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
    log_event(&mut tx, &i, "access_granted", "project", project).await?;
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
    log_event(&mut tx, &i, "access_revoked", "project", project).await?;
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
    log_event(&mut tx, &i, "visibility_changed", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- page restrictions

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct PageAccess {
    /// Is this page itself restricted?
    pub(crate) restricted: bool,
    /// The nearest restricted ancestor whose grants apply (or the page itself).
    pub(crate) governed_by: Option<Uuid>,
    /// Your effective level on the page: 1 viewer, 2 editor, 3 admin.
    pub(crate) your_level: i32,
    pub(crate) grants: Vec<Value>,
}

#[utoipa::path(get, path = "/api/pages/{id}/access", tag = "access", params(("id" = Uuid, Path, description = "Page id")), responses((status = 200, description = "Restriction state and grants", body = PageAccess), (status = 404, description = "Page not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn page_access_info(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<PageAccess>> {
    let i = tx.identity.clone();
    ensure_page_access(&mut tx, id).await?;
    let restricted: bool =
        sqlx::query_scalar("SELECT restricted FROM pages WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    let governed_by: Option<Uuid> = sqlx::query_scalar(
        "WITH RECURSIVE c(id,parent_id,restricted,d) AS (SELECT id,parent_id,restricted,0 FROM pages WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,p.restricted,c.d+1 FROM pages p JOIN c ON p.id=c.parent_id WHERE c.d<50) SELECT id FROM c WHERE restricted ORDER BY d LIMIT 1",
    ).bind(id).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let level: i32 = sqlx::query_scalar("SELECT COALESCE(page_access($1,$2,$3),0)")
        .bind(id)
        .bind(i.user_id)
        .bind(&i.role)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let grants = match governed_by {
        Some(g) if level >= 2 => sqlx::query_scalar(
            "SELECT jsonb_build_object('subject_type',t.subject_type,'subject_id',t.subject_id,'name',COALESCE(u.display_name,tm.name),'email',u.email,'relation',t.relation) FROM page_grants t LEFT JOIN users u ON t.subject_type='user' AND u.id=t.subject_id LEFT JOIN teams tm ON t.subject_type='team' AND tm.tenant_id=t.tenant_id AND tm.id=t.subject_id WHERE t.tenant_id=$1 AND t.page_id=$2 ORDER BY t.created_at",
        ).bind(i.tenant_id).bind(g).fetch_all(&mut *tx).await.map_err(db_err)?,
        _ => vec![],
    };
    Ok(Json(PageAccess {
        restricted,
        governed_by,
        your_level: level,
        grants,
    }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct RestrictionInput {
    pub(crate) restricted: bool,
}
#[utoipa::path(put, path = "/api/pages/{id}/restriction", tag = "access", params(("id" = Uuid, Path, description = "Page id")), request_body = RestrictionInput, responses((status = 204, description = "Restriction updated"), (status = 403, description = "Editor access required", body = ErrorBody), (status = 404, description = "Page not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_restriction(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<RestrictionInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_page_editor(&mut tx, id).await?;
    if v.restricted {
        // Whoever restricts a page keeps editing it.
        sqlx::query("INSERT INTO page_grants(tenant_id,page_id,relation,subject_type,subject_id,created_by) VALUES($1,$2,'editor','user',$3,$3) ON CONFLICT (tenant_id,page_id,subject_type,subject_id) DO NOTHING")
            .bind(i.tenant_id).bind(id).bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    }
    sqlx::query("UPDATE pages SET restricted=$3 WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .bind(v.restricted)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(
        &mut *tx,
        &i,
        if v.restricted {
            "restricted"
        } else {
            "unrestricted"
        },
        "page",
        id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct PageGrantInput {
    /// `user` or `team`.
    pub(crate) subject_type: String,
    pub(crate) subject_id: Uuid,
    /// `viewer` or `editor`.
    pub(crate) level: String,
}
#[utoipa::path(put, path = "/api/pages/{id}/grants", tag = "access", params(("id" = Uuid, Path, description = "Page id")), request_body = PageGrantInput, responses((status = 204, description = "Grant stored"), (status = 400, description = "Unknown subject or level, or the page is not restricted", body = ErrorBody), (status = 403, description = "Editor access required", body = ErrorBody), (status = 404, description = "Page not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn grant_page(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<PageGrantInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_page_editor(&mut tx, id).await?;
    if !["viewer", "editor"].contains(&v.level.as_str()) {
        return Err(bad("Level must be viewer or editor"));
    }
    let restricted: bool =
        sqlx::query_scalar("SELECT restricted FROM pages WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if !restricted {
        return Err(bad(
            "Restrict the page first; grants only apply to restricted pages",
        ));
    }
    let exists: bool = match v.subject_type.as_str() {
        "user" => sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)"),
        "team" => sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM teams WHERE tenant_id=$1 AND id=$2)"),
        _ => return Err(bad("Subject must be a user or a team")),
    }
    .bind(i.tenant_id).bind(v.subject_id).fetch_one(&mut *tx).await.map_err(db_err)?;
    if !exists {
        return Err(bad("Subject is not part of this workspace"));
    }
    sqlx::query("INSERT INTO page_grants(tenant_id,page_id,relation,subject_type,subject_id,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,page_id,subject_type,subject_id) DO UPDATE SET relation=EXCLUDED.relation")
        .bind(i.tenant_id).bind(id).bind(&v.level).bind(&v.subject_type).bind(v.subject_id).bind(i.user_id)
        .execute(&mut *tx).await.map_err(db_err)?;
    log_event(&mut *tx, &i, "page_access_granted", "page", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/pages/{id}/grants/{subject_type}/{subject_id}", tag = "access", params(("id" = Uuid, Path, description = "Page id"), ("subject_type" = String, Path, description = "user or team"), ("subject_id" = Uuid, Path, description = "User or team id")), responses((status = 204, description = "Grant removed"), (status = 403, description = "Editor access required", body = ErrorBody), (status = 404, description = "Page or grant not found", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn revoke_page_grant(
    mut tx: Tx,
    Path((id, subject_type, subject_id)): Path<(Uuid, String, Uuid)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_page_editor(&mut tx, id).await?;
    let done = sqlx::query("DELETE FROM page_grants WHERE tenant_id=$1 AND page_id=$2 AND subject_type=$3 AND subject_id=$4")
        .bind(i.tenant_id).bind(id).bind(&subject_type).bind(subject_id).execute(&mut *tx).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such grant"));
    }
    log_event(&mut *tx, &i, "page_access_revoked", "page", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A project's permission scheme. Owners and admins always hold level 3 in a project, so no scheme can
/// lock them out.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct PermissionScheme {
    /// The level a workspace member gets in this project: 1 (viewer, read only) or 2 (member).
    pub(crate) member_level: i32,
    /// The level needed to create, edit, comment on and move issues: 2 (member) or 3 (admin).
    pub(crate) edit_min: i32,
    /// The level needed to change the statuses, transition rules, custom fields and issue types: 2 or 3.
    pub(crate) workflow_min: i32,
    /// Per-action levels (2 or 3) for `manage_sprints`, `manage_releases` and `delete_issues`. An action
    /// not listed uses `edit_min`. Replaces the saved map on every save.
    #[serde(default)]
    pub(crate) actions: std::collections::BTreeMap<String, i32>,
}

#[utoipa::path(get, path = "/api/projects/{id}/permission-scheme", tag = "access", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "The project's scheme; defaults apply when none is saved", body = PermissionScheme), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_scheme(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<PermissionScheme>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let s = scheme_of(&mut tx, i.tenant_id, project).await?;
    let raw: Value = sqlx::query_scalar(
        "SELECT action_levels FROM project_permission_schemes WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .unwrap_or_else(|| serde_json::json!({}));
    let actions = raw
        .as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_i64().map(|n| (k.clone(), n as i32)))
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(PermissionScheme {
        member_level: s.member_level,
        edit_min: s.edit_min,
        workflow_min: s.workflow_min,
        actions,
    }))
}

