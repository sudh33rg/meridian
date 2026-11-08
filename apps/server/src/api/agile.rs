//! Backlogs, team ownership, sprint execution, burndown and velocity (Phase E).
//!
//! Ranks are project-wide and fractional: moving one item never renumbers the others, except when
//! float precision runs out between two neighbours, in which case the project is renumbered once.
//! A sprint's closing record is written when it starts and when it completes, so velocity and scope
//! creep never depend on issues that were edited afterwards.
use crate::api::common::*;
use crate::*;
use axum::http::HeaderMap;
use axum::routing::{delete, post, put};

/// Columns of a backlog row. Used by every query that returns [`BacklogItem`].
const BACKLOG_COLUMNS: &str = "id,project_id,number,title,kind,status,priority,assignee_id,team_id,sprint_id,story_points,backlog_rank,updated_at";

/// SQL test that an issue (aliased `alias`) sits in a status whose category is `done`.
pub(crate) fn done_predicate(alias: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM project_statuses ps WHERE ps.tenant_id={alias}.tenant_id \
         AND ps.project_id={alias}.project_id AND ps.key={alias}.status AND ps.category='done')"
    )
}

/// One issue as the backlog, a sprint or a release scope shows it.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct BacklogItem {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) assignee_id: Option<Uuid>,
    pub(crate) team_id: Option<Uuid>,
    pub(crate) sprint_id: Option<Uuid>,
    pub(crate) story_points: Option<i32>,
    /// Position in the project's ranking. Lower ranks come first.
    pub(crate) backlog_rank: f64,
    pub(crate) updated_at: DateTime<Utc>,
}

/// Query for `GET /api/projects/{id}/backlog`. Results are ordered by rank, then by issue number.
#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct BacklogQuery {
    /// Only issues owned by this team. Omit to see every team and unassigned work.
    pub(crate) team_id: Option<Uuid>,
    /// Only issues assigned to this user.
    pub(crate) assignee_id: Option<Uuid>,
    /// Case-insensitive title search, up to 200 characters.
    pub(crate) q: Option<String>,
    /// Include issues whose status is in the `done` category (default `false`).
    pub(crate) include_done: Option<bool>,
    /// Page size, 1 to 500 (default 200).
    pub(crate) limit: Option<i64>,
    /// Offset returned in `X-Next-Cursor` by the previous page.
    pub(crate) cursor: Option<String>,
}

#[utoipa::path(get, path = "/api/projects/{id}/backlog", tag = "agile", params(("id" = Uuid, Path, description = "Resource id"), BacklogQuery), responses((status = 200, description = "Ranked backlog. X-Next-Cursor is present when another page exists", body = Vec<BacklogItem>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn backlog(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<BacklogQuery>,
) -> ApiResult<(HeaderMap, Json<Vec<BacklogItem>>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let limit = q.limit.unwrap_or(200);
    if !(1..=500).contains(&limit) {
        return Err(bad("limit must be between 1 and 500"));
    }
    let offset: i64 = match q.cursor.as_deref().filter(|c| !c.is_empty()) {
        None => 0,
        Some(c) => c
            .parse::<i64>()
            .ok()
            .filter(|n| *n >= 0)
            .ok_or_else(|| bad("Invalid cursor"))?,
    };
    let search = match q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(s) if s.chars().count() > 200 => {
            return Err(bad("Search text is limited to 200 characters"))
        }
        Some(s) => Some(format!(
            "%{}%",
            s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        )),
    };
    let done = done_predicate("i");
    let sql = format!(
        "SELECT {cols} FROM issues i WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL \
         AND i.sprint_id IS NULL AND ($3::uuid IS NULL OR i.team_id=$3) AND ($4::uuid IS NULL OR i.assignee_id=$4) \
         AND ($5::text IS NULL OR i.title ILIKE $5 ESCAPE '\\') AND ($6 OR NOT {done}) \
         ORDER BY i.backlog_rank, i.number LIMIT $7 OFFSET $8",
        cols = BACKLOG_COLUMNS
    );
    let mut rows: Vec<BacklogItem> = sqlx::query_as(&sql)
        .bind(i.tenant_id)
        .bind(project)
        .bind(q.team_id)
        .bind(q.assignee_id)
        .bind(search)
        .bind(q.include_done.unwrap_or(false))
        .bind(limit + 1)
        .bind(offset)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
    let mut headers = HeaderMap::new();
    if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        if let Ok(v) = axum::http::HeaderValue::from_str(&(offset + limit).to_string()) {
            headers.insert("x-next-cursor", v);
        }
    }
    Ok((headers, Json(rows)))
}

/// Where to put an item in the ranking.
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct RankInput {
    /// `top`, `bottom`, `before` or `after`.
    pub(crate) placement: String,
    /// The item to place this one next to. Required for `before` and `after`; must be in the same project.
    pub(crate) anchor_id: Option<Uuid>,
}

