//! SCIM 2.0 provisioning (RFC 7643/7644): Users map to workspace memberships, Groups to teams.
//!
//! Security properties
//! * Authentication is a workspace-scoped bearer token (`scim_…`, shown once, stored as SHA-256,
//!   revocable). Every query is scoped by that token's tenant. Business plan only.
//! * Emails must belong to a domain this workspace has verified, so a SCIM client cannot attach
//!   arbitrary people (or their existing accounts) to a workspace.
//! * SCIM never edits the global profile of someone who belongs to other workspaces, "DELETE" and
//!   `active=false` only deactivate the membership (and end its sessions), and a deactivated member
//!   cannot come back through SSO.
use crate::api::common::log_event_system;
use crate::billing::{enforce_limit, require_feature, Feature, Limit};
use crate::*;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get};
use serde_json::{json, Map, Value};

const USER_SCHEMA: &str = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA: &str = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA: &str = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA: &str = "urn:ietf:params:scim:api:messages:2.0:Error";

/// SCIM-shaped error (`application/scim+json`).
pub(crate) struct ScimError(StatusCode, String, Option<&'static str>);
impl IntoResponse for ScimError {
    fn into_response(self) -> Response {
        let mut body =
            json!({"schemas":[ERROR_SCHEMA],"status":self.0.as_u16().to_string(),"detail":self.1});
        if let Some(t) = self.2 {
            body["scimType"] = json!(t);
        }
        scim_json(self.0, body)
    }
}
impl From<sqlx::Error> for ScimError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error=%e, "SCIM database error");
        ScimError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal error".into(),
            None,
        )
    }
}
impl From<ApiError> for ScimError {
    fn from(e: ApiError) -> Self {
        ScimError(
            if matches!(e, ApiError::PlanLimit(_)) {
                StatusCode::FORBIDDEN
            } else {
                e.status()
            },
            e.to_string(),
            None,
        )
    }
}
type ScimResult = Result<Response, ScimError>;

fn scim_json(status: StatusCode, body: Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/scim+json")],
        body.to_string(),
    )
        .into_response()
}
fn not_found(what: &str) -> ScimError {
    ScimError(StatusCode::NOT_FOUND, format!("{what} not found"), None)
}
fn invalid(detail: &str) -> ScimError {
    ScimError(StatusCode::BAD_REQUEST, detail.into(), Some("invalidValue"))
}

/// The workspace a SCIM bearer token belongs to.
pub(crate) struct Scim {
    tenant: Uuid,
    actor: Uuid,
}
impl FromRequestParts<App> for Scim {
    type Rejection = ScimError;
    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self, ScimError> {
        let unauth = || {
            ScimError(
                StatusCode::UNAUTHORIZED,
                "A valid SCIM token is required".into(),
                None,
            )
        };
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .filter(|t| t.starts_with("scim_") && t.len() > 20)
            .ok_or_else(unauth)?;
        let row: Option<(Uuid, Uuid, Uuid)> = sqlx::query_as(
            "UPDATE scim_tokens SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id,tenant_id,created_by",
        )
        .bind(token_hash(token))
        .fetch_optional(&state.db)
        .await?;
        let (_, tenant, actor) = row.ok_or_else(unauth)?;
        require_feature(state, tenant, Feature::Scim)
            .await
            .map_err(ScimError::from)?;
        Ok(Scim { tenant, actor })
    }
}

// ---------------------------------------------------------------- representation

#[derive(FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    display_name: String,
    active: bool,
    external_id: Option<String>,
    created_at: chrono::DateTime<Utc>,
}
const USER_SELECT: &str = "SELECT u.id,u.email,u.display_name,(m.disabled_at IS NULL) AS active,e.external_id,u.created_at \
    FROM memberships m JOIN users u ON u.id=m.user_id \
    LEFT JOIN scim_external_ids e ON e.tenant_id=m.tenant_id AND e.user_id=m.user_id";

