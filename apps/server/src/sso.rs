//! Single sign-on (OpenID Connect, authorization-code flow with PKCE) and domain verification.
//!
//! Security properties
//! * `state` is random, single use, expires in 10 minutes and is stored only as a hash; the nonce
//!   and the PKCE verifier (sealed) are bound to it, and the ID token's signature, issuer,
//!   audience, expiry and nonce are verified by `openidconnect`.
//! * The IdP must assert `email_verified = true`; accounts are only created or linked when the
//!   email's domain has been *verified by this workspace* (DNS TXT or /.well-known file), and a
//!   domain can be verified by a single workspace.
//! * A member deactivated by an admin or SCIM stays out: SSO never re-activates them.
//! * Discovery and token requests use the SSRF-safe client (public https only, no redirects).
//! * Failures redirect to the web app with a coarse `sso_error` code; details only go to the log.
use crate::api::common::log_event_system;
use crate::config::Config;
use crate::safe_http;
use crate::secrets::{open, seal};
use crate::*;
use axum::{
    extract::Query,
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, put},
};
use openidconnect::{
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use serde_json::{json, Value};

fn callback_url(cfg: &Config) -> String {
    format!("{}/api/auth/sso/callback", cfg.public_url)
}
fn web_redirect(cfg: &Config, error: Option<&str>) -> Response {
    let to = match error {
        Some(e) => format!("{}/?sso_error={e}", cfg.public_url),
        None => format!("{}/", cfg.public_url),
    };
    Redirect::to(&to).into_response()
}

#[derive(FromRow)]
struct Connection {
    issuer: String,
    client_id: String,
    client_secret_sealed: String,
    default_role: String,
    jit_provisioning: bool,
}

async fn load_enabled(db: &PgPool, tenant: Uuid) -> ApiResult<Option<Connection>> {
    sqlx::query_as("SELECT issuer,client_id,client_secret_sealed,default_role,jit_provisioning FROM sso_connections WHERE tenant_id=$1 AND enabled")
        .bind(tenant)
        .fetch_optional(db)
        .await
        .map_err(db_err)
}

async fn discover(cfg: &Config, issuer: &str) -> Result<CoreProviderMetadata, String> {
    safe_http::check_url(cfg, issuer)?;
    let http = safe_http::client(cfg);
    CoreProviderMetadata::discover_async(
        IssuerUrl::new(issuer.to_string()).map_err(|e| e.to_string())?,
        &http,
    )
    .await
    .map_err(|e| format!("provider discovery failed: {e}"))
}

// ---------------------------------------------------------------- sign-in flow

#[utoipa::path(get, path = "/api/auth/sso/{slug}/start", tag = "sso", params(("slug" = String, Path, description = "Workspace slug")), responses((status = 303, description = "Redirect to the identity provider (or back to the app with ?sso_error=)")))]
pub(crate) async fn start(State(app): State<App>, Path(slug): Path<String>) -> ApiResult<Response> {
    let tenant: Option<Uuid> = sqlx::query_scalar("SELECT id FROM tenants WHERE slug=$1")
        .bind(slug.trim())
        .fetch_optional(&app.db)
        .await
        .map_err(db_err)?;
    let Some(tenant) = tenant else {
        return Ok(web_redirect(&app.cfg, Some("not_configured")));
    };
    let Some(conn) = load_enabled(&app.db, tenant).await? else {
        return Ok(web_redirect(&app.cfg, Some("not_configured")));
    };
    let Some(secret) = open(&app.cfg, &format!("sso:{tenant}"), &conn.client_secret_sealed)
        .and_then(|b| String::from_utf8(b).ok())
    else {
        tracing::error!(%tenant, "SSO client secret cannot be opened (APP_SECRET changed?)");
        return Ok(web_redirect(&app.cfg, Some("provider")));
    };
    let metadata = match discover(&app.cfg, &conn.issuer).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(%tenant, error=%e, "SSO discovery failed");
            return Ok(web_redirect(&app.cfg, Some("provider")));
        }
    };
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(conn.client_id),
        Some(ClientSecret::new(secret)),
    )
    .set_redirect_uri(
        RedirectUrl::new(callback_url(&app.cfg))
            .map_err(|_| ApiError::Internal("Invalid redirect URL".into()))?,
    );
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (url, state, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".into()))
        .add_scope(Scope::new("profile".into()))
        .set_pkce_challenge(challenge)
        .url();
    sqlx::query("INSERT INTO sso_states(state_hash,tenant_id,nonce,pkce_verifier_sealed,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')")
        .bind(token_hash(state.secret()))
        .bind(tenant)
        .bind(nonce.secret())
        .bind(seal(&app.cfg, "sso-pkce", verifier.secret().as_bytes()))
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM sso_states WHERE expires_at<now()")
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    Ok(Redirect::to(url.as_str()).into_response())
}

