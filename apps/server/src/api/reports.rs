//! Reports, dashboards and export. Every number comes from stored facts: the status
//! history, worklogs, sprint closing records and issues. Date ranges are explicit and bounded.
use crate::api::agile::done_predicate;
use crate::api::common::*;
use crate::*;
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use chrono::{Datelike, Days, NaiveDate};
use serde_json::{json, Value};

const MAX_RANGE_DAYS: i64 = 366;

/// Parses and checks a `from` and `to` pair. Both days are inclusive.
fn date_range(from: Option<&str>, to: Option<&str>) -> ApiResult<(NaiveDate, NaiveDate)> {
    let today = Utc::now().date_naive();
    let to_day = match to.filter(|s| !s.is_empty()) {
        Some(s) => {
            NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| bad("to must be YYYY-MM-DD"))?
        }
        None => today,
    };
    let from_day = match from.filter(|s| !s.is_empty()) {
        Some(s) => {
            NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| bad("from must be YYYY-MM-DD"))?
        }
        None => to_day.checked_sub_days(Days::new(29)).unwrap_or(to_day),
    };
    if from_day > to_day {
        return Err(bad("from must be on or before to"));
    }
    if (to_day - from_day).num_days() >= MAX_RANGE_DAYS {
        return Err(bad("A report covers at most 366 days"));
    }
    Ok((from_day, to_day))
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct RangeQuery {
    /// First day, `YYYY-MM-DD`. Defaults to 29 days before `to`.
    pub(crate) from: Option<String>,
    /// Last day, `YYYY-MM-DD`. Defaults to today (UTC).
    pub(crate) to: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// G2. Flow, cycle time, created versus resolved
// ---------------------------------------------------------------------------------------------

/// Issues per status at the end of each day in the range (cumulative flow).
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct FlowRow {
    pub(crate) day: String,
    pub(crate) status: String,
    pub(crate) count: i64,
}

async fn flow_rows(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> ApiResult<Vec<FlowRow>> {
    sqlx::query_as(
        "WITH days AS (SELECT generate_series($3::date, $4::date, '1 day')::date AS day), \
         state AS (\
           SELECT d.day, i.id, (SELECT h.to_status FROM issue_status_history h \
             WHERE h.tenant_id=i.tenant_id AND h.issue_id=i.id AND h.changed_at < (d.day + 1)::timestamptz \
             ORDER BY h.changed_at DESC, h.id DESC LIMIT 1) AS status \
           FROM days d JOIN issues i ON i.tenant_id=$1 AND i.project_id=$2 \
             AND i.created_at < (d.day + 1)::timestamptz \
             AND (i.archived_at IS NULL OR i.archived_at >= (d.day + 1)::timestamptz)) \
         SELECT to_char(day,'YYYY-MM-DD') AS day, status, count(*) AS count FROM state \
         WHERE status IS NOT NULL GROUP BY day, status ORDER BY day, status",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)
}

#[utoipa::path(get, path = "/api/projects/{id}/reports/flow", tag = "reports", params(("id" = Uuid, Path, description = "Resource id"), RangeQuery), responses((status = 200, description = "Issues per status per day", body = Vec<FlowRow>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn flow_report(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<RangeQuery>,
) -> ApiResult<Json<Vec<FlowRow>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let (from, to) = date_range(q.from.as_deref(), q.to.as_deref())?;
    Ok(Json(flow_rows(&mut tx, i.tenant_id, p, from, to).await?))
}

/// One completed issue with its lead and cycle time in days.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct CompletedIssue {
    pub(crate) issue_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) started_at: Option<DateTime<Utc>>,
    pub(crate) done_at: DateTime<Utc>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CycleItem {
    pub(crate) issue_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) done_on: String,
    /// Created to done, in days.
    pub(crate) lead_days: f64,
    /// First move into an in-progress status to done, in days. Absent when the issue never started.
    pub(crate) cycle_days: Option<f64>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct Throughput {
    /// Monday of the ISO week, `YYYY-MM-DD`.
    pub(crate) week: String,
    pub(crate) completed: i64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CycleReport {
    pub(crate) completed: i64,
    pub(crate) median_lead_days: Option<f64>,
    pub(crate) average_lead_days: Option<f64>,
    pub(crate) median_cycle_days: Option<f64>,
    pub(crate) average_cycle_days: Option<f64>,
    /// Completed issues by the day they were completed (control chart points).
    pub(crate) items: Vec<CycleItem>,
    pub(crate) throughput: Vec<Throughput>,
}

fn median(mut xs: Vec<f64>) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = xs.len() / 2;
    Some(if xs.len().is_multiple_of(2) {
        (xs[mid - 1] + xs[mid]) / 2.0
    } else {
        xs[mid]
    })
}

