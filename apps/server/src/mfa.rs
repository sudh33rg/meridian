//! Multi-factor authentication: TOTP (RFC 6238) with single-use recovery codes, a login step-up
//! challenge, and a per-workspace "require MFA" policy.
//!
//! Security notes
//! * The TOTP seed is sealed at rest (AES-256-GCM, key from `APP_SECRET`, AAD binds it to the user).
//! * A code is accepted once: the 30 s step of the last accepted code is stored and must increase.
//! * After a correct password the server issues a short-lived challenge (only its hash is stored);
//!   five wrong codes burn it. Recovery codes are random, stored as SHA-256, and single use.
//! * Disabling MFA needs the password *and* a current code, and is refused while any of the user's
//!   workspaces requires MFA.
use crate::config::Config;
use crate::secrets::{open, seal};
use crate::*;
use axum::response::Response;
use axum::routing::{get, patch};
use serde_json::{json, Value};
use totp_rs::{Algorithm, Secret, TOTP};

const ISSUER: &str = "Meridian";
const RECOVERY_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

fn totp_for(secret: Vec<u8>, account: &str) -> ApiResult<TOTP> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some(ISSUER.to_string()),
        account.replace(':', "_"),
    )
    .map_err(|_| ApiError::Internal("Could not build the authenticator".into()))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The accepted 30 s step for `code` (current step ±1 for clock drift), if it is valid and newer
/// than the last one used.
fn accepted_step(t: &TOTP, code: &str, last_step: i64) -> Option<i64> {
    let code = code.trim();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let base = (now_secs() / 30) as i64;
    [0i64, -1, 1].into_iter().find_map(|d| {
        let step = base + d;
        (step > last_step
            && step > 0
            && crate::auth::constant_time_eq(&t.generate((step as u64) * 30), code))
        .then_some(step)
    })
}

fn normalize_recovery(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn new_recovery_codes() -> Vec<String> {
    let mut rng = rand::thread_rng();
    (0..10)
        .map(|_| {
            let raw: String = (0..12)
                .map(|_| RECOVERY_ALPHABET[rand::Rng::gen_range(&mut rng, 0..RECOVERY_ALPHABET.len())] as char)
                .collect();
            format!("{}-{}", &raw[..6], &raw[6..])
        })
        .collect()
}

async fn replace_recovery_codes(db: &mut PgConnection, user: Uuid) -> ApiResult<Vec<String>> {
    let codes = new_recovery_codes();
    sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id=$1")
        .bind(user)
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
    for c in &codes {
        sqlx::query("INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)")
            .bind(user)
            .bind(token_hash(&normalize_recovery(c)))
            .execute(&mut *db)
            .await
            .map_err(db_err)?;
    }
    Ok(codes)
}

struct Factor {
    secret: Vec<u8>,
    last_step: i64,
    confirmed: bool,
}

async fn load_factor(db: &mut PgConnection, cfg: &Config, user: Uuid) -> ApiResult<Option<Factor>> {
    let row: Option<(String, i64, bool)> = sqlx::query_as(
        "SELECT totp_secret_sealed, last_used_step, confirmed_at IS NOT NULL FROM user_mfa WHERE user_id=$1 FOR UPDATE",
    )
    .bind(user)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(row.and_then(|(sealed, last_step, confirmed)| {
        open(cfg, &format!("totp:{user}"), &sealed).map(|secret| Factor {
            secret,
            last_step,
            confirmed,
        })
    }))
}

async fn account_email(db: &mut PgConnection, user: Uuid) -> ApiResult<String> {
    sqlx::query_scalar("SELECT email FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)
}

/// Check a TOTP code or a recovery code for a user with confirmed MFA, consuming it on success.
/// Must run inside the caller's transaction (the factor row is locked).
pub(crate) async fn check_second_factor(
    db: &mut PgConnection,
    cfg: &Config,
    user: Uuid,
    code: &str,
) -> ApiResult<bool> {
    let Some(f) = load_factor(db, cfg, user).await? else {
        return Ok(false);
    };
    if !f.confirmed {
        return Ok(false);
    }
    let email = account_email(db, user).await?;
    if let Some(step) = accepted_step(&totp_for(f.secret, &email)?, code, f.last_step) {
        sqlx::query("UPDATE user_mfa SET last_used_step=$2 WHERE user_id=$1")
            .bind(user)
            .bind(step)
            .execute(&mut *db)
            .await
            .map_err(db_err)?;
        return Ok(true);
    }
    let used = sqlx::query("UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL")
        .bind(user)
        .bind(token_hash(&normalize_recovery(code)))
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
    Ok(used.rows_affected() == 1)
}

pub(crate) async fn has_mfa(db: &PgPool, user: Uuid) -> ApiResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_mfa WHERE user_id=$1 AND confirmed_at IS NOT NULL)")
        .bind(user)
        .fetch_one(db)
        .await
        .map_err(db_err)
}