async fn rank_of(db: &mut PgConnection, tenant: Uuid, project: Uuid, issue: Uuid) -> ApiResult<f64> {
    sqlx::query_scalar("SELECT backlog_rank FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id=$3")
        .bind(tenant)
        .bind(project)
        .bind(issue)
        .fetch_optional(&mut *db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| bad("Anchor must be an issue in the same project"))
}

/// Ranks the project's issues 1..n in their current order. Used only when float precision runs out.
async fn renumber_project(db: &mut PgConnection, tenant: Uuid, project: Uuid) -> ApiResult<()> {
    sqlx::query(
        "UPDATE issues i SET backlog_rank = r.rn::double precision FROM \
         (SELECT id, row_number() OVER (ORDER BY backlog_rank, number) AS rn FROM issues WHERE tenant_id=$1 AND project_id=$2) r \
         WHERE i.tenant_id=$1 AND i.id=r.id",
    )
    .bind(tenant)
    .bind(project)
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(())
}

#[utoipa::path(post, path = "/api/issues/{id}/rank", tag = "agile", params(("id" = Uuid, Path, description = "Resource id")), request_body = RankInput, responses((status = 200, description = "Ranked. Returns the item", body = BacklogItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn rank_issue(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<RankInput>,
) -> ApiResult<Json<BacklogItem>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    if !["top", "bottom", "before", "after"].contains(&v.placement.as_str()) {
        return Err(bad("placement must be top, bottom, before or after"));
    }
    let needs_anchor = v.placement == "before" || v.placement == "after";
    match (needs_anchor, v.anchor_id) {
        (true, None) => return Err(bad("before and after need an anchor_id")),
        (true, Some(a)) if a == id => return Err(bad("An item cannot be placed next to itself")),
        (false, Some(_)) => return Err(bad("top and bottom do not take an anchor_id")),
        _ => {}
    }
    let current = rank_of(&mut tx, i.tenant_id, project, id).await?;
    // Two passes at most: a renumbering can move the anchor, so the anchor is read again after it.
    let mut renumbered = false;
    let new_rank = loop {
        let (lower, upper) = match (v.placement.as_str(), v.anchor_id) {
            ("top", _) => (None, min_rank(&mut tx, i.tenant_id, project, id, None).await?),
            ("bottom", _) => (max_rank(&mut tx, i.tenant_id, project, id, None).await?, None),
            ("before", Some(a)) => {
                let ar = rank_of(&mut tx, i.tenant_id, project, a).await?;
                (max_rank(&mut tx, i.tenant_id, project, id, Some(ar)).await?, Some(ar))
            }
            ("after", Some(a)) => {
                let ar = rank_of(&mut tx, i.tenant_id, project, a).await?;
                (Some(ar), min_rank(&mut tx, i.tenant_id, project, id, Some(ar)).await?)
            }
            _ => return Err(bad("Invalid placement")),
        };
        match (lower, upper) {
            (None, None) => break current,
            (None, Some(u)) => break u - 1.0,
            (Some(l), None) => break l + 1.0,
            (Some(l), Some(u)) => {
                let mid = (l + u) / 2.0;
                if mid > l && mid < u {
                    break mid;
                }
                if renumbered {
                    return Err(ApiError::Internal("Could not place the item after renumbering".into()));
                }
                renumber_project(&mut tx, i.tenant_id, project).await?;
                renumbered = true;
            }
        }
    };
    let row: BacklogItem = sqlx::query_as(&format!(
        "UPDATE issues SET backlog_rank=$1 WHERE tenant_id=$2 AND id=$3 RETURNING {BACKLOG_COLUMNS}"
    ))
    .bind(new_rank)
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "ranked", "issue", id).await?;
    Ok(Json(row))
}

/// Highest rank among the project's other issues, optionally strictly below `below`.
async fn max_rank(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    me: Uuid,
    below: Option<f64>,
) -> ApiResult<Option<f64>> {
    let found: Option<f64> = sqlx::query_scalar(
        "SELECT MAX(backlog_rank) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id<>$3 AND backlog_rank < COALESCE($4, 'Infinity'::float8)",
    )
    .bind(tenant)
    .bind(project)
    .bind(me)
    .bind(below)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(found)
}

/// Lowest rank among the project's other issues, optionally strictly above `above`.
async fn min_rank(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    me: Uuid,
    above: Option<f64>,
) -> ApiResult<Option<f64>> {
    let found: Option<f64> = sqlx::query_scalar(
        "SELECT MIN(backlog_rank) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id<>$3 AND backlog_rank > COALESCE($4, '-Infinity'::float8)",
    )
    .bind(tenant)
    .bind(project)
    .bind(me)
    .bind(above)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(found)
}

/// Team ownership of one issue.
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueTeamInput {
    /// The owning team, or `null` to make the issue unassigned to any team.
    pub(crate) team_id: Option<Uuid>,
}

