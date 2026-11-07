//! Authentication: signup/login/logout, session families with rotating refresh tokens, the
//! `Identity` request extractor (bearer header or HttpOnly cookie + CSRF), email verification
//! and password reset.
//!
//! Two client modes share the same endpoints:
//! * **API / mobile** (default): the response body carries `token` and `refresh_token`; send
//!   `Authorization: Bearer <token>`. Not ambient, so no CSRF concern.
//! * **Browser** (`X-Auth-Mode: cookie`): the tokens are set as HttpOnly cookies and blanked in
//!   the body so page JavaScript never sees them. Cookie-authenticated unsafe requests must carry
//!   `X-CSRF-Token` equal to the readable `meridian_csrf` cookie (double submit) and a matching
//!   `Origin` when the browser sends one.
use crate::config::Config;
use crate::*;
use axum::response::{IntoResponse, Response};
use hmac::{Hmac, Mac};

pub(crate) const SESSION_COOKIE: &str = "meridian_session";
pub(crate) const REFRESH_COOKIE: &str = "meridian_refresh";
pub(crate) const CSRF_COOKIE: &str = "meridian_csrf";

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct Signup {
    pub(crate) organization: String,
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) email: String,
    pub(crate) password: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct Login {
    pub(crate) slug: String,
    pub(crate) email: String,
    pub(crate) password: String,
}
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct AuthResponse {
    /// Empty in cookie mode (the session lives in an HttpOnly cookie).
    pub(crate) token: String,
    /// Absent in cookie mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) refresh_token: Option<String>,
    /// Present (true) when the password was right but a second factor is still needed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mfa_required: Option<bool>,
    /// Send this with the code to `/auth/mfa/verify`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) challenge: Option<String>,
    pub(crate) tenant_id: Uuid,
    pub(crate) user_id: Uuid,
    pub(crate) organization: String,
    pub(crate) name: String,
}
#[derive(FromRow, Clone)]
pub(crate) struct Identity {
    pub(crate) tenant_id: Uuid,
    pub(crate) user_id: Uuid,
    pub(crate) role: String,
}

pub(crate) fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
pub(crate) fn mint_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
/// One-time email tokens are derived, not stored: HMAC(server secret, purpose, id). The database
/// keeps only the SHA-256 of the result, and the mailer re-derives the token when it sends.
pub(crate) fn derive_token(secret: &[u8], purpose: &str, id: Uuid) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(purpose.as_bytes());
    mac.update(b":");
    mac.update(id.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

// ---------------------------------------------------------------- cookies and CSRF

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}
pub(crate) fn cookie_mode(headers: &HeaderMap) -> bool {
    headers
        .get("x-auth-mode")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("cookie"))
        .unwrap_or(false)
}
fn is_safe_method(m: &axum::http::Method) -> bool {
    matches!(
        *m,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    )
}
pub(crate) fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
/// Double-submit CSRF check for cookie-authenticated unsafe requests.
fn check_csrf(headers: &HeaderMap, cfg: &Config) -> ApiResult<()> {
    let cookie = cookie_value(headers, CSRF_COOKIE).unwrap_or_default();
    let sent = headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if cookie.is_empty() || !constant_time_eq(&cookie, sent) {
        return Err(ApiError::Csrf);
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let host = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let origin_host = origin.split_once("://").map(|(_, h)| h).unwrap_or(origin);
        // Same host as the request, or one of the configured public origins (a dev proxy may
        // rewrite Host, so Host alone is not a reliable reference).
        if origin_host != host && !cfg.allowed_origins.iter().any(|o| o == origin) {
            return Err(ApiError::Csrf);
        }
    }
    Ok(())
}
fn cookie(
    name: &str,
    value: &str,
    path: &str,
    max_age: i64,
    http_only: bool,
    same_site: &str,
    secure: bool,
) -> String {
    format!(
        "{name}={value}; Path={path}; Max-Age={max_age}; SameSite={same_site}{}{}",
        if http_only { "; HttpOnly" } else { "" },
        if secure { "; Secure" } else { "" }
    )
}
pub(crate) fn clear_cookies(headers: &mut HeaderMap, cfg: &Config) {
    for c in [
        cookie(
            SESSION_COOKIE,
            "",
            "/api",
            0,
            true,
            "Lax",
            cfg.cookie_secure,
        ),
        cookie(
            REFRESH_COOKIE,
            "",
            "/api/auth",
            0,
            true,
            "Strict",
            cfg.cookie_secure,
        ),
        cookie(CSRF_COOKIE, "", "/", 0, false, "Lax", cfg.cookie_secure),
    ] {
        headers.append(header::SET_COOKIE, c.parse().expect("valid cookie"));
    }
}

