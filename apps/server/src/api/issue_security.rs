//! Issue security levels. A project defines levels, puts members in them, and places issues
//! in a level. The rule that hides a restricted issue from people outside its level is a row level
//! security policy on `issues` (migration 0037), so every read honours it, not only the handlers here.
//!
//! Changing levels and placing issues is for project admins. Members of a project see the names of its
//! levels; only project admins see who is in each level.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get, put};

const LEVEL_NAME_MAX: usize = 80;

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct SecurityLevel {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) description: String,
    /// Member ids of the level. Empty for callers who are not project admins.
    pub(crate) member_ids: Vec<Uuid>,
}

/// The levels of a project, and whether the caller may change them.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct SecurityLevels {
    pub(crate) can_manage: bool,
    pub(crate) levels: Vec<SecurityLevel>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewSecurityLevel {
    /// 1 to 80 characters; unique per project.
    pub(crate) name: String,
    /// Up to 500 characters.
    pub(crate) description: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SecurityLevelMembers {
    /// Members of this workspace who may see the level's issues. Replaces the current list.
    pub(crate) user_ids: Vec<Uuid>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueSecurityInput {
    /// A level of the issue's project, or null to make the issue open to the project.
    pub(crate) level_id: Option<Uuid>,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct IssueSecurity {
    pub(crate) level_id: Option<Uuid>,
    pub(crate) name: Option<String>,
}

async fn level_project(tx: &mut Tx, tenant: Uuid, level: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar("SELECT project_id FROM security_levels WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(level)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Security level not found"))
}

#[utoipa::path(get, path = "/api/projects/{id}/security-levels", tag = "security", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "The project's levels", body = SecurityLevels), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_levels(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<SecurityLevels>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let can_manage = project_level(&mut tx, &i, project).await?.unwrap_or(0) >= 3;
    let mut levels: Vec<SecurityLevel> = sqlx::query_as(
        "SELECT l.id, l.name, l.description, COALESCE(array_agg(m.user_id) FILTER (WHERE m.user_id IS NOT NULL), '{}') AS member_ids \
         FROM security_levels l LEFT JOIN security_level_members m ON m.tenant_id=l.tenant_id AND m.level_id=l.id \
         WHERE l.tenant_id=$1 AND l.project_id=$2 GROUP BY l.id, l.name, l.description ORDER BY lower(l.name)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    if !can_manage {
        for level in levels.iter_mut() {
            level.member_ids.clear();
        }
    }
    Ok(Json(SecurityLevels { can_manage, levels }))
}

#[utoipa::path(post, path = "/api/projects/{id}/security-levels", tag = "security", params(("id" = Uuid, Path, description = "Project id")), request_body = NewSecurityLevel, responses((status = 201, description = "Created", body = SecurityLevel), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 409, description = "A level with this name already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_level(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewSecurityLevel>,
) -> ApiResult<(StatusCode, Json<SecurityLevel>)> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > LEVEL_NAME_MAX {
        return Err(bad("Level name must be 1 to 80 characters"));
    }
    let description = v.description.unwrap_or_default();
    if description.chars().count() > 500 {
        return Err(bad("A description is limited to 500 characters"));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM security_levels WHERE tenant_id=$1 AND project_id=$2 AND name=$3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(
            StatusCode::CONFLICT,
            "A level with this name already exists",
        ));
    }
    let row: SecurityLevel = sqlx::query_as(
        "INSERT INTO security_levels(tenant_id,project_id,name,description) VALUES($1,$2,$3,$4) \
         RETURNING id, name, description, ARRAY[]::uuid[] AS member_ids",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .bind(&description)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "security_level_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/security-levels/{id}", tag = "security", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted. Its issues become open to the project"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_level(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = level_project(&mut tx, i.tenant_id, id).await?;
    ensure_project_admin(&mut tx, project).await?;
    sqlx::query(
        "UPDATE issues SET security_level_id=NULL WHERE tenant_id=$1 AND security_level_id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("DELETE FROM security_levels WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "security_level_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(put, path = "/api/security-levels/{id}/members", tag = "security", params(("id" = Uuid, Path, description = "Resource id")), request_body = SecurityLevelMembers, responses((status = 204, description = "Saved"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_level_members(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<SecurityLevelMembers>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = level_project(&mut tx, i.tenant_id, id).await?;
    ensure_project_admin(&mut tx, project).await?;
    let mut ids = v.user_ids.clone();
    ids.sort();
    ids.dedup();
    if ids.len() > 500 {
        return Err(bad("A level can hold up to 500 members"));
    }
    let known: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM memberships WHERE tenant_id=$1 AND user_id = ANY($2) AND disabled_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(&ids)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if known as usize != ids.len() {
        return Err(bad(
            "Every member must be an active member of this workspace",
        ));
    }
    sqlx::query("DELETE FROM security_level_members WHERE tenant_id=$1 AND level_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    for user in ids {
        sqlx::query(
            "INSERT INTO security_level_members(tenant_id,level_id,user_id) VALUES($1,$2,$3)",
        )
        .bind(i.tenant_id)
        .bind(id)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    log_event(
        &mut tx,
        &i,
        "security_level_members_set",
        "project",
        project,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/issues/{id}/security-level", tag = "security", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "The issue's level", body = IssueSecurity), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Issue not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_issue_level(
    mut tx: Tx,
    Path(issue): Path<Uuid>,
) -> ApiResult<Json<IssueSecurity>> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, issue).await?;
    let row: IssueSecurity = sqlx::query_as(
        "SELECT i.security_level_id AS level_id, l.name FROM issues i LEFT JOIN security_levels l \
         ON l.tenant_id=i.tenant_id AND l.id=i.security_level_id WHERE i.tenant_id=$1 AND i.id=$2",
    )
    .bind(i.tenant_id)
    .bind(issue)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(row))
}