#[utoipa::path(put, path = "/api/issues/{id}/team", tag = "agile", params(("id" = Uuid, Path, description = "Resource id")), request_body = IssueTeamInput, responses((status = 200, description = "Team set. Returns the item", body = BacklogItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_issue_team(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<IssueTeamInput>,
) -> ApiResult<Json<BacklogItem>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    if let Some(team) = v.team_id {
        let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM teams WHERE tenant_id=$1 AND id=$2)")
            .bind(i.tenant_id)
            .bind(team)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if !ok {
            return Err(bad("Team not found in this workspace"));
        }
    }
    // An issue inside another team's sprint cannot change team until it leaves that sprint.
    let blocked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN sprints s ON s.tenant_id=i.tenant_id AND s.id=i.sprint_id \
         WHERE i.tenant_id=$1 AND i.id=$2 AND s.team_id IS NOT NULL AND s.team_id IS DISTINCT FROM $3)",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(v.team_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if blocked {
        return Err(bad("Remove the issue from its team's sprint before changing its team"));
    }
    let before_team: Option<Uuid> = sqlx::query_scalar("SELECT team_id FROM issues WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let row: BacklogItem = sqlx::query_as(&format!(
        "UPDATE issues SET team_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3 AND archived_at IS NULL RETURNING {BACKLOG_COLUMNS}"
    ))
    .bind(v.team_id)
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))?;
    crate::api::history::record_change(
        &mut tx,
        i.tenant_id,
        id,
        i.user_id,
        "team_id",
        before_team.map(|t| t.to_string()),
        v.team_id.map(|t| t.to_string()),
    )
    .await?;
    log_event(&mut tx, &i, "updated", "issue", id).await?;
    Ok(Json(row))
}

/// Totals of a sprint's active issues. Done means the issue's status is in the `done` category.
#[derive(Debug, Clone, Copy, Serialize, utoipa::ToSchema)]
pub(crate) struct SprintTotals {
    pub(crate) scope_count: i32,
    pub(crate) done_count: i32,
    pub(crate) scope_points: i32,
    pub(crate) done_points: i32,
}

pub(crate) async fn sprint_totals(db: &mut PgConnection, tenant: Uuid, sprint: Uuid) -> ApiResult<SprintTotals> {
    let done = done_predicate("i");
    let sql = format!(
        "SELECT count(*)::int4, count(*) FILTER (WHERE {done})::int4, \
         COALESCE(sum(i.story_points),0)::int4, COALESCE(sum(i.story_points) FILTER (WHERE {done}),0)::int4 \
         FROM issues i WHERE i.tenant_id=$1 AND i.sprint_id=$2 AND i.archived_at IS NULL"
    );
    let (scope_count, done_count, scope_points, done_points): (i32, i32, i32, i32) = sqlx::query_as(&sql)
        .bind(tenant)
        .bind(sprint)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)?;
    Ok(SprintTotals { scope_count, done_count, scope_points, done_points })
}

/// Stores today's totals for a sprint. Re-running on the same day replaces the day's row.
async fn record_snapshot(db: &mut PgConnection, tenant: Uuid, sprint: Uuid) -> ApiResult<()> {
    let t = sprint_totals(db, tenant, sprint).await?;
    sqlx::query(
        "INSERT INTO sprint_daily_snapshots(tenant_id,sprint_id,day,scope_count,done_count,scope_points,done_points) \
         VALUES($1,$2,(now() AT TIME ZONE 'UTC')::date,$3,$4,$5,$6) \
         ON CONFLICT (tenant_id,sprint_id,day) DO UPDATE SET scope_count=EXCLUDED.scope_count, \
         done_count=EXCLUDED.done_count, scope_points=EXCLUDED.scope_points, done_points=EXCLUDED.done_points, captured_at=now()",
    )
    .bind(tenant)
    .bind(sprint)
    .bind(t.scope_count)
    .bind(t.done_count)
    .bind(t.scope_points)
    .bind(t.done_points)
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(())
}

/// Hourly capture for every active sprint, run by the maintenance loop on the system connection.
/// Each run replaces the day's row, so repeating it, or running two instances, does no harm.
pub(crate) async fn capture_active_sprints(db: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    let done = done_predicate("i");
    let sql = format!(
        "INSERT INTO sprint_daily_snapshots(tenant_id,sprint_id,day,scope_count,done_count,scope_points,done_points) \
         SELECT s.tenant_id, s.id, (now() AT TIME ZONE 'UTC')::date, t.sc, t.dc, t.sp, t.dp FROM sprints s \
         CROSS JOIN LATERAL (SELECT count(*)::int4 AS sc, count(*) FILTER (WHERE {done})::int4 AS dc, \
           COALESCE(sum(i.story_points),0)::int4 AS sp, COALESCE(sum(i.story_points) FILTER (WHERE {done}),0)::int4 AS dp \
           FROM issues i WHERE i.tenant_id=s.tenant_id AND i.sprint_id=s.id AND i.archived_at IS NULL) t \
         WHERE s.state='active' \
         ON CONFLICT (tenant_id,sprint_id,day) DO UPDATE SET scope_count=EXCLUDED.scope_count, \
         done_count=EXCLUDED.done_count, scope_points=EXCLUDED.scope_points, done_points=EXCLUDED.done_points, captured_at=now()"
    );
    Ok(sqlx::query(&sql).execute(db).await?.rows_affected())
}

