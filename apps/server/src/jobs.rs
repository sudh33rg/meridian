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
}

#[derive(FromRow)]
struct Job {
    id: i64,
    kind: String,
    payload: Value,
    attempts: i32,
    max_attempts: i32,
}

pub(crate) fn spawn_worker(db: PgPool, cfg: Arc<Config>, mailer: Arc<Mailer>) {
    let ctx = Arc::new(Ctx {
        db: db.clone(),
        cfg,
        mailer,
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

/// `json!` re-exported for callers that enqueue.
pub(crate) fn payload(key: &str, id: Uuid) -> Value {
    json!({ key: id })
}
