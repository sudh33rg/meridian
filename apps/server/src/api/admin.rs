//! Audit, webhooks, entitlements, export and import.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/entitlements", tag = "admin", responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn entitlements(tx: Tx) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    // No payment gateway is connected; this is a baseline configuration, not enforced billing.
    Ok(Json(
        json!({"tenant_id":i.tenant_id,"plan":"development","billing_connected":false,"features":["projects","issues","knowledge","sprints","goals","search","basic_automation"]}),
    ))
}
#[utoipa::path(get, path = "/api/audit", tag = "admin", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn audit_log(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor',u.display_name,'occurred_at',a.occurred_at) FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=$1 ORDER BY a.occurred_at DESC LIMIT 500")
        .bind(i.tenant_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(get, path = "/api/projects/{id}/export", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn export_project(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let project: Value = sqlx::query_scalar(
        "SELECT to_jsonb(t) - 'tenant_id' FROM projects t WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let issues:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) - 'tenant_id' FROM issues t WHERE tenant_id=$1 AND project_id=$2 ORDER BY number LIMIT 10000")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    let pages:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) - 'tenant_id' FROM pages t WHERE tenant_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 10000")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    let sprints: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(t) - 'tenant_id' FROM sprints t WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(
        json!({"format":"meridian-project-v1","exported_at":Utc::now(),"project":project,"issues":issues,"pages":pages,"sprints":sprints,"warning":"Bounded export: each collection has a 10000 row cap; paginated export is needed for larger projects."}),
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ImportItem {
    pub(crate) external_ref: String,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) priority: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ImportInput {
    pub(crate) items: Vec<ImportItem>,
}
#[utoipa::path(post, path = "/api/projects/{id}/import/issues", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), request_body = ImportInput, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_issues(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<ImportInput>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    if v.items.is_empty() || v.items.len() > 100 {
        return Err(bad("Import accepts 1..100 issues per batch"));
    }
    for item in &v.items {
        validate_title(&item.title)?;
        if item.external_ref.len() > 200 || item.external_ref.is_empty() {
            return Err(bad(
                "Each imported issue needs an external_ref <=200 characters",
            ));
        }
        if !["low", "medium", "high", "urgent"]
            .contains(&item.priority.as_deref().unwrap_or("medium"))
        {
            return Err(bad("Invalid priority"));
        }
    }
    let present: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    if present.is_none() {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    let mut next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    // Imported issues start in the project's first To do status and must satisfy its required fields.
    let start = crate::api::statuses::default_status(&mut tx, i.tenant_id, p).await?;
    crate::api::fields::validate_values(&mut tx, i.tenant_id, p, &serde_json::json!({})).await?;
    let mut created = 0;
    let mut skipped = 0;
    for item in v.items {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM imported_issue_refs WHERE tenant_id=$1 AND project_id=$2 AND external_ref=$3)")
            .bind(i.tenant_id).bind(p).bind(&item.external_ref).fetch_one(&mut *tx).await.map_err(db_err)?;
        if exists {
            skipped += 1;
            continue;
        }
        let kind = match item.kind {
            Some(k) => k,
            None => crate::api::issue_types::default_type(&mut tx, i.tenant_id, p).await?,
        };
        crate::api::issue_types::check_type(&mut tx, i.tenant_id, p, &kind).await?;
        let id:Uuid=sqlx::query_scalar("INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,created_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id")
            .bind(i.tenant_id).bind(p).bind(next).bind(item.title).bind(item.description.unwrap_or_default())
            .bind(kind).bind(item.priority.unwrap_or_else(||"medium".into())).bind(i.user_id).bind(&start)
            .fetch_one(&mut *tx).await.map_err(db_err)?;
        crate::api::history::record_status(&mut tx, i.tenant_id, id, None, &start, i.user_id)
            .await?;
        sqlx::query("INSERT INTO imported_issue_refs(tenant_id,project_id,external_ref,issue_id) VALUES($1,$2,$3,$4)")
            .bind(i.tenant_id).bind(p).bind(item.external_ref).bind(id).execute(&mut *tx).await.map_err(db_err)?;
        created += 1;
        next += 1;
    }
    log_event(&mut tx, &i, "imported", "project", p).await?;
    Ok(Json(
        json!({"created":created,"skipped":skipped,"idempotent_by":"external_ref"}),
    ))
}

