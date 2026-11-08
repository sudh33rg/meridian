//! Per-project issue workflow: the status catalogue. A status key is fixed once created, because
//! issues store it. Names, categories and order can change. The category drives behaviour: a
//! `done` status counts as completed and closes an issue for overdue and open counts.
use crate::api::common::*;
use crate::*;
use axum::routing::{get, patch};

/// Keeps board columns and dropdowns usable.
const MAX_STATUSES_PER_PROJECT: i64 = 20;
const CATEGORIES: [&str; 3] = ["todo", "in_progress", "done"];

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ProjectStatus {
    pub(crate) key: String,
    pub(crate) name: String,
    /// `todo`, `in_progress` or `done`.
    pub(crate) category: String,
    /// Board column order, from 0.
    pub(crate) position: i32,
    /// Most issues the column holds before moves into it are refused, or null for no limit.
    pub(crate) wip_limit: Option<i32>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewStatus {
    /// 1 to 40 characters.
    pub(crate) name: String,
    pub(crate) category: String,
    /// Optional. Derived from the name when absent: lowercase letters, digits and underscores.
    pub(crate) key: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WipLimitInput {
    /// 1 to 1000, or null to remove the limit.
    pub(crate) limit: Option<i32>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct StatusPatch {
    pub(crate) name: Option<String>,
    pub(crate) category: Option<String>,
    /// New column index. Other statuses shift to make room.
    pub(crate) position: Option<i32>,
}

/// The statuses every new project starts with, which match what all projects had before this.
/// Project templates (Phase K1). Each names the statuses a new project starts with. Templates only
/// seed statuses: fields, boards and rules stay as the project defines them.
pub(crate) const PROJECT_TEMPLATES: [&str; 4] = ["software", "kanban", "bugs", "service"];

pub(crate) async fn seed_template(db: &mut PgConnection, tenant: Uuid, project: Uuid, template: &str) -> ApiResult<()> {
    let statuses: &[(&str, &str, &str, i32)] = match template {
        "kanban" => &[("todo", "To do", "todo", 0), ("in_progress", "In progress", "in_progress", 1), ("done", "Done", "done", 2)],
        "bugs" => &[
            ("new", "New", "todo", 0),
            ("triage", "Triage", "todo", 1),
            ("fixing", "Fixing", "in_progress", 2),
            ("verified", "Verified", "in_progress", 3),
            ("closed", "Closed", "done", 4),
        ],
        "service" => &[("open", "Open", "todo", 0), ("waiting", "Waiting", "in_progress", 1), ("resolved", "Resolved", "done", 2)],
        _ => &[
            ("todo", "To do", "todo", 0),
            ("in_progress", "In progress", "in_progress", 1),
            ("in_review", "In review", "in_progress", 2),
            ("done", "Done", "done", 3),
        ],
    };
    for (key, name, category, position) in statuses.iter().copied() {
        sqlx::query(
            "INSERT INTO project_statuses(tenant_id,project_id,key,name,category,position) VALUES($1,$2,$3,$4,$5,$6)",
        )
        .bind(tenant)
        .bind(project)
        .bind(key)
        .bind(name)
        .bind(category)
        .bind(position)
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
    }

    let fields: &[(&str, &str, &str, &[&str], bool, i32)] = match template {
        "bugs" => &[
            ("severity", "Severity", "select", &["low", "medium", "high", "critical"], false, 0),
        ],
        "service" => &[
            ("impact", "Impact", "select", &["low", "medium", "high", "critical"], false, 0),
            ("urgency", "Urgency", "select", &["low", "medium", "high"], false, 1),
        ],
        "software" => &[
            ("environment", "Environment", "select", &["development", "staging", "production"], false, 0),
        ],
        _ => &[],
    };
    for (f_key, f_label, f_type, f_opts, f_req, f_pos) in fields {
        let opts: Vec<String> = f_opts.iter().map(|s| s.to_string()).collect();
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3)",
        )
        .bind(tenant)
        .bind(project)
        .bind(f_key)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)?;
        if !exists {
            sqlx::query(
                "INSERT INTO field_definitions(tenant_id, project_id, key, label, field_type, options, required, position) \
                 VALUES($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(tenant)
            .bind(project)
            .bind(f_key)
            .bind(f_label)
            .bind(f_type)
            .bind(&opts)
            .bind(f_req)
            .bind(f_pos)
            .execute(&mut *db)
            .await
            .map_err(db_err)?;
        }
    }
    Ok(())
}

/// Whether the project defines this status key.
pub(crate) async fn status_defined(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    key: &str,
) -> ApiResult<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3)",
    )
    .bind(tenant)
    .bind(project)
    .bind(key)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)
}