#[derive(Deserialize)]
pub(crate) struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn email_domain(email: &str) -> Option<&str> {
    email.rsplit_once('@').map(|(_, d)| d)
}

async fn domain_verified(db: &PgPool, tenant: Uuid, domain: &str) -> ApiResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM verified_domains WHERE tenant_id=$1 AND domain=$2 AND verified_at IS NOT NULL)")
        .bind(tenant)
        .bind(domain)
        .fetch_one(db)
        .await
        .map_err(db_err)
}

/// Why a sign-in was refused (mapped to a coarse code for the browser).
enum Denied {
    State,
    Provider,
    Email,
    Domain,
    Disabled,
}
impl Denied {
    fn code(&self) -> &'static str {
        match self {
            Denied::State => "state",
            Denied::Provider => "provider",
            Denied::Email => "email_unverified",
            Denied::Domain => "domain",
            Denied::Disabled => "denied",
        }
    }
}

#[utoipa::path(get, path = "/api/auth/sso/callback", tag = "sso", params(("code" = Option<String>, Query, description = "Authorization code"), ("state" = Option<String>, Query, description = "State from the start request")), responses((status = 303, description = "Session cookies set and redirect to the app (or ?sso_error=)")))]
pub(crate) async fn callback(
    State(app): State<App>,
    headers: HeaderMap,
    Query(q): Query<CallbackParams>,
) -> ApiResult<Response> {
    match complete(&app, &headers, q).await {
        Ok(resp) => Ok(resp),
        Err(Ok(denied)) => Ok(web_redirect(&app.cfg, Some(denied.code()))),
        Err(Err(e)) => Err(e),
    }
}