fn mean(xs: &[f64]) -> Option<f64> {
    if xs.is_empty() {
        None
    } else {
        Some(xs.iter().sum::<f64>() / xs.len() as f64)
    }
}

/// Issues first completed inside the range, with their first start and completion times.
async fn completed_issues(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> ApiResult<Vec<CompletedIssue>> {
    sqlx::query_as(
        "WITH done AS (\
           SELECT h.issue_id, min(h.changed_at) AS done_at FROM issue_status_history h \
           JOIN issues i ON i.tenant_id=h.tenant_id AND i.id=h.issue_id \
           JOIN project_statuses ps ON ps.tenant_id=h.tenant_id AND ps.project_id=i.project_id AND ps.key=h.to_status AND ps.category='done' \
           WHERE h.tenant_id=$1 AND i.project_id=$2 GROUP BY h.issue_id), \
         started AS (\
           SELECT h.issue_id, min(h.changed_at) AS started_at FROM issue_status_history h \
           JOIN issues i ON i.tenant_id=h.tenant_id AND i.id=h.issue_id \
           JOIN project_statuses ps ON ps.tenant_id=h.tenant_id AND ps.project_id=i.project_id AND ps.key=h.to_status AND ps.category='in_progress' \
           WHERE h.tenant_id=$1 AND i.project_id=$2 GROUP BY h.issue_id) \
         SELECT i.id AS issue_id, i.number, i.title, i.created_at, s.started_at, d.done_at \
         FROM done d JOIN issues i ON i.tenant_id=$1 AND i.id=d.issue_id LEFT JOIN started s ON s.issue_id=d.issue_id \
         WHERE d.done_at >= $3::date::timestamptz AND d.done_at < ($4::date + 1)::timestamptz \
         ORDER BY d.done_at DESC LIMIT 2000",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)
}

#[utoipa::path(get, path = "/api/projects/{id}/reports/cycle-time", tag = "reports", params(("id" = Uuid, Path, description = "Resource id"), RangeQuery), responses((status = 200, description = "Lead and cycle time of issues completed in the range, with throughput by week", body = CycleReport), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn cycle_report(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<RangeQuery>,
) -> ApiResult<Json<CycleReport>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let (from, to) = date_range(q.from.as_deref(), q.to.as_deref())?;
    let rows = completed_issues(&mut tx, i.tenant_id, p, from, to).await?;
    let items: Vec<CycleItem> = rows
        .iter()
        .map(|r| CycleItem {
            issue_id: r.issue_id,
            number: r.number,
            title: r.title.clone(),
            done_on: r.done_at.format("%Y-%m-%d").to_string(),
            lead_days: (r.done_at - r.created_at).num_seconds() as f64 / 86_400.0,
            cycle_days: r
                .started_at
                .map(|s| (r.done_at - s).num_seconds() as f64 / 86_400.0),
        })
        .collect();
    let leads: Vec<f64> = items.iter().map(|x| x.lead_days).collect();
    let cycles: Vec<f64> = items.iter().filter_map(|x| x.cycle_days).collect();
    let mut weeks: std::collections::BTreeMap<NaiveDate, i64> = std::collections::BTreeMap::new();
    for r in &rows {
        let day = r.done_at.date_naive();
        let monday = day - Days::new(u64::from(day.weekday().num_days_from_monday()));
        *weeks.entry(monday).or_insert(0) += 1;
    }
    Ok(Json(CycleReport {
        completed: items.len() as i64,
        median_lead_days: median(leads.clone()),
        average_lead_days: mean(&leads),
        median_cycle_days: median(cycles.clone()),
        average_cycle_days: mean(&cycles),
        items,
        throughput: weeks
            .into_iter()
            .map(|(w, n)| Throughput {
                week: w.format("%Y-%m-%d").to_string(),
                completed: n,
            })
            .collect(),
    }))
}

