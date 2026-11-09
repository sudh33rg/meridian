//! Integrations: personal API tokens, git linking through signed repository events, and
//! reading the links an issue has collected.
//!
//! Tokens: the secret is returned once. Only its SHA-256 is stored, and a `read` token cannot make
//! writes. Tokens cannot create other tokens; that needs a signed-in session.
//!
//! Git: a project holds a secret that signs inbound repository events (HMAC-SHA256, the GitHub
//! `X-Hub-Signature-256` format). The sender is identified by the signature alone, so an unknown
//! project and a wrong signature get the same answer.
use crate::api::common::*;
use crate::auth::{mint_token, token_hash};
use crate::secrets::{open, seal};
use crate::*;
use axum::body::Bytes;
use axum::http::header::AUTHORIZATION;
use axum::routing::{delete, get, post, put};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashSet;

const MAX_WEBHOOK_BYTES: usize = 256 * 1024;

/// True when the request was authenticated with an API token rather than a session.
fn sent_with_api_token(headers: &HeaderMap) -> bool {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .is_some_and(|t| t.starts_with("mtk_"))
}

// ---------------------------------------------------------------------------------------------
// I5. Personal API tokens
// ---------------------------------------------------------------------------------------------

/// A token as listed to its owner. The secret is never listed.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ApiTokenRow {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    /// The first characters of the token, to tell tokens apart.
    pub(crate) prefix: String,
    /// `read` or `write`.
    pub(crate) scope: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) last_used_at: Option<DateTime<Utc>>,
    pub(crate) expires_at: Option<DateTime<Utc>>,
    pub(crate) revoked_at: Option<DateTime<Utc>>,
}

#[utoipa::path(get, path = "/api/me/tokens", tag = "me", responses((status = 200, description = "Your API tokens", body = Vec<ApiTokenRow>), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_tokens(mut tx: Tx) -> ApiResult<Json<Vec<ApiTokenRow>>> {
    let i = tx.identity.clone();
    let rows: Vec<ApiTokenRow> = sqlx::query_as(
        "SELECT id, name, prefix, scope, created_at, last_used_at, expires_at, revoked_at FROM api_tokens \
         WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ApiTokenInput {
    pub(crate) name: String,
    /// `read` (GET only) or `write` (the same reach as your session).
    pub(crate) scope: String,
    /// Days until the token expires, 1 to 365. Omit for no expiry.
    pub(crate) expires_days: Option<i64>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CreatedApiToken {
    pub(crate) token: String,
    pub(crate) info: ApiTokenRow,
}

#[utoipa::path(post, path = "/api/me/tokens", tag = "me", request_body = ApiTokenInput, responses((status = 201, description = "The secret is in the response once; store it now", body = CreatedApiToken), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Tokens cannot create tokens", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_token(
    mut tx: Tx,
    headers: HeaderMap,
    Json(v): Json<ApiTokenInput>,
) -> ApiResult<(StatusCode, Json<CreatedApiToken>)> {
    let i = tx.identity.clone();
    if sent_with_api_token(&headers) {
        return Err(err(StatusCode::FORBIDDEN, "API tokens cannot create tokens. Sign in to create one"));
    }
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(bad("Token name must be between 1 and 80 characters"));
    }
    if !["read", "write"].contains(&v.scope.as_str()) {
        return Err(bad("scope must be read or write"));
    }
    if v.expires_days.is_some_and(|d| !(1..=365).contains(&d)) {
        return Err(bad("expires_days must be between 1 and 365"));
    }
    let secret = format!("mtk_{}", mint_token());
    let prefix: String = secret.chars().take(12).collect();
    let info: ApiTokenRow = sqlx::query_as(
        "INSERT INTO api_tokens(tenant_id,user_id,name,token_hash,prefix,scope,expires_at) \
         VALUES($1,$2,$3,$4,$5,$6, CASE WHEN $7::bigint IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END) \
         RETURNING id, name, prefix, scope, created_at, last_used_at, expires_at, revoked_at",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(name)
    .bind(token_hash(&secret))
    .bind(prefix)
    .bind(v.scope)
    .bind(v.expires_days)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "created", "api_token", info.id).await?;
    Ok((StatusCode::CREATED, Json(CreatedApiToken { token: secret, info })))
}