/// The status a new issue starts in: the first `todo` status by position.
pub(crate) async fn default_status(db: &mut PgConnection, tenant: Uuid, project: Uuid) -> ApiResult<String> {
    sqlx::query_scalar(
        "SELECT key FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND category='todo' ORDER BY position, key LIMIT 1",
    )
    .bind(tenant)
    .bind(project)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::Internal("The project has no To do status".into()))
}

pub(crate) fn valid_key(key: &str) -> bool {
    let b = key.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && b[0].is_ascii_lowercase()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

pub(crate) fn slug(name: &str) -> ApiResult<String> {
    let mut out = String::new();
    for c in name.trim().to_ascii_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('_') {
            out.push('_');
        }
    }
    let key: String = out.chars().take(32).collect();
    let key = key.trim_end_matches('_').to_string();
    if valid_key(&key) {
        Ok(key)
    } else {
        Err(bad("Give the status a name that starts with a letter"))
    }
}

fn validate_name(name: &str) -> ApiResult<String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 40 {
        return Err(bad("A status name must be 1 to 40 characters"));
    }
    Ok(n.to_string())
}

fn validate_category(category: &str) -> ApiResult<String> {
    if CATEGORIES.contains(&category) {
        Ok(category.to_string())
    } else {
        Err(bad("Category must be todo, in_progress or done"))
    }
}