/// Issues created and issues completed on each day.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct CreatedResolved {
    pub(crate) day: String,
    pub(crate) created: i64,
    pub(crate) resolved: i64,
}

#[utoipa::path(get, path = "/api/projects/{id}/reports/created-resolved", tag = "reports", params(("id" = Uuid, Path, description = "Resource id"), RangeQuery), responses((status = 200, description = "Created and resolved counts per day", body = Vec<CreatedResolved>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn created_resolved_report(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<RangeQuery>,
) -> ApiResult<Json<Vec<CreatedResolved>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let (from, to) = date_range(q.from.as_deref(), q.to.as_deref())?;
    let rows: Vec<CreatedResolved> = sqlx::query_as(
        "WITH days AS (SELECT generate_series($3::date,$4::date,'1 day')::date AS day), \
         created AS (SELECT (i.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n FROM issues i \
           WHERE i.tenant_id=$1 AND i.project_id=$2 GROUP BY 1), \
         resolved AS (SELECT (x.done_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n FROM (\
           SELECT min(h.changed_at) AS done_at FROM issue_status_history h \
           JOIN issues i ON i.tenant_id=h.tenant_id AND i.id=h.issue_id \
           JOIN project_statuses ps ON ps.tenant_id=h.tenant_id AND ps.project_id=i.project_id AND ps.key=h.to_status AND ps.category='done' \
           WHERE h.tenant_id=$1 AND i.project_id=$2 GROUP BY h.issue_id) x GROUP BY 1) \
         SELECT to_char(days.day,'YYYY-MM-DD') AS day, COALESCE(created.n,0) AS created, COALESCE(resolved.n,0) AS resolved \
         FROM days LEFT JOIN created ON created.day=days.day LEFT JOIN resolved ON resolved.day=days.day ORDER BY days.day",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------------------------
// G2. Time reports
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TimeByPerson {
    pub(crate) user_id: Uuid,
    pub(crate) name: String,
    pub(crate) minutes: i64,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TimeByIssue {
    pub(crate) issue_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) minutes: i64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct TimeReport {
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) total_minutes: i64,
    pub(crate) by_person: Vec<TimeByPerson>,
    pub(crate) by_issue: Vec<TimeByIssue>,
}

#[utoipa::path(get, path = "/api/projects/{id}/reports/time", tag = "reports", params(("id" = Uuid, Path, description = "Resource id"), RangeQuery), responses((status = 200, description = "Logged time in the range by person and by issue", body = TimeReport), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn time_report(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<RangeQuery>,
) -> ApiResult<Json<TimeReport>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let (from, to) = date_range(q.from.as_deref(), q.to.as_deref())?;
    Ok(Json(
        time_report_for(&mut tx, i.tenant_id, p, from, to).await?,
    ))
}

async fn time_report_for(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> ApiResult<TimeReport> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(w.minutes),0)::bigint FROM worklogs w JOIN issues i ON i.tenant_id=w.tenant_id AND i.id=w.issue_id \
         WHERE w.tenant_id=$1 AND i.project_id=$2 AND w.started_on BETWEEN $3 AND $4",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    let by_person: Vec<TimeByPerson> = sqlx::query_as(
        "SELECT w.author_id AS user_id, u.display_name AS name, sum(w.minutes)::bigint AS minutes FROM worklogs w \
         JOIN issues i ON i.tenant_id=w.tenant_id AND i.id=w.issue_id JOIN users u ON u.id=w.author_id \
         WHERE w.tenant_id=$1 AND i.project_id=$2 AND w.started_on BETWEEN $3 AND $4 GROUP BY w.author_id, u.display_name ORDER BY minutes DESC",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)?;
    let by_issue: Vec<TimeByIssue> = sqlx::query_as(
        "SELECT i.id AS issue_id, i.number, i.title, sum(w.minutes)::bigint AS minutes FROM worklogs w \
         JOIN issues i ON i.tenant_id=w.tenant_id AND i.id=w.issue_id \
         WHERE w.tenant_id=$1 AND i.project_id=$2 AND w.started_on BETWEEN $3 AND $4 GROUP BY i.id, i.number, i.title ORDER BY minutes DESC LIMIT 200",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(TimeReport {
        from: from.to_string(),
        to: to.to_string(),
        total_minutes: total,
        by_person,
        by_issue,
    })
}

