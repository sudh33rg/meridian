//! Issue details, edits, comments and links.
use crate::api::collab::run_automations;
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/issues/{id}/details", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_details(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, id).await?;
    let row: Value =
        sqlx::query_scalar("SELECT to_jsonb(t) FROM issues t WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    Ok(Json(row))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueEdit {
    pub(crate) title: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) assignee_id: Option<Uuid>,
    pub(crate) sprint_id: Option<Uuid>,
    pub(crate) parent_id: Option<Uuid>,
    pub(crate) story_points: Option<i32>,
    pub(crate) due_at: Option<DateTime<Utc>>,
    pub(crate) labels: Option<Vec<String>>,
    pub(crate) custom_fields: Option<Value>,
}
#[utoipa::path(patch, path = "/api/issues/{id}/edit", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = IssueEdit, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn edit_issue(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<IssueEdit>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    if let Some(ref s) = v.title {
        validate_title(s)?;
    }
    if let Some(ref s) = v.kind {
        if !["task", "bug", "story", "epic"].contains(&s.as_str()) {
            return Err(bad("Invalid issue type"));
        }
    }
    if let Some(ref s) = v.status {
        if !["todo", "in_progress", "in_review", "done"].contains(&s.as_str()) {
            return Err(bad("Invalid status"));
        }
    }
    if let Some(ref s) = v.priority {
        if !["low", "medium", "high", "urgent"].contains(&s.as_str()) {
            return Err(bad("Invalid priority"));
        }
    }
    if v.story_points.is_some_and(|n| !(0..=1000).contains(&n)) {
        return Err(bad("Story points outside allowed range"));
    }
    if v.labels
        .as_ref()
        .is_some_and(|xs| xs.len() > 30 || xs.iter().any(|s| s.len() > 40 || s.is_empty()))
    {
        return Err(bad("Invalid labels"));
    }
    if v.custom_fields
        .as_ref()
        .is_some_and(|c| !c.is_object() || c.to_string().len() > 32000)
    {
        return Err(bad("Custom fields must be a small JSON object"));
    }
    if v.parent_id == Some(id) {
        return Err(bad("An issue cannot be its own parent"));
    }
    if let Some(s) = v.sprint_id {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND state<>'completed')")
            .bind(i.tenant_id).bind(project).bind(s).fetch_one(&mut *tx).await.map_err(db_err)?;
        if !ok {
            return Err(bad("Sprint must be in the same project and not completed"));
        }
    }
    if let Some(parent) = v.parent_id {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL)")
            .bind(i.tenant_id).bind(project).bind(parent).fetch_one(&mut *tx).await.map_err(db_err)?;
        if !ok {
            return Err(bad("Parent must be in the same project"));
        }
    }
    // Nullable attributes are intentionally unchanged when omitted. Explicit clearing is a separate operation.
    let row:Value=sqlx::query_scalar("UPDATE issues SET title=COALESCE($1,title),description=COALESCE($2,description),kind=COALESCE($3,kind),priority=COALESCE($4,priority),status=COALESCE($5,status),assignee_id=COALESCE($6,assignee_id),sprint_id=COALESCE($7,sprint_id),parent_id=COALESCE($8,parent_id),story_points=COALESCE($9,story_points),due_at=COALESCE($10,due_at),labels=COALESCE($11,labels),custom_fields=COALESCE($12,custom_fields),updated_at=now() WHERE tenant_id=$13 AND id=$14 AND archived_at IS NULL RETURNING to_jsonb(issues)")
        .bind(v.title).bind(v.description).bind(v.kind).bind(v.priority).bind(v.status.clone()).bind(v.assignee_id)
        .bind(v.sprint_id).bind(v.parent_id).bind(v.story_points).bind(v.due_at).bind(v.labels).bind(v.custom_fields)
        .bind(i.tenant_id).bind(id).fetch_one(&mut *tx).await.map_err(db_err)?;
    log_event(&mut *tx, &i, "updated", "issue", id).await?;
    log_outbox(
        &mut *tx,
        i.tenant_id,
        "issue.updated",
        id,
        json!({"issue_id":id,"project_id":project}),
    )
    .await?;
    if v.status.is_some() {
        run_automations(&mut *tx, &i, project, id, "issue_status_changed").await?;
    }
    Ok(Json(row))
}
#[utoipa::path(post, path = "/api/issues/{id}/archive", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn archive_issue(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let r = sqlx::query(
        "UPDATE issues SET archived_at=now() WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Issue not found"));
    }
    log_event(&mut *tx, &i, "archived", "issue", id).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CommentInput {
    pub(crate) body: String,
    pub(crate) parent_id: Option<Uuid>,
}
#[utoipa::path(get, path = "/api/issues/{id}/comments", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_comments(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, id).await?;
    Ok(Json(sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'body',c.body,'author_id',c.author_id,'author',u.display_name,'parent_id',c.parent_id,'created_at',c.created_at) FROM issue_comments c JOIN users u ON u.id=c.author_id WHERE c.tenant_id=$1 AND c.issue_id=$2 ORDER BY c.created_at ASC LIMIT 1000")
        .bind(i.tenant_id).bind(id).fetch_all(&mut *tx).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/issues/{id}/comments", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = CommentInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_issue_comment(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<CommentInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    validate_body(&v.body)?;
    if let Some(parent) = v.parent_id {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM issue_comments WHERE tenant_id=$1 AND issue_id=$2 AND id=$3)")
            .bind(i.tenant_id).bind(id).bind(parent).fetch_one(&mut *tx).await.map_err(db_err)?;
        if !ok {
            return Err(bad("Reply must belong to the same issue"));
        }
    }
    let row:Value=sqlx::query_scalar("INSERT INTO issue_comments(tenant_id,issue_id,parent_id,author_id,body) VALUES($1,$2,$3,$4,$5) RETURNING to_jsonb(issue_comments)")
        .bind(i.tenant_id).bind(id).bind(v.parent_id).bind(i.user_id).bind(v.body).fetch_one(&mut *tx).await.map_err(db_err)?;
    log_event(&mut *tx, &i, "commented", "issue", id).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct LinkInput {
    pub(crate) target_id: Uuid,
    pub(crate) relation: String,
}
#[utoipa::path(get, path = "/api/issues/{id}/links", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_links(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, id).await?;
    Ok(Json(sqlx::query_scalar("SELECT jsonb_build_object('source_id',source_id,'target_id',target_id,'relation',relation) FROM issue_links WHERE tenant_id=$1 AND (source_id=$2 OR target_id=$2) LIMIT 250")
        .bind(i.tenant_id).bind(id).fetch_all(&mut *tx).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/issues/{id}/links", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = LinkInput, responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_issue_link(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<LinkInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    valid_issue(&mut tx, &i, v.target_id).await?;
    if id == v.target_id
        || !["blocks", "relates", "duplicates", "depends_on"].contains(&v.relation.as_str())
    {
        return Err(bad("Invalid issue link"));
    }
    sqlx::query("INSERT INTO issue_links(tenant_id,source_id,target_id,relation,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
        .bind(i.tenant_id).bind(id).bind(v.target_id).bind(v.relation).bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/issues/{id}/details", get(issue_details))
        .route("/api/issues/{id}/edit", patch(edit_issue))
        .route("/api/issues/{id}/archive", post(archive_issue))
        .route(
            "/api/issues/{id}/comments",
            get(issue_comments).post(new_issue_comment),
        )
        .route(
            "/api/issues/{id}/links",
            get(issue_links).post(new_issue_link),
        )
}