/// A sprint as stored, including its opening and closing record.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Sprint {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) team_id: Option<Uuid>,
    pub(crate) name: String,
    pub(crate) goal: String,
    pub(crate) state: String,
    pub(crate) starts_at: Option<DateTime<Utc>>,
    pub(crate) ends_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) started_scope_count: Option<i32>,
    pub(crate) started_scope_points: Option<i32>,
    pub(crate) closed_at: Option<DateTime<Utc>>,
    pub(crate) final_scope_count: Option<i32>,
    pub(crate) final_scope_points: Option<i32>,
    pub(crate) final_done_count: Option<i32>,
    pub(crate) final_done_points: Option<i32>,
    pub(crate) carried_over_count: Option<i32>,
}

pub(crate) const SPRINT_COLUMNS: &str = "id,tenant_id,project_id,team_id,name,goal,state,starts_at,ends_at,created_at,\
started_scope_count,started_scope_points,closed_at,final_scope_count,final_scope_points,final_done_count,final_done_points,carried_over_count";

pub(crate) async fn load_sprint(db: &mut PgConnection, tenant: Uuid, id: Uuid) -> ApiResult<Sprint> {
    sqlx::query_as(&format!("SELECT {SPRINT_COLUMNS} FROM sprints WHERE tenant_id=$1 AND id=$2"))
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut *db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Sprint not found"))
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct SprintDetail {
    pub(crate) sprint: Sprint,
    pub(crate) totals: SprintTotals,
    /// Active issues in the sprint, in rank order.
    pub(crate) issues: Vec<BacklogItem>,
}

#[utoipa::path(get, path = "/api/sprints/{id}", tag = "agile", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = SprintDetail), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn sprint_detail(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<SprintDetail>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "sprints", id).await?;
    let sprint = load_sprint(&mut tx, i.tenant_id, id).await?;
    let totals = sprint_totals(&mut tx, i.tenant_id, id).await?;
    let issues: Vec<BacklogItem> = sqlx::query_as(&format!(
        "SELECT {BACKLOG_COLUMNS} FROM issues WHERE tenant_id=$1 AND sprint_id=$2 AND archived_at IS NULL ORDER BY backlog_rank, number"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(SprintDetail { sprint, totals, issues }))
}

/// Issue ids to add to or remove from a sprint. At most 100 distinct ids.
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SprintIssuesInput {
    pub(crate) issue_ids: Vec<Uuid>,
}

/// Result of a membership change. Each id is reported; a refused one carries the reason.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct MembershipResult {
    pub(crate) changed: i64,
    pub(crate) results: Vec<crate::api::issues::BulkItemResult>,
}

#[utoipa::path(post, path = "/api/sprints/{id}/issues", tag = "agile", params(("id" = Uuid, Path, description = "Resource id")), request_body = SprintIssuesInput, responses((status = 200, description = "Applied; per-item results name any refused issue", body = MembershipResult), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_issues_to_sprint(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<SprintIssuesInput>,
) -> ApiResult<Json<MembershipResult>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "sprints", id).await?;
    require_editor(&i)?;
    let ids = distinct_ids(&v.issue_ids)?;
    let sprint = load_sprint(&mut tx, i.tenant_id, id).await?;
    if sprint.state == "completed" {
        return Err(bad("Completed sprints are closed"));
    }
    let mut results = Vec::with_capacity(ids.len());
    let mut changed = 0_i64;
    for issue in ids {
        // (project, team, archived, current sprint)
        let row: Option<(Uuid, Option<Uuid>, Option<DateTime<Utc>>, Option<Uuid>)> = sqlx::query_as(
            "SELECT project_id, team_id, archived_at, sprint_id FROM issues WHERE tenant_id=$1 AND id=$2",
        )
        .bind(i.tenant_id)
        .bind(issue)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let prev_sprint = row.and_then(|r| r.3);
        let reason = match row {
            None => Some("Issue not found".to_string()),
            Some((project, _, _, _)) if project != sprint.project_id => Some("Issue is in another project".into()),
            Some((_, _, Some(_), _)) => Some("Issue is archived".into()),
            Some((_, team, _, _)) if sprint.team_id.is_some() && team != sprint.team_id => {
                Some("Issue belongs to another team; assign it to this team first".into())
            }
            Some((_, _, _, Some(current))) if current == id => Some("Already in this sprint".into()),
            Some((_, _, _, Some(current))) => {
                // Work that was completed in a closed sprint stays there; open work may move between sprints.
                let closed: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM sprints WHERE tenant_id=$1 AND id=$2 AND state='completed')",
                )
                .bind(i.tenant_id)
                .bind(current)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                if closed {
                    Some("Issue is in a closed sprint".into())
                } else {
                    None
                }
            }
            Some(_) => None,
        };
        match reason {
            Some(reason) => results.push(crate::api::issues::BulkItemResult { id: issue, ok: false, error: Some(reason) }),
            None => {
                sqlx::query("UPDATE issues SET sprint_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(id)
                    .bind(i.tenant_id)
                    .bind(issue)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
                log_event(&mut tx, &i, "updated", "issue", issue).await?;
                crate::api::history::record_change(
                    &mut tx,
                    i.tenant_id,
                    issue,
                    i.user_id,
                    "sprint_id",
                    prev_sprint.map(|s| s.to_string()),
                    Some(id.to_string()),
                )
                .await?;
                changed += 1;
                results.push(crate::api::issues::BulkItemResult { id: issue, ok: true, error: None });
            }
        }
    }
    Ok(Json(MembershipResult { changed, results }))
}