// ---------------------------------------------------------------------------------------------
// G4. Dashboards
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Dashboard {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) owner_id: Uuid,
    pub(crate) name: String,
    pub(crate) shared: bool,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Widget {
    pub(crate) id: Uuid,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) config: Value,
    pub(crate) position: i32,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct DashboardView {
    pub(crate) dashboard: Dashboard,
    pub(crate) widgets: Vec<WidgetView>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct WidgetView {
    pub(crate) id: Uuid,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) config: Value,
    pub(crate) position: i32,
    /// The widget's data, computed now. Shape depends on the kind.
    pub(crate) data: Value,
}

const DASHBOARD_SELECT: &str =
    "SELECT id, project_id, owner_id, name, shared, created_at FROM dashboards";

#[utoipa::path(get, path = "/api/projects/{id}/dashboards", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Dashboards you own and shared ones", body = Vec<Dashboard>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_dashboards(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Dashboard>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let rows: Vec<Dashboard> = sqlx::query_as(&format!(
        "{DASHBOARD_SELECT} WHERE tenant_id=$1 AND project_id=$2 AND (shared OR owner_id=$3) ORDER BY created_at"
    ))
    .bind(i.tenant_id)
    .bind(p)
    .bind(i.user_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct DashboardInput {
    pub(crate) name: String,
    pub(crate) shared: Option<bool>,
}

#[utoipa::path(post, path = "/api/projects/{id}/dashboards", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), request_body = DashboardInput, responses((status = 201, description = "Success", body = Dashboard), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_dashboard(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<DashboardInput>,
) -> ApiResult<(StatusCode, Json<Dashboard>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_project(&mut tx, &i, p).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(bad("Dashboard name must be between 1 and 120 characters"));
    }
    let row: Dashboard = sqlx::query_as(
        "INSERT INTO dashboards(tenant_id,project_id,owner_id,name,shared) VALUES($1,$2,$3,$4,$5) \
         RETURNING id, project_id, owner_id, name, shared, created_at",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(i.user_id)
    .bind(name)
    .bind(v.shared.unwrap_or(false))
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// Reads a dashboard the caller may see: their own, or one shared with the workspace.
async fn visible_dashboard(
    db: &mut PgConnection,
    tenant: Uuid,
    me: Uuid,
    id: Uuid,
) -> ApiResult<Dashboard> {
    sqlx::query_as(&format!(
        "{DASHBOARD_SELECT} WHERE tenant_id=$1 AND id=$2 AND (shared OR owner_id=$3)"
    ))
    .bind(tenant)
    .bind(id)
    .bind(me)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Dashboard not found"))
}

async fn widget_data(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    w: &Widget,
) -> ApiResult<Value> {
    let done = done_predicate("i");
    Ok(match w.kind.as_str() {
        "status_counts" => {
            let rows: Vec<(String, i64)> = sqlx::query_as(
                "SELECT i.status, count(*) FROM issues i WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL GROUP BY i.status ORDER BY i.status",
            )
            .bind(tenant)
            .bind(project)
            .fetch_all(&mut *db)
            .await
            .map_err(db_err)?;
            json!(rows
                .into_iter()
                .map(|(k, n)| json!({"key": k, "count": n}))
                .collect::<Vec<_>>())
        }
        "priority_counts" => {
            let rows: Vec<(String, i64)> = sqlx::query_as(
                "SELECT i.priority, count(*) FROM issues i WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL GROUP BY i.priority",
            )
            .bind(tenant)
            .bind(project)
            .fetch_all(&mut *db)
            .await
            .map_err(db_err)?;
            json!(rows
                .into_iter()
                .map(|(k, n)| json!({"key": k, "count": n}))
                .collect::<Vec<_>>())
        }
        "assignee_counts" => {
            let rows: Vec<(Option<String>, i64)> = sqlx::query_as(&format!(
                "SELECT u.display_name, count(*) FROM issues i LEFT JOIN users u ON u.id=i.assignee_id \
                 WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL AND NOT {done} GROUP BY u.display_name ORDER BY count(*) DESC"
            ))
            .bind(tenant)
            .bind(project)
            .fetch_all(&mut *db)
            .await
            .map_err(db_err)?;
            json!(rows
                .into_iter()
                .map(|(k, n)| json!({"key": k.unwrap_or_else(|| "Unassigned".into()), "count": n}))
                .collect::<Vec<_>>())
        }
        "time_by_person" => {
            let (from, to) = date_range(
                w.config.get("from").and_then(Value::as_str),
                w.config.get("to").and_then(Value::as_str),
            )?;
            json!(
                time_report_for(db, tenant, project, from, to)
                    .await?
                    .by_person
            )
        }
        "flow" => {
            let (from, to) = date_range(
                w.config.get("from").and_then(Value::as_str),
                w.config.get("to").and_then(Value::as_str),
            )?;
            json!(flow_rows(db, tenant, project, from, to).await?)
        }
        "cycle_summary" => {
            let (from, to) = date_range(
                w.config.get("from").and_then(Value::as_str),
                w.config.get("to").and_then(Value::as_str),
            )?;
            let rows = completed_issues(db, tenant, project, from, to).await?;
            let leads: Vec<f64> = rows
                .iter()
                .map(|r| (r.done_at - r.created_at).num_seconds() as f64 / 86_400.0)
                .collect();
            let cycles: Vec<f64> = rows
                .iter()
                .filter_map(|r| {
                    r.started_at
                        .map(|s| (r.done_at - s).num_seconds() as f64 / 86_400.0)
                })
                .collect();
            json!({"completed": rows.len(), "median_lead_days": median(leads), "median_cycle_days": median(cycles)})
        }
        "velocity" => {
            let rows: Vec<(String, Option<i32>, Option<i32>)> = sqlx::query_as(
                "SELECT name, started_scope_points, final_done_points FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND state='completed' AND final_done_points IS NOT NULL ORDER BY closed_at DESC NULLS LAST LIMIT 5",
            )
            .bind(tenant)
            .bind(project)
            .fetch_all(&mut *db)
            .await
            .map_err(db_err)?;
            let recent: Vec<Value> = rows
                .iter()
                .map(|(name, started, done)| {
                    json!({
                        "name": name,
                        "started_points": started.unwrap_or(0),
                        "done_points": done.unwrap_or(0),
                    })
                })
                .collect();
            let xs: Vec<f64> = rows
                .iter()
                .map(|(_, _, p)| f64::from(p.unwrap_or(0)))
                .collect();
            json!({
                "sprints": xs.len(),
                "average_done_points": mean(&xs).unwrap_or(0.0),
                "recent": recent
            })
        }
        _ => json!(null),
    })
}

#[utoipa::path(get, path = "/api/dashboards/{id}", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Dashboard with each widget's data", body = DashboardView), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_dashboard(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<DashboardView>> {
    let i = tx.identity.clone();
    let dashboard = visible_dashboard(&mut tx, i.tenant_id, i.user_id, id).await?;
    ensure_access(&mut tx, dashboard.project_id).await?;
    let widgets: Vec<Widget> = sqlx::query_as(
        "SELECT id, kind, title, config, position FROM dashboard_widgets WHERE tenant_id=$1 AND dashboard_id=$2 ORDER BY position",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut views = Vec::with_capacity(widgets.len());
    for w in widgets {
        let data = widget_data(&mut tx, i.tenant_id, dashboard.project_id, &w).await?;
        views.push(WidgetView {
            id: w.id,
            kind: w.kind,
            title: w.title,
            config: w.config,
            position: w.position,
            data,
        });
    }
    Ok(Json(DashboardView {
        dashboard,
        widgets: views,
    }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WidgetInput {
    /// `status_counts`, `priority_counts`, `assignee_counts`, `time_by_person`, `flow`, `velocity` or `cycle_summary`.
    pub(crate) kind: String,
    pub(crate) title: String,
    /// For time, flow and cycle widgets: `from` and `to` (YYYY-MM-DD).
    pub(crate) config: Option<Value>,
}

#[utoipa::path(post, path = "/api/dashboards/{id}/widgets", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), request_body = WidgetInput, responses((status = 201, description = "Success", body = Widget), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_widget(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<WidgetInput>,
) -> ApiResult<(StatusCode, Json<Widget>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let dashboard: Dashboard =
        sqlx::query_as(&format!("{DASHBOARD_SELECT} WHERE tenant_id=$1 AND id=$2"))
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Dashboard not found"))?;
    if dashboard.owner_id != i.user_id {
        return Err(forbidden());
    }
    ensure_access(&mut tx, dashboard.project_id).await?;
    if ![
        "status_counts",
        "priority_counts",
        "assignee_counts",
        "time_by_person",
        "flow",
        "velocity",
        "cycle_summary",
    ]
    .contains(&v.kind.as_str())
    {
        return Err(bad("Unknown widget kind"));
    }
    let title = v.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(bad("Widget title must be between 1 and 120 characters"));
    }
    let config = v.config.unwrap_or_else(|| json!({}));
    if !config.is_object() || config.to_string().len() > 2000 {
        return Err(bad("Widget config must be a small object"));
    }
    let row: Widget = sqlx::query_as(
        "INSERT INTO dashboard_widgets(tenant_id,dashboard_id,kind,title,config,position) VALUES($1,$2,$3,$4,$5, \
         COALESCE((SELECT max(position)+1 FROM dashboard_widgets WHERE tenant_id=$1 AND dashboard_id=$2),0)) \
         RETURNING id, kind, title, config, position",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(v.kind)
    .bind(title)
    .bind(config)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/dashboards/{id}/widgets/{widget_id}", tag = "reports", params(("id" = Uuid, Path, description = "Resource id"), ("widget_id" = Uuid, Path, description = "Widget id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_widget(
    mut tx: Tx,
    Path((id, widget)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let dashboard = visible_dashboard(&mut tx, i.tenant_id, i.user_id, id).await?;
    if dashboard.owner_id != i.user_id {
        return Err(forbidden());
    }
    let affected = sqlx::query(
        "DELETE FROM dashboard_widgets WHERE tenant_id=$1 AND dashboard_id=$2 AND id=$3",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(widget)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected();
    if affected == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Widget not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/dashboards/{id}", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_dashboard(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let dashboard = visible_dashboard(&mut tx, i.tenant_id, i.user_id, id).await?;
    if dashboard.owner_id != i.user_id {
        require_admin(&i)?;
    }
    sqlx::query("DELETE FROM dashboards WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// G5. CSV export
// ---------------------------------------------------------------------------------------------

/// Quotes a CSV cell and neutralises spreadsheet formulas by prefixing a quote when a cell starts
/// with `=`, `+`, `-`, `@`, a tab or a carriage return.
pub(crate) fn csv_cell(raw: &str) -> String {
    let guarded = match raw.chars().next() {
        Some('=') | Some('+') | Some('-') | Some('@') | Some('\t') | Some('\r') => {
            format!("'{raw}")
        }
        _ => raw.to_string(),
    };
    if guarded.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

#[utoipa::path(get, path = "/api/projects/{id}/export.csv", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Active issues as CSV (at most 10000 rows)", content_type = "text/csv", body = String), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn export_csv(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<axum::response::Response> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let key: String = sqlx::query_scalar("SELECT key FROM projects WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(p)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let rows: Vec<(i64, String, String, String, String, Option<String>, Option<String>, Option<String>, Option<i32>, String, String, String)> =
        sqlx::query_as(
            "SELECT i.number, i.title, i.kind, i.status, i.priority, u.display_name, t.name, s.name, i.story_points, \
             array_to_string(i.labels, ' '), to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI'), \
             to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') \
             FROM issues i LEFT JOIN users u ON u.id=i.assignee_id LEFT JOIN teams t ON t.tenant_id=i.tenant_id AND t.id=i.team_id \
             LEFT JOIN sprints s ON s.tenant_id=i.tenant_id AND s.id=i.sprint_id \
             WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL ORDER BY i.number LIMIT 10000",
        )
        .bind(i.tenant_id)
        .bind(p)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
    let mut out = String::from(
        "key,title,type,status,priority,assignee,team,sprint,story_points,labels,created,updated\n",
    );
    for (
        number,
        title,
        kind,
        status,
        priority,
        assignee,
        team,
        sprint,
        points,
        labels,
        created,
        updated,
    ) in rows
    {
        let cells = [
            format!("{key}-{number}"),
            title,
            kind,
            status,
            priority,
            assignee.unwrap_or_default(),
            team.unwrap_or_default(),
            sprint.unwrap_or_default(),
            points.map(|n| n.to_string()).unwrap_or_default(),
            labels,
            created,
            updated,
        ];
        out.push_str(
            &cells
                .iter()
                .map(|c| csv_cell(c))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    let disposition = format!("attachment; filename=\"{key}-issues.csv\"");
    Ok((
        [
            (CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (CONTENT_DISPOSITION, disposition),
        ],
        out,
    )
        .into_response())
}

/// Columns shared by the sprint and release exports: key, title, type, status, priority, assignee,
/// team, story points, labels, last updated.
type ScopeExportRow = (
    i64,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<i32>,
    String,
    String,
);

fn scope_csv(
    key: &str,
    rows: Vec<ScopeExportRow>,
    extra_header: bool,
    extra: Vec<String>,
) -> String {
    let mut out =
        String::from("key,title,type,status,priority,assignee,team,story_points,labels,updated");
    if extra_header {
        out.push_str(",added_after_freeze");
    }
    out.push('\n');
    for (idx, (number, title, kind, status, priority, assignee, team, points, labels, updated)) in
        rows.into_iter().enumerate()
    {
        let mut cells = vec![
            format!("{key}-{number}"),
            title,
            kind,
            status,
            priority,
            assignee.unwrap_or_default(),
            team.unwrap_or_default(),
            points.map(|n| n.to_string()).unwrap_or_default(),
            labels,
            updated,
        ];
        if extra_header {
            cells.push(extra.get(idx).cloned().unwrap_or_default());
        }
        out.push_str(
            &cells
                .iter()
                .map(|c| csv_cell(c))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    out
}

fn csv_response(filename: String, body: String) -> axum::response::Response {
    (
        [
            (CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        body,
    )
        .into_response()
}

async fn project_key_for(tx: &mut Tx, tenant: Uuid, project: Uuid) -> ApiResult<String> {
    sqlx::query_scalar("SELECT key FROM projects WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(project)
        .fetch_one(&mut **tx)
        .await
        .map_err(db_err)
}

#[utoipa::path(get, path = "/api/sprints/{id}/export.csv", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Issues in the sprint as CSV (at most 10000 rows)", content_type = "text/csv", body = String), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn sprint_export(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<axum::response::Response> {
    let i = tx.identity.clone();
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM sprints WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Sprint not found"))?;
    valid_project(&mut tx, &i, project).await?;
    let key = project_key_for(&mut tx, i.tenant_id, project).await?;
    let rows: Vec<ScopeExportRow> = sqlx::query_as(
        "SELECT i.number, i.title, i.kind, i.status, i.priority, u.display_name, t.name, i.story_points, \
         array_to_string(i.labels, ' '), to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') \
         FROM issues i LEFT JOIN users u ON u.id=i.assignee_id LEFT JOIN teams t ON t.tenant_id=i.tenant_id AND t.id=i.team_id \
         WHERE i.tenant_id=$1 AND i.sprint_id=$2 AND i.archived_at IS NULL AND i.trashed_at IS NULL ORDER BY i.number LIMIT 10000",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(csv_response(
        format!("{key}-sprint-issues.csv"),
        scope_csv(&key, rows, false, Vec::new()),
    ))
}

#[utoipa::path(get, path = "/api/releases/{id}/export.csv", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Active release scope as CSV (at most 10000 rows)", content_type = "text/csv", body = String), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn release_export(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<axum::response::Response> {
    let i = tx.identity.clone();
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM releases WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Release not found"))?;
    valid_project(&mut tx, &i, project).await?;
    let key = project_key_for(&mut tx, i.tenant_id, project).await?;
    let rows: Vec<(i64, String, String, String, String, Option<String>, Option<String>, Option<i32>, String, String, bool)> = sqlx::query_as(
        "SELECT i.number, i.title, i.kind, i.status, i.priority, u.display_name, t.name, i.story_points, \
         array_to_string(i.labels, ' '), to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI'), ri.added_after_freeze \
         FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id \
         LEFT JOIN users u ON u.id=i.assignee_id LEFT JOIN teams t ON t.tenant_id=i.tenant_id AND t.id=i.team_id \
         WHERE ri.tenant_id=$1 AND ri.release_id=$2 AND ri.removed_at IS NULL ORDER BY i.number LIMIT 10000",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut flags = Vec::with_capacity(rows.len());
    let mut scope = Vec::with_capacity(rows.len());
    for (number, title, kind, status, priority, assignee, team, points, labels, updated, after) in
        rows
    {
        flags.push(if after {
            "yes".to_string()
        } else {
            "no".to_string()
        });
        scope.push((
            number, title, kind, status, priority, assignee, team, points, labels, updated,
        ));
    }
    Ok(csv_response(
        format!("{key}-release-scope.csv"),
        scope_csv(&key, scope, true, flags),
    ))
}

#[utoipa::path(get, path = "/api/projects/{id}/history.csv", tag = "reports", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Status and field changes of the project's issues as CSV (at most 10000 rows, newest first)", content_type = "text/csv", body = String), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn history_export(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<axum::response::Response> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let key = project_key_for(&mut tx, i.tenant_id, p).await?;
    // Custom fields are not in the change log, so restricted field values cannot leak through it.
    let rows: Vec<(i64, String, Option<String>, Option<String>, String, String)> = sqlx::query_as(
        "SELECT * FROM (\
           SELECT i.number, 'status', h.from_status, h.to_status, u.display_name, to_char(h.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') \
           FROM issue_status_history h JOIN issues i ON i.tenant_id=h.tenant_id AND i.id=h.issue_id \
           JOIN users u ON u.id=h.actor_id WHERE h.tenant_id=$1 AND i.project_id=$2 \
           UNION ALL \
           SELECT i.number, c.field, \
             CASE WHEN c.field = 'team_id' THEN COALESCE((SELECT t.name FROM teams t WHERE t.tenant_id=c.tenant_id AND t.id::text=c.old_value), c.old_value) \
                  WHEN c.field = 'sprint_id' THEN COALESCE((SELECT s.name FROM sprints s WHERE s.tenant_id=c.tenant_id AND s.id::text=c.old_value), c.old_value) \
                  ELSE c.old_value END, \
             CASE WHEN c.field = 'team_id' THEN COALESCE((SELECT t.name FROM teams t WHERE t.tenant_id=c.tenant_id AND t.id::text=c.new_value), c.new_value) \
                  WHEN c.field = 'sprint_id' THEN COALESCE((SELECT s.name FROM sprints s WHERE s.tenant_id=c.tenant_id AND s.id::text=c.new_value), c.new_value) \
                  ELSE c.new_value END, \
             u.display_name, to_char(c.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') \
           FROM issue_changes c JOIN issues i ON i.tenant_id=c.tenant_id AND i.id=c.issue_id \
           JOIN users u ON u.id=c.actor_id WHERE c.tenant_id=$1 AND i.project_id=$2\
         ) changes ORDER BY 6 DESC LIMIT 10000",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut out = String::from("key,field,from,to,by,at\n");
    for (number, field, from, to, by, at) in rows {
        let cells = [
            format!("{key}-{number}"),
            field,
            from.unwrap_or_default(),
            to.unwrap_or_default(),
            by,
            at,
        ];
        out.push_str(
            &cells
                .iter()
                .map(|c| csv_cell(c))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    Ok(csv_response(format!("{key}-history.csv"), out))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/projects/{id}/reports/flow", get(flow_report))
        .route("/api/projects/{id}/reports/cycle-time", get(cycle_report))
        .route(
            "/api/projects/{id}/reports/created-resolved",
            get(created_resolved_report),
        )
        .route("/api/projects/{id}/reports/time", get(time_report))
        .route(
            "/api/projects/{id}/dashboards",
            get(list_dashboards).post(create_dashboard),
        )
        .route(
            "/api/dashboards/{id}",
            get(get_dashboard).delete(delete_dashboard),
        )
        .route(
            "/api/dashboards/{id}/widgets",
            axum::routing::post(add_widget),
        )
        .route(
            "/api/dashboards/{id}/widgets/{widget_id}",
            delete(delete_widget),
        )
        .route("/api/projects/{id}/export.csv", get(export_csv))
        .route("/api/projects/{id}/history.csv", get(history_export))
        .route("/api/sprints/{id}/export.csv", get(sprint_export))
        .route("/api/releases/{id}/export.csv", get(release_export))
}