async fn complete(
    app: &App,
    headers: &HeaderMap,
    q: CallbackParams,
) -> Result<Response, Result<Denied, ApiError>> {
    let fail = |d: Denied, why: &str| {
        tracing::warn!(reason = why, "SSO sign-in refused");
        Err(Ok(d))
    };
    if q.error.is_some() {
        return fail(Denied::Disabled, "identity provider returned an error");
    }
    let (Some(code), Some(state)) = (q.code, q.state) else {
        return fail(Denied::State, "missing code or state");
    };
    // State is single use: take it out of the table in the same statement that reads it.
    let row: Option<(Uuid, String, String)> = sqlx::query_as(
        "DELETE FROM sso_states WHERE state_hash=$1 AND expires_at>now() RETURNING tenant_id,nonce,pkce_verifier_sealed",
    )
    .bind(token_hash(&state))
    .fetch_optional(&app.db)
    .await
    .map_err(|e| Err(db_err(e)))?;
    let Some((tenant, nonce, pkce_sealed)) = row else {
        return fail(Denied::State, "unknown or expired state");
    };
    let conn = load_enabled(&app.db, tenant).await.map_err(Err)?;
    let Some(conn) = conn else {
        return fail(Denied::Provider, "SSO disabled");
    };
    let secret = open(&app.cfg, &format!("sso:{tenant}"), &conn.client_secret_sealed)
        .and_then(|b| String::from_utf8(b).ok());
    let verifier = open(&app.cfg, "sso-pkce", &pkce_sealed).and_then(|b| String::from_utf8(b).ok());
    let (Some(secret), Some(verifier)) = (secret, verifier) else {
        return fail(Denied::Provider, "sealed values unreadable");
    };
    let metadata = match discover(&app.cfg, &conn.issuer).await {
        Ok(m) => m,
        Err(e) => return fail(Denied::Provider, &e),
    };
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(conn.client_id.clone()),
        Some(ClientSecret::new(secret)),
    )
    .set_redirect_uri(
        RedirectUrl::new(callback_url(&app.cfg))
            .map_err(|_| Err(ApiError::Internal("Invalid redirect URL".into())))?,
    );
    let http = safe_http::client(&app.cfg);
    let token = match client.exchange_code(AuthorizationCode::new(code)) {
        Ok(req) => match req.set_pkce_verifier(PkceCodeVerifier::new(verifier)).request_async(&http).await {
            Ok(t) => t,
            Err(e) => return fail(Denied::Provider, &format!("token exchange failed: {e}")),
        },
        Err(e) => return fail(Denied::Provider, &format!("no token endpoint: {e}")),
    };
    let Some(id_token) = token.id_token() else {
        return fail(Denied::Provider, "no id_token in response");
    };
    let claims = match id_token.claims(&client.id_token_verifier(), &Nonce::new(nonce)) {
        Ok(c) => c,
        Err(e) => return fail(Denied::Provider, &format!("id_token verification failed: {e}")),
    };
    let subject = claims.subject().as_str().to_string();
    let Some(email) = claims.email().map(|e| e.as_str().trim().to_lowercase()) else {
        return fail(Denied::Email, "no email claim");
    };
    if claims.email_verified() != Some(true) || !email.contains('@') {
        return fail(Denied::Email, "email not verified by the provider");
    }
    let display = claims
        .name()
        .and_then(|n| n.get(None))
        .map(|n| n.as_str().to_string())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| email.split('@').next().unwrap_or("Member").to_string());

    let mut tx = app.db.begin().await.map_err(|e| Err(db_err(e)))?;
    // 1) already linked identity?
    let linked: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM sso_identities WHERE tenant_id=$1 AND issuer=$2 AND subject=$3")
        .bind(tenant).bind(&conn.issuer).bind(&subject)
        .fetch_optional(&mut *tx).await.map_err(|e| Err(db_err(e)))?;
    let user = if let Some(u) = linked {
        u
    } else {
        // Creating or linking an account requires a domain this workspace has verified.
        let domain = email_domain(&email).unwrap_or_default().to_string();
        if !domain_verified(&app.db, tenant, &domain).await.map_err(Err)? {
            return fail(Denied::Domain, "email domain is not verified for this workspace");
        }
        let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
            .bind(&email)
            .fetch_optional(&mut *tx).await.map_err(|e| Err(db_err(e)))?;
        let user = match existing {
            Some(u) => u,
            None => {
                if !conn.jit_provisioning {
                    return fail(Denied::Disabled, "just-in-time provisioning is off");
                }
                // No password is ever usable for a provisioned account; the person can still set
                // one through "forgot password" if the workspace allows it.
                let hash = hash_password(&mint_token()).map_err(Err)?;
                sqlx::query_scalar("INSERT INTO users(email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,now()) RETURNING id")
                    .bind(&email).bind(&display).bind(hash)
                    .fetch_one(&mut *tx).await.map_err(|e| Err(db_err(e)))?
            }
        };
        sqlx::query("INSERT INTO sso_identities(tenant_id,issuer,subject,user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING")
            .bind(tenant).bind(&conn.issuer).bind(&subject).bind(user)
            .execute(&mut *tx).await.map_err(|e| Err(db_err(e)))?;
        user
    };
    // 2) membership: create (JIT) or require it to be active.
    let membership: Option<bool> = sqlx::query_scalar("SELECT disabled_at IS NULL FROM memberships WHERE tenant_id=$1 AND user_id=$2")
        .bind(tenant).bind(user)
        .fetch_optional(&mut *tx).await.map_err(|e| Err(db_err(e)))?;
    match membership {
        Some(true) => {}
        Some(false) => return fail(Denied::Disabled, "member is deactivated"),
        None => {
            if !conn.jit_provisioning {
                return fail(Denied::Disabled, "not a member and provisioning is off");
            }
            if crate::billing::enforce_limit(&mut tx, tenant, crate::billing::Limit::Seats).await.is_err() {
                return fail(Denied::Disabled, "the workspace is out of seats");
            }
            sqlx::query("INSERT INTO memberships(tenant_id,user_id,role,provisioned_by) VALUES($1,$2,$3,'sso')")
                .bind(tenant).bind(user).bind(&conn.default_role)
                .execute(&mut *tx).await.map_err(|e| Err(db_err(e)))?;
        }
    }
    let issued = start_session(&mut tx, &app.cfg, tenant, user, &user_agent(headers), None)
        .await
        .map_err(Err)?;
    sqlx::query("UPDATE session_families SET auth_method='sso' WHERE id=$1")
        .bind(issued.family)
        .execute(&mut *tx).await.map_err(|e| Err(db_err(e)))?;
    log_event_system(&mut tx, tenant, user, "sso_login", "session", issued.family)
        .await
        .map_err(Err)?;
    tx.commit().await.map_err(|e| Err(db_err(e)))?;
    let mut out = HeaderMap::new();
    set_session_cookies(&mut out, &app.cfg, &issued);
    let mut resp = web_redirect(&app.cfg, None);
    resp.headers_mut().extend(out);
    Ok(resp)
}