#[utoipa::path(delete, path = "/api/sprints/{id}/issues/{issue_id}", tag = "agile", params(("id" = Uuid, Path, description = "Resource id"), ("issue_id" = Uuid, Path, description = "Issue id")), responses((status = 200, description = "Removed from the sprint. Returns the item, now in the backlog", body = BacklogItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_issue_from_sprint(
    mut tx: Tx,
    Path((id, issue)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<BacklogItem>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "sprints", id).await?;
    require_editor(&i)?;
    let sprint = load_sprint(&mut tx, i.tenant_id, id).await?;
    if sprint.state == "completed" {
        return Err(bad("Completed sprints are closed"));
    }
    let row: BacklogItem = sqlx::query_as(&format!(
        "UPDATE issues SET sprint_id=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND sprint_id=$3 AND archived_at IS NULL RETURNING {BACKLOG_COLUMNS}"
    ))
    .bind(i.tenant_id)
    .bind(issue)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue is not in this sprint"))?;
    crate::api::history::record_change(
        &mut tx,
        i.tenant_id,
        issue,
        i.user_id,
        "sprint_id",
        Some(id.to_string()),
        None,
    )
    .await?;
    log_event(&mut tx, &i, "updated", "issue", issue).await?;
    Ok(Json(row))
}

fn distinct_ids(ids: &[Uuid]) -> ApiResult<Vec<Uuid>> {
    let mut out: Vec<Uuid> = Vec::new();
    for id in ids {
        if !out.contains(id) {
            out.push(*id);
        }
    }
    if out.is_empty() || out.len() > 100 {
        return Err(bad("Choose between 1 and 100 issues"));
    }
    Ok(out)
}

/// Fields a sprint can change. Only the fields that are present are changed.
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SprintUpdate {
    /// `active` starts a planned sprint; `completed` closes an active one.
    pub(crate) state: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) goal: Option<String>,
    pub(crate) starts_at: Option<DateTime<Utc>>,
    pub(crate) ends_at: Option<DateTime<Utc>>,
    /// Only with `state: completed`. `backlog` (the default) or the id of a planned or active sprint
    /// with the same team, where unfinished issues go.
    pub(crate) carry_over_to: Option<String>,
}