/// Park a sign-in that passed the password step and hand back the challenge token.
pub(crate) async fn open_challenge(
    db: &PgPool,
    tenant: Uuid,
    user: Uuid,
    user_agent: &str,
) -> ApiResult<String> {
    let token = mint_token();
    sqlx::query("INSERT INTO mfa_challenges(token_hash,user_id,tenant_id,user_agent,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')")
        .bind(token_hash(&token))
        .bind(user)
        .bind(tenant)
        .bind(user_agent.chars().take(200).collect::<String>())
        .execute(db)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM mfa_challenges WHERE expires_at<now()-interval '1 hour'")
        .execute(db)
        .await
        .map_err(db_err)?;
    Ok(token)
}

// ---------------------------------------------------------------- handlers

#[utoipa::path(get, path = "/api/auth/mfa", tag = "mfa", responses((status = 200, description = "MFA status of the signed-in user", body = Object), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn status(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    let row: Option<(bool, i64)> = sqlx::query_as(
        "SELECT m.confirmed_at IS NOT NULL, (SELECT count(*) FROM mfa_recovery_codes r WHERE r.user_id=m.user_id AND r.used_at IS NULL) FROM user_mfa m WHERE m.user_id=$1",
    )
    .bind(i.user_id)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;
    let required: bool = sqlx::query_scalar("SELECT require_mfa FROM tenants WHERE id=$1")
        .bind(i.tenant_id)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    let (enabled, codes) = row.unwrap_or((false, 0));
    Ok(Json(json!({
        "enabled": enabled,
        "pending_enrolment": row.is_some() && !enabled,
        "recovery_codes_remaining": if enabled { codes } else { 0 },
        "workspace_requires_mfa": required,
    })))
}