fn user_json(cfg: &crate::config::Config, u: &UserRow) -> Value {
    let (given, family) = u
        .display_name
        .split_once(' ')
        .unwrap_or((&u.display_name, ""));
    let mut v = json!({
        "schemas": [USER_SCHEMA],
        "id": u.id,
        "userName": u.email,
        "name": {"formatted": u.display_name, "givenName": given, "familyName": family},
        "displayName": u.display_name,
        "emails": [{"value": u.email, "primary": true}],
        "active": u.active,
        "meta": {"resourceType": "User", "created": u.created_at, "location": format!("{}/scim/v2/Users/{}", cfg.public_url, u.id)},
    });
    if let Some(e) = &u.external_id {
        v["externalId"] = json!(e);
    }
    v
}

fn parse_filter(filter: Option<&str>) -> Result<Option<(String, String)>, ScimError> {
    let Some(f) = filter.map(str::trim).filter(|f| !f.is_empty()) else {
        return Ok(None);
    };
    let parts: Vec<&str> = f.splitn(3, ' ').collect();
    if parts.len() == 3 && parts[1].eq_ignore_ascii_case("eq") {
        let value = parts[2].trim().trim_matches('"').to_string();
        let attr = parts[0].to_string();
        if ["userName", "externalId", "displayName"].contains(&attr.as_str()) {
            return Ok(Some((attr, value)));
        }
    }
    Err(ScimError(
        StatusCode::BAD_REQUEST,
        "Only `userName`, `externalId` and `displayName` with `eq` are supported".into(),
        Some("invalidFilter"),
    ))
}

fn paging(q: &std::collections::HashMap<String, String>) -> (i64, i64) {
    let start = q
        .get("startIndex")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    let count = q
        .get("count")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(0, 200);
    (start, count)
}

