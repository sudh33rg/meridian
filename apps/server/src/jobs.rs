//! Durable background jobs on PostgreSQL: transactional enqueue (a job commits or rolls back with
//! the change that caused it), `SKIP LOCKED` claiming, exponential retry, dead-letter state.
//! The worker runs on the system connection; request transactions can only INSERT.
use crate::{config::Config, mail::Mailer, *};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

pub(crate) async fn enqueue(
    db: &mut PgConnection,
    tenant: Option<Uuid>,
    kind: &str,
    payload: Value,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO jobs(tenant_id,kind,payload) VALUES($1,$2,$3)")
        .bind(tenant)
        .bind(kind)
        .bind(payload)
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
    Ok(())
}

struct Ctx {
    db: PgPool,
    cfg: Arc<Config>,
    mailer: Arc<Mailer>,
    store: crate::storage::Store,
}

#[derive(FromRow)]
struct Job {
    id: i64,
    kind: String,
    payload: Value,
    attempts: i32,
    max_attempts: i32,
}

pub(crate) fn spawn_worker(
    db: PgPool,
    cfg: Arc<Config>,
    mailer: Arc<Mailer>,
    store: crate::storage::Store,
) {
    let ctx = Arc::new(Ctx {
        db: db.clone(),
        cfg,
        mailer,
        store,
    });
    tokio::spawn(async move {
        let mut listener = sqlx::postgres::PgListener::connect_with(&ctx.db).await.ok();
        if let Some(l) = listener.as_mut() {
            let _ = l.listen("jobs").await;
        }
        loop {
            match run_one(&ctx).await {
                Ok(true) => continue,
                Ok(false) => {}
                Err(e) => tracing::error!(error=%e, "job worker error"),
            }
            if let Ok(n) =
                sqlx::query_scalar::<_, i64>("SELECT count(*) FROM jobs WHERE state='queued'")
                    .fetch_one(&ctx.db)
                    .await
            {
                metrics::gauge!("meridian_jobs_queued").set(n as f64);
            }
            match listener.as_mut() {
                Some(l) => {
                    let _ = tokio::time::timeout(Duration::from_secs(5), l.recv()).await;
                }
                None => tokio::time::sleep(Duration::from_secs(5)).await,
            }
        }
    });
}

async fn run_one(ctx: &Ctx) -> Result<bool, sqlx::Error> {
    let job: Option<Job> = sqlx::query_as(
        "UPDATE jobs SET state='running', locked_at=now(), attempts=attempts+1 \
         WHERE id=(SELECT id FROM jobs WHERE (state='queued' AND run_at<=now()) \
                      OR (state='running' AND locked_at<now()-interval '10 minutes') \
                   ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED) \
         RETURNING id,kind,payload,attempts,max_attempts",
    )
    .fetch_optional(&ctx.db)
    .await?;
    let Some(job) = job else { return Ok(false) };
    let started = std::time::Instant::now();
    let result = handle(ctx, &job).await;
    metrics::histogram!("meridian_job_seconds", "kind" => job.kind.clone())
        .record(started.elapsed().as_secs_f64());
    match result {
        Ok(()) => {
            metrics::counter!("meridian_jobs_total", "kind" => job.kind.clone(), "outcome" => "ok")
                .increment(1);
            sqlx::query(
                "UPDATE jobs SET state='done', finished_at=now(), last_error=NULL WHERE id=$1",
            )
            .bind(job.id)
            .execute(&ctx.db)
            .await?;
        }
        Err(e) => {
            let dead = job.attempts >= job.max_attempts;
            tracing::warn!(job=job.id, kind=%job.kind, attempt=job.attempts, error=%e, dead, "job failed");
            metrics::counter!("meridian_jobs_total", "kind" => job.kind.clone(), "outcome" => if dead { "dead" } else { "retry" }).increment(1);
            sqlx::query(
                "UPDATE jobs SET state=CASE WHEN $2 THEN 'dead' ELSE 'queued' END, \
                 run_at=now()+make_interval(secs => 30*power(2,$3)), last_error=$4, \
                 finished_at=CASE WHEN $2 THEN now() END WHERE id=$1",
            )
            .bind(job.id)
            .bind(dead)
            .bind(job.attempts as f64)
            .bind(e.chars().take(500).collect::<String>())
            .execute(&ctx.db)
            .await?;
        }
    }
    Ok(true)
}

