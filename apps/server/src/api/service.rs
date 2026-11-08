//! Service management (Phase K2): queues with an assignment rule, request types that route into a
//! queue, requests submitted as issues, and SLA timers read from status history.
//!
//! Queues and request types are workflow configuration, so they follow the project's workflow level
//! in its permission scheme. Anyone who can edit issues can submit a request.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get, post};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};

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
    /// Whether a request of this type waits for approval by `approver_id` (Phase K2).
    pub(crate) requires_approval: bool,
    pub(crate) approver_id: Option<Uuid>,
    /// The form: custom fields in the order they are shown, each with whether it is required.
    #[sqlx(skip)]
    pub(crate) fields: Vec<RequestFormField>,
}

/// One field on a request form.
#[derive(Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct RequestFormField {
    /// A custom field of this project.
    pub(crate) key: String,
    pub(crate) required: bool,
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
    /// Approval by `approver_id` before work starts. Needs an approver.
    pub(crate) requires_approval: Option<bool>,
    pub(crate) approver_id: Option<Uuid>,
    /// The form, in order. Omit for no form.
    pub(crate) fields: Option<Vec<RequestFormField>>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewRequest {
    pub(crate) request_type_id: Uuid,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    /// Values for the request type's form fields (a JSON object keyed by field key).
    pub(crate) values: Option<serde_json::Value>,
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
        "SELECT id,name,description,flow,queue_id,target_hours,created_at,requires_approval,approver_id FROM request_types WHERE tenant_id=$1 AND project_id=$2 ORDER BY lower(name)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut rows = rows;
    for row in rows.iter_mut() {
        row.fields = request_form(&mut tx, i.tenant_id, row.id).await?;
    }
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
    let requires_approval = v.requires_approval.unwrap_or(false);
    if requires_approval {
        let approver = v.approver_id.ok_or_else(|| bad("A request type that needs approval names an approver"))?;
        let member: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)",
        )
        .bind(i.tenant_id)
        .bind(approver)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if !member {
            return Err(bad("The approver must be an active member of this workspace"));
        }
    }
    let form = v.fields.clone().unwrap_or_default();
    if form.len() > 20 {
        return Err(bad("A request form has at most 20 fields"));
    }
    let mut seen = std::collections::HashSet::new();
    for f in &form {
        if !seen.insert(f.key.as_str()) {
            return Err(bad(&format!("“{}” is on the form twice", f.key)));
        }
        let defined: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(&f.key)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if !defined {
            return Err(bad(&format!("“{}” is not a custom field in this project", f.key)));
        }
    }
    let mut row: RequestType = sqlx::query_as(
        "INSERT INTO request_types(tenant_id,project_id,name,description,flow,queue_id,target_hours,requires_approval,approver_id) \
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) \
         RETURNING id,name,description,flow,queue_id,target_hours,created_at,requires_approval,approver_id",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .bind(&description)
    .bind(&flow)
    .bind(v.queue_id)
    .bind(v.target_hours)
    .bind(requires_approval)
    .bind(if requires_approval { v.approver_id } else { None })
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    for (position, f) in form.iter().enumerate() {
        sqlx::query(
            "INSERT INTO request_type_fields(tenant_id,project_id,request_type_id,field_key,position,required) VALUES($1,$2,$3,$4,$5,$6)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(row.id)
        .bind(&f.key)
        .bind(position as i32)
        .bind(f.required)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    row.fields = form.clone();
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
    let (rt_project, queue, type_name, needs_approval, approver): (Uuid, Uuid, String, bool, Option<Uuid>) =
        sqlx::query_as(
            "SELECT project_id, queue_id, name, requires_approval, approver_id FROM request_types WHERE tenant_id=$1 AND id=$2",
        )
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
    // The form: only the fields on this request type are stored; required ones must be filled, and
    // restricted fields are for project admins.
    let is_admin = project_level(&mut tx, &i, project).await?.unwrap_or(0) >= 3;
    let given = v.values.clone().unwrap_or_else(|| json!({}));
    let given = given.as_object().cloned().unwrap_or_default();
    let mut custom = serde_json::Map::new();
    for form_field in request_form(&mut tx, i.tenant_id, v.request_type_id).await? {
        let def = crate::api::fields::definition(&mut tx, i.tenant_id, project, &form_field.key).await?;
        match given.get(&form_field.key) {
            Some(value) if !value.is_null() => {
                if def.restricted && !is_admin {
                    return Err(forbidden());
                }
                custom.insert(form_field.key.clone(), crate::api::fields::check_value(&def, value)?);
            }
            _ if form_field.required => return Err(bad(&format!("{} is required", def.label))),
            _ => {}
        }
    }
    let row: crate::api::work::Issue = sqlx::query_as(
        "INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,created_by,status,assignee_id,request_type_id,custom_fields) \
         VALUES($1,$2,$3,$4,$5,$6,'medium',$7,$8,$9,$10,$11) \
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
    .bind(Value::Object(custom))
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if needs_approval {
        // The approver decides in the approvals inbox; the request is worked once it is approved.
        let approver = approver.ok_or_else(|| ApiError::Internal("A request type needs approval but has no approver".into()))?;
        sqlx::query(
            "INSERT INTO approvals(tenant_id,project_id,title,subject_type,subject_id,requester_id,reviewer_id) VALUES($1,$2,$3,'issue',$4,$5,$6)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(format!("Approve request: {}", row.title))
        .bind(row.id)
        .bind(i.user_id)
        .bind(approver)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
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
        .route("/api/portal/projects/{id}", get(get_portal_info))
        .route("/api/portal/projects/{id}/requests", post(submit_customer_request))
        .route("/api/portal/requests/{id}", get(get_customer_request))
        .route("/api/projects/{id}/incidents", get(list_incidents).post(create_incident))
        .route("/api/incidents/{id}", axum::routing::patch(update_incident))
}

/// The form of a request type, in order: each field key with whether it is required.
pub(crate) async fn request_form(tx: &mut Tx, tenant: Uuid, request_type: Uuid) -> ApiResult<Vec<RequestFormField>> {
    let rows: Vec<(String, bool)> = sqlx::query_as(
        "SELECT field_key, required FROM request_type_fields WHERE tenant_id=$1 AND request_type_id=$2 ORDER BY position",
    )
    .bind(tenant)
    .bind(request_type)
    .fetch_all(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(rows.into_iter().map(|(key, required)| RequestFormField { key, required }).collect())
}

/// Escalates requests that have passed their target without reaching a done status. Each request is
/// escalated once (`issues.escalated_at`), and its project's owners and admins are told. Runs from the
/// hourly maintenance loop on the system connection.
pub(crate) async fn escalate_breached(db: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "WITH due AS (UPDATE issues i SET escalated_at=now() FROM request_types rt \
           WHERE rt.tenant_id=i.tenant_id AND rt.id=i.request_type_id AND i.escalated_at IS NULL \
           AND i.trashed_at IS NULL AND i.archived_at IS NULL \
           AND COALESCE((SELECT min(h.changed_at) FROM issue_status_history h WHERE h.tenant_id=i.tenant_id AND h.issue_id=i.id), i.created_at) \
               + make_interval(hours => rt.target_hours) < now() \
           AND NOT EXISTS (SELECT 1 FROM issue_status_history h JOIN project_statuses ps \
               ON ps.tenant_id=h.tenant_id AND ps.project_id=i.project_id AND ps.key=h.to_status AND ps.category='done' \
               WHERE h.tenant_id=i.tenant_id AND h.issue_id=i.id) \
           AND i.id IN (SELECT id FROM issues WHERE escalated_at IS NULL LIMIT 200) \
           RETURNING i.id, i.tenant_id, i.project_id, i.number, i.title) \
         INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id) \
         SELECT d.tenant_id, m.user_id, m.user_id, 'sla', 'A request is past its target', \
           '#' || d.number || ' ' || d.title, 'issue', d.id \
         FROM due d JOIN memberships m ON m.tenant_id=d.tenant_id AND m.role IN ('owner','admin') AND m.disabled_at IS NULL",
    )
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct PortalInfo {
    pub(crate) project_id: Uuid,
    pub(crate) project_name: String,
    pub(crate) portal_name: String,
    pub(crate) welcome_message: String,
    pub(crate) request_types: Vec<RequestType>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CustomerRequestInput {
    pub(crate) request_type_id: Uuid,
    pub(crate) email: String,
    pub(crate) summary: String,
    pub(crate) description: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CustomerRequestStatus {
    pub(crate) id: Uuid,
    pub(crate) number: i64,
    pub(crate) summary: String,
    pub(crate) status: String,
    pub(crate) created_at: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/portal/projects/{id}", tag = "service", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Customer portal information", body = PortalInfo), (status = 404, description = "Project not found", body = ErrorBody)))]
pub(crate) async fn get_portal_info(
    State(app): State<App>,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<PortalInfo>> {
    let project_row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT tenant_id, name FROM projects WHERE id=$1 AND archived_at IS NULL")
            .bind(project)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?;

    let (tenant_id, project_name) = project_row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Project not found"))?;

    let settings: Option<(String, String)> = sqlx::query_as(
        "SELECT portal_name, welcome_message FROM portal_settings WHERE tenant_id=$1 AND project_id=$2 AND portal_enabled=true",
    )
    .bind(tenant_id)
    .bind(project)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;

    let (portal_name, welcome_message) = settings.unwrap_or_else(|| {
        (
            "Customer Support Portal".to_string(),
            "Welcome to our service desk. How can we help you today?".to_string(),
        )
    });

    let request_types: Vec<RequestType> = sqlx::query_as(
        "SELECT id, project_id, name, description, target_hours, queue_id, requires_approval, created_at \
         FROM request_types WHERE tenant_id=$1 AND project_id=$2 ORDER BY name",
    )
    .bind(tenant_id)
    .bind(project)
    .fetch_all(&app.db)
    .await
    .map_err(db_err)?;

    Ok(Json(PortalInfo {
        project_id: project,
        project_name,
        portal_name,
        welcome_message,
        request_types,
    }))
}

#[utoipa::path(post, path = "/api/portal/projects/{id}/requests", tag = "service", params(("id" = Uuid, Path, description = "Project id")), request_body = CustomerRequestInput, responses((status = 201, description = "Ticket submitted", body = CustomerRequestStatus), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 404, description = "Project not found", body = ErrorBody)))]
pub(crate) async fn submit_customer_request(
    State(app): State<App>,
    Path(project): Path<Uuid>,
    Json(input): Json<CustomerRequestInput>,
) -> ApiResult<(StatusCode, Json<CustomerRequestStatus>)> {
    let project_row: Option<Uuid> =
        sqlx::query_scalar("SELECT tenant_id FROM projects WHERE id=$1 AND archived_at IS NULL")
            .bind(project)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?;

    let tenant_id = project_row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Project not found"))?;

    let email = input.email.trim();
    if !email.contains('@') {
        return Err(bad("A valid email address is required"));
    }
    let summary = input.summary.trim();
    if summary.is_empty() || summary.len() > 200 {
        return Err(bad("Summary must be 1 to 200 characters"));
    }

    let owner_user_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner' LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;

    let creator_id = owner_user_id.unwrap_or_else(Uuid::nil);

    let next_num: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(number), 0) + 1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(tenant_id)
    .bind(project)
    .fetch_one(&app.db)
    .await
    .map_err(db_err)?;

    let desc = format!("Submitted by: {}\n\n{}", email, input.description.unwrap_or_default());

    let (id, number, status, created_at): (Uuid, i64, String, DateTime<Utc>) = sqlx::query_as(
        "INSERT INTO issues(tenant_id, project_id, number, title, description, kind, status, priority, creator_id, request_type_id) \
         VALUES($1, $2, $3, $4, $5, 'request', 'open', 'medium', $6, $7) \
         RETURNING id, number, status, created_at",
    )
    .bind(tenant_id)
    .bind(project)
    .bind(next_num)
    .bind(summary)
    .bind(desc)
    .bind(creator_id)
    .bind(input.request_type_id)
    .fetch_one(&app.db)
    .await
    .map_err(db_err)?;

    Ok((
        StatusCode::CREATED,
        Json(CustomerRequestStatus {
            id,
            number,
            summary: summary.to_string(),
            status,
            created_at,
        }),
    ))
}

#[utoipa::path(get, path = "/api/portal/requests/{id}", tag = "service", params(("id" = Uuid, Path, description = "Request id")), responses((status = 200, description = "Ticket status", body = CustomerRequestStatus), (status = 404, description = "Not found", body = ErrorBody)))]
pub(crate) async fn get_customer_request(
    State(app): State<App>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<CustomerRequestStatus>> {
    let row: Option<(Uuid, i64, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, number, title, status, created_at FROM issues WHERE id=$1 AND archived_at IS NULL AND trashed_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&app.db)
    .await
    .map_err(db_err)?;

    let (id, number, summary, status, created_at) =
        row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Request not found"))?;

    Ok(Json(CustomerRequestStatus {
        id,
        number,
        summary,
        status,
        created_at,
    }))
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ServiceIncident {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) issue_id: Uuid,
    pub(crate) issue_number: i64,
    pub(crate) title: String,
    pub(crate) severity: String,
    pub(crate) impact: String,
    pub(crate) root_cause: String,
    pub(crate) status: String,
    pub(crate) started_at: DateTime<Utc>,
    pub(crate) resolved_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewIncidentInput {
    pub(crate) issue_id: Uuid,
    pub(crate) severity: Option<String>,
    pub(crate) impact: Option<String>,
    pub(crate) root_cause: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct UpdateIncidentInput {
    pub(crate) severity: Option<String>,
    pub(crate) impact: Option<String>,
    pub(crate) root_cause: Option<String>,
    pub(crate) status: Option<String>,
}

#[utoipa::path(get, path = "/api/projects/{id}/incidents", tag = "service", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "List of project incidents", body = Vec<ServiceIncident>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Project not found", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_incidents(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<ServiceIncident>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<ServiceIncident> = sqlx::query_as(
        "SELECT inc.id, inc.project_id, inc.issue_id, i.number AS issue_number, i.title, \
         inc.severity, inc.impact, inc.root_cause, inc.status, inc.started_at, inc.resolved_at, inc.created_at \
         FROM service_incidents inc JOIN issues i ON i.id = inc.issue_id \
         WHERE inc.tenant_id=$1 AND inc.project_id=$2 ORDER BY inc.created_at DESC",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/incidents", tag = "service", params(("id" = Uuid, Path, description = "Project id")), request_body = NewIncidentInput, responses((status = 201, description = "Incident declared", body = ServiceIncident), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_incident(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewIncidentInput>,
) -> ApiResult<(StatusCode, Json<ServiceIncident>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;

    let issue_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id=$3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(v.issue_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    if !issue_exists {
        return Err(bad("Issue does not exist in this project"));
    }

    let severity = v.severity.unwrap_or_else(|| "sev-2".to_string());
    if !["sev-0", "sev-1", "sev-2", "sev-3"].contains(&severity.as_str()) {
        return Err(bad("severity must be sev-0, sev-1, sev-2 or sev-3"));
    }
    let impact = v.impact.unwrap_or_else(|| "minor".to_string());
    if !["minor", "major", "critical"].contains(&impact.as_str()) {
        return Err(bad("impact must be minor, major or critical"));
    }

    let inc_id: Uuid = sqlx::query_scalar(
        "INSERT INTO service_incidents(tenant_id, project_id, issue_id, severity, impact, root_cause, status) \
         VALUES($1, $2, $3, $4, $5, $6, 'investigating') RETURNING id",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(v.issue_id)
    .bind(severity)
    .bind(impact)
    .bind(v.root_cause.unwrap_or_default())
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    let row: ServiceIncident = sqlx::query_as(
        "SELECT inc.id, inc.project_id, inc.issue_id, i.number AS issue_number, i.title, \
         inc.severity, inc.impact, inc.root_cause, inc.status, inc.started_at, inc.resolved_at, inc.created_at \
         FROM service_incidents inc JOIN issues i ON i.id = inc.issue_id \
         WHERE inc.tenant_id=$1 AND inc.id=$2",
    )
    .bind(i.tenant_id)
    .bind(inc_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(patch, path = "/api/incidents/{id}", tag = "service", params(("id" = Uuid, Path, description = "Incident id")), request_body = UpdateIncidentInput, responses((status = 200, description = "Updated incident", body = ServiceIncident), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_incident(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<UpdateIncidentInput>,
) -> ApiResult<Json<ServiceIncident>> {
    let i = tx.identity.clone();
    let project: Uuid = sqlx::query_scalar("SELECT project_id FROM service_incidents WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Incident not found"))?;
    ensure_access(&mut tx, project).await?;

    let resolved_at = match v.status.as_deref() {
        Some("resolved") => Some(Utc::now()),
        _ => None,
    };

    let row: ServiceIncident = sqlx::query_as(
        "UPDATE service_incidents SET \
         severity = COALESCE($3, severity), \
         impact = COALESCE($4, impact), \
         root_cause = COALESCE($5, root_cause), \
         status = COALESCE($6, status), \
         resolved_at = CASE WHEN $6 = 'resolved' THEN $7 ELSE resolved_at END \
         WHERE tenant_id=$1 AND id=$2 \
         RETURNING id, project_id, issue_id, (SELECT i.number FROM issues i WHERE i.id = service_incidents.issue_id) AS issue_number, \
         (SELECT i.title FROM issues i WHERE i.id = service_incidents.issue_id) AS title, \
         severity, impact, root_cause, status, started_at, resolved_at, created_at",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(v.severity)
    .bind(v.impact)
    .bind(v.root_cause)
    .bind(v.status)
    .bind(resolved_at)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    Ok(Json(row))
}
