//! Outbound webhooks: registration (admin) and the delivery dispatcher.
//!
//! Safety properties (Constitution III.7)
//! * **HTTPS only** and **SSRF-safe**: URLs are validated at registration and again at delivery;
//!   the client resolves through `safe_http` (public addresses only, connection pinned to the
//!   vetted addresses, no redirects).
//! * **Signed**: Standard Webhooks headers (`webhook-id`, `webhook-timestamp`,
//!   `webhook-signature: v1,<base64 HMAC-SHA256>`); the per-endpoint secret is shown once and is
//!   stored sealed (AES-256-GCM), never in the clear.
//! * **Reliable**: deliveries are queued in the same transaction as the event, retried with
//!   exponential backoff, then dead-lettered; endpoints that keep failing are disabled.
//! * **Bounded**: per-workspace delivery rate limit, plan limit on endpoints, 10 s timeouts.
use crate::api::common::log_event_system;
use crate::billing::{enforce_limit, Limit};
use crate::config::Config;
use crate::safe_http;
use crate::secrets::{open, seal};
use crate::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

const MAX_ATTEMPTS: i32 = 10;
const DISABLE_AFTER_FAILURES: i32 = 20;

fn require_admin(i: &Identity) -> ApiResult<()> {
    if i.role == "owner" || i.role == "admin" {
        Ok(())
    } else {
        Err(forbidden())
    }
}

fn new_secret() -> String {
    let mut raw = [0u8; 24];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut raw);
    format!("whsec_{}", B64.encode(raw))
}

fn valid_events(events: &[String]) -> bool {
    events.len() <= 50
        && events.iter().all(|e| {
            e == "*"
                || e.split_once('.').is_some_and(|(a, b)| {
                    !a.is_empty()
                        && a.len() <= 40
                        && a.chars().all(|c| c.is_ascii_lowercase() || c == '_')
                        && (b == "*"
                            || (b.len() <= 40
                                && b.chars().all(|c| c.is_ascii_lowercase() || c == '_')))
                })
        })
}

/// `v1,<base64 HMAC-SHA256(secret, "{id}.{timestamp}.{body}")>` (secret = base64 after `whsec_`).
pub(crate) fn sign(secret: &str, id: &str, ts: i64, body: &str) -> Option<String> {
    let key = B64.decode(secret.strip_prefix("whsec_")?).ok()?;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key).ok()?;
    mac.update(format!("{id}.{ts}.{body}").as_bytes());
    Some(format!("v1,{}", B64.encode(mac.finalize().into_bytes())))
}

// ---------------------------------------------------------------- admin API

#[utoipa::path(get, path = "/api/admin/webhooks", tag = "webhooks", responses((status = 200, description = "Registered endpoints (never the secret)", body = Vec<Object>), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list(State(app): State<App>, i: Identity) -> ApiResult<Json<Vec<Value>>> {
    require_admin(&i)?;
    let rows = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'url',url,'enabled',enabled,'events',events,'consecutive_failures',consecutive_failures,'disabled_reason',disabled_reason,'last_success_at',last_success_at,'created_at',created_at) FROM webhooks WHERE tenant_id=$1 AND secret_sealed IS NOT NULL ORDER BY created_at DESC LIMIT 200")
        .bind(i.tenant_id).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WebhookInput {
    pub(crate) name: String,
    pub(crate) url: String,
    /// Event filters such as `issue.created`, `page.*` or `*`. Empty means every event.
    pub(crate) events: Option<Vec<String>>,
}

#[utoipa::path(post, path = "/api/admin/webhooks", tag = "webhooks", request_body = WebhookInput, responses((status = 201, description = "Created; the signing secret is shown once", body = Object), (status = 400, description = "Invalid URL (must be public https) or filters", body = ErrorBody), (status = 402, description = "Plan limit reached", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<WebhookInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_admin(&i)?;
    let name = v.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(bad("Give the endpoint a short name"));
    }
    let url = safe_http::check_url(&app.cfg, v.url.trim())
        .map_err(|e| bad(&format!("Webhook URL rejected: {e}")))?;
    let events = v.events.unwrap_or_default();
    if !valid_events(&events) {
        return Err(bad("Events must look like issue.created, page.* or *"));
    }
    let mut db = app.db.acquire().await.map_err(db_err)?;
    enforce_limit(&mut db, i.tenant_id, Limit::Webhooks).await?;
    let id = Uuid::new_v4();
    let secret = new_secret();
    sqlx::query("INSERT INTO webhooks(id,tenant_id,name,url,secret_sealed,enabled,events) VALUES($1,$2,$3,$4,$5,true,$6)")
        .bind(id).bind(i.tenant_id).bind(name).bind(url.as_str())
        .bind(seal(&app.cfg, &format!("webhook:{id}"), secret.as_bytes())).bind(&events)
        .execute(&mut *db).await.map_err(db_err)?;
    log_event_system(
        &mut db,
        i.tenant_id,
        i.user_id,
        "webhook_created",
        "webhook",
        id,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id": id, "secret": secret})),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WebhookPatch {
    pub(crate) name: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) enabled: Option<bool>,
    pub(crate) events: Option<Vec<String>>,
}