// ---------------------------------------------------------------- admin configuration

fn require_admin(i: &Identity) -> ApiResult<()> {
    if i.role == "owner" || i.role == "admin" {
        Ok(())
    } else {
        Err(forbidden())
    }
}

fn valid_domain(d: &str) -> bool {
    d.len() <= 253
        && d.contains('.')
        && d.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

#[utoipa::path(get, path = "/api/workspace/sso", tag = "sso", responses((status = 200, description = "SSO configuration and verified domains (never the client secret)", body = Object), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_config(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let conn: Option<(String, String, bool, String, bool, bool)> = sqlx::query_as(
        "SELECT issuer,client_id,enabled,default_role,jit_provisioning,enforce_sso FROM sso_connections WHERE tenant_id=$1",
    )
    .bind(i.tenant_id)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;
    let domains: Vec<(String, String, Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
        "SELECT domain,token,verified_at FROM verified_domains WHERE tenant_id=$1 ORDER BY domain",
    )
    .bind(i.tenant_id)
    .fetch_all(&app.db)
    .await
    .map_err(db_err)?;
    let slug: String = sqlx::query_scalar("SELECT slug FROM tenants WHERE id=$1")
        .bind(i.tenant_id)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "configured": conn.is_some(),
        "issuer": conn.as_ref().map(|c| c.0.clone()),
        "client_id": conn.as_ref().map(|c| c.1.clone()),
        "enabled": conn.as_ref().map(|c| c.2).unwrap_or(false),
        "default_role": conn.as_ref().map(|c| c.3.clone()).unwrap_or_else(|| "member".into()),
        "jit_provisioning": conn.as_ref().map(|c| c.4).unwrap_or(true),
        "enforce_sso": conn.as_ref().map(|c| c.5).unwrap_or(false),
        "callback_url": callback_url(&app.cfg),
        "login_url": format!("{}/api/auth/sso/{}/start", app.cfg.public_url, slug),
        "domains": domains.into_iter().map(|(d, t, v)| json!({
            "domain": d,
            "verified": v.is_some(),
            "txt_name": format!("_meridian-challenge.{d}"),
            "txt_value": format!("meridian-verification={t}"),
            "file_url": format!("https://{d}/.well-known/meridian-domain-verification.txt"),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SsoInput {
    pub(crate) issuer: String,
    pub(crate) client_id: String,
    /// Required the first time; omit to keep the stored secret.
    pub(crate) client_secret: Option<String>,
    pub(crate) enabled: bool,
    /// `member`, `viewer` or `guest`.
    pub(crate) default_role: String,
    pub(crate) jit_provisioning: bool,
    pub(crate) enforce_sso: bool,
}
#[utoipa::path(put, path = "/api/workspace/sso", tag = "sso", request_body = SsoInput, responses((status = 204, description = "Saved"), (status = 400, description = "Invalid settings or provider discovery failed", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn put_config(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<SsoInput>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    crate::billing::require_feature(&app, i.tenant_id, crate::billing::Feature::Sso).await?;
    if !["member", "viewer", "guest"].contains(&v.default_role.as_str()) || v.client_id.trim().is_empty() {
        return Err(bad("Choose member, viewer or guest as the default role and provide a client id"));
    }
    let issuer = v.issuer.trim().trim_end_matches('/').to_string();
    discover(&app.cfg, &issuer).await.map_err(|e| bad(&format!("Cannot use this issuer: {e}")))?;
    let sealed = match v.client_secret.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => seal(&app.cfg, &format!("sso:{}", i.tenant_id), s.as_bytes()),
        None => sqlx::query_scalar("SELECT client_secret_sealed FROM sso_connections WHERE tenant_id=$1")
            .bind(i.tenant_id)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?
            .ok_or_else(|| bad("A client secret is required the first time"))?,
    };
    if v.enabled {
        let verified: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM verified_domains WHERE tenant_id=$1 AND verified_at IS NOT NULL)")
            .bind(i.tenant_id)
            .fetch_one(&app.db)
            .await
            .map_err(db_err)?;
        if !verified {
            return Err(bad("Verify at least one email domain before enabling SSO"));
        }
    }
    sqlx::query("INSERT INTO sso_connections(tenant_id,issuer,client_id,client_secret_sealed,enabled,default_role,jit_provisioning,enforce_sso) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id) DO UPDATE SET issuer=EXCLUDED.issuer,client_id=EXCLUDED.client_id,client_secret_sealed=EXCLUDED.client_secret_sealed,enabled=EXCLUDED.enabled,default_role=EXCLUDED.default_role,jit_provisioning=EXCLUDED.jit_provisioning,enforce_sso=EXCLUDED.enforce_sso,updated_at=now()")
        .bind(i.tenant_id).bind(&issuer).bind(v.client_id.trim()).bind(sealed).bind(v.enabled)
        .bind(&v.default_role).bind(v.jit_provisioning).bind(v.enforce_sso && v.enabled)
        .execute(&app.db).await.map_err(db_err)?;
    audit(&app.db, &i, "sso_configured").await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/workspace/sso", tag = "sso", responses((status = 204, description = "SSO removed"), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_config(State(app): State<App>, i: Identity) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    sqlx::query("DELETE FROM sso_connections WHERE tenant_id=$1")
        .bind(i.tenant_id)
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM sso_identities WHERE tenant_id=$1")
        .bind(i.tenant_id)
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    audit(&app.db, &i, "sso_removed").await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn audit(db: &PgPool, i: &Identity, action: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,'workspace',$1)")
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(action)
        .execute(db)
        .await
        .map_err(db_err)?;
    Ok(())
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct DomainInput {
    pub(crate) domain: String,
}
#[utoipa::path(post, path = "/api/workspace/domains", tag = "sso", request_body = DomainInput, responses((status = 200, description = "Challenge to publish", body = Object), (status = 400, description = "Invalid or already claimed domain", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_domain(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<DomainInput>,
) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let domain = v.domain.trim().to_ascii_lowercase();
    if !valid_domain(&domain) {
        return Err(bad("Enter a domain such as example.com"));
    }
    let taken: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM verified_domains WHERE domain=$1 AND verified_at IS NOT NULL AND tenant_id<>$2)")
        .bind(&domain)
        .bind(i.tenant_id)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    if taken {
        return Err(bad("That domain is already verified by another workspace"));
    }
    let token = mint_token();
    let kept: String = sqlx::query_scalar("INSERT INTO verified_domains(tenant_id,domain,token) VALUES($1,$2,$3) ON CONFLICT (tenant_id,domain) DO UPDATE SET domain=EXCLUDED.domain RETURNING token")
        .bind(i.tenant_id)
        .bind(&domain)
        .bind(&token)
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "domain": domain,
        "txt_name": format!("_meridian-challenge.{domain}"),
        "txt_value": format!("meridian-verification={kept}"),
        "file_url": format!("https://{domain}/.well-known/meridian-domain-verification.txt"),
    })))
}