// ---------------------------------------------------------------- sessions

pub(crate) struct Issued {
    pub(crate) token: String,
    pub(crate) refresh_token: String,
    pub(crate) family: Uuid,
}

/// Create (or continue, when `family` is given) a session family and issue an access token plus a
/// refresh token. Runs on whichever connection the caller owns, so it joins the caller's
/// transaction.
pub(crate) async fn start_session(
    db: &mut PgConnection,
    cfg: &Config,
    tenant: Uuid,
    user: Uuid,
    user_agent: &str,
    family: Option<Uuid>,
) -> ApiResult<Issued> {
    let family = match family {
        Some(f) => f,
        None => sqlx::query_scalar(
            "INSERT INTO session_families(tenant_id,user_id,user_agent) VALUES($1,$2,$3) RETURNING id",
        )
        .bind(tenant)
        .bind(user)
        .bind(user_agent.chars().take(200).collect::<String>())
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)?,
    };
    let (token, refresh) = (mint_token(), mint_token());
    sqlx::query("INSERT INTO sessions(token_hash,tenant_id,user_id,expires_at,family_id) VALUES($1,$2,$3,now()+make_interval(hours => $4),$5)")
        .bind(token_hash(&token)).bind(tenant).bind(user).bind(cfg.session_ttl_hours).bind(family)
        .execute(&mut *db).await.map_err(db_err)?;
    sqlx::query("INSERT INTO refresh_tokens(token_hash,family_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+make_interval(days => $4))")
        .bind(token_hash(&refresh)).bind(family).bind(tenant).bind(cfg.refresh_ttl_days)
        .execute(&mut *db).await.map_err(db_err)?;
    Ok(Issued {
        token,
        refresh_token: refresh,
        family,
    })
}

/// Set the HttpOnly session + refresh cookies and the readable CSRF cookie.
pub(crate) fn set_session_cookies(headers: &mut HeaderMap, cfg: &Config, issued: &Issued) {
    let csrf = mint_token();
    let ttl = (cfg.session_ttl_hours as i64) * 3600;
    let rttl = (cfg.refresh_ttl_days as i64) * 86400;
    for c in [
        cookie(
            SESSION_COOKIE,
            &issued.token,
            "/api",
            ttl,
            true,
            "Lax",
            cfg.cookie_secure,
        ),
        cookie(
            REFRESH_COOKIE,
            &issued.refresh_token,
            "/api/auth",
            rttl,
            true,
            "Strict",
            cfg.cookie_secure,
        ),
        cookie(
            CSRF_COOKIE,
            &csrf,
            "/",
            rttl,
            false,
            "Lax",
            cfg.cookie_secure,
        ),
    ] {
        headers.append(header::SET_COOKIE, c.parse().expect("valid cookie"));
    }
}

/// Build the HTTP reply for a freshly issued session: tokens in the body for API clients, or in
/// cookies (and blanked in the body) for browsers.
pub(crate) fn auth_reply(
    req: &HeaderMap,
    cfg: &Config,
    status: StatusCode,
    mut body: AuthResponse,
    issued: Issued,
) -> Response {
    let mut headers = HeaderMap::new();
    if cookie_mode(req) {
        set_session_cookies(&mut headers, cfg, &issued);
    } else {
        body.token = issued.token;
        body.refresh_token = Some(issued.refresh_token);
    }
    (status, headers, Json(body)).into_response()
}

/// The session token a request presented: bearer header first, then the session cookie.
fn presented_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|x| x.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_string)
        .or_else(|| cookie_value(headers, SESSION_COOKIE))
}

