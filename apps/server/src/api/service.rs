//! Service management (Phase K2): queues with an assignment rule, request types that route into a
//! queue, requests submitted as issues, and SLA timers read from status history.
//!
//! Queues and request types are workflow configuration, so they follow the project's workflow level
//! in its permission scheme. Anyone who can edit issues can submit a request.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get, post};
use chrono::{DateTime, Utc};
use serde_json::json;

const FLOWS: [&str; 3] = ["request", "incident", "change"];
const SLA_ROWS: i64 = 500;

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ServiceQueue {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    /// Assignment rule: requests routed to this queue are assigned to this member.
    pub(crate) default_assignee_id: Option<Uuid>,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewServiceQueue {
    /// 1 to 80 characters; unique per project.
    pub(crate) name: String,
    /// A member of this workspace, or null to leave requests unassigned.
    pub(crate) default_assignee_id: Option<Uuid>,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct RequestType {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) description: String,
    /// `request`, `incident` or `change`.
    pub(crate) flow: String,
    pub(crate) queue_id: Uuid,
    /// Hours from submission to the first done status.
    pub(crate) target_hours: i32,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewRequestType {
    /// 1 to 80 characters; unique per project.
    pub(crate) name: String,
    /// Up to 2,000 characters.
    pub(crate) description: Option<String>,
    /// `request` (default), `incident` or `change`.
    pub(crate) flow: Option<String>,
    /// A queue of this project.
    pub(crate) queue_id: Uuid,
    /// 1 to 8,760 hours.
    pub(crate) target_hours: i32,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewRequest {
    pub(crate) request_type_id: Uuid,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
}

/// Row of the SLA report before the timer is worked out.
#[derive(FromRow)]
struct SlaRaw {
    id: Uuid,
    number: i64,
    title: String,
    status: String,
    request_type_id: Uuid,
    request_type: String,
    flow: String,
    queue_id: Uuid,
    target_hours: i32,
    started_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
}

/// One request's SLA timer. `state` is `met` or `missed` once resolved, and `on_track` or `breached`
/// while open. `elapsed_hours` stops at the first done status.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct SlaRow {
    pub(crate) id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) request_type_id: Uuid,
    pub(crate) request_type: String,
    pub(crate) flow: String,
    pub(crate) queue_id: Uuid,
    pub(crate) target_hours: i32,
    pub(crate) started_at: DateTime<Utc>,
    pub(crate) resolved_at: Option<DateTime<Utc>>,
    pub(crate) elapsed_hours: f64,
    pub(crate) state: String,
}

/// The SLA state of one request at `now`.
fn sla_state(target_hours: i32, elapsed_hours: f64, resolved: bool) -> &'static str {
    match (resolved, elapsed_hours > f64::from(target_hours)) {
        (true, false) => "met",
        (true, true) => "missed",
        (false, false) => "on_track",
        (false, true) => "breached",
    }
}

async fn queue_project(tx: &mut Tx, tenant: Uuid, queue: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar("SELECT project_id FROM service_queues WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(queue)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Queue not found"))
}

async fn request_type_project(tx: &mut Tx, tenant: Uuid, id: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar("SELECT project_id FROM request_types WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Request type not found"))
}