/// Filters for the audit log. Each one is optional and they combine with AND.
#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct AuditQuery {
    /// Exact action name, for example `issue_created`. Up to 80 characters.
    pub(crate) action: Option<String>,
    /// Exact entity type, for example `issue`. Up to 80 characters.
    pub(crate) entity_type: Option<String>,
    /// Only events by this member.
    pub(crate) actor_id: Option<Uuid>,
    /// Events on or after this UTC date (YYYY-MM-DD).
    pub(crate) from: Option<String>,
    /// Events on or before this UTC date (YYYY-MM-DD).
    pub(crate) to: Option<String>,
    /// Page size, 1 to 200 (default 50). Ignored by the CSV export.
    pub(crate) limit: Option<i64>,
    /// Value of `X-Next-Cursor` from the previous page.
    pub(crate) cursor: Option<String>,
    /// Free-text search across action, entity type, and actor name.
    pub(crate) q: Option<String>,
}

/// One audit event. Events are listed newest first, in the order they were recorded.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct AuditEvent {
    pub(crate) id: i64,
    pub(crate) action: String,
    pub(crate) entity_type: String,
    pub(crate) entity_id: Uuid,
    pub(crate) actor_id: Uuid,
    pub(crate) actor: String,
    pub(crate) occurred_at: DateTime<Utc>,
}

/// Largest number of events the CSV export returns.
const AUDIT_EXPORT_LIMIT: i64 = 10_000;

fn audit_day(raw: Option<&str>, end_of: bool) -> ApiResult<Option<DateTime<Utc>>> {
    let Some(text) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let day = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .map_err(|_| bad("Dates must use the form YYYY-MM-DD"))?;
    let day = if end_of {
        day.succ_opt().ok_or_else(|| bad("Date is out of range"))?
    } else {
        day
    };
    Ok(Some(day.and_hms_opt(0, 0, 0).expect("midnight exists").and_utc()))
}

/// Runs the filtered audit query for the caller's workspace. `to` is exclusive here: the caller
/// passes the day after the last day it wants.
async fn audit_rows(
    tx: &mut Tx,
    tenant: Uuid,
    q: &AuditQuery,
    limit: i64,
    cursor: Option<i64>,
) -> ApiResult<Vec<AuditEvent>> {
    let action = q.action.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let entity = q.entity_type.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if action.is_some_and(|s| s.chars().count() > 80) || entity.is_some_and(|s| s.chars().count() > 80) {
        return Err(bad("Action and entity type are limited to 80 characters"));
    }
    let from = audit_day(q.from.as_deref(), false)?;
    let to = audit_day(q.to.as_deref(), true)?;
    if let (Some(f), Some(t)) = (from, to) {
        if f >= t {
            return Err(bad("'from' must be on or before 'to'"));
        }
    }
    let search = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("%{s}%"));
    let rows: Vec<AuditEvent> = sqlx::query_as(
        "SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_id, u.display_name AS actor, a.occurred_at \
         FROM audit_events a JOIN users u ON u.id=a.actor_id \
         WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.action=$2) AND ($3::text IS NULL OR a.entity_type=$3) \
         AND ($4::uuid IS NULL OR a.actor_id=$4) AND ($5::timestamptz IS NULL OR a.occurred_at>=$5) \
         AND ($6::timestamptz IS NULL OR a.occurred_at<$6) AND ($7::bigint IS NULL OR a.id<$7) \
         AND ($8::text IS NULL OR a.action ILIKE $8 OR a.entity_type ILIKE $8 OR u.display_name ILIKE $8) \
         ORDER BY a.id DESC LIMIT $9",
    )
    .bind(tenant)
    .bind(action)
    .bind(entity)
    .bind(q.actor_id)
    .bind(from)
    .bind(to)
    .bind(cursor)
    .bind(search)
    .bind(limit)
    .fetch_all(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(rows)
}