pub(crate) fn user_agent(headers: &HeaderMap) -> String {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn validate_slug(s: &str) -> bool {
    s.len() >= 3
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
}
pub(crate) fn verify_password(password: &str, stored_hash: &str) -> bool {
    PasswordHash::new(stored_hash)
        .map(|p| {
            Argon2::default()
                .verify_password(password.as_bytes(), &p)
                .is_ok()
        })
        .unwrap_or(false)
}
pub(crate) fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| bad("Password hashing failed"))
}

/// Create a one-time email token row and enqueue the email that will carry it.
pub(crate) async fn issue_auth_token(
    db: &mut PgConnection,
    cfg: &Config,
    user: Uuid,
    kind: &str,
    ttl_hours: i32,
) -> ApiResult<()> {
    let id = Uuid::new_v4();
    let token = derive_token(&cfg.secret, "auth_token", id);
    sqlx::query("INSERT INTO auth_tokens(id,kind,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(hours => $5))")
        .bind(id).bind(kind).bind(user).bind(token_hash(&token)).bind(ttl_hours)
        .execute(&mut *db).await.map_err(db_err)?;
    crate::jobs::enqueue(
        db,
        None,
        "email.auth_token",
        crate::jobs::payload("auth_token_id", id),
    )
    .await
}

// ---------------------------------------------------------------- handlers