fn email_of(body: &Value) -> Option<String> {
    body["userName"]
        .as_str()
        .or_else(|| {
            body["emails"]
                .as_array()
                .and_then(|e| e.iter().find(|x| x["primary"] == true).or(e.first()))
                .and_then(|e| e["value"].as_str())
        })
        .map(|e| e.trim().to_lowercase())
        .filter(|e| e.contains('@') && e.len() <= 320)
}
fn name_of(body: &Value) -> Option<String> {
    body["displayName"]
        .as_str()
        .or_else(|| body["name"]["formatted"].as_str())
        .map(str::to_string)
        .or_else(|| {
            let g = body["name"]["givenName"].as_str().unwrap_or("");
            let f = body["name"]["familyName"].as_str().unwrap_or("");
            let n = format!("{g} {f}").trim().to_string();
            (!n.is_empty()).then_some(n)
        })
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty() && n.len() <= 200)
}
fn truthy(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

// ---------------------------------------------------------------- membership operations

async fn set_active(
    db: &mut PgConnection,
    s: &Scim,
    user: Uuid,
    active: bool,
) -> Result<(), ScimError> {
    if active {
        let was_inactive: bool = sqlx::query_scalar(
            "SELECT disabled_at IS NOT NULL FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        )
        .bind(s.tenant)
        .bind(user)
        .fetch_one(&mut *db)
        .await?;
        if was_inactive {
            enforce_limit(db, s.tenant, Limit::Seats).await?;
            sqlx::query(
                "UPDATE memberships SET disabled_at=NULL WHERE tenant_id=$1 AND user_id=$2",
            )
            .bind(s.tenant)
            .bind(user)
            .execute(&mut *db)
            .await?;
            log_event_system(db, s.tenant, s.actor, "scim_reactivated", "member", user).await?;
        }
    } else {
        let done = sqlx::query("UPDATE memberships SET disabled_at=now() WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL AND role<>'owner'")
            .bind(s.tenant).bind(user).execute(&mut *db).await?;
        if done.rows_affected() > 0 {
            sqlx::query("UPDATE session_families SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL")
                .bind(s.tenant).bind(user).execute(&mut *db).await?;
            sqlx::query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2")
                .bind(s.tenant)
                .bind(user)
                .execute(&mut *db)
                .await?;
            log_event_system(db, s.tenant, s.actor, "scim_deactivated", "member", user).await?;
        }
    }
    Ok(())
}

async fn rename_if_private(
    db: &mut PgConnection,
    s: &Scim,
    user: Uuid,
    name: &str,
) -> Result<(), ScimError> {
    // The profile is global; only rewrite it when this workspace is the person's only one.
    sqlx::query("UPDATE users SET display_name=$2 WHERE id=$1 AND (SELECT count(*) FROM memberships WHERE user_id=$1 AND disabled_at IS NULL)=1 AND EXISTS (SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id=$3)")
        .bind(user).bind(name).bind(s.tenant).execute(&mut *db).await?;
    Ok(())
}

async fn fetch_user(db: &mut PgConnection, tenant: Uuid, id: Uuid) -> Result<UserRow, ScimError> {
    sqlx::query_as::<_, UserRow>(&format!("{USER_SELECT} WHERE m.tenant_id=$1 AND u.id=$2"))
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut *db)
        .await?
        .ok_or_else(|| not_found("User"))
}

// ---------------------------------------------------------------- Users

async fn list_users(
    s: Scim,
    State(app): State<App>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> ScimResult {
    let filter = parse_filter(q.get("filter").map(String::as_str))?;
    let (start, count) = paging(&q);
    let (clause, bind) = match &filter {
        Some((a, v)) if a == "userName" => ("AND u.email=$2", v.to_lowercase()),
        Some((a, v)) if a == "externalId" => ("AND e.external_id=$2", v.clone()),
        Some((_, v)) => ("AND u.display_name=$2", v.clone()),
        None => ("AND $2=$2", String::new()),
    };
    let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN scim_external_ids e ON e.tenant_id=m.tenant_id AND e.user_id=m.user_id WHERE m.tenant_id=$1 {clause}"))
        .bind(s.tenant).bind(&bind).fetch_one(&app.db).await?;
    let rows: Vec<UserRow> = sqlx::query_as(&format!(
        "{USER_SELECT} WHERE m.tenant_id=$1 {clause} ORDER BY u.email OFFSET $3 LIMIT $4"
    ))
    .bind(s.tenant)
    .bind(&bind)
    .bind(start - 1)
    .bind(count)
    .fetch_all(&app.db)
    .await?;
    Ok(scim_json(
        StatusCode::OK,
        json!({
            "schemas": [LIST_SCHEMA], "totalResults": total, "startIndex": start, "itemsPerPage": rows.len(),
            "Resources": rows.iter().map(|u| user_json(&app.cfg, u)).collect::<Vec<_>>(),
        }),
    ))
}

async fn get_user(s: Scim, State(app): State<App>, Path(id): Path<Uuid>) -> ScimResult {
    let mut db = app.db.acquire().await?;
    let u = fetch_user(&mut db, s.tenant, id).await?;
    Ok(scim_json(StatusCode::OK, user_json(&app.cfg, &u)))
}

async fn create_user(s: Scim, State(app): State<App>, Json(body): Json<Value>) -> ScimResult {
    let email = email_of(&body).ok_or_else(|| invalid("userName must be an email address"))?;
    let domain = email
        .rsplit_once('@')
        .map(|(_, d)| d)
        .unwrap_or_default()
        .to_string();
    let verified: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM verified_domains WHERE tenant_id=$1 AND domain=$2 AND verified_at IS NOT NULL)")
        .bind(s.tenant).bind(&domain).fetch_one(&app.db).await?;
    if !verified {
        return Err(invalid(
            "The email domain has not been verified for this workspace",
        ));
    }
    let active = body.get("active").and_then(truthy).unwrap_or(true);
    let mut tx = app.db.begin().await?;
    if active {
        enforce_limit(&mut tx, s.tenant, Limit::Seats).await?;
    }
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await?;
    let user = match existing {
        Some(u) => u,
        None => {
            let name = name_of(&body)
                .unwrap_or_else(|| email.split('@').next().unwrap_or("Member").to_string());
            let hash = hash_password(&mint_token())?;
            sqlx::query_scalar(
                "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
            )
            .bind(&email)
            .bind(name)
            .bind(hash)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    let role: String = sqlx::query_scalar(
        "SELECT COALESCE((SELECT default_role FROM sso_connections WHERE tenant_id=$1),'member')",
    )
    .bind(s.tenant)
    .fetch_one(&mut *tx)
    .await?;
    let inserted = sqlx::query("INSERT INTO memberships(tenant_id,user_id,role,provisioned_by,disabled_at) VALUES($1,$2,$3,'scim',CASE WHEN $4 THEN NULL ELSE now() END) ON CONFLICT DO NOTHING")
        .bind(s.tenant).bind(user).bind(role).bind(active).execute(&mut *tx).await?;
    if inserted.rows_affected() == 0 {
        return Err(ScimError(
            StatusCode::CONFLICT,
            "That user is already a member of this workspace".into(),
            Some("uniqueness"),
        ));
    }
    if let Some(ext) = body["externalId"].as_str() {
        sqlx::query("INSERT INTO scim_external_ids(tenant_id,user_id,external_id) VALUES($1,$2,$3) ON CONFLICT (tenant_id,user_id) DO UPDATE SET external_id=EXCLUDED.external_id")
            .bind(s.tenant).bind(user).bind(ext).execute(&mut *tx).await
            .map_err(|_| ScimError(StatusCode::CONFLICT, "externalId already used".into(), Some("uniqueness")))?;
    }
    log_event_system(
        &mut tx,
        s.tenant,
        s.actor,
        "scim_provisioned",
        "member",
        user,
    )
    .await?;
    let u = fetch_user(&mut tx, s.tenant, user).await?;
    tx.commit().await?;
    Ok(scim_json(StatusCode::CREATED, user_json(&app.cfg, &u)))
}

async fn replace_user(
    s: Scim,
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(body): Json<Value>,
) -> ScimResult {
    let mut tx = app.db.begin().await?;
    fetch_user(&mut tx, s.tenant, id).await?;
    if let Some(n) = name_of(&body) {
        rename_if_private(&mut tx, &s, id, &n).await?;
    }
    if let Some(active) = body.get("active").and_then(truthy) {
        set_active(&mut tx, &s, id, active).await?;
    }
    if let Some(ext) = body["externalId"].as_str() {
        sqlx::query("INSERT INTO scim_external_ids(tenant_id,user_id,external_id) VALUES($1,$2,$3) ON CONFLICT (tenant_id,user_id) DO UPDATE SET external_id=EXCLUDED.external_id")
            .bind(s.tenant).bind(id).bind(ext).execute(&mut *tx).await?;
    }
    let u = fetch_user(&mut tx, s.tenant, id).await?;
    tx.commit().await?;
    Ok(scim_json(StatusCode::OK, user_json(&app.cfg, &u)))
}

async fn patch_user(
    s: Scim,
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(body): Json<Value>,
) -> ScimResult {
    let ops = body["Operations"]
        .as_array()
        .ok_or_else(|| invalid("Operations is required"))?;
    let mut tx = app.db.begin().await?;
    fetch_user(&mut tx, s.tenant, id).await?;
    for op in ops {
        let kind = op["op"].as_str().unwrap_or("").to_ascii_lowercase();
        if !["add", "replace", "remove"].contains(&kind.as_str()) {
            return Err(invalid("Unsupported op"));
        }
        // Normalise "no path + object value" to a list of (path, value).
        let mut changes: Vec<(String, Value)> = vec![];
        match (op["path"].as_str(), &op["value"]) {
            (Some(p), v) => changes.push((p.to_string(), v.clone())),
            (None, Value::Object(m)) => {
                changes.extend(m.iter().map(|(k, v)| (k.clone(), v.clone())))
            }
            _ => {}
        }
        for (path, value) in changes {
            match path.as_str() {
                "active" => {
                    let a = truthy(&value).ok_or_else(|| invalid("active must be a boolean"))?;
                    set_active(&mut tx, &s, id, a && kind != "remove").await?;
                }
                "displayName" | "name.formatted" => {
                    if let Some(n) = value
                        .as_str()
                        .filter(|n| !n.trim().is_empty() && n.len() <= 200)
                    {
                        rename_if_private(&mut tx, &s, id, n.trim()).await?;
                    }
                }
                "name" => {
                    if let Some(n) = name_of(&json!({"name": value})) {
                        rename_if_private(&mut tx, &s, id, &n).await?;
                    }
                }
                "externalId" => {
                    if let Some(ext) = value.as_str() {
                        sqlx::query("INSERT INTO scim_external_ids(tenant_id,user_id,external_id) VALUES($1,$2,$3) ON CONFLICT (tenant_id,user_id) DO UPDATE SET external_id=EXCLUDED.external_id")
                            .bind(s.tenant).bind(id).bind(ext).execute(&mut *tx).await?;
                    }
                }
                "userName" | "emails" => {
                    return Err(ScimError(
                        StatusCode::BAD_REQUEST,
                        "userName is immutable".into(),
                        Some("mutability"),
                    ))
                }
                _ => {}
            }
        }
    }
    let u = fetch_user(&mut tx, s.tenant, id).await?;
    tx.commit().await?;
    Ok(scim_json(StatusCode::OK, user_json(&app.cfg, &u)))
}

async fn delete_user(s: Scim, State(app): State<App>, Path(id): Path<Uuid>) -> ScimResult {
    let mut tx = app.db.begin().await?;
    fetch_user(&mut tx, s.tenant, id).await?;
    set_active(&mut tx, &s, id, false).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// ---------------------------------------------------------------- Groups (teams)

async fn group_json(
    db: &mut PgConnection,
    cfg: &crate::config::Config,
    tenant: Uuid,
    id: Uuid,
    name: &str,
) -> Result<Value, ScimError> {
    let members: Vec<(Uuid, String)> = sqlx::query_as("SELECT u.id,u.display_name FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND tm.team_id=$2 ORDER BY u.display_name")
        .bind(tenant).bind(id).fetch_all(&mut *db).await?;
    Ok(json!({
        "schemas": [GROUP_SCHEMA], "id": id, "displayName": name,
        "members": members.into_iter().map(|(v, d)| json!({"value": v, "display": d})).collect::<Vec<_>>(),
        "meta": {"resourceType": "Group", "location": format!("{}/scim/v2/Groups/{}", cfg.public_url, id)},
    }))
}

fn member_ids(v: &Value) -> Result<Vec<Uuid>, ScimError> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|m| m["value"].as_str().and_then(|s| Uuid::parse_str(s).ok()))
                .collect()
        })
        .ok_or_else(|| invalid("members must be a list"))
}

