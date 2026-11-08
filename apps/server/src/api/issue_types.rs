//! Issue type schemes (Phase F3). Each project defines the types its issues can have. A key is fixed
//! once created, because issues store it. Names and icons can change. Level-1 types group child
//! issues (epic level); level-0 types are standard work and can be subtasks.
use crate::api::common::*;
use crate::*;
use axum::routing::{get, patch};

/// Keeps the type menu usable.
const MAX_TYPES_PER_PROJECT: i64 = 12;
pub(crate) const ICONS: [&str; 8] = [
    "task",
    "bug",
    "story",
    "epic",
    "feature",
    "improvement",
    "incident",
    "request",
];

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct IssueType {
    pub(crate) key: String,
    pub(crate) name: String,
    /// One of the built-in icon names: task, bug, story, epic, feature, improvement, incident, request.
    pub(crate) icon: String,
    /// 0 for standard work, 1 for epic-level work that groups children.
    pub(crate) hierarchy_level: i32,
    /// Menu order, from 0.
    pub(crate) position: i32,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewIssueType {
    /// 1 to 40 characters.
    pub(crate) name: String,
    /// Optional. One of the built-in icon names; defaults to `task`.
    pub(crate) icon: Option<String>,
    /// Optional. 0 (standard, the default) or 1 (epic level).
    pub(crate) hierarchy_level: Option<i32>,
    /// Optional. Derived from the name when absent: lowercase letters, digits and underscores.
    pub(crate) key: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueTypePatch {
    pub(crate) name: Option<String>,
    pub(crate) icon: Option<String>,
}

/// The types every new project starts with, which match the four types projects have always had.
const DEFAULT_TYPES: [(&str, &str, i32, i32); 4] = [
    ("task", "Task", 0, 0),
    ("bug", "Bug", 0, 1),
    ("story", "Story", 0, 2),
    ("epic", "Epic", 1, 3),
];

pub(crate) async fn seed_defaults(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
) -> ApiResult<()> {
    for (key, name, level, position) in DEFAULT_TYPES {
        sqlx::query(
            "INSERT INTO issue_types(tenant_id,project_id,key,name,icon,hierarchy_level,position) VALUES($1,$2,$3,$4,$3,$5,$6)",
        )
        .bind(tenant)
        .bind(project)
        .bind(key)
        .bind(name)
        .bind(level)
        .bind(position)
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
    }
    Ok(())
}

/// The hierarchy level of a type the project defines, or None when it does not define it.
pub(crate) async fn type_level(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    key: &str,
) -> ApiResult<Option<i32>> {
    sqlx::query_scalar(
        "SELECT hierarchy_level FROM issue_types WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(tenant)
    .bind(project)
    .bind(key)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)
}

/// Refuses a type the project does not define.
pub(crate) async fn check_type(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    key: &str,
) -> ApiResult<()> {
    match type_level(db, tenant, project, key).await? {
        Some(_) => Ok(()),
        None => Err(bad("Invalid issue type for this project")),
    }
}

/// The type a new issue gets when none is given: the first standard type by position.
pub(crate) async fn default_type(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
) -> ApiResult<String> {
    sqlx::query_scalar(
        "SELECT key FROM issue_types WHERE tenant_id=$1 AND project_id=$2 AND hierarchy_level=0 ORDER BY position, key LIMIT 1",
    )
    .bind(tenant)
    .bind(project)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::Internal("The project has no standard issue type".into()))
}

/// Keeps a type that the project defines, otherwise falls back to the project's default type.
/// Used when issues move or are imported from a project that has different types.
pub(crate) async fn type_or_default(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    key: &str,
) -> ApiResult<String> {
    if type_level(db, tenant, project, key).await?.is_some() {
        Ok(key.to_string())
    } else {
        default_type(db, tenant, project).await
    }
}

fn validate_name(name: &str) -> ApiResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 40 {
        return Err(bad("A type name is 1 to 40 characters"));
    }
    Ok(trimmed.to_string())
}

fn validate_icon(icon: &str) -> ApiResult<String> {
    if ICONS.contains(&icon) {
        Ok(icon.to_string())
    } else {
        Err(bad(
            "Icon must be one of task, bug, story, epic, feature, improvement, incident or request",
        ))
    }
}

