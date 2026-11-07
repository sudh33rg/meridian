//! Activity, analytics, automations, inbox and approvals.
use crate::api::common::*;
use crate::api::knowledge::relation_entity_exists;
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/projects/{id}/activity", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn activity(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor',u.display_name,'occurred_at',a.occurred_at) FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=$1 AND (EXISTS(SELECT 1 FROM issues t WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=a.entity_id) OR EXISTS(SELECT 1 FROM pages t WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=a.entity_id)) ORDER BY a.occurred_at DESC LIMIT 200")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(get, path = "/api/projects/{id}/analytics", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn analytics(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    valid_project(&app.db, &i, p).await?;
    let counts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('status',status,'count',count(*)) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL GROUP BY status")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?;
    let kinds:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('kind',kind,'count',count(*)) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL GROUP BY kind")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?;
    let overdue:i64=sqlx::query_scalar("SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND due_at<now() AND status<>'done' AND archived_at IS NULL")
        .bind(i.tenant_id).bind(p).fetch_one(&app.db).await.map_err(db_err)?;
    Ok(Json(
        json!({"statuses":counts,"types":kinds,"overdue":overdue}),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct AutomationInput {
    pub(crate) name: String,
    pub(crate) trigger_event: String,
    pub(crate) action_type: String,
}
#[utoipa::path(get, path = "/api/projects/{id}/automations", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn automations(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(a) FROM automation_rules a WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/automations", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = AutomationInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_automation(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<AutomationInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_admin(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.name)?;
    if !["issue_created", "issue_status_changed"].contains(&v.trigger_event.as_str())
        || !["notify_project_admins", "set_priority_high"].contains(&v.action_type.as_str())
    {
        return Err(bad("Unsupported automation trigger or action"));
    }
    let rule=sqlx::query_scalar("INSERT INTO automation_rules(tenant_id,project_id,name,trigger_event,action_type,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(automation_rules)")
        .bind(i.tenant_id).bind(p).bind(v.name).bind(v.trigger_event).bind(v.action_type).bind(i.user_id).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(rule)))
}
pub(crate) async fn run_automations(
    db: &PgPool,
    i: &Identity,
    project: Uuid,
    entity: Uuid,
    event: &str,
) -> ApiResult<()> {
    let rules:Vec<(Uuid,String)>=sqlx::query_as("SELECT id,action_type FROM automation_rules WHERE tenant_id=$1 AND project_id=$2 AND enabled=true AND trigger_event=$3 LIMIT 30")
        .bind(i.tenant_id).bind(project).bind(event).fetch_all(db).await.map_err(db_err)?;
    for (rule, action) in rules {
        // Only allowlisted, non-recursive actions; activity is not replayed as a new trigger.
        match action.as_str() {
            "set_priority_high" => {
                sqlx::query("UPDATE issues SET priority='high',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND priority IN ('low','medium')")
                    .bind(i.tenant_id).bind(entity).execute(db).await.map_err(db_err)?;
            }
            "notify_project_admins" => {
                sqlx::query("INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,entity_type,entity_id) SELECT $1,m.user_id,$2,'automation','Automation ran for an issue','issue',$3 FROM memberships m WHERE m.tenant_id=$1 AND m.role IN ('owner','admin') AND m.user_id<>$2")
                    .bind(i.tenant_id).bind(i.user_id).bind(entity).execute(db).await.map_err(db_err)?;
            }
            _ => {}
        }
        sqlx::query(
            "INSERT INTO automation_runs(tenant_id,rule_id,entity_id,result) VALUES($1,$2,$3,'ok')",
        )
        .bind(i.tenant_id)
        .bind(rule)
        .bind(entity)
        .execute(db)
        .await
        .map_err(db_err)?;
    }
    Ok(())
}
#[utoipa::path(get, path = "/api/notifications", tag = "collab", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn inbox(State(app): State<App>, i: Identity) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(n) FROM notifications n WHERE tenant_id=$1 AND recipient_id=$2 ORDER BY created_at DESC LIMIT 100")
        .bind(i.tenant_id).bind(i.user_id).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/notifications/{id}/read", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn mark_read(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let r=sqlx::query("UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3 AND read_at IS NULL")
        .bind(i.tenant_id).bind(i.user_id).bind(id).execute(&app.db).await.map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Unread notification not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ApprovalInput {
    pub(crate) title: String,
    pub(crate) subject_type: String,
    pub(crate) subject_id: Uuid,
    pub(crate) reviewer_id: Uuid,
    pub(crate) note: Option<String>,
}
#[utoipa::path(get, path = "/api/projects/{id}/approvals", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn approvals(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(a) FROM approvals a WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 250")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/approvals", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = ApprovalInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_approval(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<ApprovalInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_editor(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.title)?;
    if !["issue", "page", "decision"].contains(&v.subject_type.as_str())
        || !relation_entity_exists(&app.db, i.tenant_id, &v.subject_type, v.subject_id).await?
    {
        return Err(bad("Referenced work item not found"));
    }
    let reviewer: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2)",
    )
    .bind(i.tenant_id)
    .bind(v.reviewer_id)
    .fetch_one(&app.db)
    .await
    .map_err(db_err)?;
    if !reviewer {
        return Err(bad("Reviewer must be a workspace member"));
    }
    let row:Value=sqlx::query_scalar("INSERT INTO approvals(tenant_id,project_id,title,subject_type,subject_id,requester_id,reviewer_id,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(approvals)")
        .bind(i.tenant_id).bind(p).bind(v.title).bind(v.subject_type).bind(v.subject_id).bind(i.user_id).bind(v.reviewer_id).bind(v.note.unwrap_or_default())
        .fetch_one(&app.db).await.map_err(db_err)?;
    let id = Uuid::parse_str(row["id"].as_str().unwrap_or(""))
        .map_err(|_| bad("Invalid approval ID"))?;
    sqlx::query("INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,entity_type,entity_id) VALUES($1,$2,$3,'approval','Approval requested','approval',$4)")
        .bind(i.tenant_id).bind(v.reviewer_id).bind(i.user_id).bind(id).execute(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[utoipa::path(get, path = "/api/approvals/mine", tag = "collab", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn my_approvals(
    State(app): State<App>,
    i: Identity,
) -> ApiResult<Json<Vec<Value>>> {
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(a) FROM approvals a WHERE tenant_id=$1 AND reviewer_id=$2 ORDER BY created_at DESC LIMIT 250")
        .bind(i.tenant_id).bind(i.user_id).fetch_all(&app.db).await.map_err(db_err)?))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ApprovalDecision {
    pub(crate) status: String,
    pub(crate) note: Option<String>,
}
#[utoipa::path(patch, path = "/api/approvals/{id}", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = ApprovalDecision, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn decide_approval(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
    Json(v): Json<ApprovalDecision>,
) -> ApiResult<Json<Value>> {
    if !["approved", "rejected"].contains(&v.status.as_str()) {
        return Err(bad("Invalid approval outcome"));
    }
    let row:Option<Value>=sqlx::query_scalar("UPDATE approvals SET status=$1,note=COALESCE($2,note),decided_at=now() WHERE tenant_id=$3 AND id=$4 AND reviewer_id=$5 AND status='pending' RETURNING to_jsonb(approvals)")
        .bind(v.status).bind(v.note).bind(i.tenant_id).bind(id).bind(i.user_id).fetch_optional(&app.db).await.map_err(db_err)?;
    Ok(Json(row.ok_or_else(|| {
        err(StatusCode::CONFLICT, "Not pending or not assigned to you")
    })?))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/activity", get(activity))
        .route("/api/projects/{id}/analytics", get(analytics))
        .route(
            "/api/projects/{id}/automations",
            get(automations).post(new_automation),
        )
        .route("/api/notifications", get(inbox))
        .route("/api/notifications/{id}/read", post(mark_read))
        .route(
            "/api/projects/{id}/approvals",
            get(approvals).post(new_approval),
        )
        .route("/api/approvals/mine", get(my_approvals))
        .route("/api/approvals/{id}", patch(decide_approval))
}