async fn add_members(
    db: &mut PgConnection,
    tenant: Uuid,
    team: Uuid,
    users: &[Uuid],
) -> Result<(), ScimError> {
    for u in users {
        let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)")
            .bind(tenant).bind(u).fetch_one(&mut *db).await?;
        if !ok {
            return Err(invalid(
                "Every group member must be an active member of the workspace",
            ));
        }
        sqlx::query("INSERT INTO team_members(tenant_id,team_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(tenant).bind(team).bind(u).execute(&mut *db).await?;
    }
    Ok(())
}

async fn list_groups(
    s: Scim,
    State(app): State<App>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> ScimResult {
    let filter = parse_filter(q.get("filter").map(String::as_str))?;
    let (start, count) = paging(&q);
    let name = match &filter {
        Some((a, v)) if a == "displayName" => Some(v.clone()),
        Some(_) => {
            return Err(ScimError(
                StatusCode::BAD_REQUEST,
                "Groups support only displayName eq".into(),
                Some("invalidFilter"),
            ))
        }
        None => None,
    };
    let mut db = app.db.acquire().await?;
    let rows: Vec<(Uuid, String)> = sqlx::query_as("SELECT id,name FROM teams WHERE tenant_id=$1 AND ($2::text IS NULL OR name=$2) ORDER BY name OFFSET $3 LIMIT $4")
        .bind(s.tenant).bind(&name).bind(start - 1).bind(count).fetch_all(&mut *db).await?;
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM teams WHERE tenant_id=$1 AND ($2::text IS NULL OR name=$2)",
    )
    .bind(s.tenant)
    .bind(&name)
    .fetch_one(&mut *db)
    .await?;
    let mut resources = vec![];
    for (id, n) in rows {
        resources.push(group_json(&mut db, &app.cfg, s.tenant, id, &n).await?);
    }
    Ok(scim_json(
        StatusCode::OK,
        json!({"schemas":[LIST_SCHEMA],"totalResults":total,"startIndex":start,"itemsPerPage":resources.len(),"Resources":resources}),
    ))
}