#[utoipa::path(put, path = "/api/issues/{id}/security-level", tag = "security", params(("id" = Uuid, Path, description = "Resource id")), request_body = IssueSecurityInput, responses((status = 200, description = "Saved", body = IssueSecurity), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Issue or level not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_issue_level(
    mut tx: Tx,
    Path(issue): Path<Uuid>,
    Json(v): Json<IssueSecurityInput>,
) -> ApiResult<Json<IssueSecurity>> {
    let i = tx.identity.clone();
    let project = valid_issue(&mut tx, &i, issue).await?;
    ensure_project_admin(&mut tx, project).await?;
    let old: Option<String> = sqlx::query_scalar(
        "SELECT l.name FROM issues i LEFT JOIN security_levels l ON l.tenant_id=i.tenant_id AND l.id=i.security_level_id WHERE i.tenant_id=$1 AND i.id=$2",
    )
    .bind(i.tenant_id)
    .bind(issue)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let name: Option<String> = match v.level_id {
        None => None,
        Some(level) => {
            if level_project(&mut tx, i.tenant_id, level).await? != project {
                return Err(bad("That level belongs to another project"));
            }
            sqlx::query_scalar("SELECT name FROM security_levels WHERE tenant_id=$1 AND id=$2")
                .bind(i.tenant_id)
                .bind(level)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_err)?
        }
    };
    sqlx::query(
        "UPDATE issues SET security_level_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
    )
    .bind(v.level_id)
    .bind(i.tenant_id)
    .bind(issue)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    crate::api::history::record_change(
        &mut tx,
        i.tenant_id,
        issue,
        i.user_id,
        "security_level",
        old,
        name.clone(),
    )
    .await?;
    log_event(&mut tx, &i, "issue_security_level_set", "issue", issue).await?;
    Ok(Json(IssueSecurity {
        level_id: v.level_id,
        name,
    }))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route(
            "/api/projects/{id}/security-levels",
            get(list_levels).post(create_level),
        )
        .route("/api/security-levels/{id}", delete(delete_level))
        .route("/api/security-levels/{id}/members", put(set_level_members))
        .route(
            "/api/issues/{id}/security-level",
            get(get_issue_level).put(set_issue_level),
        )
}