#[utoipa::path(delete, path = "/api/me/tokens/{id}", tag = "me", params(("id" = Uuid, Path, description = "Token id")), responses((status = 204, description = "Revoked"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn revoke_token(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let affected = sqlx::query(
        "UPDATE api_tokens SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected();
    if affected == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Token not found"));
    }
    log_event(&mut tx, &i, "revoked", "api_token", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// I4. Git linking
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct GitSecretInput {
    /// Shared secret the repository host signs events with. 16 to 200 characters.
    pub(crate) secret: String,
}

#[utoipa::path(put, path = "/api/projects/{id}/git-secret", tag = "integrations", params(("id" = Uuid, Path, description = "Resource id")), request_body = GitSecretInput, responses((status = 204, description = "Saved (sealed at rest)"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn put_git_secret(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<GitSecretInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    valid_project(&mut tx, &i, p).await?;
    if !(16..=200).contains(&v.secret.len()) {
        return Err(bad("The secret must be 16 to 200 characters"));
    }
    let sealed = seal(&tx.cfg, &format!("git:{p}"), v.secret.as_bytes());
    sqlx::query(
        "INSERT INTO project_git_secrets(tenant_id,project_id,secret_sealed) VALUES($1,$2,$3) \
         ON CONFLICT (tenant_id,project_id) DO UPDATE SET secret_sealed=EXCLUDED.secret_sealed, updated_at=now()",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(sealed)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "updated", "project", p).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct GitSecretStatus {
    pub(crate) configured: bool,
    /// Where to send repository events: `POST /api/integrations/git/{project_id}`.
    pub(crate) webhook_path: String,
}

#[utoipa::path(get, path = "/api/projects/{id}/git-secret", tag = "integrations", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Whether a secret is set; the secret itself is never returned", body = GitSecretStatus), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_git_secret(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<GitSecretStatus>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    valid_project(&mut tx, &i, p).await?;
    let configured: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM project_git_secrets WHERE tenant_id=$1 AND project_id=$2)")
        .bind(i.tenant_id)
        .bind(p)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(Json(GitSecretStatus { configured, webhook_path: format!("/api/integrations/git/{p}") }))
}

/// Keys of the form `KEY-123` that belong to `project_key`, in order of first appearance.
fn issue_numbers_in(text: &str, project_key: &str) -> Vec<i64> {
    let mut out: Vec<i64> = Vec::new();
    for token in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')) {
        if let Some((key, number)) = token.split_once('-') {
            if key == project_key
                && !number.is_empty()
                && number.len() <= 9
                && number.chars().all(|c| c.is_ascii_digit())
            {
                if let Ok(n) = number.parse::<i64>() {
                    if n > 0 && !out.contains(&n) {
                        out.push(n);
                    }
                }
            }
        }
    }
    out
}

/// One link candidate from a repository event.
struct GitItem {
    kind: &'static str,
    reference: String,
    title: String,
    url: String,
    author: String,
    text: String,
}