#[utoipa::path(patch, path = "/api/admin/webhooks/{id}", tag = "webhooks", params(("id" = Uuid, Path, description = "Webhook id")), request_body = WebhookPatch, responses((status = 204, description = "Updated (re-enabling resets the failure counter)"), (status = 400, description = "Invalid URL or filters", body = ErrorBody), (status = 404, description = "No such webhook", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
    Json(v): Json<WebhookPatch>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    let url = match v.url.as_deref() {
        Some(u) => Some(
            safe_http::check_url(&app.cfg, u.trim())
                .map_err(|e| bad(&format!("Webhook URL rejected: {e}")))?
                .to_string(),
        ),
        None => None,
    };
    if let Some(e) = &v.events {
        if !valid_events(e) {
            return Err(bad("Events must look like issue.created, page.* or *"));
        }
    }
    let name = v
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty() && n.len() <= 80);
    let done = sqlx::query("UPDATE webhooks SET name=COALESCE($3,name), url=COALESCE($4,url), events=COALESCE($5,events), enabled=COALESCE($6,enabled), consecutive_failures=CASE WHEN $6 IS TRUE THEN 0 ELSE consecutive_failures END, disabled_reason=CASE WHEN $6 IS TRUE THEN NULL ELSE disabled_reason END WHERE tenant_id=$1 AND id=$2 AND secret_sealed IS NOT NULL")
        .bind(i.tenant_id).bind(id).bind(name).bind(url).bind(&v.events).bind(v.enabled)
        .execute(&app.db).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such webhook"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/admin/webhooks/{id}", tag = "webhooks", params(("id" = Uuid, Path, description = "Webhook id")), responses((status = 204, description = "Removed with its delivery history"), (status = 404, description = "No such webhook", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    let done = sqlx::query("DELETE FROM webhooks WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such webhook"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/admin/webhooks/{id}/rotate-secret", tag = "webhooks", params(("id" = Uuid, Path, description = "Webhook id")), responses((status = 200, description = "The new secret, shown once; the old one stops working", body = Object), (status = 404, description = "No such webhook", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn rotate_secret(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let secret = new_secret();
    let done = sqlx::query("UPDATE webhooks SET secret_sealed=$3 WHERE tenant_id=$1 AND id=$2 AND secret_sealed IS NOT NULL")
        .bind(i.tenant_id).bind(id).bind(seal(&app.cfg, &format!("webhook:{id}"), secret.as_bytes()))
        .execute(&app.db).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such webhook"));
    }
    Ok(Json(json!({"secret": secret})))
}

#[utoipa::path(post, path = "/api/admin/webhooks/{id}/test", tag = "webhooks", params(("id" = Uuid, Path, description = "Webhook id")), responses((status = 202, description = "A webhook.test event was queued"), (status = 404, description = "No such webhook", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn test_event(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    let payload = json!({"type": "webhook.test", "tenant_id": i.tenant_id, "occurred_at": Utc::now(), "data": {"message": "This is a test event from Meridian"}});
    let done = sqlx::query("INSERT INTO webhook_deliveries(tenant_id,webhook_id,event_type,payload) SELECT tenant_id,id,'webhook.test',$3 FROM webhooks WHERE tenant_id=$1 AND id=$2 AND secret_sealed IS NOT NULL")
        .bind(i.tenant_id).bind(id).bind(payload).execute(&app.db).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such webhook"));
    }
    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(get, path = "/api/admin/webhooks/{id}/deliveries", tag = "webhooks", params(("id" = Uuid, Path, description = "Webhook id")), responses((status = 200, description = "Most recent deliveries", body = Vec<Object>), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn deliveries(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    require_admin(&i)?;
    let rows = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'event_type',event_type,'state',state,'attempts',attempts,'last_status',last_status,'last_error',last_error,'next_attempt_at',next_attempt_at,'created_at',created_at,'delivered_at',delivered_at) FROM webhook_deliveries WHERE tenant_id=$1 AND webhook_id=$2 ORDER BY created_at DESC LIMIT 50")
        .bind(i.tenant_id).bind(id).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/admin/webhook-deliveries/{id}/redeliver", tag = "webhooks", params(("id" = Uuid, Path, description = "Delivery id")), responses((status = 202, description = "A copy was queued"), (status = 404, description = "No such delivery", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn redeliver(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    let done = sqlx::query("INSERT INTO webhook_deliveries(tenant_id,webhook_id,event_sync_id,event_type,payload) SELECT tenant_id,webhook_id,event_sync_id,event_type,payload FROM webhook_deliveries WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id).bind(id).execute(&app.db).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such delivery"));
    }
    Ok(StatusCode::ACCEPTED)
}