#[utoipa::path(get, path = "/api/audit/events", tag = "admin", params(AuditQuery), responses((status = 200, description = "Audit events, newest first. X-Next-Cursor is present when another page exists", body = Vec<AuditEvent>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn audit_events(
    mut tx: Tx,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
) -> ApiResult<(axum::http::HeaderMap, Json<Vec<AuditEvent>>)> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let limit = q.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) {
        return Err(bad("limit must be between 1 and 200"));
    }
    let cursor: Option<i64> = match q.cursor.as_deref().filter(|c| !c.is_empty()) {
        None => None,
        Some(c) => Some(c.parse::<i64>().ok().filter(|n| *n > 0).ok_or_else(|| bad("Invalid cursor"))?),
    };
    let mut rows = audit_rows(&mut tx, i.tenant_id, &q, limit + 1, cursor).await?;
    let mut headers = axum::http::HeaderMap::new();
    if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        if let Some(last) = rows.last() {
            if let Ok(v) = axum::http::HeaderValue::from_str(&last.id.to_string()) {
                headers.insert("x-next-cursor", v);
            }
        }
    }
    Ok((headers, Json(rows)))
}

#[utoipa::path(get, path = "/api/audit/export.csv", tag = "admin", params(AuditQuery), responses((status = 200, description = "Matching audit events as CSV (at most 10000 rows). Cells that start with a formula character are quoted", content_type = "text/csv", body = String), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn audit_export(
    mut tx: Tx,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
) -> ApiResult<axum::response::Response> {
    use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
    use axum::response::IntoResponse;
    let i = tx.identity.clone();
    require_admin(&i)?;
    let rows = audit_rows(&mut tx, i.tenant_id, &q, AUDIT_EXPORT_LIMIT, None).await?;
    let mut out = String::from("occurred_at,actor,action,entity_type,entity_id\n");
    for r in rows {
        let cells = [
            r.occurred_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            r.actor,
            r.action,
            r.entity_type,
            r.entity_id.to_string(),
        ];
        out.push_str(&cells.iter().map(|c| crate::api::reports::csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    Ok((
        [
            (CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (CONTENT_DISPOSITION, "attachment; filename=\"audit-events.csv\"".to_string()),
        ],
        out,
    )
        .into_response())
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct OtelSpan {
    pub(crate) trace_id: String,
    pub(crate) span_id: String,
    pub(crate) parent_span_id: Option<String>,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) status_code: String,
    pub(crate) duration_ms: i32,
    pub(crate) attributes: Value,
    pub(crate) occurred_at: DateTime<Utc>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct OtelExport {
    pub(crate) resource_spans: Vec<OtelSpan>,
    pub(crate) total: i64,
}

#[utoipa::path(get, path = "/api/admin/traces/export", tag = "admin", responses((status = 200, description = "OpenTelemetry trace spans export", body = OtelExport), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn export_traces(mut tx: Tx) -> ApiResult<Json<OtelExport>> {
    require_admin(&tx.identity)?;
    let spans: Vec<OtelSpan> = sqlx::query_as(
        "SELECT trace_id, span_id, parent_span_id, name, kind, status_code, duration_ms, attributes, occurred_at \
         FROM trace_spans WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 1000",
    )
    .bind(tx.identity.tenant_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;

    let total = spans.len() as i64;
    Ok(Json(OtelExport {
        resource_spans: spans,
        total,
    }))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/audit/events", get(audit_events))
        .route("/api/audit/export.csv", get(audit_export))
        .route("/api/projects/{id}/export", get(export_project))
        .route("/api/projects/{id}/import/issues", post(import_issues))
        .route("/api/entitlements", get(entitlements))
        .route("/api/audit", get(audit_log))
        .route("/api/admin/traces/export", get(export_traces))
}