#[utoipa::path(post, path = "/api/auth/signup", tag = "auth", request_body = Signup, responses((status = 201, description = "Workspace created; session issued", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody)))]
pub(crate) async fn signup(
    State(app): State<App>,
    headers: HeaderMap,
    Json(v): Json<Signup>,
) -> ApiResult<Response> {
    let email = v.email.trim().to_lowercase();
    if v.password.len() < 12
        || !email.contains('@')
        || v.organization.trim().is_empty()
        || v.name.trim().is_empty()
        || !validate_slug(&v.slug)
    {
        return Err(bad(
            "Check organization, slug, email and password (at least 12 characters)",
        ));
    }
    let hash = hash_password(&v.password)?;
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let tenant =
        sqlx::query_scalar::<_, Uuid>("INSERT INTO tenants(slug,name) VALUES($1,$2) RETURNING id")
            .bind(&v.slug)
            .bind(&v.organization)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| bad("Organization slug is unavailable"))?;
    let user = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
    )
    .bind(&email)
    .bind(&v.name)
    .bind(hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| bad("Email is already registered; login to your existing organization"))?;
    sqlx::query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let issued =
        start_session(&mut tx, &app.cfg, tenant, user, &user_agent(&headers), None).await?;
    issue_auth_token(&mut tx, &app.cfg, user, "verify_email", 48).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(auth_reply(
        &headers,
        &app.cfg,
        StatusCode::CREATED,
        AuthResponse {
            token: String::new(),
            refresh_token: None,
            mfa_required: None,
            challenge: None,
            tenant_id: tenant,
            user_id: user,
            organization: v.organization,
            name: v.name,
        },
        issued,
    ))
}
pub(crate) async fn is_login_blocked(db: &PgPool, slug: &str, email: &str) -> ApiResult<bool> {
    let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM login_attempts WHERE tenant_slug=$1 AND email=$2 AND blocked_until>now())")
 .bind(slug).bind(email).fetch_one(db).await.map_err(db_err)?;
    Ok(blocked)
}
pub(crate) async fn login_failed(db: &PgPool, slug: &str, email: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO login_attempts(tenant_slug,email,failures,last_attempt,blocked_until) VALUES($1,$2,1,now(),NULL) ON CONFLICT(tenant_slug,email) DO UPDATE SET failures=CASE WHEN login_attempts.last_attempt<now()-interval '15 minutes' THEN 1 ELSE login_attempts.failures+1 END,last_attempt=now(),blocked_until=CASE WHEN login_attempts.last_attempt>=now()-interval '15 minutes' AND login_attempts.failures>=9 THEN now()+interval '15 minutes' ELSE NULL END")
 .bind(slug).bind(email).execute(db).await.map_err(db_err)?;
    Ok(())
}
#[utoipa::path(post, path = "/api/auth/login", tag = "auth", request_body = Login, responses((status = 200, description = "Session issued", body = AuthResponse), (status = 401, description = "Invalid credentials", body = ErrorBody), (status = 429, description = "Too many failed attempts", body = ErrorBody)))]
pub(crate) async fn login(
    State(app): State<App>,
    headers: HeaderMap,
    Json(v): Json<Login>,
) -> ApiResult<Response> {
    let slug = v.slug.trim();
    let email = v.email.trim().to_lowercase();
    if is_login_blocked(&app.db, slug, &email).await? {
        return Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many failed attempts; retry later",
        ));
    }
    let rec:Option<(Uuid,Uuid,String,String,String)>=sqlx::query_as("SELECT t.id,u.id,u.password_hash,t.name,u.display_name FROM tenants t JOIN memberships m ON m.tenant_id=t.id JOIN users u ON u.id=m.user_id WHERE t.slug=$1 AND u.email=$2 AND m.disabled_at IS NULL")
 .bind(slug).bind(&email).fetch_optional(&app.db).await.map_err(db_err)?;
    let Some((tenant, user, hash, organization, name)) = rec else {
        // Still spend the hashing time so unknown accounts are indistinguishable by latency.
        let _ = hash_password(&v.password);
        login_failed(&app.db, slug, &email).await?;
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid credentials"));
    };
    let parsed = PasswordHash::new(&hash)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Authentication failure"))?;
    if Argon2::default()
        .verify_password(v.password.as_bytes(), &parsed)
        .is_err()
    {
        login_failed(&app.db, slug, &email).await?;
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid credentials"));
    }
    sqlx::query("DELETE FROM login_attempts WHERE tenant_slug=$1 AND email=$2")
        .bind(slug)
        .bind(&email)
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    // A workspace that enforces SSO refuses passwords (the owner keeps a break-glass password).
    let sso_only: bool = sqlx::query_scalar(
        "SELECT COALESCE(c.enabled AND c.enforce_sso, false) AND m.role<>'owner' FROM memberships m LEFT JOIN sso_connections c ON c.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2",
    )
    .bind(tenant)
    .bind(user)
    .fetch_one(&app.db)
    .await
    .map_err(db_err)?;
    if sso_only {
        return Err(forbidden_msg(
            "This workspace requires single sign-on. Use the SSO option on the sign-in page",
        ));
    }
    // Second step: with MFA enabled the password alone never yields a session.
    if crate::mfa::has_mfa(&app.db, user).await? {
        let challenge =
            crate::mfa::open_challenge(&app.db, tenant, user, &user_agent(&headers)).await?;
        return Ok((
            StatusCode::OK,
            Json(AuthResponse {
                token: String::new(),
                refresh_token: None,
                mfa_required: Some(true),
                challenge: Some(challenge),
                tenant_id: tenant,
                user_id: user,
                organization,
                name,
            }),
        )
            .into_response());
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let issued =
        start_session(&mut tx, &app.cfg, tenant, user, &user_agent(&headers), None).await?;
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

/// (family, tenant, expired, family revoked, used_at) for a presented refresh token.
type RefreshRow = (Uuid, Uuid, bool, bool, Option<chrono::DateTime<Utc>>);

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct RefreshInput {
    /// API clients send the refresh token here; browsers rely on the HttpOnly cookie.
    pub(crate) refresh_token: Option<String>,
}
#[utoipa::path(post, path = "/api/auth/refresh", tag = "auth", request_body = RefreshInput, responses((status = 200, description = "Tokens rotated", body = AuthResponse), (status = 401, description = "Refresh token invalid, expired or reused", body = ErrorBody)))]
pub(crate) async fn refresh(
    State(app): State<App>,
    headers: HeaderMap,
    Json(v): Json<RefreshInput>,
) -> ApiResult<Response> {
    let via_cookie = v.refresh_token.is_none();
    let presented = match v.refresh_token {
        Some(t) => t,
        None => {
            check_csrf(&headers, &app.cfg)?;
            cookie_value(&headers, REFRESH_COOKIE)
                .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Refresh token required"))?
        }
    };
    let invalid = || err(StatusCode::UNAUTHORIZED, "Refresh token invalid or expired");
    if presented.len() != 64 {
        return Err(invalid());
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let row: Option<RefreshRow> = sqlx::query_as(
        "SELECT r.family_id, r.tenant_id, r.expires_at<now(), f.revoked_at IS NOT NULL, r.used_at \
         FROM refresh_tokens r JOIN session_families f ON f.id=r.family_id AND f.tenant_id=r.tenant_id \
         WHERE r.token_hash=$1 FOR UPDATE OF r",
    )
    .bind(token_hash(&presented))
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let Some((family, tenant, expired, revoked, used_at)) = row else {
        return Err(invalid());
    };
    if used_at.is_some() && !revoked {
        // A rotated-out token came back: assume theft and kill the whole family.
        sqlx::query("UPDATE session_families SET revoked_at=now() WHERE id=$1")
            .bind(family)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        sqlx::query("DELETE FROM sessions WHERE family_id=$1")
            .bind(family)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        tracing::warn!(%family, "refresh token reuse detected; session family revoked");
        return Err(invalid());
    }
    if used_at.is_some() || expired || revoked {
        return Err(invalid());
    }
    let (user, organization, name): (Uuid, String, String) = sqlx::query_as(
        "SELECT f.user_id, t.name, u.display_name FROM session_families f \
         JOIN tenants t ON t.id=f.tenant_id JOIN users u ON u.id=f.user_id \
         JOIN memberships m ON m.tenant_id=f.tenant_id AND m.user_id=f.user_id AND m.disabled_at IS NULL \
         WHERE f.id=$1",
    )
    .bind(family)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(invalid)?;
    sqlx::query("UPDATE refresh_tokens SET used_at=now() WHERE token_hash=$1")
        .bind(token_hash(&presented))
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM sessions WHERE family_id=$1")
        .bind(family)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE session_families SET last_seen_at=now() WHERE id=$1")
        .bind(family)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let issued = start_session(&mut tx, &app.cfg, tenant, user, "", Some(family)).await?;
    tx.commit().await.map_err(db_err)?;
    let mut h = headers;
    if via_cookie {
        h.insert("x-auth-mode", "cookie".parse().expect("static header"));
    }
    Ok(auth_reply(
        &h,
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

/// Resolve the caller from the bearer header or session cookie. Returns the identity and the
/// SHA-256 of the presented session token (to identify "this session" in the UI).
pub(crate) async fn authenticate(parts: &Parts, app: &App) -> ApiResult<(Identity, String)> {
    let db = &app.db;
    let unauth = || err(StatusCode::UNAUTHORIZED, "Authentication required");
    let bearer = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|x| x.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_string);
    let (value, via_cookie) = match bearer {
        Some(t) => (t, false),
        None => (
            cookie_value(&parts.headers, SESSION_COOKIE).ok_or_else(unauth)?,
            true,
        ),
    };
    if value.len() != 64 {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid session"));
    }
    if via_cookie && !is_safe_method(&parts.method) {
        check_csrf(&parts.headers, &app.cfg)?;
    }
    let hash = token_hash(&value);
    let (tenant_id, user_id, role, mfa_missing): (Uuid, Uuid, String, bool) = sqlx::query_as("SELECT s.tenant_id,s.user_id,m.role, (t.require_mfa AND COALESCE(f.auth_method,'password')<>'sso' AND NOT EXISTS (SELECT 1 FROM user_mfa x WHERE x.user_id=s.user_id AND x.confirmed_at IS NOT NULL)) FROM sessions s JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id JOIN tenants t ON t.id=s.tenant_id LEFT JOIN session_families f ON f.id=s.family_id WHERE s.token_hash=$1 AND s.expires_at>now() AND m.disabled_at IS NULL AND (f.id IS NULL OR f.revoked_at IS NULL)")
        .bind(&hash).fetch_optional(db).await.map_err(db_err)?
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Session expired"))?;
    // A workspace that requires MFA locks everything but account/security endpoints until the
    // member enrols (SSO sign-ins are exempt: the identity provider handles MFA).
    if mfa_missing {
        let path = parts.uri.path();
        let allowed = ["/api/auth/", "/api/me", "/api/sessions", "/api/workspaces"]
            .iter()
            .any(|p| path.starts_with(p));
        if !allowed {
            return Err(ApiError::MfaSetupRequired);
        }
    }
    let identity = Identity {
        tenant_id,
        user_id,
        role,
    };
    // Cheap "last active" marker, written at most every couple of minutes per session.
    let _ = sqlx::query("UPDATE session_families f SET last_seen_at=now() FROM sessions s WHERE s.token_hash=$1 AND f.id=s.family_id AND f.last_seen_at<now()-interval '2 minutes'")
        .bind(&hash).execute(db).await;
    Ok((identity, hash))
}
pub(crate) async fn identity(parts: &Parts, app: &App) -> ApiResult<Identity> {
    authenticate(parts, app).await.map(|(i, _)| i)
}

/// Authenticated caller. Declaring `i: Identity` in a handler resolves the session (tenant +
/// role) before the handler body runs; handlers never read a tenant from the request. Handlers
/// that touch tenant data use `Tx` instead, which carries the same identity.
impl FromRequestParts<App> for Identity {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self, Self::Rejection> {
        identity(parts, state).await
    }
}
pub(crate) fn can_edit(i: &Identity) -> bool {
    i.role != "viewer"
}

#[utoipa::path(post, path = "/api/auth/logout", tag = "auth", responses((status = 204, description = "Session revoked and cookies cleared"), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn logout(
    State(app): State<App>,
    _i: Identity,
    headers: HeaderMap,
) -> ApiResult<(StatusCode, HeaderMap)> {
    let token = presented_token(&headers)
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Authentication required"))?;
    sqlx::query("UPDATE session_families SET revoked_at=now() WHERE id=(SELECT family_id FROM sessions WHERE token_hash=$1)")
        .bind(token_hash(&token)).execute(&app.db).await.map_err(db_err)?;
    sqlx::query("DELETE FROM sessions WHERE token_hash=$1")
        .bind(token_hash(&token))
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    let mut out = HeaderMap::new();
    clear_cookies(&mut out, &app.cfg);
    Ok((StatusCode::NO_CONTENT, out))
}

// ---------------------------------------------------------------- password change

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ChangePasswordInput {
    pub(crate) current_password: String,
    pub(crate) new_password: String,
}
#[utoipa::path(post, path = "/api/auth/change-password", tag = "auth", request_body = ChangePasswordInput, responses((status = 204, description = "Password changed; every other sign-in ended"), (status = 400, description = "Current password wrong, or new password too weak/unchanged", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn change_password(
    State(app): State<App>,
    headers: HeaderMap,
    i: Identity,
    Json(v): Json<ChangePasswordInput>,
) -> ApiResult<StatusCode> {
    if v.new_password.len() < 12 {
        return Err(bad("New password must be at least 12 characters"));
    }
    if v.new_password == v.current_password {
        return Err(bad("New password must differ from the current one"));
    }
    let stored: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(i.user_id)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    let parsed = PasswordHash::new(&stored)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Authentication failure"))?;
    if Argon2::default()
        .verify_password(v.current_password.as_bytes(), &parsed)
        .is_err()
    {
        return Err(bad("The current password is incorrect"));
    }
    let hash = hash_password(&v.new_password)?;
    let current = presented_token(&headers)
        .map(|t| token_hash(&t))
        .unwrap_or_default();
    let mut tx = app.db.begin().await.map_err(db_err)?;
    sqlx::query("UPDATE users SET password_hash=$1 WHERE id=$2")
        .bind(hash)
        .bind(i.user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    // Keep this sign-in; end every other one (all workspaces) and forget failed-attempt counters.
    let keep: Option<Uuid> =
        sqlx::query_scalar("SELECT family_id FROM sessions WHERE token_hash=$1")
            .bind(&current)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .flatten();
    sqlx::query("UPDATE session_families SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2")
        .bind(i.user_id).bind(keep).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1 AND family_id IS DISTINCT FROM $2")
        .bind(i.user_id)
        .bind(keep)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM login_attempts WHERE email=(SELECT email FROM users WHERE id=$1)")
        .bind(i.user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- password reset / verification

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ForgotInput {
    pub(crate) email: String,
}
#[utoipa::path(post, path = "/api/auth/forgot-password", tag = "auth", request_body = ForgotInput, responses((status = 202, description = "If the address belongs to an account, a reset email is on its way")))]
pub(crate) async fn forgot_password(
    State(app): State<App>,
    Json(v): Json<ForgotInput>,
) -> ApiResult<StatusCode> {
    let email = v.email.trim().to_lowercase();
    let user: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&app.db)
        .await
        .map_err(db_err)?;
    if let Some(user) = user {
        let mut conn = app.db.acquire().await.map_err(db_err)?;
        issue_auth_token(&mut conn, &app.cfg, user, "reset_password", 1).await?;
    } else {
        // Same work, same answer: do not reveal whether the address is registered.
        let _ = hash_password(&email);
    }
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ResetInput {
    pub(crate) token: String,
    pub(crate) password: String,
}
#[utoipa::path(post, path = "/api/auth/reset-password", tag = "auth", request_body = ResetInput, responses((status = 204, description = "Password changed; every session revoked"), (status = 400, description = "Invalid or expired token, or weak password", body = ErrorBody)))]
pub(crate) async fn reset_password(
    State(app): State<App>,
    Json(v): Json<ResetInput>,
) -> ApiResult<StatusCode> {
    if v.password.len() < 12 {
        return Err(bad("Password must be at least 12 characters"));
    }
    let hash = hash_password(&v.password)?;
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let row: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT t.id,t.user_id,u.email FROM auth_tokens t JOIN users u ON u.id=t.user_id \
         WHERE t.token_hash=$1 AND t.kind='reset_password' AND t.used_at IS NULL AND t.expires_at>now() FOR UPDATE OF t",
    )
    .bind(token_hash(&v.token))
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (id, user, email) = row.ok_or_else(|| bad("This reset link is invalid or has expired"))?;
    sqlx::query("UPDATE users SET password_hash=$1 WHERE id=$2")
        .bind(hash)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE auth_tokens SET used_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    // A reset proves control of the mailbox; it also ends every existing session.
    sqlx::query(
        "UPDATE session_families SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(user)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("DELETE FROM sessions WHERE user_id=$1")
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM login_attempts WHERE email=$1")
        .bind(email)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct VerifyInput {
    pub(crate) token: String,
}
#[utoipa::path(post, path = "/api/auth/verify-email", tag = "auth", request_body = VerifyInput, responses((status = 204, description = "Email address confirmed"), (status = 400, description = "Invalid or expired token", body = ErrorBody)))]
pub(crate) async fn verify_email(
    State(app): State<App>,
    Json(v): Json<VerifyInput>,
) -> ApiResult<StatusCode> {
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let row: Option<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT id,user_id FROM auth_tokens WHERE token_hash=$1 AND kind='verify_email' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
    )
    .bind(token_hash(&v.token))
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (id, user) = row.ok_or_else(|| bad("This confirmation link is invalid or has expired"))?;
    sqlx::query("UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1")
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE auth_tokens SET used_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/auth/resend-verification", tag = "auth", responses((status = 202, description = "Confirmation email queued"), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn resend_verification(
    State(app): State<App>,
    i: Identity,
) -> ApiResult<StatusCode> {
    let verified: bool =
        sqlx::query_scalar("SELECT email_verified_at IS NOT NULL FROM users WHERE id=$1")
            .bind(i.user_id)
            .fetch_one(&app.db)
            .await
            .map_err(db_err)?;
    if !verified {
        let mut conn = app.db.acquire().await.map_err(db_err)?;
        issue_auth_token(&mut conn, &app.cfg, i.user_id, "verify_email", 48).await?;
    }
    Ok(StatusCode::ACCEPTED)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/auth/forgot-password", post(forgot_password))
        .route("/api/auth/reset-password", post(reset_password))
        .route("/api/auth/verify-email", post(verify_email))
        .route("/api/auth/resend-verification", post(resend_verification))
}