async fn get_group(s: Scim, State(app): State<App>, Path(id): Path<Uuid>) -> ScimResult {
    let mut db = app.db.acquire().await?;
    let name: String = sqlx::query_scalar("SELECT name FROM teams WHERE tenant_id=$1 AND id=$2")
        .bind(s.tenant)
        .bind(id)
        .fetch_optional(&mut *db)
        .await?
        .ok_or_else(|| not_found("Group"))?;
    Ok(scim_json(
        StatusCode::OK,
        group_json(&mut db, &app.cfg, s.tenant, id, &name).await?,
    ))
}

async fn create_group(s: Scim, State(app): State<App>, Json(body): Json<Value>) -> ScimResult {
    let name = body["displayName"]
        .as_str()
        .map(str::trim)
        .filter(|n| !n.is_empty() && n.len() <= 120)
        .ok_or_else(|| invalid("displayName is required"))?;
    let mut tx = app.db.begin().await?;
    let id: Uuid =
        sqlx::query_scalar("INSERT INTO teams(tenant_id,name) VALUES($1,$2) RETURNING id")
            .bind(s.tenant)
            .bind(name)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| {
                ScimError(
                    StatusCode::CONFLICT,
                    "A group with that name already exists".into(),
                    Some("uniqueness"),
                )
            })?;
    if let Some(m) = body.get("members") {
        add_members(&mut tx, s.tenant, id, &member_ids(m)?).await?;
    }
    log_event_system(&mut tx, s.tenant, s.actor, "scim_group_created", "team", id).await?;
    let out = group_json(&mut tx, &app.cfg, s.tenant, id, name).await?;
    tx.commit().await?;
    Ok(scim_json(StatusCode::CREATED, out))
}