#[utoipa::path(get, path = "/api/projects/{id}/service/queues", tag = "service", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Queues in this project", body = Vec<ServiceQueue>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_queues(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<ServiceQueue>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let rows: Vec<ServiceQueue> = sqlx::query_as(
        "SELECT id,name,default_assignee_id,created_at FROM service_queues WHERE tenant_id=$1 AND project_id=$2 ORDER BY lower(name)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/service/queues", tag = "service", params(("id" = Uuid, Path, description = "Project id")), request_body = NewServiceQueue, responses((status = 201, description = "Created", body = ServiceQueue), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Below the workflow level of the project's scheme", body = ErrorBody), (status = 409, description = "A queue with this name already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_queue(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewServiceQueue>,
) -> ApiResult<(StatusCode, Json<ServiceQueue>)> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(bad("Queue name must be 1 to 80 characters"));
    }
    if let Some(assignee) = v.default_assignee_id {
        let member: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)",
        )
        .bind(i.tenant_id)
        .bind(assignee)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if !member {
            return Err(bad("The default assignee must be an active member of this workspace"));
        }
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM service_queues WHERE tenant_id=$1 AND project_id=$2 AND name=$3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(StatusCode::CONFLICT, "A queue with this name already exists"));
    }
    let row: ServiceQueue = sqlx::query_as(
        "INSERT INTO service_queues(tenant_id,project_id,name,default_assignee_id) VALUES($1,$2,$3,$4) \
         RETURNING id,name,default_assignee_id,created_at",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .bind(v.default_assignee_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "service_queue_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/service/queues/{id}", tag = "service", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 400, description = "The queue still has request types", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Below the workflow level of the project's scheme", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_queue(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = queue_project(&mut tx, i.tenant_id, id).await?;
    ensure_workflow(&mut tx, project).await?;
    let used: i64 = sqlx::query_scalar("SELECT count(*) FROM request_types WHERE tenant_id=$1 AND queue_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if used > 0 {
        return Err(bad("This queue still has request types. Delete or move them first"));
    }
    sqlx::query("DELETE FROM service_queues WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "service_queue_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/projects/{id}/service/request-types", tag = "service", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Request types in this project", body = Vec<RequestType>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_request_types(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<RequestType>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let rows: Vec<RequestType> = sqlx::query_as(
        "SELECT id,name,description,flow,queue_id,target_hours,created_at FROM request_types WHERE tenant_id=$1 AND project_id=$2 ORDER BY lower(name)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/service/request-types", tag = "service", params(("id" = Uuid, Path, description = "Project id")), request_body = NewRequestType, responses((status = 201, description = "Created", body = RequestType), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Below the workflow level of the project's scheme", body = ErrorBody), (status = 409, description = "A request type with this name already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_request_type(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewRequestType>,
) -> ApiResult<(StatusCode, Json<RequestType>)> {
    let i = tx.identity.clone();
    ensure_workflow(&mut tx, project).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(bad("Request type name must be 1 to 80 characters"));
    }
    let description = v.description.unwrap_or_default();
    if description.chars().count() > 2000 {
        return Err(bad("A description is limited to 2,000 characters"));
    }
    let flow = v.flow.unwrap_or_else(|| "request".to_string());
    if !FLOWS.contains(&flow.as_str()) {
        return Err(bad("flow must be request, incident or change"));
    }
    if !(1..=8760).contains(&v.target_hours) {
        return Err(bad("target_hours must be between 1 and 8760"));
    }
    if queue_project(&mut tx, i.tenant_id, v.queue_id).await? != project {
        return Err(bad("The queue must belong to this project"));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM request_types WHERE tenant_id=$1 AND project_id=$2 AND name=$3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(StatusCode::CONFLICT, "A request type with this name already exists"));
    }
    let row: RequestType = sqlx::query_as(
        "INSERT INTO request_types(tenant_id,project_id,name,description,flow,queue_id,target_hours) VALUES($1,$2,$3,$4,$5,$6,$7) \
         RETURNING id,name,description,flow,queue_id,target_hours,created_at",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .bind(&description)
    .bind(&flow)
    .bind(v.queue_id)
    .bind(v.target_hours)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "request_type_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/service/request-types/{id}", tag = "service", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 400, description = "The request type still has requests", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Below the workflow level of the project's scheme", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_request_type(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = request_type_project(&mut tx, i.tenant_id, id).await?;
    ensure_workflow(&mut tx, project).await?;
    let used: i64 = sqlx::query_scalar("SELECT count(*) FROM issues WHERE tenant_id=$1 AND request_type_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if used > 0 {
        return Err(bad("Requests of this type exist, so it cannot be deleted. Their history is kept"));
    }
    sqlx::query("DELETE FROM request_types WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "request_type_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/projects/{id}/service/requests", tag = "service", params(("id" = Uuid, Path, description = "Project id")), request_body = NewRequest, responses((status = 201, description = "Submitted as an issue, routed to the queue's assignee", body = crate::api::work::Issue), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Viewers cannot submit", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn submit_request(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewRequest>,
) -> ApiResult<(StatusCode, Json<crate::api::work::Issue>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    validate_title(&v.title)?;
    let description = v.description.unwrap_or_default();
    if description.chars().count() > 20_000 {
        return Err(bad("A request description is limited to 20,000 characters"));
    }
    let (rt_project, queue, type_name): (Uuid, Uuid, String) =
        sqlx::query_as("SELECT project_id, queue_id, name FROM request_types WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(v.request_type_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Request type not found"))?;
    if rt_project != project {
        return Err(bad("That request type belongs to another project"));
    }
    let assignee: Option<Uuid> =
        sqlx::query_scalar("SELECT default_assignee_id FROM service_queues WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(queue)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    let kind = crate::api::issue_types::default_type(&mut tx, i.tenant_id, project).await?;
    if crate::api::issue_types::type_level(&mut tx, i.tenant_id, project, &kind).await? != Some(0) {
        return Err(bad("The project's default type is an epic level type, so requests cannot use it"));
    }
    // Same lock and numbering as a subtask made by hand, so two submissions cannot take one number.
    sqlx::query("SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    let number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let status = crate::api::statuses::default_status(&mut tx, i.tenant_id, project).await?;
    let row: crate::api::work::Issue = sqlx::query_as(
        "INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,created_by,status,assignee_id,request_type_id) \
         VALUES($1,$2,$3,$4,$5,$6,'medium',$7,$8,$9,$10) \
         RETURNING id,project_id,number,title,description,kind,status,priority,created_at,updated_at",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(number)
    .bind(v.title.trim())
    .bind(&description)
    .bind(&kind)
    .bind(i.user_id)
    .bind(&status)
    .bind(assignee)
    .bind(v.request_type_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "created", "issue", row.id).await?;
    crate::api::history::record_status(&mut tx, i.tenant_id, row.id, None, &row.status, i.user_id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.created",
        row.id,
        json!({"project_id": project, "request_type_id": v.request_type_id, "request_type": type_name}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(get, path = "/api/projects/{id}/service/sla", tag = "service", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "SLA timers for the project's requests, newest first (at most 500)", body = Vec<SlaRow>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn sla_report(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<SlaRow>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let raw: Vec<SlaRaw> = sqlx::query_as(
        "SELECT i.id, i.number, i.title, i.status, rt.id AS request_type_id, rt.name AS request_type, rt.flow, \
         rt.queue_id, rt.target_hours, \
         COALESCE((SELECT min(h.changed_at) FROM issue_status_history h WHERE h.tenant_id=i.tenant_id AND h.issue_id=i.id), i.created_at) AS started_at, \
         (SELECT min(h.changed_at) FROM issue_status_history h \
            JOIN project_statuses ps ON ps.tenant_id=h.tenant_id AND ps.project_id=i.project_id AND ps.key=h.to_status AND ps.category='done' \
           WHERE h.tenant_id=i.tenant_id AND h.issue_id=i.id) AS resolved_at \
         FROM issues i JOIN request_types rt ON rt.tenant_id=i.tenant_id AND rt.id=i.request_type_id \
         WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.trashed_at IS NULL \
         ORDER BY started_at DESC LIMIT $3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(SLA_ROWS)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let now = Utc::now();
    let rows = raw
        .into_iter()
        .map(|r| {
            let end = r.resolved_at.unwrap_or(now);
            let elapsed_hours = (end - r.started_at).num_seconds() as f64 / 3600.0;
            let state = sla_state(r.target_hours, elapsed_hours, r.resolved_at.is_some());
            SlaRow {
                id: r.id,
                number: r.number,
                title: r.title,
                status: r.status,
                request_type_id: r.request_type_id,
                request_type: r.request_type,
                flow: r.flow,
                queue_id: r.queue_id,
                target_hours: r.target_hours,
                started_at: r.started_at,
                resolved_at: r.resolved_at,
                elapsed_hours,
                state: state.to_string(),
            }
        })
        .collect();
    Ok(Json(rows))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/service/queues",
            get(list_queues).post(create_queue),
        )
        .route("/api/service/queues/{id}", delete(delete_queue))
        .route(
            "/api/projects/{id}/service/request-types",
            get(list_request_types).post(create_request_type),
        )
        .route("/api/service/request-types/{id}", delete(delete_request_type))
        .route("/api/projects/{id}/service/requests", post(submit_request))
        .route("/api/projects/{id}/service/sla", get(sla_report))
}
