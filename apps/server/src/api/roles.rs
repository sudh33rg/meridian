//! Custom project roles. A role has a level (viewer, member or admin) and members. A member's
//! project level is the highest of their workspace role, the permission scheme, the grants, and the
//! custom roles they hold (migration 0046). Only project admins manage roles.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get, put};

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ProjectRole {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    /// 1 viewer, 2 member, 3 admin.
    pub(crate) level: i16,
    pub(crate) member_ids: Vec<Uuid>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewProjectRole {
    /// 1 to 80 characters; unique per project.
    pub(crate) name: String,
    /// 1 viewer, 2 member, 3 admin.
    pub(crate) level: i16,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ProjectRoleMembers {
    /// Members of this workspace who hold the role. Replaces the current list.
    pub(crate) user_ids: Vec<Uuid>,
}

async fn role_project(tx: &mut Tx, tenant: Uuid, role: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar("SELECT project_id FROM project_roles WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(role)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Role not found"))
}

#[utoipa::path(get, path = "/api/projects/{id}/roles", tag = "access", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "The project's custom roles. Members are listed for project admins only", body = Vec<ProjectRole>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_roles(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<ProjectRole>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let admin = project_level(&mut tx, &i, project).await?.unwrap_or(0) >= 3;
    let mut rows: Vec<ProjectRole> = sqlx::query_as(
        "SELECT r.id, r.name, r.level, COALESCE(array_agg(m.user_id) FILTER (WHERE m.user_id IS NOT NULL), '{}') AS member_ids \
         FROM project_roles r LEFT JOIN project_role_members m ON m.tenant_id=r.tenant_id AND m.role_id=r.id \
         WHERE r.tenant_id=$1 AND r.project_id=$2 GROUP BY r.id, r.name, r.level ORDER BY lower(r.name)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    if !admin {
        for row in rows.iter_mut() {
            row.member_ids.clear();
        }
    }
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/roles", tag = "access", params(("id" = Uuid, Path, description = "Project id")), request_body = NewProjectRole, responses((status = 201, description = "Created", body = ProjectRole), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 409, description = "A role with this name already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_role(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewProjectRole>,
) -> ApiResult<(StatusCode, Json<ProjectRole>)> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(bad("Role name must be 1 to 80 characters"));
    }
    if !matches!(v.level, 1..=3) {
        return Err(bad("level is 1 (viewer), 2 (member) or 3 (admin)"));
    }
    let taken: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM project_roles WHERE tenant_id=$1 AND project_id=$2 AND name=$3)")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&name)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if taken {
        return Err(err(StatusCode::CONFLICT, "A role with this name already exists"));
    }
    let row: ProjectRole = sqlx::query_as(
        "INSERT INTO project_roles(tenant_id,project_id,name,level) VALUES($1,$2,$3,$4) RETURNING id, name, level, ARRAY[]::uuid[] AS member_ids",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .bind(v.level)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "project_role_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/roles/{id}", tag = "access", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_role(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = role_project(&mut tx, i.tenant_id, id).await?;
    ensure_project_admin(&mut tx, project).await?;
    sqlx::query("DELETE FROM project_roles WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "project_role_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(put, path = "/api/roles/{id}/members", tag = "access", params(("id" = Uuid, Path, description = "Resource id")), request_body = ProjectRoleMembers, responses((status = 204, description = "Saved"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_role_members(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ProjectRoleMembers>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = role_project(&mut tx, i.tenant_id, id).await?;
    ensure_project_admin(&mut tx, project).await?;
    let mut ids = v.user_ids.clone();
    ids.sort();
    ids.dedup();
    if ids.len() > 500 {
        return Err(bad("A role can hold up to 500 members"));
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
        return Err(bad("Every member must be an active member of this workspace"));
    }
    sqlx::query("DELETE FROM project_role_members WHERE tenant_id=$1 AND role_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    for user in ids {
        sqlx::query("INSERT INTO project_role_members(tenant_id,role_id,user_id) VALUES($1,$2,$3)")
            .bind(i.tenant_id)
            .bind(id)
            .bind(user)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    log_event(&mut tx, &i, "project_role_members_set", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/projects/{id}/roles", get(list_roles).post(create_role))
        .route("/api/roles/{id}", delete(delete_role))
        .route("/api/roles/{id}/members", put(set_role_members))
}