async fn handle(ctx: &Ctx, job: &Job) -> Result<(), String> {
    match job.kind.as_str() {
        "email.auth_token" => email_auth_token(ctx, &job.payload).await,
        "email.invite" => email_invite(ctx, &job.payload).await,
        "email.digest" => email_digest(ctx, &job.payload).await,
        "chat.notify" => crate::api::chat::deliver(&ctx.db, &ctx.cfg, &job.payload).await,
        "attachment.scan" => {
            let id = payload_id(&job.payload, "attachment_id")?;
            crate::attachments::scan_job(&ctx.db, &ctx.cfg, &ctx.store, id).await
        }
        "attachment.purge" => {
            let key = job
                .payload
                .get("storage_key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "attachment.purge needs a storage_key".to_string())?;
            use object_store::ObjectStoreExt;
            match ctx.store.delete(&object_store::path::Path::from(key)).await {
                Ok(()) | Err(object_store::Error::NotFound { .. }) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        }
        other => Err(format!("unknown job kind {other}")),
    }
}

fn payload_id(p: &Value, key: &str) -> Result<Uuid, String> {
    p.get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| format!("payload.{key} missing"))
}

async fn email_auth_token(ctx: &Ctx, payload: &Value) -> Result<(), String> {
    let id = payload_id(payload, "auth_token_id")?;
    let row: Option<(String, bool, String, String)> = sqlx::query_as(
        "SELECT t.kind, (t.used_at IS NOT NULL OR t.expires_at<now()), u.email, u.display_name \
         FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=$1",
    )
    .bind(id)
    .fetch_optional(&ctx.db)
    .await
    .map_err(|e| e.to_string())?;
    let Some((kind, stale, email, name)) = row else {
        return Ok(());
    };
    if stale {
        return Ok(());
    }
    let token = derive_token(&ctx.cfg.secret, "auth_token", id);
    let base = &ctx.cfg.public_url;
    let (subject, body) = if kind == "reset_password" {
        (
            "Reset your Meridian password",
            format!("Hi {name},\n\nUse this link within one hour to choose a new password:\n{base}/auth/reset?token={token}\n\nIf you did not ask for this, ignore this message; your password is unchanged.\n"),
        )
    } else {
        (
            "Confirm your Meridian email address",
            format!("Hi {name},\n\nConfirm your email address within 48 hours:\n{base}/auth/verify?token={token}\n"),
        )
    };
    ctx.mailer.send(&email, subject, &body).await
}

/// One member's daily digest. Nothing is sent unless email is enabled on this server.
async fn email_digest(ctx: &Ctx, payload: &Value) -> Result<(), String> {
    if !(ctx.cfg.email_notifications && ctx.cfg.smtp_url.is_some()) {
        return Ok(());
    }
    let tenant = payload_id(payload, "tenant_id")?;
    let user = payload_id(payload, "user_id")?;
    let text = crate::api::digest::digest_text(&ctx.db, &ctx.cfg.secret, &ctx.cfg.public_url, tenant, user)
        .await
        .map_err(|e| e.to_string())?;
    match text {
        Some((subject, body, to)) => ctx.mailer.send(&to, &subject, &body).await,
        None => Ok(()),
    }
}

async fn email_invite(ctx: &Ctx, payload: &Value) -> Result<(), String> {
    let id = payload_id(payload, "invitation_id")?;
    let row: Option<(String, String, bool, String, String)> = sqlx::query_as(
        "SELECT i.email, i.role, (i.accepted_at IS NOT NULL OR i.expires_at<now()), t.name, u.display_name \
         FROM invitations i JOIN tenants t ON t.id=i.tenant_id JOIN users u ON u.id=i.invited_by WHERE i.id=$1",
    )
    .bind(id)
    .fetch_optional(&ctx.db)
    .await
    .map_err(|e| e.to_string())?;
    let Some((email, role, stale, org, inviter)) = row else {
        return Ok(());
    };
    if stale {
        return Ok(());
    }
    let token = derive_token(&ctx.cfg.secret, "invite", id);
    let body = format!(
        "{inviter} invited you to join {org} on Meridian as {role}.\n\nAccept within 72 hours:\n{}/auth/accept?token={token}\n",
        ctx.cfg.public_url
    );
    ctx.mailer
        .send(
            &email,
            &format!("You're invited to {org} on Meridian"),
            &body,
        )
        .await
}

/// Housekeeping on the system connection, once an hour. Idempotency keys are kept for 24 hours,
/// the minimum window Stripe documents; after pruning, a reused key creates a new record.
pub(crate) fn spawn_maintenance(db: PgPool, email_on: bool) {
    tokio::spawn(async move {
        loop {
            prune_idempotency_keys(&db).await;
            // Burndown: one row per active sprint per day (Phase E5).
            match crate::api::agile::capture_active_sprints(&db).await {
                Ok(n) if n > 0 => tracing::debug!(sprints = n, "captured sprint burndown"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "sprint burndown capture failed"),
            }
            // Daily digests are queued for opted-in members with unread notifications (Phase I2).
            match crate::api::digest::enqueue_due_digests(&db, email_on).await {
                Ok(n) if n > 0 => tracing::info!(digests = n, "queued email digests"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "digest queueing failed"),
            }
            // Requests past their target are escalated once to the owners and admins (Phase K2).
            match crate::api::service::escalate_breached(&db).await {
                Ok(n) if n > 0 => tracing::info!(notifications = n, "escalated requests past target"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "request escalation failed"),
            }
            // Personal reminders that are due become notifications (Phase F5).
            match crate::api::issue_content::send_due_reminders(&db).await {
                Ok(n) if n > 0 => tracing::info!(reminders = n, "sent due reminders"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "reminder delivery failed"),
            }
            // Trash past its 30-day window is purged (Phase F6).
            match crate::api::issues::purge_expired_trash(&db).await {
                Ok(n) if n > 0 => tracing::info!(issues = n, "purged expired trash"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "trash purge failed"),
            }
            // Scheduled automation rules that are due run on their issues (Phase I1).
            match crate::api::collab::run_due_scheduled_rules(&db).await {
                Ok(n) if n > 0 => tracing::info!(runs = n, "ran scheduled automation rules"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "scheduled automation failed"),
            }
            // Saved views with a subscriber who is due get a notification (Phase I2).
            match crate::api::personal::run_due_view_subscriptions(&db).await {
                Ok(n) if n > 0 => tracing::info!(notifications = n, "sent saved-view subscriptions"),
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "saved-view subscriptions failed"),
            }
            // Shared rate-limit counters older than an hour are not needed (Phase N).
            if let Err(e) = sqlx::query("DELETE FROM rate_limit_windows WHERE window_start < now() - interval '1 hour'")
                .execute(&db)
                .await
            {
                tracing::error!(error=%e, "rate limit cleanup failed");
            }
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
}

async fn prune_idempotency_keys(db: &PgPool) {
    let mut total: u64 = 0;
    loop {
        let result = sqlx::query(
            "DELETE FROM idempotency_keys WHERE (tenant_id,user_id,scope,key) IN \
             (SELECT tenant_id,user_id,scope,key FROM idempotency_keys \
              WHERE created_at < now() - interval '24 hours' LIMIT 5000)",
        )
        .execute(db)
        .await;
        match result {
            Ok(r) => {
                total += r.rows_affected();
                // A full batch may mean more rows are waiting; a short one means we are done.
                if r.rows_affected() == 5000 {
                    continue;
                }
                if total > 0 {
                    tracing::info!(pruned = total, "pruned expired idempotency keys");
                }
                return;
            }
            Err(e) => {
                tracing::error!(error=%e, "idempotency key pruning failed");
                return;
            }
        }
    }
}

/// `json!` re-exported for callers that enqueue.
pub(crate) fn payload(key: &str, id: Uuid) -> Value {
    json!({ key: id })
}