async fn patch_group(
    s: Scim,
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(body): Json<Value>,
) -> ScimResult {
    let ops = body["Operations"]
        .as_array()
        .ok_or_else(|| invalid("Operations is required"))?;
    let mut tx = app.db.begin().await?;
    let mut name: String =
        sqlx::query_scalar("SELECT name FROM teams WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
            .bind(s.tenant)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| not_found("Group"))?;
    for op in ops {
        let kind = op["op"].as_str().unwrap_or("").to_ascii_lowercase();
        let path = op["path"].as_str().unwrap_or("");
        match (kind.as_str(), path) {
            ("add", "members") => {
                add_members(&mut tx, s.tenant, id, &member_ids(&op["value"])?).await?
            }
            ("replace", "members") => {
                sqlx::query("DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2")
                    .bind(s.tenant)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                add_members(&mut tx, s.tenant, id, &member_ids(&op["value"])?).await?;
            }
            ("remove", "members") => {
                let ids = op.get("value").map(member_ids).transpose()?;
                match ids {
                    Some(ids) => {
                        sqlx::query("DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2 AND user_id=ANY($3)").bind(s.tenant).bind(id).bind(&ids).execute(&mut *tx).await?;
                    }
                    None => {
                        sqlx::query("DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2")
                            .bind(s.tenant)
                            .bind(id)
                            .execute(&mut *tx)
                            .await?;
                    }
                }
            }
            ("remove", p) if p.starts_with("members[") => {
                if let Some(uid) = p.split('"').nth(1).and_then(|x| Uuid::parse_str(x).ok()) {
                    sqlx::query(
                        "DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2 AND user_id=$3",
                    )
                    .bind(s.tenant)
                    .bind(id)
                    .bind(uid)
                    .execute(&mut *tx)
                    .await?;
                }
            }
            ("replace" | "add", "displayName") => {
                if let Some(n) = op["value"]
                    .as_str()
                    .map(str::trim)
                    .filter(|n| !n.is_empty() && n.len() <= 120)
                {
                    sqlx::query("UPDATE teams SET name=$3 WHERE tenant_id=$1 AND id=$2")
                        .bind(s.tenant)
                        .bind(id)
                        .bind(n)
                        .execute(&mut *tx)
                        .await
                        .map_err(|_| {
                            ScimError(
                                StatusCode::CONFLICT,
                                "A group with that name already exists".into(),
                                Some("uniqueness"),
                            )
                        })?;
                    name = n.to_string();
                }
            }
            ("replace" | "add", "") if op["value"].is_object() => {
                let m: &Map<String, Value> = op["value"].as_object().expect("checked");
                if let Some(n) = m
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|n| !n.is_empty())
                {
                    sqlx::query("UPDATE teams SET name=$3 WHERE tenant_id=$1 AND id=$2")
                        .bind(s.tenant)
                        .bind(id)
                        .bind(n)
                        .execute(&mut *tx)
                        .await
                        .map_err(|_| {
                            ScimError(
                                StatusCode::CONFLICT,
                                "A group with that name already exists".into(),
                                Some("uniqueness"),
                            )
                        })?;
                    name = n.to_string();
                }
                if let Some(ms) = m.get("members") {
                    add_members(&mut tx, s.tenant, id, &member_ids(ms)?).await?;
                }
            }
            _ => return Err(invalid("Unsupported operation")),
        }
    }
    log_event_system(&mut tx, s.tenant, s.actor, "scim_group_updated", "team", id).await?;
    let out = group_json(&mut tx, &app.cfg, s.tenant, id, &name).await?;
    tx.commit().await?;
    Ok(scim_json(StatusCode::OK, out))
}