#[utoipa::path(post, path = "/api/auth/mfa/enroll", tag = "mfa", responses((status = 200, description = "A fresh authenticator secret (not active until confirmed)", body = Object), (status = 400, description = "MFA is already enabled", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn enroll(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    if has_mfa(&app.db, i.user_id).await? {
        return Err(bad("MFA is already enabled; disable it first to enrol a new device"));
    }
    let email = sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id=$1")
        .bind(i.user_id)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    let mut secret = vec![0u8; 20];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut secret);
    let t = totp_for(secret.clone(), &email)?;
    sqlx::query("INSERT INTO user_mfa(user_id,totp_secret_sealed) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET totp_secret_sealed=EXCLUDED.totp_secret_sealed, last_used_step=0, confirmed_at=NULL")
        .bind(i.user_id)
        .bind(seal(&app.cfg, &format!("totp:{}", i.user_id), &secret))
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "secret": Secret::Raw(secret).to_encoded().to_string(),
        "otpauth_uri": t.get_url(),
    })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CodeInput {
    pub(crate) code: String,
}
#[utoipa::path(post, path = "/api/auth/mfa/confirm", tag = "mfa", request_body = CodeInput, responses((status = 200, description = "MFA enabled; the recovery codes are shown once", body = Object), (status = 400, description = "Wrong code or nothing to confirm", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn confirm(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<CodeInput>,
) -> ApiResult<Json<Value>> {
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let f = load_factor(&mut tx, &app.cfg, i.user_id)
        .await?
        .filter(|f| !f.confirmed)
        .ok_or_else(|| bad("Start enrolment first"))?;
    let email = account_email(&mut tx, i.user_id).await?;
    let step = accepted_step(&totp_for(f.secret, &email)?, &v.code, f.last_step)
        .ok_or_else(|| bad("That code is not correct. Check the time on your device and try again"))?;
    sqlx::query("UPDATE user_mfa SET confirmed_at=now(), last_used_step=$2 WHERE user_id=$1")
        .bind(i.user_id)
        .bind(step)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let codes = replace_recovery_codes(&mut tx, i.user_id).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "recovery_codes": codes })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct DisableInput {
    pub(crate) password: String,
    pub(crate) code: String,
}
#[utoipa::path(post, path = "/api/auth/mfa/disable", tag = "mfa", request_body = DisableInput, responses((status = 204, description = "MFA disabled"), (status = 400, description = "Wrong password or code, or a workspace requires MFA", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn disable(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<DisableInput>,
) -> ApiResult<StatusCode> {
    let required: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.disabled_at IS NULL AND t.require_mfa)",
    )
    .bind(i.user_id)
    .fetch_one(&app.db)
    .await
    .map_err(db_err)?;
    if required {
        return Err(bad("A workspace you belong to requires MFA, so it cannot be turned off"));
    }
    let stored: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(i.user_id)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    if !verify_password(&v.password, &stored) {
        return Err(bad("The password is incorrect"));
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    if !check_second_factor(&mut tx, &app.cfg, i.user_id, &v.code).await? {
        return Err(bad("That code is not correct"));
    }
    sqlx::query("DELETE FROM user_mfa WHERE user_id=$1").bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id=$1").bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/auth/mfa/recovery-codes", tag = "mfa", request_body = CodeInput, responses((status = 200, description = "A new set of recovery codes (the old ones stop working)", body = Object), (status = 400, description = "Wrong code or MFA not enabled", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn regenerate_recovery_codes(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<CodeInput>,
) -> ApiResult<Json<Value>> {
    let mut tx = app.db.begin().await.map_err(db_err)?;
    if !check_second_factor(&mut tx, &app.cfg, i.user_id, &v.code).await? {
        return Err(bad("That code is not correct"));
    }
    let codes = replace_recovery_codes(&mut tx, i.user_id).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "recovery_codes": codes })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct VerifyChallengeInput {
    pub(crate) challenge: String,
    pub(crate) code: String,
}
#[utoipa::path(post, path = "/api/auth/mfa/verify", tag = "mfa", request_body = VerifyChallengeInput, responses((status = 200, description = "Second factor accepted; session issued", body = AuthResponse), (status = 401, description = "Challenge expired/used up or code wrong", body = ErrorBody)))]
pub(crate) async fn verify_challenge(
    State(app): State<App>,
    headers: HeaderMap,
    Json(v): Json<VerifyChallengeInput>,
) -> ApiResult<Response> {
    let denied = || err(StatusCode::UNAUTHORIZED, "The code is not valid, or the sign-in expired");
    if v.challenge.len() != 64 {
        return Err(denied());
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let row: Option<(Uuid, Uuid, i32, String)> = sqlx::query_as(
        "SELECT user_id,tenant_id,attempts,user_agent FROM mfa_challenges WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
    )
    .bind(token_hash(&v.challenge))
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let Some((user, tenant, attempts, ua)) = row else {
        return Err(denied());
    };
    if attempts >= 5 {
        sqlx::query("DELETE FROM mfa_challenges WHERE token_hash=$1").bind(token_hash(&v.challenge)).execute(&mut *tx).await.map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        return Err(denied());
    }
    if !check_second_factor(&mut tx, &app.cfg, user, &v.code).await? {
        // Persist the failed attempt even though this request ends in an error.
        sqlx::query("UPDATE mfa_challenges SET attempts=attempts+1 WHERE token_hash=$1").bind(token_hash(&v.challenge)).execute(&mut *tx).await.map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        return Err(denied());
    }
    sqlx::query("DELETE FROM mfa_challenges WHERE token_hash=$1").bind(token_hash(&v.challenge)).execute(&mut *tx).await.map_err(db_err)?;
    let (organization, name): (String, String) = sqlx::query_as("SELECT t.name,u.display_name FROM tenants t, users u WHERE t.id=$1 AND u.id=$2")
        .bind(tenant)
        .bind(user)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let agent = if ua.is_empty() { user_agent(&headers) } else { ua };
    let issued = start_session(&mut tx, &app.cfg, tenant, user, &agent, None).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(auth_reply(
        &headers,
        &app.cfg,
        StatusCode::OK,
        AuthResponse {
            token: String::new(),
            refresh_token: None,
            mfa_required: None,
            challenge: None,
            tenant_id: tenant,
            user_id: user,
            organization,
            name,
        },
        issued,
    ))
}

// ---------------------------------------------------------------- workspace policy

fn require_admin(i: &Identity) -> ApiResult<()> {
    if i.role == "owner" || i.role == "admin" {
        Ok(())
    } else {
        Err(forbidden())
    }
}

#[utoipa::path(get, path = "/api/workspace/security", tag = "mfa", responses((status = 200, description = "Workspace security policy", body = Object), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn workspace_security(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let (require_mfa, members_without_mfa): (bool, i64) = sqlx::query_as(
        "SELECT t.require_mfa, (SELECT count(*) FROM memberships m WHERE m.tenant_id=t.id AND m.disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_mfa x WHERE x.user_id=m.user_id AND x.confirmed_at IS NOT NULL)) FROM tenants t WHERE t.id=$1",
    )
    .bind(i.tenant_id)
    .fetch_one(&app.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "require_mfa": require_mfa, "members_without_mfa": members_without_mfa })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SecurityPolicyInput {
    pub(crate) require_mfa: bool,
}
#[utoipa::path(patch, path = "/api/workspace/security", tag = "mfa", request_body = SecurityPolicyInput, responses((status = 204, description = "Policy updated"), (status = 400, description = "Enable MFA on your own account first", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_workspace_security(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<SecurityPolicyInput>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    if v.require_mfa && !has_mfa(&app.db, i.user_id).await? {
        return Err(bad("Turn on MFA for your own account before requiring it for everyone"));
    }
    sqlx::query("UPDATE tenants SET require_mfa=$2 WHERE id=$1")
        .bind(i.tenant_id)
        .bind(v.require_mfa)
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    sqlx::query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,'workspace',$1)")
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(if v.require_mfa { "mfa_required" } else { "mfa_optional" })
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/auth/mfa", get(status))
        .route("/api/auth/mfa/enroll", post(enroll))
        .route("/api/auth/mfa/confirm", post(confirm))
        .route("/api/auth/mfa/disable", post(disable))
        .route("/api/auth/mfa/recovery-codes", post(regenerate_recovery_codes))
        .route("/api/auth/mfa/verify", post(verify_challenge))
        .route("/api/workspace/security", get(workspace_security).merge(patch(set_workspace_security)))
}