#[utoipa::path(put, path = "/api/projects/{id}/permission-scheme", tag = "access", params(("id" = Uuid, Path, description = "Project id")), request_body = PermissionScheme, responses((status = 200, description = "Saved", body = PermissionScheme), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_scheme(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<PermissionScheme>,
) -> ApiResult<Json<PermissionScheme>> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    if !matches!(v.member_level, 1 | 2) {
        return Err(bad("member_level is 1 (viewer) or 2 (member)"));
    }
    if !matches!(v.edit_min, 2 | 3) {
        return Err(bad("edit_min is 2 (member) or 3 (admin)"));
    }
    if !matches!(v.workflow_min, 2 | 3) {
        return Err(bad("workflow_min is 2 (member) or 3 (admin)"));
    }
    for (action, level) in &v.actions {
        if !crate::api::common::SCHEME_ACTIONS.contains(&action.as_str()) {
            return Err(bad("Unknown action in the permission scheme"));
        }
        if !matches!(level, 2 | 3) {
            return Err(bad("An action level is 2 (member) or 3 (admin)"));
        }
    }
    let action_json = serde_json::Value::Object(
        v.actions
            .iter()
            .map(|(k, lvl)| (k.clone(), serde_json::json!(lvl)))
            .collect(),
    );
    sqlx::query(
        "INSERT INTO project_permission_schemes(tenant_id,project_id,member_level,edit_min,workflow_min,action_levels,updated_at) \
         VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (tenant_id, project_id) DO UPDATE SET \
         member_level=EXCLUDED.member_level, edit_min=EXCLUDED.edit_min, workflow_min=EXCLUDED.workflow_min, \
         action_levels=EXCLUDED.action_levels, updated_at=now()",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(v.member_level as i16)
    .bind(v.edit_min as i16)
    .bind(v.workflow_min as i16)
    .bind(action_json)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "permission_scheme_updated", "project", project).await?;
    Ok(Json(v))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/permission-scheme",
            get(get_scheme).put(set_scheme),
        )
        .route(
            "/api/projects/{id}/access",
            get(list_access).put(grant_access),
        )
        .route(
            "/api/projects/{id}/access/{subject_type}/{subject_id}",
            delete(revoke_access),
        )
        .route("/api/projects/{id}", patch(set_visibility))
        .route("/api/pages/{id}/access", get(page_access_info))
        .route("/api/pages/{id}/restriction", put(set_restriction))
        .route("/api/pages/{id}/grants", put(grant_page))
        .route(
            "/api/pages/{id}/grants/{subject_type}/{subject_id}",
            delete(revoke_page_grant),
        )
}