async fn replace_group(
    s: Scim,
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(body): Json<Value>,
) -> ScimResult {
    let name = body["displayName"]
        .as_str()
        .map(str::trim)
        .filter(|n| !n.is_empty() && n.len() <= 120)
        .ok_or_else(|| invalid("displayName is required"))?;
    let mut tx = app.db.begin().await?;
    let done = sqlx::query("UPDATE teams SET name=$3 WHERE tenant_id=$1 AND id=$2")
        .bind(s.tenant)
        .bind(id)
        .bind(name)
        .execute(&mut *tx)
        .await
        .map_err(|_| {
            ScimError(
                StatusCode::CONFLICT,
                "A group with that name already exists".into(),
                Some("uniqueness"),
            )
        })?;
    if done.rows_affected() == 0 {
        return Err(not_found("Group"));
    }
    if let Some(m) = body.get("members") {
        sqlx::query("DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2")
            .bind(s.tenant)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        add_members(&mut tx, s.tenant, id, &member_ids(m)?).await?;
    }
    let out = group_json(&mut tx, &app.cfg, s.tenant, id, name).await?;
    tx.commit().await?;
    Ok(scim_json(StatusCode::OK, out))
}

async fn delete_group(s: Scim, State(app): State<App>, Path(id): Path<Uuid>) -> ScimResult {
    let mut tx = app.db.begin().await?;
    sqlx::query("DELETE FROM team_members WHERE tenant_id=$1 AND team_id=$2")
        .bind(s.tenant)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM relation_tuples WHERE tenant_id=$1 AND subject_type='team' AND subject_id=$2",
    )
    .bind(s.tenant)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let done = sqlx::query("DELETE FROM teams WHERE tenant_id=$1 AND id=$2")
        .bind(s.tenant)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(not_found("Group"));
    }
    log_event_system(&mut tx, s.tenant, s.actor, "scim_group_deleted", "team", id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// ---------------------------------------------------------------- discovery

async fn service_provider_config(_s: Scim) -> ScimResult {
    Ok(scim_json(
        StatusCode::OK,
        json!({
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
            "patch": {"supported": true}, "bulk": {"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
            "filter": {"supported": true, "maxResults": 200}, "changePassword": {"supported": false},
            "sort": {"supported": false}, "etag": {"supported": false},
            "authenticationSchemes": [{"type": "oauthbearertoken", "name": "Bearer token", "description": "Workspace SCIM token"}],
        }),
    ))
}
async fn resource_types(_s: Scim) -> ScimResult {
    Ok(scim_json(
        StatusCode::OK,
        json!({"schemas":[LIST_SCHEMA],"totalResults":2,"Resources":[
        {"id":"User","name":"User","endpoint":"/Users","schema":USER_SCHEMA},
        {"id":"Group","name":"Group","endpoint":"/Groups","schema":GROUP_SCHEMA}]}),
    ))
}
async fn schemas(_s: Scim) -> ScimResult {
    Ok(scim_json(
        StatusCode::OK,
        json!({"schemas":[LIST_SCHEMA],"totalResults":2,"Resources":[
        {"id":USER_SCHEMA,"name":"User"},{"id":GROUP_SCHEMA,"name":"Group"}]}),
    ))
}

// ---------------------------------------------------------------- token management (admin UI)

fn require_admin(i: &Identity) -> ApiResult<()> {
    if i.role == "owner" || i.role == "admin" {
        Ok(())
    } else {
        Err(forbidden())
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct TokenInput {
    pub(crate) name: String,
}
#[utoipa::path(post, path = "/api/workspace/scim/tokens", tag = "scim", request_body = TokenInput, responses((status = 201, description = "The token, shown once", body = Object), (status = 402, description = "Business plan required", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_token(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<TokenInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_admin(&i)?;
    require_feature(&app, i.tenant_id, Feature::Scim).await?;
    let name = v.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(bad("Give the token a short name"));
    }
    let token = format!("scim_{}", mint_token());
    let id: Uuid = sqlx::query_scalar("INSERT INTO scim_tokens(tenant_id,name,token_hash,created_by) VALUES($1,$2,$3,$4) RETURNING id")
        .bind(i.tenant_id).bind(name).bind(token_hash(&token)).bind(i.user_id).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"id": id, "token": token, "base_url": format!("{}/scim/v2", app.cfg.public_url)}),
        ),
    ))
}

