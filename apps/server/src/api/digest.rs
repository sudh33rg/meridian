//! Email and digests. Members opt in to a daily digest of their unread notifications. The
//! digest is sent through the job queue, only when the server enables email, and every email carries a
//! signed unsubscribe link. Nothing is sent to anyone who has not opted in.
use crate::api::common::*;
use crate::*;
use axum::routing::get;
use hmac::{Hmac, Mac};
use sha2::Sha256;

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct DigestSetting {
    /// Email me a daily digest of my unread notifications.
    pub(crate) enabled: bool,
    /// Whether the server currently sends email at all (EMAIL_NOTIFICATIONS and SMTP_URL).
    pub(crate) email_available: bool,
}

/// The signed token in an unsubscribe link. It is derived from the server secret, so it cannot be
/// forged, and it names one tenant and one member.
pub(crate) fn unsubscribe_token(secret: &[u8], tenant: Uuid, user: Uuid) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret).expect("HMAC takes any key length");
    mac.update(format!("digest-unsubscribe:{tenant}:{user}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn token_ok(secret: &[u8], tenant: Uuid, user: Uuid, token: &str) -> bool {
    let Ok(bytes) = hex::decode(token) else {
        return false;
    };
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret).expect("HMAC takes any key length");
    mac.update(format!("digest-unsubscribe:{tenant}:{user}").as_bytes());
    mac.verify_slice(&bytes).is_ok()
}

#[utoipa::path(get, path = "/api/me/digest", tag = "notifications", responses((status = 200, description = "Your digest setting", body = DigestSetting), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_digest(
    mut tx: Tx,
    State(app): State<App>,
) -> ApiResult<Json<DigestSetting>> {
    let i = tx.identity.clone();
    let enabled: Option<bool> = sqlx::query_scalar(
        "SELECT enabled FROM email_digest_settings WHERE tenant_id=$1 AND user_id=$2",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(DigestSetting {
        enabled: enabled.unwrap_or(false),
        email_available: app.cfg.email_notifications && app.cfg.smtp_url.is_some(),
    }))
}

#[utoipa::path(put, path = "/api/me/digest", tag = "notifications", request_body = DigestSetting, responses((status = 200, description = "Saved", body = DigestSetting), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_digest(
    mut tx: Tx,
    State(app): State<App>,
    Json(v): Json<DigestSetting>,
) -> ApiResult<Json<DigestSetting>> {
    let i = tx.identity.clone();
    sqlx::query(
        "INSERT INTO email_digest_settings(tenant_id,user_id,enabled) VALUES($1,$2,$3) \
         ON CONFLICT (tenant_id,user_id) DO UPDATE SET enabled=EXCLUDED.enabled",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(v.enabled)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(DigestSetting {
        enabled: v.enabled,
        email_available: app.cfg.email_notifications && app.cfg.smtp_url.is_some(),
    }))
}

#[derive(Deserialize)]
pub(crate) struct UnsubscribeQuery {
    tenant: Uuid,
    user: Uuid,
    token: String,
}

/// The link in every digest. It turns the digest off for one member of one workspace. It is a GET so
/// that mail clients can open it, and it changes nothing unless the signed token is right.
#[utoipa::path(get, path = "/api/email/unsubscribe", tag = "notifications", params(("tenant" = Uuid, Query, description = "Workspace id"), ("user" = Uuid, Query, description = "Member id"), ("token" = String, Query, description = "Signed token from the email")), responses((status = 200, description = "Unsubscribed", body = String), (status = 400, description = "The link is not valid", body = ErrorBody)))]
pub(crate) async fn unsubscribe(
    State(app): State<App>,
    axum::extract::Query(q): axum::extract::Query<UnsubscribeQuery>,
) -> ApiResult<axum::response::Html<&'static str>> {
    if !token_ok(&app.cfg.secret, q.tenant, q.user, &q.token) {
        return Err(bad("This unsubscribe link is not valid"));
    }
    sqlx::query(
        "INSERT INTO email_digest_settings(tenant_id,user_id,enabled) VALUES($1,$2,false) \
         ON CONFLICT (tenant_id,user_id) DO UPDATE SET enabled=false",
    )
    .bind(q.tenant)
    .bind(q.user)
    .execute(&app.db)
    .await
    .map_err(db_err)?;
    Ok(axum::response::Html(
        "<p>You will no longer receive the Meridian digest.</p>",
    ))
}

/// Queues one digest job for each opted-in member who has unread notifications and has not had a digest
/// in the last day. Runs from the hourly maintenance loop on the system connection. Does nothing unless
/// email is enabled.
pub(crate) async fn enqueue_due_digests(
    db: &sqlx::PgPool,
    email_on: bool,
) -> Result<u64, sqlx::Error> {
    if !email_on {
        return Ok(0);
    }
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT s.tenant_id, s.user_id FROM email_digest_settings s \
         WHERE s.enabled AND (s.last_sent_at IS NULL OR s.last_sent_at < now() - interval '23 hours') \
         AND EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=s.tenant_id AND n.recipient_id=s.user_id \
           AND n.read_at IS NULL AND n.created_at > now() - interval '24 hours') LIMIT 500",
    )
    .fetch_all(db)
    .await?;
    let mut queued = 0u64;
    for (tenant, user) in rows {
        sqlx::query(
            "UPDATE email_digest_settings SET last_sent_at=now() WHERE tenant_id=$1 AND user_id=$2",
        )
        .bind(tenant)
        .bind(user)
        .execute(db)
        .await?;
        sqlx::query("INSERT INTO jobs(tenant_id,kind,payload) VALUES($1,'email.digest',$2)")
            .bind(tenant)
            .bind(serde_json::json!({ "tenant_id": tenant, "user_id": user }))
            .execute(db)
            .await?;
        queued += 1;
    }
    Ok(queued)
}

/// Builds the digest text for one member: their unread notifications from the last day, and the
/// unsubscribe link. Returns None when there is nothing to say.
pub(crate) async fn digest_text(
    db: &sqlx::PgPool,
    secret: &[u8],
    public_url: &str,
    tenant: Uuid,
    user: Uuid,
) -> Result<Option<(String, String, String)>, sqlx::Error> {
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(db)
        .await?;
    let titles: Vec<String> = sqlx::query_scalar(
        "SELECT title FROM notifications WHERE tenant_id=$1 AND recipient_id=$2 AND read_at IS NULL \
         AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 20",
    )
    .bind(tenant)
    .bind(user)
    .fetch_all(db)
    .await?;
    if titles.is_empty() {
        return Ok(None);
    }
    let token = unsubscribe_token(secret, tenant, user);
    let link =
        format!("{public_url}/api/email/unsubscribe?tenant={tenant}&user={user}&token={token}");
    let mut body = String::from("Your unread Meridian notifications from the last day:\n\n");
    for t in &titles {
        body.push_str(&format!("- {t}\n"));
    }
    body.push_str(&format!("\nTo stop this digest: {link}\n"));
    Ok(Some(("Your Meridian digest".to_string(), body, email)))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/me/digest", get(get_digest).put(set_digest))
        .route("/api/email/unsubscribe", get(unsubscribe))
}