#[utoipa::path(get, path = "/api/projects/{id}/statuses", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "The project's statuses in column order", body = Vec<ProjectStatus>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_statuses(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<ProjectStatus>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<ProjectStatus> = sqlx::query_as(
        "SELECT key,name,category,position,wip_limit FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 ORDER BY position, key",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/statuses", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewStatus, responses((status = 201, description = "Created at the end of the board", body = ProjectStatus), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 409, description = "The key already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_status(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewStatus>,
) -> ApiResult<(StatusCode, Json<ProjectStatus>)> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let name = validate_name(&v.name)?;
    let category = validate_category(&v.category)?;
    let key = match v.key {
        Some(k) if valid_key(&k) => k,
        Some(_) => return Err(bad("A status key uses lowercase letters, digits and underscores, starting with a letter")),
        None => slug(&name)?,
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM project_statuses WHERE tenant_id=$1 AND project_id=$2")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if count >= MAX_STATUSES_PER_PROJECT {
        return Err(bad("A project can have up to 20 statuses"));
    }
    if status_defined(&mut tx, i.tenant_id, project, &key).await? {
        return Err(err(StatusCode::CONFLICT, "A status with this key already exists"));
    }
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM project_statuses WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: ProjectStatus = sqlx::query_as(
        "INSERT INTO project_statuses(tenant_id,project_id,key,name,category,position) VALUES($1,$2,$3,$4,$5,$6) RETURNING key,name,category,position,wip_limit",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .bind(&name)
    .bind(&category)
    .bind(position)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "status_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// Moves one status to `target` and renumbers the rest, all inside the request transaction. The
/// position uniqueness constraint is deferred, so the intermediate states are allowed.
async fn reorder(tx: &mut Tx, tenant: Uuid, project: Uuid, key: &str, target: i32) -> ApiResult<()> {
    let others: Vec<String> = sqlx::query_scalar(
        "SELECT key FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key<>$3 ORDER BY position, key",
    )
    .bind(tenant)
    .bind(project)
    .bind(key)
    .fetch_all(&mut **tx)
    .await
    .map_err(db_err)?;
    let index = (target.max(0) as usize).min(others.len());
    let mut order = others;
    order.insert(index, key.to_string());
    for (position, k) in order.iter().enumerate() {
        sqlx::query("UPDATE project_statuses SET position=$1 WHERE tenant_id=$2 AND project_id=$3 AND key=$4")
            .bind(position as i32)
            .bind(tenant)
            .bind(project)
            .bind(k)
            .execute(&mut **tx)
            .await
            .map_err(db_err)?;
    }
    Ok(())
}

#[utoipa::path(patch, path = "/api/projects/{id}/statuses/{key}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Status key")), request_body = StatusPatch, responses((status = 200, description = "Updated", body = ProjectStatus), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such status", body = ErrorBody), (status = 409, description = "A project needs at least one To do status", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_status(
    mut tx: Tx,
    Path((project, key)): Path<(Uuid, String)>,
    Json(v): Json<StatusPatch>,
) -> ApiResult<Json<ProjectStatus>> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let current: Option<ProjectStatus> = sqlx::query_as(
        "SELECT key,name,category,position,wip_limit FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let current = current.ok_or_else(|| err(StatusCode::NOT_FOUND, "Status not found"))?;
    let name = match v.name {
        Some(n) => validate_name(&n)?,
        None => current.name.clone(),
    };
    let category = match v.category {
        Some(c) => validate_category(&c)?,
        None => current.category.clone(),
    };
    if current.category == "todo" && category != "todo" {
        let others: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND category='todo' AND key<>$3",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if others == 0 {
            return Err(err(StatusCode::CONFLICT, "A project needs at least one To do status"));
        }
    }
    sqlx::query("UPDATE project_statuses SET name=$1, category=$2 WHERE tenant_id=$3 AND project_id=$4 AND key=$5")
        .bind(&name)
        .bind(&category)
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if let Some(target) = v.position {
        reorder(&mut tx, i.tenant_id, project, &key, target).await?;
    }
    let row: ProjectStatus = sqlx::query_as(
        "SELECT key,name,category,position,wip_limit FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "status_updated", "project", project).await?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/projects/{id}/statuses/{key}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Status key")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such status", body = ErrorBody), (status = 409, description = "Issues still use it, or it is the last To do status", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_status(
    mut tx: Tx,
    Path((project, key)): Path<(Uuid, String)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let category: Option<String> = sqlx::query_scalar(
        "SELECT category FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let category = category.ok_or_else(|| err(StatusCode::NOT_FOUND, "Status not found"))?;
    // Archived issues count too: they still reference the status.
    let used: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND status=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if used > 0 {
        return Err(err(
            StatusCode::CONFLICT,
            &format!("{used} issue(s) use this status. Move them to another status first"),
        ));
    }
    if category == "todo" {
        let others: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND category='todo' AND key<>$3",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if others == 0 {
            return Err(err(StatusCode::CONFLICT, "A project needs at least one To do status"));
        }
    }
    sqlx::query("DELETE FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "status_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(put, path = "/api/projects/{id}/statuses/{key}/wip-limit", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Status key")), request_body = WipLimitInput, responses((status = 200, description = "Updated", body = ProjectStatus), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such status", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_wip_limit(
    mut tx: Tx,
    Path((project, key)): Path<(Uuid, String)>,
    Json(v): Json<WipLimitInput>,
) -> ApiResult<Json<ProjectStatus>> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    if v.limit.is_some_and(|n| !(1..=1000).contains(&n)) {
        return Err(bad("A WIP limit is between 1 and 1000, or null for none"));
    }
    let updated = sqlx::query("UPDATE project_statuses SET wip_limit=$1 WHERE tenant_id=$2 AND project_id=$3 AND key=$4")
        .bind(v.limit)
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if updated.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Status not found"));
    }
    let row: ProjectStatus = sqlx::query_as(
        "SELECT key,name,category,position,wip_limit FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "status_wip_limit_set", "project", project).await?;
    Ok(Json(row))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/statuses/{key}/wip-limit", axum::routing::put(set_wip_limit))
        .route("/api/projects/{id}/statuses", get(list_statuses).post(create_status))
        .route("/api/projects/{id}/statuses/{key}", patch(update_status).delete(delete_status))
}