// ---------------------------------------------------------------- dispatcher

#[derive(FromRow)]
struct Due {
    id: Uuid,
    tenant_id: Uuid,
    webhook_id: Uuid,
    event_type: String,
    payload: Value,
    attempts: i32,
}

pub(crate) fn spawn_dispatcher(db: PgPool, cfg: Arc<Config>) {
    tokio::spawn(async move {
        let mut listener = sqlx::postgres::PgListener::connect_with(&db).await.ok();
        if let Some(l) = listener.as_mut() {
            let _ = l.listen("webhooks").await;
        }
        let http = safe_http::client(&cfg);
        loop {
            match run_batch(&db, &cfg, &http).await {
                Ok(n) if n > 0 => continue,
                Ok(_) => {}
                Err(e) => tracing::error!(error=%e, "webhook dispatcher error"),
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

async fn run_batch(
    db: &PgPool,
    cfg: &Config,
    http: &reqwest::Client,
) -> Result<usize, sqlx::Error> {
    let due: Vec<Due> = sqlx::query_as(
        "UPDATE webhook_deliveries SET state='sending', attempts=attempts+1, locked_at=now() \
         WHERE id IN (SELECT id FROM webhook_deliveries \
                      WHERE (state='pending' AND next_attempt_at<=now()) OR (state='sending' AND locked_at<now()-interval '2 minutes') \
                      ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) \
         RETURNING id,tenant_id,webhook_id,event_type,payload,attempts",
    )
    .fetch_all(db)
    .await?;
    let n = due.len();
    for d in due {
        deliver(db, cfg, http, d).await?;
    }
    Ok(n)
}

async fn finish(
    db: &PgPool,
    id: Uuid,
    state: &str,
    status: Option<i32>,
    error: Option<String>,
    retry_in: Option<i64>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE webhook_deliveries SET state=$2, last_status=$3, last_error=$4, next_attempt_at=now()+make_interval(secs => COALESCE($5,0)), delivered_at=CASE WHEN $2='delivered' THEN now() END, locked_at=NULL WHERE id=$1")
        .bind(id).bind(state).bind(status).bind(error.map(|e| e.chars().take(300).collect::<String>())).bind(retry_in.map(|s| s as f64))
        .execute(db).await?;
    Ok(())
}

async fn deliver(
    db: &PgPool,
    cfg: &Config,
    http: &reqwest::Client,
    d: Due,
) -> Result<(), sqlx::Error> {
    let hook: Option<(String, Option<String>, bool)> = sqlx::query_as(
        "SELECT url,secret_sealed,enabled FROM webhooks WHERE tenant_id=$1 AND id=$2",
    )
    .bind(d.tenant_id)
    .bind(d.webhook_id)
    .fetch_optional(db)
    .await?;
    let Some((url, sealed, enabled)) = hook else {
        return finish(
            db,
            d.id,
            "dead",
            None,
            Some("webhook was deleted".into()),
            None,
        )
        .await;
    };
    let secret = sealed
        .and_then(|s| open(cfg, &format!("webhook:{}", d.webhook_id), &s))
        .and_then(|b| String::from_utf8(b).ok());
    let Some(secret) = secret.filter(|_| enabled || d.event_type == "webhook.test") else {
        return finish(
            db,
            d.id,
            "dead",
            None,
            Some("webhook is disabled or its secret is unreadable".into()),
            None,
        )
        .await;
    };
    // Per-workspace rate limit: defer, do not burn an attempt.
    let recent: i64 = sqlx::query_scalar("SELECT count(*) FROM webhook_deliveries WHERE tenant_id=$1 AND state IN ('delivered','dead') AND COALESCE(delivered_at, next_attempt_at) > now()-interval '1 minute'")
        .bind(d.tenant_id).fetch_one(db).await?;
    if recent >= cfg.webhook_per_min as i64 {
        sqlx::query("UPDATE webhook_deliveries SET state='pending', attempts=attempts-1, next_attempt_at=now()+interval '30 seconds', locked_at=NULL WHERE id=$1")
            .bind(d.id).execute(db).await?;
        metrics::counter!("meridian_webhook_deferred_total").increment(1);
        return Ok(());
    }
    // Re-validate: configuration or DNS may have changed since registration.
    if let Err(e) = safe_http::check_url(cfg, &url) {
        return fail(db, &d, None, format!("destination refused: {e}"), true).await;
    }
    let body = d.payload.to_string();
    let ts = Utc::now().timestamp();
    let id = d.id.to_string();
    let Some(sig) = sign(&secret, &id, ts, &body) else {
        return finish(
            db,
            d.id,
            "dead",
            None,
            Some("signing secret is malformed".into()),
            None,
        )
        .await;
    };
    let started = std::time::Instant::now();
    let res = http
        .post(&url)
        .header("content-type", "application/json")
        .header("webhook-id", &id)
        .header("webhook-timestamp", ts.to_string())
        .header("webhook-signature", sig)
        .header("x-meridian-event", &d.event_type)
        .body(body)
        .send()
        .await;
    metrics::histogram!("meridian_webhook_seconds").record(started.elapsed().as_secs_f64());
    match res {
        Ok(r) if r.status().is_success() => {
            finish(
                db,
                d.id,
                "delivered",
                Some(r.status().as_u16() as i32),
                None,
                None,
            )
            .await?;
            sqlx::query("UPDATE webhooks SET consecutive_failures=0, last_success_at=now() WHERE tenant_id=$1 AND id=$2")
                .bind(d.tenant_id).bind(d.webhook_id).execute(db).await?;
            metrics::counter!("meridian_webhooks_total", "outcome" => "delivered").increment(1);
            Ok(())
        }
        Ok(r) => {
            let status = r.status().as_u16() as i32;
            // 3xx/4xx (other than 408/429) will not improve by retrying.
            let permanent = (300..500).contains(&status) && status != 408 && status != 429;
            fail(
                db,
                &d,
                Some(status),
                format!("endpoint answered HTTP {status}"),
                permanent,
            )
            .await
        }
        Err(e) => {
            fail(
                db,
                &d,
                None,
                format!("request failed: {}", e.without_url()),
                false,
            )
            .await
        }
    }
}

async fn fail(
    db: &PgPool,
    d: &Due,
    status: Option<i32>,
    error: String,
    permanent: bool,
) -> Result<(), sqlx::Error> {
    let dead = permanent || d.attempts >= MAX_ATTEMPTS;
    let backoff = (30i64 * 2i64.pow((d.attempts.max(1) - 1) as u32)).min(6 * 3600);
    finish(
        db,
        d.id,
        if dead { "dead" } else { "pending" },
        status,
        Some(error.clone()),
        (!dead).then_some(backoff),
    )
    .await?;
    metrics::counter!("meridian_webhooks_total", "outcome" => if dead { "dead" } else { "retry" })
        .increment(1);
    if dead {
        let failures: i32 = sqlx::query_scalar("UPDATE webhooks SET consecutive_failures=consecutive_failures+1 WHERE tenant_id=$1 AND id=$2 RETURNING consecutive_failures")
            .bind(d.tenant_id).bind(d.webhook_id).fetch_optional(db).await?.unwrap_or(0);
        if failures >= DISABLE_AFTER_FAILURES {
            sqlx::query("UPDATE webhooks SET enabled=false, disabled_reason=$3 WHERE tenant_id=$1 AND id=$2")
                .bind(d.tenant_id).bind(d.webhook_id).bind(format!("Disabled after {failures} consecutive failed deliveries: {error}"))
                .execute(db).await?;
            tracing::warn!(webhook=%d.webhook_id, "webhook disabled after repeated failures");
        }
    }
    Ok(())
}

pub(crate) fn routes() -> Router<App> {
    use axum::routing::patch;
    Router::new()
        .route("/api/admin/webhooks", get(list).post(create))
        .route("/api/admin/webhooks/{id}", patch(update).delete(remove))
        .route(
            "/api/admin/webhooks/{id}/rotate-secret",
            post(rotate_secret),
        )
        .route("/api/admin/webhooks/{id}/test", post(test_event))
        .route("/api/admin/webhooks/{id}/deliveries", get(deliveries))
        .route(
            "/api/admin/webhook-deliveries/{id}/redeliver",
            post(redeliver),
        )
}