async fn proves_control(cfg: &Config, domain: &str, expected: &str) -> bool {
    // 1) DNS TXT record
    if let Ok(resolver) = hickory_resolver::TokioResolver::builder_tokio().map(|b| b.build()) {
        if let Ok(txt) = resolver.txt_lookup(format!("_meridian-challenge.{domain}.")).await {
            if txt.iter().any(|r| r.to_string().trim() == expected) {
                return true;
            }
        }
    }
    // 2) well-known file over https (SSRF-safe client)
    let url = format!("https://{domain}/.well-known/meridian-domain-verification.txt");
    let url = if cfg.allow_private_outbound { format!("http://{domain}/.well-known/meridian-domain-verification.txt") } else { url };
    if safe_http::check_url(cfg, &url).is_err() {
        return false;
    }
    match safe_http::client(cfg).get(&url).send().await {
        Ok(r) if r.status().is_success() => {
            r.text().await.map(|t| t.trim() == expected).unwrap_or(false)
        }
        _ => false,
    }
}

#[utoipa::path(post, path = "/api/workspace/domains/{domain}/verify", tag = "sso", params(("domain" = String, Path, description = "Domain to verify")), responses((status = 204, description = "Domain verified"), (status = 400, description = "Challenge not found yet", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn verify_domain(
    State(app): State<App>,
    i: Identity,
    Path(domain): Path<String>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    let domain = domain.to_ascii_lowercase();
    let token: Option<String> = sqlx::query_scalar("SELECT token FROM verified_domains WHERE tenant_id=$1 AND domain=$2")
        .bind(i.tenant_id)
        .bind(&domain)
        .fetch_optional(&app.db)
        .await
        .map_err(db_err)?;
    let token = token.ok_or_else(|| err(StatusCode::NOT_FOUND, "Add the domain first"))?;
    if !proves_control(&app.cfg, &domain, &format!("meridian-verification={token}")).await {
        return Err(bad("We could not find the verification record yet. DNS changes can take a while; try again shortly"));
    }
    let done = sqlx::query("UPDATE verified_domains SET verified_at=now() WHERE tenant_id=$1 AND domain=$2")
        .bind(i.tenant_id)
        .bind(&domain)
        .execute(&app.db)
        .await
        .map_err(|_| bad("That domain is already verified by another workspace"))?;
    let _ = done;
    audit(&app.db, &i, "domain_verified").await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/workspace/domains/{domain}", tag = "sso", params(("domain" = String, Path, description = "Domain to remove")), responses((status = 204, description = "Removed"), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_domain(
    State(app): State<App>,
    i: Identity,
    Path(domain): Path<String>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    sqlx::query("DELETE FROM verified_domains WHERE tenant_id=$1 AND domain=$2")
        .bind(i.tenant_id)
        .bind(domain.to_ascii_lowercase())
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/auth/sso/{slug}/start", get(start))
        .route("/api/auth/sso/callback", get(callback))
        .route("/api/workspace/sso", get(get_config).merge(put(put_config)).merge(delete(delete_config)))
        .route("/api/workspace/domains", post(add_domain))
        .route("/api/workspace/domains/{domain}/verify", post(verify_domain))
        .route("/api/workspace/domains/{domain}", delete(remove_domain))
}
