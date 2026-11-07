//! Project access control: visibility (workspace / private) and explicit grants to users or teams.
//! Only project admins (workspace owners/admins are always project admins) can change access.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, patch, put};
use serde_json::Value;

#[utoipa::path(get, path = "/api/projects/{id}/access", tag = "access", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Explicit grants on the project", body = Vec<Object>), (status = 404, description = "Project not found or not visible", body = ErrorBody), (status = 403, description = "Project admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_access(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let rows = sqlx::query_scalar(
        "SELECT jsonb_build_object('subject_type',t.subject_type,'subject_id',t.subject_id,\
         'name',COALESCE(u.display_name,tm.name),'email',u.email,'relation',t.relation,'created_at',t.created_at) \
         FROM relation_tuples t \
         LEFT JOIN users u ON t.subject_type='user' AND u.id=t.subject_id \
         LEFT JOIN teams tm ON t.subject_type='team' AND tm.tenant_id=t.tenant_id AND tm.id=t.subject_id \
         WHERE t.tenant_id=$1 AND t.object_type='project' AND t.object_id=$2 ORDER BY t.created_at LIMIT 500",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct GrantInput {
    /// `user` or `team`.
    pub(crate) subject_type: String,
    pub(crate) subject_id: Uuid,
    /// `viewer`, `editor` or `admin`.
    pub(crate) level: String,
}
#[utoipa::path(put, path = "/api/projects/{id}/access", tag = "access", params(("id" = Uuid, Path, description = "Project id")), request_body = GrantInput, responses((status = 204, description = "Grant stored (replaces any earlier grant for the same subject)"), (status = 400, description = "Unknown subject or level", body = ErrorBody), (status = 403, description = "Project admin required", body = ErrorBody), (status = 404, description = "Project not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn grant_access(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<GrantInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    if !["viewer", "editor", "admin"].contains(&v.level.as_str()) {
        return Err(bad("Level must be viewer, editor or admin"));
    }
    let exists: bool = match v.subject_type.as_str() {
        "user" => sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)"),
        "team" => sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM teams WHERE tenant_id=$1 AND id=$2)"),
        _ => return Err(bad("Subject must be a user or a team")),
    }
    .bind(i.tenant_id)
    .bind(v.subject_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if !exists {
        return Err(bad("Subject is not part of this workspace"));
    }
    sqlx::query("DELETE FROM relation_tuples WHERE tenant_id=$1 AND object_type='project' AND object_id=$2 AND subject_type=$3 AND subject_id=$4")
        .bind(i.tenant_id).bind(project).bind(&v.subject_type).bind(v.subject_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("INSERT INTO relation_tuples(tenant_id,object_type,object_id,relation,subject_type,subject_id,created_by) VALUES($1,'project',$2,$3,$4,$5,$6)")
        .bind(i.tenant_id).bind(project).bind(&v.level).bind(&v.subject_type).bind(v.subject_id).bind(i.user_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    log_event(&mut *tx, &i, "access_granted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/projects/{id}/access/{subject_type}/{subject_id}", tag = "access", params(("id" = Uuid, Path, description = "Project id"), ("subject_type" = String, Path, description = "user or team"), ("subject_id" = Uuid, Path, description = "User or team id")), responses((status = 204, description = "Grant removed"), (status = 403, description = "Project admin required", body = ErrorBody), (status = 404, description = "Project or grant not found", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn revoke_access(
    mut tx: Tx,
    Path((project, subject_type, subject_id)): Path<(Uuid, String, Uuid)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let done = sqlx::query("DELETE FROM relation_tuples WHERE tenant_id=$1 AND object_type='project' AND object_id=$2 AND subject_type=$3 AND subject_id=$4")
        .bind(i.tenant_id).bind(project).bind(&subject_type).bind(subject_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such grant"));
    }
    log_event(&mut *tx, &i, "access_revoked", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct VisibilityInput {
    /// `workspace` or `private`.
    pub(crate) visibility: String,
}
#[utoipa::path(patch, path = "/api/projects/{id}", tag = "access", params(("id" = Uuid, Path, description = "Project id")), request_body = VisibilityInput, responses((status = 204, description = "Visibility updated"), (status = 400, description = "Unknown visibility", body = ErrorBody), (status = 403, description = "Project admin required", body = ErrorBody), (status = 404, description = "Project not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_visibility(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<VisibilityInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    if !["workspace", "private"].contains(&v.visibility.as_str()) {
        return Err(bad("Visibility must be workspace or private"));
    }
    if v.visibility == "private" {
        // Never strand the project: whoever makes it private keeps admin access explicitly.
        sqlx::query("INSERT INTO relation_tuples(tenant_id,object_type,object_id,relation,subject_type,subject_id,created_by) VALUES($1,'project',$2,'admin','user',$3,$3) ON CONFLICT DO NOTHING")
            .bind(i.tenant_id).bind(project).bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    }
    sqlx::query("UPDATE projects SET visibility=$3 WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&v.visibility)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut *tx, &i, "visibility_changed", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/access",
            get(list_access).put(grant_access),
        )
        .route(
            "/api/projects/{id}/access/{subject_type}/{subject_id}",
            delete(revoke_access),
        )
        .route("/api/projects/{id}", patch(set_visibility))
}