#[utoipa::path(get, path = "/api/workspace/scim/tokens", tag = "scim", responses((status = 200, description = "SCIM tokens (never the secret)", body = Vec<Object>), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_tokens(
    State(app): State<App>,
    i: Identity,
) -> ApiResult<Json<Vec<Value>>> {
    require_admin(&i)?;
    let rows = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'created_at',created_at,'last_used_at',last_used_at) FROM scim_tokens WHERE tenant_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC")
        .bind(i.tenant_id).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(delete, path = "/api/workspace/scim/tokens/{id}", tag = "scim", params(("id" = Uuid, Path, description = "Token id")), responses((status = 204, description = "Revoked"), (status = 404, description = "No such token", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn revoke_token(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    let done = sqlx::query("UPDATE scim_tokens SET revoked_at=now() WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL")
        .bind(i.tenant_id).bind(id).execute(&app.db).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such token"));
    }
    Ok(StatusCode::NO_CONTENT)
}

use axum::extract::Query;

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/scim/v2/ServiceProviderConfig",
            get(service_provider_config),
        )
        .route("/scim/v2/ResourceTypes", get(resource_types))
        .route("/scim/v2/Schemas", get(schemas))
        .route("/scim/v2/Users", get(list_users).post(create_user))
        .route(
            "/scim/v2/Users/{id}",
            get(get_user)
                .put(replace_user)
                .patch(patch_user)
                .delete(delete_user),
        )
        .route("/scim/v2/Groups", get(list_groups).post(create_group))
        .route(
            "/scim/v2/Groups/{id}",
            get(get_group)
                .put(replace_group)
                .patch(patch_group)
                .delete(delete_group),
        )
        .route(
            "/api/workspace/scim/tokens",
            get(list_tokens).post(create_token),
        )
        .route("/api/workspace/scim/tokens/{id}", delete(revoke_token))
}
