//! OAuth 2.0 integration apps: third-party client registration,
//! authorization code flow, and token exchange.
use crate::api::common::*;
use crate::*;
use axum::extract::{Path, Query};
use axum::routing::{get, post};
use chrono::{Duration, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct OAuthApp {
    pub(crate) id: Uuid,
    pub(crate) client_id: String,
    pub(crate) name: String,
    pub(crate) redirect_uri: String,
    pub(crate) scopes: Vec<String>,
    pub(crate) is_trusted: bool,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CreatedOAuthApp {
    pub(crate) app: OAuthApp,
    pub(crate) client_secret: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewOAuthApp {
    pub(crate) name: String,
    pub(crate) redirect_uri: String,
    pub(crate) scopes: Option<Vec<String>>,
    pub(crate) is_trusted: Option<bool>,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct AuthorizeQuery {
    pub(crate) client_id: String,
    pub(crate) redirect_uri: String,
    pub(crate) scope: Option<String>,
    pub(crate) state: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct AuthorizePrompt {
    pub(crate) client_id: String,
    pub(crate) app_name: String,
    pub(crate) redirect_uri: String,
    pub(crate) scopes: Vec<String>,
    pub(crate) state: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ConsentInput {
    pub(crate) client_id: String,
    pub(crate) redirect_uri: String,
    pub(crate) scopes: Option<Vec<String>>,
    pub(crate) state: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct ConsentResponse {
    pub(crate) code: String,
    pub(crate) redirect_url: String,
    pub(crate) state: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct TokenExchangeInput {
    pub(crate) grant_type: String,
    pub(crate) client_id: String,
    pub(crate) client_secret: String,
    pub(crate) code: String,
    pub(crate) redirect_uri: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct TokenResponse {
    pub(crate) access_token: String,
    pub(crate) token_type: String,
    pub(crate) expires_in: i64,
    pub(crate) scope: String,
}

fn generate_random_token(prefix: &str, num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{prefix}_{}", hex::encode(bytes))
}

fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

#[utoipa::path(get, path = "/api/oauth/apps", tag = "integrations", responses((status = 200, description = "Registered OAuth apps", body = Vec<OAuthApp>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_oauth_apps(mut tx: Tx) -> ApiResult<Json<Vec<OAuthApp>>> {
    require_admin(&tx.identity)?;
    let rows: Vec<OAuthApp> = sqlx::query_as(
        "SELECT id, client_id, name, redirect_uri, scopes, is_trusted, created_at \
         FROM oauth_apps WHERE tenant_id=$1 ORDER BY created_at DESC",
    )
    .bind(tx.identity.tenant_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/oauth/apps", tag = "integrations", request_body = NewOAuthApp, responses((status = 201, description = "Created. Secret is shown once", body = CreatedOAuthApp), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_oauth_app(
    mut tx: Tx,
    Json(input): Json<NewOAuthApp>,
) -> ApiResult<(StatusCode, Json<CreatedOAuthApp>)> {
    let i = tx.identity.clone();
    require_admin(&i)?;

    let name = input.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(bad("App name must be 1 to 80 characters"));
    }
    let redirect = input.redirect_uri.trim();
    if !redirect.starts_with("https://") && !redirect.starts_with("http://localhost") {
        return Err(bad("Redirect URI must use https or http://localhost"));
    }

    let client_id = generate_random_token("mrd_client", 12);
    let client_secret = generate_random_token("mrd_secret", 24);
    let secret_hash = hash_secret(&client_secret);
    let scopes = input
        .scopes
        .unwrap_or_else(|| vec!["read".to_string(), "write".to_string()]);
    let is_trusted = input.is_trusted.unwrap_or(false);

    let app: OAuthApp = sqlx::query_as(
        "INSERT INTO oauth_apps(tenant_id, client_id, client_secret_hash, name, redirect_uri, scopes, is_trusted, created_by) \
         VALUES($1, $2, $3, $4, $5, $6, $7, $8) \
         RETURNING id, client_id, name, redirect_uri, scopes, is_trusted, created_at",
    )
    .bind(i.tenant_id)
    .bind(&client_id)
    .bind(&secret_hash)
    .bind(name)
    .bind(redirect)
    .bind(&scopes)
    .bind(is_trusted)
    .bind(i.user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    Ok((
        StatusCode::CREATED,
        Json(CreatedOAuthApp { app, client_secret }),
    ))
}

#[utoipa::path(get, path = "/api/oauth/authorize", tag = "integrations", params(AuthorizeQuery), responses((status = 200, description = "Consent details", body = AuthorizePrompt), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_authorize(
    mut tx: Tx,
    Query(q): Query<AuthorizeQuery>,
) -> ApiResult<Json<AuthorizePrompt>> {
    let app: Option<(String, String, Vec<String>)> = sqlx::query_as(
        "SELECT name, redirect_uri, scopes FROM oauth_apps WHERE tenant_id=$1 AND client_id=$2",
    )
    .bind(tx.identity.tenant_id)
    .bind(&q.client_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;

    let (app_name, registered_redirect, app_scopes) =
        app.ok_or_else(|| bad("Unknown client_id for this workspace"))?;

    if q.redirect_uri != registered_redirect {
        return Err(bad("Redirect URI does not match client registration"));
    }

    let prompt_scopes = q
        .scope
        .as_deref()
        .map(|s| s.split_whitespace().map(String::from).collect())
        .unwrap_or(app_scopes);

    Ok(Json(AuthorizePrompt {
        client_id: q.client_id,
        app_name,
        redirect_uri: registered_redirect,
        scopes: prompt_scopes,
        state: q.state,
    }))
}

#[utoipa::path(post, path = "/api/oauth/authorize", tag = "integrations", request_body = ConsentInput, responses((status = 200, description = "Authorization code granted", body = ConsentResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn submit_authorize(
    mut tx: Tx,
    Json(input): Json<ConsentInput>,
) -> ApiResult<Json<ConsentResponse>> {
    let i = tx.identity.clone();
    let app: Option<(String, Vec<String>)> = sqlx::query_as(
        "SELECT redirect_uri, scopes FROM oauth_apps WHERE tenant_id=$1 AND client_id=$2",
    )
    .bind(i.tenant_id)
    .bind(&input.client_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;

    let (registered_redirect, app_scopes) =
        app.ok_or_else(|| bad("Unknown client_id for this workspace"))?;

    if input.redirect_uri != registered_redirect {
        return Err(bad("Redirect URI does not match client registration"));
    }

    let code = generate_random_token("code", 16);
    let expires_at = Utc::now() + Duration::minutes(10);
    let scopes = input.scopes.unwrap_or(app_scopes);

    sqlx::query(
        "INSERT INTO oauth_auth_codes(code, client_id, user_id, tenant_id, scopes, expires_at) \
         VALUES($1, $2, $3, $4, $5, $6)",
    )
    .bind(&code)
    .bind(&input.client_id)
    .bind(i.user_id)
    .bind(i.tenant_id)
    .bind(&scopes)
    .bind(expires_at)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;

    let delimiter = if registered_redirect.contains('?') {
        "&"
    } else {
        "?"
    };
    let state_param = match &input.state {
        Some(s) => format!("&state={s}"),
        None => String::new(),
    };
    let redirect_url = format!("{registered_redirect}{delimiter}code={code}{state_param}");

    Ok(Json(ConsentResponse {
        code,
        redirect_url,
        state: input.state,
    }))
}

#[utoipa::path(post, path = "/api/oauth/token", tag = "integrations", request_body = TokenExchangeInput, responses((status = 200, description = "Access token generated", body = TokenResponse), (status = 400, description = "Invalid code or grant", body = ErrorBody), (status = 401, description = "Client authentication failed", body = ErrorBody)))]
pub(crate) async fn exchange_token(
    State(app): State<App>,
    Json(input): Json<TokenExchangeInput>,
) -> ApiResult<Json<TokenResponse>> {
    if input.grant_type != "authorization_code" {
        return Err(bad("Unsupported grant_type; must be authorization_code"));
    }

    let secret_hash = hash_secret(&input.client_secret);
    let client: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT tenant_id, redirect_uri FROM oauth_apps WHERE client_id=$1 AND client_secret_hash=$2",
    )
    .bind(&input.client_id)
    .bind(&secret_hash)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;

    let (tenant_id, redirect_uri) =
        client.ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Invalid client credentials"))?;

    if input.redirect_uri != redirect_uri {
        return Err(bad("Redirect URI mismatch"));
    }

    let code_row: Option<(Uuid, Vec<String>)> = sqlx::query_as(
        "DELETE FROM oauth_auth_codes WHERE code=$1 AND client_id=$2 AND tenant_id=$3 AND expires_at > now() \
         RETURNING user_id, scopes",
    )
    .bind(&input.code)
    .bind(&input.client_id)
    .bind(tenant_id)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;

    let (user_id, scopes) = code_row.ok_or_else(|| bad("Invalid or expired authorization code"))?;

    let access_token = generate_random_token("mrd_oauth", 32);
    let token_hash = hash_secret(&access_token);
    let expires_in = 30 * 86400; // 30 days
    let expires_at = Utc::now() + Duration::days(30);

    sqlx::query(
        "INSERT INTO oauth_tokens(token_hash, client_id, user_id, tenant_id, scopes, expires_at) \
         VALUES($1, $2, $3, $4, $5, $6)",
    )
    .bind(&token_hash)
    .bind(&input.client_id)
    .bind(user_id)
    .bind(tenant_id)
    .bind(&scopes)
    .bind(expires_at)
    .execute(&app.db)
    .await
    .map_err(db_err)?;

    Ok(Json(TokenResponse {
        access_token,
        token_type: "Bearer".to_string(),
        expires_in,
        scope: scopes.join(" "),
    }))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route(
            "/api/oauth/apps",
            get(list_oauth_apps).post(create_oauth_app),
        )
        .route(
            "/api/oauth/authorize",
            get(get_authorize).post(submit_authorize),
        )
        .route("/api/oauth/token", post(exchange_token))
}