#[utoipa::path(patch, path = "/api/sprints/{id}", tag = "agile", params(("id" = Uuid, Path, description = "Resource id")), request_body = SprintUpdate, responses((status = 200, description = "Success", body = Sprint), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "Invalid transition, or another sprint is already active", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_sprint(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<SprintUpdate>,
) -> ApiResult<Json<Sprint>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "sprints", id).await?;
    require_editor(&i)?;
    let current = load_sprint(&mut tx, i.tenant_id, id).await?;
    let meta_change = v.name.is_some() || v.goal.is_some() || v.starts_at.is_some() || v.ends_at.is_some();
    if v.state.is_none() && !meta_change {
        return Err(bad("Nothing to change"));
    }
    if meta_change && current.state == "completed" {
        return Err(bad("Completed sprints are closed"));
    }
    if let Some(n) = &v.name {
        validate_title(n)?;
    }
    if v.goal.as_ref().is_some_and(|g| g.len() > 2000) {
        return Err(bad("Sprint goal is limited to 2000 characters"));
    }
    let starts = v.starts_at.or(current.starts_at);
    let ends = v.ends_at.or(current.ends_at);
    if starts.zip(ends).is_some_and(|(a, b)| a >= b) {
        return Err(bad("Sprint end must follow start"));
    }
    if v.carry_over_to.is_some() && v.state.as_deref() != Some("completed") {
        return Err(bad("Carry-over applies when a sprint is completed"));
    }
    if meta_change {
        sqlx::query(
            "UPDATE sprints SET name=COALESCE($1,name), goal=COALESCE($2,goal), starts_at=COALESCE($3,starts_at), ends_at=COALESCE($4,ends_at) WHERE tenant_id=$5 AND id=$6",
        )
        .bind(v.name.as_ref().map(|n| n.trim().to_string()))
        .bind(v.goal.clone())
        .bind(v.starts_at)
        .bind(v.ends_at)
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    match v.state.as_deref() {
        None => {}
        Some("active") => {
            if current.state != "planned" {
                return Err(err(StatusCode::CONFLICT, "Only a planned sprint can start"));
            }
            let t = sprint_totals(&mut tx, i.tenant_id, id).await?;
            sqlx::query(
                "UPDATE sprints SET state='active', started_scope_count=$1, started_scope_points=$2 WHERE tenant_id=$3 AND id=$4 AND state='planned'",
            )
            .bind(t.scope_count)
            .bind(t.scope_points)
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                if let sqlx::Error::Database(ref d) = e {
                    if d.code().as_deref() == Some("23505") {
                        return err(StatusCode::CONFLICT, "Another sprint is already active for this team or project");
                    }
                }
                db_err(e)
            })?;
            record_snapshot(&mut tx, i.tenant_id, id).await?;
        }
        Some("completed") => {
            if current.state != "active" {
                return Err(err(StatusCode::CONFLICT, "Only an active sprint can complete"));
            }
            // Totals are taken before anything moves, so the closing record describes the sprint as it ended.
            let t = sprint_totals(&mut tx, i.tenant_id, id).await?;
            record_snapshot(&mut tx, i.tenant_id, id).await?;
            let target = carry_over_target(&mut tx, &i, &current, v.carry_over_to.as_deref()).await?;
            let done = done_predicate("issues");
            let carried = sqlx::query(&format!(
                "UPDATE issues SET sprint_id=$1, updated_at=now() WHERE tenant_id=$2 AND sprint_id=$3 AND archived_at IS NULL AND NOT {done}"
            ))
            .bind(target)
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?
            .rows_affected() as i32;
            sqlx::query(
                "UPDATE sprints SET state='completed', closed_at=now(), final_scope_count=$1, final_scope_points=$2, \
                 final_done_count=$3, final_done_points=$4, carried_over_count=$5 WHERE tenant_id=$6 AND id=$7 AND state='active'",
            )
            .bind(t.scope_count)
            .bind(t.scope_points)
            .bind(t.done_count)
            .bind(t.done_points)
            .bind(carried)
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
            log_event(&mut tx, &i, "completed", "sprint", id).await?;
        }
        Some(_) => return Err(bad("Sprint state must be active or completed")),
    }
    if v.state.is_none() {
        log_event(&mut tx, &i, "updated", "sprint", id).await?;
    }
    Ok(Json(load_sprint(&mut tx, i.tenant_id, id).await?))
}

/// Where unfinished work goes when a sprint closes. `None` means the backlog.
async fn carry_over_target(
    db: &mut PgConnection,
    i: &Identity,
    sprint: &Sprint,
    to: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    match to {
        None | Some("backlog") => Ok(None),
        Some(raw) => {
            let target: Uuid = raw
                .parse()
                .map_err(|_| bad("carry_over_to must be backlog or a sprint id"))?;
            if target == sprint.id {
                return Err(bad("Carry-over must go to a different sprint"));
            }
            let row: Option<(Uuid, Option<Uuid>, String)> = sqlx::query_as(
                "SELECT project_id, team_id, state FROM sprints WHERE tenant_id=$1 AND id=$2",
            )
            .bind(i.tenant_id)
            .bind(target)
            .fetch_optional(&mut *db)
            .await
            .map_err(db_err)?;
            match row {
                Some((project, team, state))
                    if project == sprint.project_id
                        && team == sprint.team_id
                        && (state == "planned" || state == "active") =>
                {
                    Ok(Some(target))
                }
                _ => Err(bad("Carry-over sprint must be planned or active, in this project, for the same team")),
            }
        }
    }
}