#[utoipa::path(get, path = "/api/projects/{id}/issue-types", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "The project's issue types in menu order", body = Vec<IssueType>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_issue_types(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<IssueType>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<IssueType> = sqlx::query_as(
        "SELECT key,name,icon,hierarchy_level,position FROM issue_types WHERE tenant_id=$1 AND project_id=$2 ORDER BY position, key",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/issue-types", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewIssueType, responses((status = 201, description = "Created at the end of the menu", body = IssueType), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 409, description = "The key already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_issue_type(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewIssueType>,
) -> ApiResult<(StatusCode, Json<IssueType>)> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let name = validate_name(&v.name)?;
    let icon = validate_icon(v.icon.as_deref().unwrap_or("task"))?;
    let level = v.hierarchy_level.unwrap_or(0);
    if level != 0 && level != 1 {
        return Err(bad("Hierarchy level is 0 (standard) or 1 (epic level)"));
    }
    let key =
        match v.key {
            Some(k) if crate::api::statuses::valid_key(&k) => k,
            Some(_) => return Err(bad(
                "A type key uses lowercase letters, digits and underscores, starting with a letter",
            )),
            None => crate::api::statuses::slug(&name)?,
        };
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM issue_types WHERE tenant_id=$1 AND project_id=$2")
            .bind(i.tenant_id)
            .bind(project)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if count >= MAX_TYPES_PER_PROJECT {
        return Err(bad("A project can have up to 12 issue types"));
    }
    if type_level(&mut tx, i.tenant_id, project, &key)
        .await?
        .is_some()
    {
        return Err(err(
            StatusCode::CONFLICT,
            "An issue type with this key already exists",
        ));
    }
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM issue_types WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: IssueType = sqlx::query_as(
        "INSERT INTO issue_types(tenant_id,project_id,key,name,icon,hierarchy_level,position) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING key,name,icon,hierarchy_level,position",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .bind(&name)
    .bind(&icon)
    .bind(level)
    .bind(position)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "issue_type_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(patch, path = "/api/projects/{id}/issue-types/{key}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Issue type key")), request_body = IssueTypePatch, responses((status = 200, description = "Updated", body = IssueType), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such issue type", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_issue_type(
    mut tx: Tx,
    Path((project, key)): Path<(Uuid, String)>,
    Json(v): Json<IssueTypePatch>,
) -> ApiResult<Json<IssueType>> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    if type_level(&mut tx, i.tenant_id, project, &key)
        .await?
        .is_none()
    {
        return Err(err(StatusCode::NOT_FOUND, "Issue type not found"));
    }
    if let Some(name) = v.name {
        let name = validate_name(&name)?;
        sqlx::query(
            "UPDATE issue_types SET name=$1 WHERE tenant_id=$2 AND project_id=$3 AND key=$4",
        )
        .bind(&name)
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    if let Some(icon) = v.icon {
        let icon = validate_icon(&icon)?;
        sqlx::query(
            "UPDATE issue_types SET icon=$1 WHERE tenant_id=$2 AND project_id=$3 AND key=$4",
        )
        .bind(&icon)
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    let row: IssueType = sqlx::query_as(
        "SELECT key,name,icon,hierarchy_level,position FROM issue_types WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "issue_type_updated", "project", project).await?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/projects/{id}/issue-types/{key}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Issue type key")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such issue type", body = ErrorBody), (status = 409, description = "Issues still use it, or it is the last standard type", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_issue_type(
    mut tx: Tx,
    Path((project, key)): Path<(Uuid, String)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let level = type_level(&mut tx, i.tenant_id, project, &key)
        .await?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue type not found"))?;
    // Archived issues count too: they still reference the type.
    let used: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND kind=$3",
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
            &format!("{used} issue(s) use this type. Change them to another type first"),
        ));
    }
    if level == 0 {
        let others: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM issue_types WHERE tenant_id=$1 AND project_id=$2 AND hierarchy_level=0 AND key<>$3",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if others == 0 {
            return Err(err(
                StatusCode::CONFLICT,
                "A project needs at least one standard issue type",
            ));
        }
    }
    sqlx::query("DELETE FROM issue_types WHERE tenant_id=$1 AND project_id=$2 AND key=$3")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "issue_type_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/issue-types",
            get(list_issue_types).post(create_issue_type),
        )
        .route(
            "/api/projects/{id}/issue-types/{key}",
            patch(update_issue_type).delete(delete_issue_type),
        )
}
