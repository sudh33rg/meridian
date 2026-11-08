//! Core projects, issues and pages.
use crate::api::collab::run_automations;
use crate::api::common::*;
use crate::*;
use axum::response::IntoResponse;
use axum::routing::patch;
use sha2::{Digest, Sha256};

pub(crate) const ISSUE_PRIORITIES: [&str; 4] = ["low", "medium", "high", "urgent"];

/// Query for `GET /api/projects/{id}/issues`. Results are ordered by issue number, newest first.
/// Pass the `X-Next-Cursor` response header back as `cursor` to fetch the next page; the header is
/// absent on the last page.
#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct IssueListQuery {
    /// Page size, 1 to 500 (default 500, the size clients received before paging existed).
    pub(crate) limit: Option<i64>,
    /// Continue below the issue number returned in `X-Next-Cursor`.
    pub(crate) cursor: Option<String>,
    /// Exact status key, as defined by the project's workflow.
    pub(crate) status: Option<String>,
    /// Exact priority filter: low, medium, high or urgent.
    pub(crate) priority: Option<String>,
    /// Only issues assigned to this user.
    pub(crate) assignee_id: Option<Uuid>,
    /// Case-insensitive title search, up to 200 characters.
    pub(crate) q: Option<String>,
    /// `true` lists archived issues instead of active ones (default `false`).
    pub(crate) archived: Option<bool>,
}

/// Optional `Idempotency-Key` header: 8 to 255 visible ASCII characters.
fn idempotency_key(headers: &HeaderMap) -> ApiResult<Option<String>> {
    let Some(value) = headers.get("idempotency-key") else {
        return Ok(None);
    };
    let key = value
        .to_str()
        .map_err(|_| bad("Idempotency-Key must be visible ASCII"))?;
    if !(8..=255).contains(&key.len()) || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(bad("Idempotency-Key must be 8 to 255 visible ASCII characters"));
    }
    Ok(Some(key.to_string()))
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Project {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) key: String,
    pub(crate) description: String,
    pub(crate) created_at: DateTime<Utc>,
    /// `workspace` (everyone in the workspace) or `private` (explicit grants only).
    pub(crate) visibility: String,
    /// The caller's effective access: `viewer`, `editor` or `admin`.
    pub(crate) access: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewProject {
    pub(crate) name: String,
    pub(crate) key: String,
    pub(crate) description: Option<String>,
    pub(crate) visibility: Option<String>,
}
pub(crate) const PROJECT_COLS: &str = "p.id,p.name,p.key,p.description,p.created_at,p.visibility,\
 CASE project_access(p.id,$2,$3) WHEN 3 THEN 'admin' WHEN 2 THEN 'editor' ELSE 'viewer' END AS access";