/// Points and counts for velocity, per completed sprint.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct VelocitySprint {
    pub(crate) sprint_id: Uuid,
    pub(crate) name: String,
    pub(crate) team_id: Option<Uuid>,
    pub(crate) closed_at: Option<DateTime<Utc>>,
    pub(crate) started_scope_points: Option<i32>,
    pub(crate) final_scope_points: Option<i32>,
    pub(crate) final_done_points: Option<i32>,
    pub(crate) carried_over_count: Option<i32>,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct VelocityQuery {
    /// Only sprints of this team. Omit for every sprint in the project.
    pub(crate) team_id: Option<Uuid>,
    /// How many of the most recent completed sprints to average (1 to 20, default 5).
    pub(crate) sprints: Option<i64>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct Velocity {
    pub(crate) team_id: Option<Uuid>,
    pub(crate) window: i64,
    /// Mean completed points over the sprints listed. 0 when none are closed yet.
    pub(crate) average_done_points: f64,
    /// Mean committed points at start over the sprints listed.
    pub(crate) average_started_points: f64,
    pub(crate) sprints: Vec<VelocitySprint>,
}

#[utoipa::path(get, path = "/api/projects/{id}/velocity", tag = "agile", params(("id" = Uuid, Path, description = "Resource id"), VelocityQuery), responses((status = 200, description = "Success", body = Velocity), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn velocity(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<VelocityQuery>,
) -> ApiResult<Json<Velocity>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, project).await?;
    let window = q.sprints.unwrap_or(5);
    if !(1..=20).contains(&window) {
        return Err(bad("sprints must be between 1 and 20"));
    }
    let sprints: Vec<VelocitySprint> = sqlx::query_as(
        "SELECT id AS sprint_id, name, team_id, closed_at, started_scope_points, final_scope_points, final_done_points, carried_over_count \
         FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND state='completed' AND final_done_points IS NOT NULL \
         AND ($3::uuid IS NULL OR team_id=$3) ORDER BY closed_at DESC NULLS LAST LIMIT $4",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(q.team_id)
    .bind(window)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let n = sprints.len() as f64;
    let average_done_points = if sprints.is_empty() {
        0.0
    } else {
        sprints.iter().map(|s| f64::from(s.final_done_points.unwrap_or(0))).sum::<f64>() / n
    };
    let average_started_points = if sprints.is_empty() {
        0.0
    } else {
        sprints.iter().map(|s| f64::from(s.started_scope_points.unwrap_or(0))).sum::<f64>() / n
    };
    Ok(Json(Velocity {
        team_id: q.team_id,
        window,
        average_done_points,
        average_started_points,
        sprints,
    }))
}

/// One day of a sprint's burndown.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct SprintSnapshot {
    /// Calendar day in UTC, `YYYY-MM-DD`.
    pub(crate) day: String,
    pub(crate) scope_count: i32,
    pub(crate) done_count: i32,
    pub(crate) scope_points: i32,
    pub(crate) done_points: i32,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct Burndown {
    pub(crate) sprint_id: Uuid,
    pub(crate) state: String,
    /// Stored days, oldest first. Days before the first capture are not shown.
    pub(crate) snapshots: Vec<SprintSnapshot>,
    /// The sprint's totals right now, read live. Not stored until the next capture.
    pub(crate) current: SprintTotals,
    /// The UTC day that `current` belongs to.
    pub(crate) today: String,
}

#[utoipa::path(get, path = "/api/sprints/{id}/burndown", tag = "agile", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Burndown), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn burndown(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Burndown>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "sprints", id).await?;
    let sprint = load_sprint(&mut tx, i.tenant_id, id).await?;
    let snapshots: Vec<SprintSnapshot> = sqlx::query_as(
        "SELECT to_char(day,'YYYY-MM-DD') AS day, scope_count, done_count, scope_points, done_points \
         FROM sprint_daily_snapshots WHERE tenant_id=$1 AND sprint_id=$2 ORDER BY day",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let current = sprint_totals(&mut tx, i.tenant_id, id).await?;
    Ok(Json(Burndown {
        sprint_id: id,
        state: sprint.state,
        snapshots,
        current,
        today: Utc::now().format("%Y-%m-%d").to_string(),
    }))
}

/// Query for `GET /api/projects/{id}/board`. Quick filters narrow the issues before they are grouped.
#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct BoardQuery {
    /// `none` (one lane), `assignee` or `epic`. Defaults to `none`.
    pub(crate) group_by: Option<String>,
    /// Only issues owned by this team.
    pub(crate) team_id: Option<Uuid>,
    /// Only issues assigned to this user.
    pub(crate) assignee_id: Option<Uuid>,
    /// Only issues with no assignee.
    pub(crate) unassigned: Option<bool>,
    /// Only issues with this priority: `low`, `medium`, `high` or `urgent`.
    pub(crate) priority: Option<String>,
    /// Case-insensitive title search, up to 200 characters.
    pub(crate) q: Option<String>,
}

/// One issue as a board card shows it.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct BoardIssue {
    pub(crate) id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) assignee_id: Option<Uuid>,
    pub(crate) parent_id: Option<Uuid>,
    pub(crate) updated_at: DateTime<Utc>,
}

/// A swimlane. Its issues keep the ranking order; the client places them in status columns.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct BoardLane {
    /// Stable key: `all`, a user id, `unassigned`, an epic id or `no-epic`.
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) issues: Vec<BoardIssue>,
}

/// Swimlanes for the board. At most 2,000 issues are returned; `truncated` says when more matched.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct BoardView {
    pub(crate) group_by: String,
    pub(crate) truncated: bool,
    pub(crate) lanes: Vec<BoardLane>,
}

const BOARD_LIMIT: usize = 2000;