fn git_items(event: &str, payload: &Value) -> Vec<GitItem> {
    let s = |v: Option<&Value>| v.and_then(Value::as_str).unwrap_or("").to_string();
    match event {
        "push" => payload
            .get("commits")
            .and_then(Value::as_array)
            .map(|commits| {
                commits
                    .iter()
                    .take(200)
                    .map(|c| {
                        let message = s(c.get("message"));
                        GitItem {
                            kind: "commit",
                            reference: s(c.get("id")),
                            title: message.lines().next().unwrap_or("").chars().take(500).collect(),
                            url: s(c.get("url")),
                            author: c
                                .get("author")
                                .and_then(|a| a.get("username").or_else(|| a.get("name")))
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .chars()
                                .take(200)
                                .collect(),
                            text: message,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
        "pull_request" => payload
            .get("pull_request")
            .map(|pr| {
                let number = pr.get("number").and_then(Value::as_i64).unwrap_or(0);
                let title = s(pr.get("title"));
                vec![GitItem {
                    kind: "pull_request",
                    reference: number.to_string(),
                    url: s(pr.get("html_url")),
                    author: pr
                        .get("user")
                        .and_then(|u| u.get("login"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .chars()
                        .take(200)
                        .collect(),
                    text: format!("{} {}", title, s(pr.get("body"))),
                    title: title.chars().take(500).collect(),
                }]
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Inbound repository events for one project. Authenticated by the project's signing secret, not by
/// a session. The tenant comes from the project row, never from the request body.
#[utoipa::path(post, path = "/api/integrations/git/{id}", tag = "integrations", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Events read; returns how many links were created", body = Object), (status = 400, description = "Unsupported event or body", body = ErrorBody), (status = 401, description = "Signature missing or wrong", body = ErrorBody)))]
pub(crate) async fn git_webhook(
    State(app): State<App>,
    Path(p): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let refuse = || err(StatusCode::UNAUTHORIZED, "Signature missing or wrong");
    if body.len() > MAX_WEBHOOK_BYTES {
        return Err(bad("Event body is too large"));
    }
    let project: Option<(Uuid, String)> =
        sqlx::query_as("SELECT tenant_id, key FROM projects WHERE id=$1 AND archived_at IS NULL")
            .bind(p)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?;
    let sealed: Option<String> = match &project {
        Some((tenant, _)) => sqlx::query_scalar("SELECT secret_sealed FROM project_git_secrets WHERE tenant_id=$1 AND project_id=$2")
            .bind(tenant)
            .bind(p)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?,
        None => None,
    };
    let (Some((tenant, key)), Some(sealed)) = (project, sealed) else {
        return Err(refuse());
    };
    let secret = open(&app.cfg, &format!("git:{p}"), &sealed).ok_or_else(refuse)?;
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("sha256="))
        .and_then(|hex_sig| hex::decode(hex_sig).ok())
        .ok_or_else(refuse)?;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&secret).map_err(|_| refuse())?;
    mac.update(&body);
    mac.verify_slice(&signature).map_err(|_| refuse())?;
    let event = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let payload: Value = serde_json::from_slice(&body).map_err(|_| bad("Body is not JSON"))?;
    let items = git_items(&event, &payload);
    if items.is_empty() {
        return Ok(Json(json!({"linked": 0, "ignored": true})));
    }
    let mut linked = 0_i64;
    let mut seen: HashSet<(i64, &'static str, String)> = HashSet::new();
    for item in items {
        let mut numbers = issue_numbers_in(&item.text, &key);
        numbers.retain(|n| seen.insert((*n, item.kind, item.reference.clone())));
        for number in numbers {
            let issue: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM issues WHERE tenant_id=$1 AND project_id=$2 AND number=$3 AND archived_at IS NULL",
            )
            .bind(tenant)
            .bind(p)
            .bind(number)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?;
            if let Some(issue) = issue {
                let res = sqlx::query(
                    "INSERT INTO dev_links(tenant_id,issue_id,kind,ref,title,url,author) VALUES($1,$2,$3,$4,$5,$6,$7) \
                     ON CONFLICT (tenant_id,issue_id,kind,ref) DO NOTHING",
                )
                .bind(tenant)
                .bind(issue)
                .bind(item.kind)
                .bind(&item.reference)
                .bind(&item.title)
                .bind(&item.url)
                .bind(&item.author)
                .execute(&app.db)
                .await
                .map_err(db_err)?;
                linked += res.rows_affected() as i64;
            }
        }
    }
    Ok(Json(json!({"linked": linked})))
}

/// A commit or pull request linked to an issue.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct DevLink {
    pub(crate) id: i64,
    /// `commit` or `pull_request`.
    pub(crate) kind: String,
    /// Commit id or pull request number.
    pub(crate) reference: String,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) author: String,
    pub(crate) occurred_at: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/issues/{id}/dev-links", tag = "integrations", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Commits and pull requests that name this issue", body = Vec<DevLink>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_dev_links(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Vec<DevLink>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let rows: Vec<DevLink> = sqlx::query_as(
        "SELECT id, kind, ref AS reference, title, url, author, occurred_at FROM dev_links WHERE tenant_id=$1 AND issue_id=$2 \
         ORDER BY occurred_at DESC LIMIT 200",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/me/tokens", get(list_tokens).post(create_token))
        .route("/api/me/tokens/{id}", delete(revoke_token))
        .route("/api/projects/{id}/git-secret", put(put_git_secret).get(get_git_secret))
        .route("/api/integrations/git/{id}", post(git_webhook))
        .route("/api/issues/{id}/dev-links", get(issue_dev_links))
}