#[utoipa::path(get, path = "/api/projects", tag = "work", responses((status = 200, description = "Success", body = Vec<Project>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn projects(mut tx: Tx) -> ApiResult<Json<Vec<Project>>> {
    let i = tx.identity.clone();
    let items = sqlx::query_as(&format!(
        "SELECT {PROJECT_COLS} FROM projects p WHERE p.tenant_id=$1 AND project_access(p.id,$2,$3)>=1 ORDER BY p.created_at DESC LIMIT 200"
    ))
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(&i.role)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(items))
}
#[utoipa::path(post, path = "/api/projects", tag = "work", request_body = NewProject, responses((status = 201, description = "Success", body = Project), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_project(
    mut tx: Tx,
    Json(v): Json<NewProject>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    let i = tx.identity.clone();
    if !can_edit(&i) {
        return Err(forbidden());
    }
    if v.name.trim().is_empty()
        || v.key.len() < 2
        || v.key.len() > 10
        || !v
            .key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        || !v.key.starts_with(|c: char| c.is_ascii_uppercase())
    {
        return Err(bad("Use a project name and uppercase 2-10 character key"));
    }
    if i.role == "guest" {
        return Err(forbidden());
    }
    crate::billing::enforce_limit(&mut tx, i.tenant_id, crate::billing::Limit::Projects).await?;
    let visibility = v.visibility.clone().unwrap_or_else(|| "workspace".into());
    if !["workspace", "private"].contains(&visibility.as_str()) {
        return Err(bad("Visibility must be workspace or private"));
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO projects(tenant_id,name,key,description) VALUES($1,$2,$3,$4) RETURNING id",
    )
    .bind(i.tenant_id)
    .bind(v.name.trim())
    .bind(v.key)
    .bind(v.description.unwrap_or_default())
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| bad("Project key may already exist"))?;
    crate::api::statuses::seed_defaults(&mut tx, i.tenant_id, id).await?;
    if visibility == "private" {
        // The creator must not lock themselves out of their own private project.
        sqlx::query("INSERT INTO relation_tuples(tenant_id,object_type,object_id,relation,subject_type,subject_id,created_by) VALUES($1,'project',$2,'admin','user',$3,$3)")
            .bind(i.tenant_id).bind(id).bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
        sqlx::query("UPDATE projects SET visibility='private' WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    let p: Project = sqlx::query_as(&format!(
        "SELECT {PROJECT_COLS} FROM projects p WHERE p.tenant_id=$1 AND p.id=$4"
    ))
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(&i.role)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "created", "project", id).await?;
    Ok((StatusCode::CREATED, Json(p)))
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Issue {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewIssue {
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) priority: Option<String>,
    /// Values for the project's custom fields. Required fields must be present.
    pub(crate) custom_fields: Option<serde_json::Value>,
    /// Owning team. Must exist in this workspace.
    pub(crate) team_id: Option<Uuid>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct PatchIssue {
    pub(crate) status: String,
}
#[utoipa::path(get, path = "/api/projects/{id}/issues", tag = "work", params(("id" = Uuid, Path, description = "Resource id"), IssueListQuery), responses((status = 200, description = "Success. X-Next-Cursor is present when another page exists", body = Vec<Issue>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issues(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    axum::extract::Query(p): axum::extract::Query<IssueListQuery>,
) -> ApiResult<(HeaderMap, Json<Vec<Issue>>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let limit = p.limit.unwrap_or(500);
    if !(1..=500).contains(&limit) {
        return Err(bad("limit must be between 1 and 500"));
    }
    let before: Option<i64> = match p.cursor.as_deref().filter(|c| !c.is_empty()) {
        None => None,
        Some(c) => Some(
            c.parse::<i64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| bad("Invalid cursor"))?,
        ),
    };
    if let Some(s) = p.status.as_deref() {
        if !crate::api::statuses::status_defined(&mut tx, i.tenant_id, project, s).await? {
            return Err(bad("Invalid status filter"));
        }
    }
    if p.priority.as_deref().is_some_and(|s| !ISSUE_PRIORITIES.contains(&s)) {
        return Err(bad("Invalid priority filter"));
    }
    // Escape LIKE wildcards so the search text is matched literally.
    let search = match p.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(s) if s.chars().count() > 200 => {
            return Err(bad("Search text is limited to 200 characters"))
        }
        Some(s) => Some(format!(
            "%{}%",
            s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        )),
    };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2)")
            .bind(i.tenant_id)
            .bind(project)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    // Fetch one row past the page size to learn whether another page exists without a COUNT.
    let mut rows: Vec<Issue> = sqlx::query_as(
        "SELECT id,project_id,number,title,description,kind,status,priority,created_at,updated_at \
         FROM issues WHERE tenant_id=$1 AND project_id=$2 AND ((archived_at IS NOT NULL) = $9) \
         AND ($3::bigint IS NULL OR number < $3) AND ($4::text IS NULL OR status=$4) \
         AND ($5::text IS NULL OR priority=$5) AND ($6::uuid IS NULL OR assignee_id=$6) \
         AND ($7::text IS NULL OR title ILIKE $7 ESCAPE '\\') \
         ORDER BY number DESC LIMIT $8",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(before)
    .bind(p.status)
    .bind(p.priority)
    .bind(p.assignee_id)
    .bind(search)
    .bind(limit + 1)
    .bind(p.archived.unwrap_or(false))
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    let mut headers = HeaderMap::new();
    if has_more {
        if let Some(last) = rows.last() {
            if let Ok(v) = axum::http::HeaderValue::from_str(&last.number.to_string()) {
                headers.insert("x-next-cursor", v);
            }
        }
    }
    Ok((headers, Json(rows)))
}
#[utoipa::path(post, path = "/api/projects/{id}/issues", tag = "work", params(("id" = Uuid, Path, description = "Resource id"), ("Idempotency-Key" = Option<String>, Header, description = "Optional client key (8 to 255 visible ASCII characters). A retry with the same key and body replays the original 201 response with Idempotent-Replayed: true; the same key with a different body returns 409")), request_body = NewIssue, responses((status = 201, description = "Success", body = Issue), (status = 409, description = "Idempotency-Key reused for a different request", body = ErrorBody), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_issue(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    headers: HeaderMap,
    Json(v): Json<NewIssue>,
) -> ApiResult<axum::response::Response> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    if !can_edit(&i) {
        return Err(forbidden());
    }
    if v.title.trim().is_empty() {
        return Err(bad("Title is required"));
    }
    let kind = v.kind.unwrap_or_else(|| "task".into());
    let priority = v.priority.unwrap_or_else(|| "medium".into());
    if !["task", "bug", "story", "epic"].contains(&kind.as_str())
        || !["low", "medium", "high", "urgent"].contains(&priority.as_str())
    {
        return Err(bad("Unsupported issue kind or priority"));
    }
    let present = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    // Values are checked before the idempotency lookup, so a replay cannot skip validation.
    let custom = crate::api::fields::validate_values(
        &mut tx,
        i.tenant_id,
        project,
        &v.custom_fields.clone().unwrap_or_else(|| serde_json::json!({})),
    )
    .await?;
    if present.is_none() {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    let team = v.team_id;
    if let Some(t) = team {
        let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM teams WHERE tenant_id=$1 AND id=$2)")
            .bind(i.tenant_id)
            .bind(t)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if !ok {
            return Err(bad("Team not found in this workspace"));
        }
    }
    // The project row lock above serializes creates in this project. A retry that waited for an
    // earlier request with the same key therefore sees that request's stored response below.
    let idem = idempotency_key(&headers)?;
    let scope = format!("issue.create:{project}");
    let request_hash = hex::encode(Sha256::digest(
        serde_json::json!({
            "project": project,
            "title": v.title.trim(),
            "description": v.description.clone().unwrap_or_default(),
            "kind": &kind,
            "priority": &priority,
            "custom_fields": &custom,
            "team_id": team,
        })
        .to_string(),
    ));
    if let Some(key) = &idem {
        let stored: Option<(String, i32, serde_json::Value)> = sqlx::query_as(
            "SELECT request_hash,response_status,response_body FROM idempotency_keys \
             WHERE tenant_id=$1 AND user_id=$2 AND scope=$3 AND key=$4",
        )
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(&scope)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        if let Some((hash, status, body)) = stored {
            if hash != request_hash {
                return Err(err(
                    StatusCode::CONFLICT,
                    "This Idempotency-Key was already used for a different request",
                ));
            }
            let status = StatusCode::from_u16(status as u16).unwrap_or(StatusCode::CREATED);
            return Ok((
                [("idempotent-replayed", "true")],
                (status, Json(body)),
            )
                .into_response());
        }
    }
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    // New issues start in the project's first To do status (the workflow decides which that is).
    let status = crate::api::statuses::default_status(&mut tx, i.tenant_id, project).await?;
    let row:Issue=sqlx::query_as("INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,created_by,status,custom_fields,team_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,project_id,number,title,description,kind,status,priority,created_at,updated_at")
 .bind(i.tenant_id).bind(project).bind(next).bind(v.title.trim()).bind(v.description.unwrap_or_default()).bind(kind).bind(priority).bind(i.user_id).bind(status).bind(custom).bind(team).fetch_one(&mut *tx).await.map_err(db_err)?;
    log_event(&mut tx, &i, "created", "issue", row.id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.created",
        row.id,
        serde_json::json!({"project_id":project}),
    )
    .await?;
    run_automations(&mut tx, &i, project, row.id, "issue_created").await?;
    if let Some(key) = &idem {
        // Stored in the same transaction as the issue, so a key never points at a missing issue.
        let body = serde_json::to_value(&row).map_err(|e| ApiError::Internal(e.to_string()))?;
        sqlx::query(
            "INSERT INTO idempotency_keys(tenant_id,user_id,scope,key,request_hash,response_status,response_body) \
             VALUES($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(&scope)
        .bind(key)
        .bind(&request_hash)
        .bind(201_i32)
        .bind(body)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    Ok((StatusCode::CREATED, Json(row)).into_response())
}
#[utoipa::path(patch, path = "/api/issues/{id}", tag = "work", params(("id" = Uuid, Path, description = "Resource id")), request_body = PatchIssue, responses((status = 200, description = "Success", body = Issue), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn patch_issue(
    mut tx: Tx,
    Path(issue): Path<Uuid>,
    Json(v): Json<PatchIssue>,
) -> ApiResult<Json<Issue>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", issue).await?;
    if !can_edit(&i) {
        return Err(forbidden());
    }
    let (project, from, custom): (Uuid, String, serde_json::Value) = sqlx::query_as(
        "SELECT project_id, status, custom_fields FROM issues WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(issue)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if !crate::api::statuses::status_defined(&mut tx, i.tenant_id, project, &v.status).await? {
        return Err(bad("Unknown status"));
    }
    crate::api::transitions::check_transition(&mut tx, i.tenant_id, project, &from, &v.status, &custom).await?;
    let row:Issue=sqlx::query_as("UPDATE issues SET status=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING id,project_id,number,title,description,kind,status,priority,created_at,updated_at")
 .bind(v.status).bind(i.tenant_id).bind(issue).fetch_optional(&mut *tx).await.map_err(db_err)?.ok_or_else(||err(StatusCode::NOT_FOUND,"Issue not found"))?;
    log_event(&mut tx, &i, "updated", "issue", issue).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.updated",
        issue,
        serde_json::json!({"project_id":row.project_id,"status":row.status.clone()}),
    )
    .await?;
    run_automations(&mut tx, &i, row.project_id, issue, "issue_status_changed").await?;
    Ok(Json(row))
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Page {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) parent_id: Option<Uuid>,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) version: i32,
    pub(crate) updated_at: DateTime<Utc>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewPage {
    pub(crate) title: String,
    pub(crate) content: Option<String>,
    pub(crate) parent_id: Option<Uuid>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct PatchPage {
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) expected_version: i32,
}
#[utoipa::path(get, path = "/api/projects/{id}/pages", tag = "work", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Page>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn pages(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<Page>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2)")
            .bind(i.tenant_id)
            .bind(project)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    let rows=sqlx::query_as("SELECT id,project_id,parent_id,title,content,version,updated_at FROM pages WHERE tenant_id=$1 AND project_id=$2 AND page_access(id,$3,$4)>=1 ORDER BY updated_at DESC LIMIT 500")
 .bind(i.tenant_id).bind(project).bind(i.user_id).bind(&i.role).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(post, path = "/api/projects/{id}/pages", tag = "work", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewPage, responses((status = 201, description = "Success", body = Page), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_page(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewPage>,
) -> ApiResult<(StatusCode, Json<Page>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    if !can_edit(&i) {
        return Err(forbidden());
    }
    if v.title.trim().is_empty() {
        return Err(bad("Title is required"));
    }
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2)")
            .bind(i.tenant_id)
            .bind(project)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    if let Some(parent) = v.parent_id {
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pages WHERE tenant_id=$1 AND project_id=$2 AND id=$3)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(parent)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if !valid {
            return Err(bad("Parent page must belong to this project"));
        }
    }
    let page:Page=sqlx::query_as("INSERT INTO pages(tenant_id,project_id,parent_id,title,content,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,project_id,parent_id,title,content,version,updated_at")
 .bind(i.tenant_id).bind(project).bind(v.parent_id).bind(v.title.trim()).bind(v.content.unwrap_or_default()).bind(i.user_id).fetch_one(&mut *tx).await.map_err(db_err)?;
    log_event(&mut tx, &i, "created", "page", page.id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "page.created",
        page.id,
        serde_json::json!({"project_id":project}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(page)))
}
#[utoipa::path(patch, path = "/api/pages/{id}", tag = "work", params(("id" = Uuid, Path, description = "Resource id")), request_body = PatchPage, responses((status = 200, description = "Success", body = Page), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn patch_page(
    mut tx: Tx,
    Path(page_id): Path<Uuid>,
    Json(v): Json<PatchPage>,
) -> ApiResult<Json<Page>> {
    let i = tx.identity.clone();
    ensure_page_access(&mut tx, page_id).await?;
    if !can_edit(&i) {
        return Err(forbidden());
    }
    if v.title.trim().is_empty() {
        return Err(bad("Title is required"));
    }
    let current:Option<Page>=sqlx::query_as("SELECT id,project_id,parent_id,title,content,version,updated_at FROM pages WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(i.tenant_id).bind(page_id).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let c = current.ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))?;
    if c.version != v.expected_version {
        return Err(err(
            StatusCode::CONFLICT,
            "Page has changed; refresh before saving",
        ));
    }
    sqlx::query("INSERT INTO page_versions(tenant_id,page_id,version,title,content,editor_id) VALUES($1,$2,$3,$4,$5,$6)")
 .bind(i.tenant_id).bind(page_id).bind(c.version).bind(&c.title).bind(&c.content).bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    let updated:Page=sqlx::query_as("UPDATE pages SET title=$1,content=$2,version=version+1,collab_epoch=collab_epoch+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING id,project_id,parent_id,title,content,version,updated_at")
 .bind(v.title.trim()).bind(&v.content).bind(i.tenant_id).bind(page_id).fetch_one(&mut *tx).await.map_err(db_err)?;
    // The saved text now wins over any live-edit state; rooms reset on the new epoch.
    sqlx::query("DELETE FROM page_ydoc_updates WHERE tenant_id=$1 AND page_id=$2")
        .bind(i.tenant_id)
        .bind(page_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "updated", "page", page_id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "page.updated",
        page_id,
        serde_json::json!({"project_id":updated.project_id}),
    )
    .await?;
    Ok(Json(updated))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects", get(projects).post(create_project))
        .route("/api/projects/{id}/issues", get(issues).post(create_issue))
        .route("/api/issues/{id}", patch(patch_issue))
        .route("/api/projects/{id}/pages", get(pages).post(create_page))
        .route("/api/pages/{id}", patch(patch_page))
}