#[utoipa::path(get, path = "/api/projects/{id}/board", tag = "agile", params(("id" = Uuid, Path, description = "Resource id"), BoardQuery), responses((status = 200, description = "Board lanes. Archived and trashed issues are never included", body = BoardView), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn board(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<BoardQuery>,
) -> ApiResult<Json<BoardView>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let group_by = q.group_by.clone().unwrap_or_else(|| "none".to_string());
    if !matches!(group_by.as_str(), "none" | "assignee" | "epic") {
        return Err(bad("group_by must be none, assignee or epic"));
    }
    if let Some(p) = q.priority.as_deref() {
        if !matches!(p, "low" | "medium" | "high" | "urgent") {
            return Err(bad("priority must be low, medium, high or urgent"));
        }
    }
    let search = match q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(s) if s.chars().count() > 200 => return Err(bad("Search text is limited to 200 characters")),
        Some(s) => Some(format!(
            "%{}%",
            s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        )),
    };
    let rows: Vec<BoardIssue> = sqlx::query_as(
        "SELECT i.id,i.number,i.title,i.kind,i.status,i.priority,i.assignee_id,i.parent_id,i.updated_at \
         FROM issues i WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL AND i.trashed_at IS NULL \
         AND ($3::uuid IS NULL OR i.team_id=$3) AND ($4::uuid IS NULL OR i.assignee_id=$4) \
         AND (NOT $5 OR i.assignee_id IS NULL) AND ($6::text IS NULL OR i.priority=$6) \
         AND ($7::text IS NULL OR i.title ILIKE $7 ESCAPE '\\') \
         ORDER BY i.backlog_rank NULLS LAST, i.number LIMIT $8",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(q.team_id)
    .bind(q.assignee_id)
    .bind(q.unassigned.unwrap_or(false))
    .bind(q.priority.as_deref())
    .bind(search)
    .bind(BOARD_LIMIT as i64 + 1)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let truncated = rows.len() > BOARD_LIMIT;
    let rows: Vec<BoardIssue> = rows.into_iter().take(BOARD_LIMIT).collect();

    // Work out each issue's lane key first, then fetch labels only for the keys that appear.
    let key_of = |r: &BoardIssue| -> String {
        match group_by.as_str() {
            "assignee" => r.assignee_id.map_or("unassigned".to_string(), |u| u.to_string()),
            "epic" => r.parent_id.map_or("no-epic".to_string(), |u| u.to_string()),
            _ => "all".to_string(),
        }
    };
    let mut labels: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    match group_by.as_str() {
        "assignee" => {
            let ids: Vec<Uuid> = rows.iter().filter_map(|r| r.assignee_id).collect();
            let names: Vec<(Uuid, String)> = sqlx::query_as(
                "SELECT u.id, u.display_name FROM users u \
                 JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$1 WHERE u.id = ANY($2)",
            )
            .bind(i.tenant_id)
            .bind(&ids)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_err)?;
            labels.extend(names.into_iter().map(|(id, name)| (id.to_string(), name)));
        }
        "epic" => {
            let ids: Vec<Uuid> = rows.iter().filter_map(|r| r.parent_id).collect();
            let titles: Vec<(Uuid, String)> = sqlx::query_as(
                "SELECT id, title FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id = ANY($3)",
            )
            .bind(i.tenant_id)
            .bind(project)
            .bind(&ids)
            .fetch_all(&mut *tx)
            .await
            .map_err(db_err)?;
            labels.extend(titles.into_iter().map(|(id, title)| (id.to_string(), title)));
        }
        _ => {}
    }
    let mut lanes: Vec<(bool, String, BoardLane)> = Vec::new();
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for r in rows {
        let key = key_of(&r);
        let slot = match index.get(&key) {
            Some(s) => *s,
            None => {
                let (fallback, last) = match key.as_str() {
                    "unassigned" => ("Unassigned".to_string(), true),
                    "no-epic" => ("No epic".to_string(), true),
                    "all" => ("All issues".to_string(), false),
                    _ => (key.clone(), false),
                };
                let label = labels.get(&key).cloned().unwrap_or(fallback);
                lanes.push((last, label.to_lowercase(), BoardLane { key: key.clone(), label, issues: Vec::new() }));
                index.insert(key.clone(), lanes.len() - 1);
                lanes.len() - 1
            }
        };
        lanes[slot].2.issues.push(r);
    }
    lanes.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    Ok(Json(BoardView {
        group_by,
        truncated,
        lanes: lanes.into_iter().map(|(_, _, lane)| lane).collect(),
    }))
}

pub(crate) fn routes() -> axum::Router<App> {
    use axum::routing::get;
    axum::Router::new()
        .route("/api/projects/{id}/backlog", get(backlog))
        .route("/api/projects/{id}/board", get(board))
        .route("/api/issues/{id}/rank", post(rank_issue))
        .route("/api/issues/{id}/team", put(set_issue_team))
        .route("/api/sprints/{id}", get(sprint_detail).patch(update_sprint))
        .route("/api/sprints/{id}/issues", post(add_issues_to_sprint))
        .route("/api/sprints/{id}/issues/{issue_id}", delete(remove_issue_from_sprint))
        .route("/api/sprints/{id}/burndown", get(burndown))
        .route("/api/projects/{id}/velocity", get(velocity))
}
