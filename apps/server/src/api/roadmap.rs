//! Roadmaps, portfolio and capacity: milestones and the project timeline, initiatives above
//! epics, project updates with health, goal progress from linked work, member capacity, dependencies
//! and the critical path, and baselines with variance.
//!
//! Visibility: initiative and capacity figures count only work in projects the caller can open.
use crate::api::agile::done_predicate;
use crate::api::common::*;
use crate::*;
use axum::routing::{get, put};
use chrono::NaiveDate;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

fn day(raw: &str) -> ApiResult<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| bad("Dates must be YYYY-MM-DD"))
}

// ---------------------------------------------------------------------------------------------
// H1. Milestones and the project timeline
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Milestone {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) name: String,
    /// `YYYY-MM-DD`.
    pub(crate) target_on: String,
    pub(crate) reached_on: Option<String>,
    pub(crate) created_at: DateTime<Utc>,
}

const MILESTONE_SELECT: &str =
    "SELECT id, project_id, name, to_char(target_on,'YYYY-MM-DD') AS target_on, \
 to_char(reached_on,'YYYY-MM-DD') AS reached_on, created_at FROM milestones";

#[utoipa::path(get, path = "/api/projects/{id}/milestones", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Milestone>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_milestones(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Milestone>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let rows: Vec<Milestone> = sqlx::query_as(&format!(
        "{MILESTONE_SELECT} WHERE tenant_id=$1 AND project_id=$2 ORDER BY target_on"
    ))
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct MilestoneInput {
    pub(crate) name: String,
    /// `YYYY-MM-DD`.
    pub(crate) target_on: String,
}

#[utoipa::path(post, path = "/api/projects/{id}/milestones", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = MilestoneInput, responses((status = 201, description = "Success", body = Milestone), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_milestone(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<MilestoneInput>,
) -> ApiResult<(StatusCode, Json<Milestone>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_project(&mut tx, &i, p).await?;
    validate_title(&v.name)?;
    let target = day(&v.target_on)?;
    let id: Uuid = sqlx::query_scalar("INSERT INTO milestones(tenant_id,project_id,name,target_on) VALUES($1,$2,$3,$4) RETURNING id")
        .bind(i.tenant_id)
        .bind(p)
        .bind(v.name.trim())
        .bind(target)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let row: Milestone =
        sqlx::query_as(&format!("{MILESTONE_SELECT} WHERE tenant_id=$1 AND id=$2"))
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct MilestonePatch {
    pub(crate) name: Option<String>,
    pub(crate) target_on: Option<String>,
    /// `true` marks the milestone reached today; `false` clears it.
    pub(crate) reached: Option<bool>,
}

#[utoipa::path(patch, path = "/api/milestones/{id}", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = MilestonePatch, responses((status = 200, description = "Success", body = Milestone), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_milestone(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<MilestonePatch>,
) -> ApiResult<Json<Milestone>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "milestones", id).await?;
    require_editor(&i)?;
    if let Some(n) = &v.name {
        validate_title(n)?;
    }
    let target = v.target_on.as_deref().map(day).transpose()?;
    let reached: Option<Option<NaiveDate>> = v.reached.map(|r| r.then(|| Utc::now().date_naive()));
    sqlx::query(
        "UPDATE milestones SET name=COALESCE($1,name), target_on=COALESCE($2,target_on), \
         reached_on=CASE WHEN $3 THEN $4 ELSE reached_on END WHERE tenant_id=$5 AND id=$6",
    )
    .bind(v.name.map(|n| n.trim().to_string()))
    .bind(target)
    .bind(reached.is_some())
    .bind(reached.flatten())
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: Milestone =
        sqlx::query_as(&format!("{MILESTONE_SELECT} WHERE tenant_id=$1 AND id=$2"))
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/milestones/{id}", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_milestone(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "milestones", id).await?;
    require_editor(&i)?;
    sqlx::query("DELETE FROM milestones WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

/// One bar or marker on a project timeline. Dates are `YYYY-MM-DD`; `progress` is 0 to 100.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TimelineItem {
    /// `epic`, `release`, `sprint` or `milestone`.
    pub(crate) kind: String,
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) start: Option<String>,
    pub(crate) end: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) progress: Option<i32>,
}

#[utoipa::path(get, path = "/api/projects/{id}/timeline", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Epics, releases, sprints and milestones with dates", body = Vec<TimelineItem>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn timeline(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<TimelineItem>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let done = done_predicate("e");
    let epics: Vec<TimelineItem> = sqlx::query_as(&format!(
        "SELECT 'epic'::text AS kind, e.id, e.title AS name, to_char(e.created_at,'YYYY-MM-DD') AS start, \
         to_char(e.due_at,'YYYY-MM-DD') AS \"end\", e.status, \
         (SELECT CASE WHEN count(*)=0 THEN CASE WHEN {done} THEN 100 ELSE 0 END \
            ELSE (100*count(*) FILTER (WHERE EXISTS (SELECT 1 FROM project_statuses ps2 WHERE ps2.tenant_id=c.tenant_id AND ps2.project_id=c.project_id AND ps2.key=c.status AND ps2.category='done')) / count(*))::int END \
          FROM issues c WHERE c.tenant_id=e.tenant_id AND c.parent_id=e.id AND c.archived_at IS NULL) AS progress \
         FROM issues e WHERE e.tenant_id=$1 AND e.project_id=$2 AND e.kind='epic' AND e.archived_at IS NULL ORDER BY e.created_at"
    ))
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let releases: Vec<TimelineItem> = sqlx::query_as(
        "SELECT 'release'::text AS kind, id, name, to_char(created_at,'YYYY-MM-DD') AS start, to_char(target_at,'YYYY-MM-DD') AS \"end\", \
         status, NULL::int AS progress FROM releases WHERE tenant_id=$1 AND project_id=$2 ORDER BY target_at NULLS LAST",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let sprints: Vec<TimelineItem> = sqlx::query_as(
        "SELECT 'sprint'::text AS kind, id, name, to_char(starts_at,'YYYY-MM-DD') AS start, to_char(ends_at,'YYYY-MM-DD') AS \"end\", \
         state AS status, NULL::int AS progress FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND state<>'completed' ORDER BY starts_at NULLS LAST",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let milestones: Vec<TimelineItem> = sqlx::query_as(
        "SELECT 'milestone'::text AS kind, id, name, NULL::text AS start, to_char(target_on,'YYYY-MM-DD') AS \"end\", \
         CASE WHEN reached_on IS NULL THEN 'open' ELSE 'reached' END AS status, NULL::int AS progress \
         FROM milestones WHERE tenant_id=$1 AND project_id=$2 ORDER BY target_on",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut all = epics;
    all.extend(releases);
    all.extend(sprints);
    all.extend(milestones);
    Ok(Json(all))
}

/// A dependency between two open issues: `from` must finish before `to` can.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Dependency {
    pub(crate) from: Uuid,
    pub(crate) to: Uuid,
}

#[utoipa::path(get, path = "/api/projects/{id}/dependencies", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Blocking links between open issues, normalised so `from` comes first", body = Vec<Dependency>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn dependencies(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Dependency>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    Ok(Json(load_dependencies(&mut tx, i.tenant_id, p).await?))
}

/// Normalised edges of open issues in a project: `blocks` runs source to target, `depends_on` runs target to source.
async fn load_dependencies(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
) -> ApiResult<Vec<Dependency>> {
    let done = done_predicate("a");
    let done_b = done_predicate("b");
    let rows: Vec<Dependency> = sqlx::query_as(&format!(
        "SELECT CASE WHEN l.relation='blocks' THEN l.source_id ELSE l.target_id END AS \"from\", \
                CASE WHEN l.relation='blocks' THEN l.target_id ELSE l.source_id END AS \"to\" \
         FROM issue_links l JOIN issues a ON a.tenant_id=l.tenant_id AND a.id=l.source_id \
         JOIN issues b ON b.tenant_id=l.tenant_id AND b.id=l.target_id \
         WHERE l.tenant_id=$1 AND l.relation IN ('blocks','depends_on') AND a.project_id=$2 AND b.project_id=$2 \
           AND a.archived_at IS NULL AND b.archived_at IS NULL AND NOT {done} AND NOT {done_b}"
    ))
    .bind(tenant)
    .bind(project)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(rows)
}

// ---------------------------------------------------------------------------------------------
// H5. Critical path
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct PathItem {
    pub(crate) issue_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    /// Remaining estimate, or 60 minutes when none is set.
    pub(crate) minutes: i64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CriticalPath {
    /// The longest chain of dependent open work, in order.
    pub(crate) path: Vec<PathItem>,
    pub(crate) total_minutes: i64,
    /// True when the dependencies form a loop. No path is reported then.
    pub(crate) has_cycle: bool,
}

#[utoipa::path(get, path = "/api/projects/{id}/critical-path", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Longest chain of dependent open issues", body = CriticalPath), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn critical_path(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<CriticalPath>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let edges = load_dependencies(&mut tx, i.tenant_id, p).await?;
    let nodes: Vec<(Uuid, i64, String, Option<i32>)> = sqlx::query_as(
        "SELECT i.id, i.number, i.title, i.remaining_estimate_minutes FROM issues i WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    // Only open issues take part: done work is filtered out by the dependency query above.
    let mut info: HashMap<Uuid, (i64, String, i64)> = HashMap::new();
    for (id, number, title, remaining) in nodes {
        info.insert(id, (number, title, i64::from(remaining.unwrap_or(60))));
    }
    let mut indegree: HashMap<Uuid, usize> = HashMap::new();
    let mut out: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for e in &edges {
        *indegree.entry(e.to).or_insert(0) += 1;
        indegree.entry(e.from).or_insert(0);
        out.entry(e.from).or_default().push(e.to);
    }
    // Kahn's algorithm, which also detects cycles.
    let mut queue: VecDeque<Uuid> = indegree
        .iter()
        .filter(|(_, d)| **d == 0)
        .map(|(n, _)| *n)
        .collect();
    let mut order: Vec<Uuid> = Vec::new();
    let mut remaining_in = indegree.clone();
    while let Some(n) = queue.pop_front() {
        order.push(n);
        for m in out.get(&n).cloned().unwrap_or_default() {
            if let Some(d) = remaining_in.get_mut(&m) {
                *d -= 1;
                if *d == 0 {
                    queue.push_back(m);
                }
            }
        }
    }
    if order.len() != indegree.len() {
        return Ok(Json(CriticalPath {
            path: Vec::new(),
            total_minutes: 0,
            has_cycle: true,
        }));
    }
    // Longest weighted path ending at each node, with the predecessor that gives it.
    let mut best: HashMap<Uuid, (i64, Option<Uuid>)> = HashMap::new();
    for n in &order {
        let weight = info.get(n).map(|x| x.2).unwrap_or(60);
        let entry = best.entry(*n).or_insert((weight, None));
        let here = entry.0;
        for m in out.get(n).cloned().unwrap_or_default() {
            let w = info.get(&m).map(|x| x.2).unwrap_or(60);
            let candidate = here + w;
            let slot = best.entry(m).or_insert((w, None));
            if candidate > slot.0 {
                *slot = (candidate, Some(*n));
            }
        }
    }
    let Some((&end, &(total, _))) = best.iter().max_by_key(|(_, (t, _))| *t) else {
        return Ok(Json(CriticalPath {
            path: Vec::new(),
            total_minutes: 0,
            has_cycle: false,
        }));
    };
    let mut chain = vec![end];
    let mut cursor = end;
    while let Some((_, Some(prev))) = best.get(&cursor).copied() {
        chain.push(prev);
        cursor = prev;
    }
    chain.reverse();
    let path = chain
        .into_iter()
        .filter_map(|id| {
            info.get(&id).map(|(number, title, minutes)| PathItem {
                issue_id: id,
                number: *number,
                title: title.clone(),
                minutes: *minutes,
            })
        })
        .collect();
    Ok(Json(CriticalPath {
        path,
        total_minutes: total,
        has_cycle: false,
    }))
}

// ---------------------------------------------------------------------------------------------
// H2. Initiatives above epics (tenant-level, visible through the projects each epic lives in)
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Initiative {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) status: String,
    pub(crate) target_on: Option<String>,
    pub(crate) owner_id: Option<Uuid>,
    /// Epics linked to the initiative that the caller can open.
    pub(crate) epics: i64,
    /// Of those, epics in a done status.
    pub(crate) epics_done: i64,
    pub(crate) created_at: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/initiatives", tag = "roadmap", responses((status = 200, description = "Initiatives with epic progress", body = Vec<Initiative>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_initiatives(mut tx: Tx) -> ApiResult<Json<Vec<Initiative>>> {
    let i = tx.identity.clone();
    let done = done_predicate("e");
    let rows: Vec<Initiative> = sqlx::query_as(&format!(
        "SELECT n.id, n.name, n.description, n.status, to_char(n.target_on,'YYYY-MM-DD') AS target_on, n.owner_id, \
         count(e.id) AS epics, count(e.id) FILTER (WHERE {done}) AS epics_done, n.created_at \
         FROM initiatives n LEFT JOIN initiative_epics x ON x.tenant_id=n.tenant_id AND x.initiative_id=n.id \
         LEFT JOIN issues e ON e.tenant_id=x.tenant_id AND e.id=x.issue_id AND e.archived_at IS NULL \
           AND project_access(e.project_id, $2, $3) >= 1 \
         WHERE n.tenant_id=$1 GROUP BY n.id ORDER BY n.created_at"
    ))
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(&i.role)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct InitiativeInput {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) target_on: Option<String>,
    pub(crate) owner_id: Option<Uuid>,
}

#[utoipa::path(post, path = "/api/initiatives", tag = "roadmap", request_body = InitiativeInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_initiative(
    mut tx: Tx,
    Json(v): Json<InitiativeInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    validate_title(&v.name)?;
    if v.description.as_ref().is_some_and(|d| d.len() > 5000) {
        return Err(bad("Description is limited to 5000 characters"));
    }
    let target = v.target_on.as_deref().map(day).transpose()?;
    let row: Value = sqlx::query_scalar(
        "INSERT INTO initiatives(tenant_id,name,description,target_on,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING to_jsonb(initiatives)",
    )
    .bind(i.tenant_id)
    .bind(v.name.trim())
    .bind(v.description.unwrap_or_default())
    .bind(target)
    .bind(v.owner_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct InitiativePatch {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    /// `active`, `paused` or `done`.
    pub(crate) status: Option<String>,
    pub(crate) target_on: Option<String>,
}

#[utoipa::path(patch, path = "/api/initiatives/{id}", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = InitiativePatch, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_initiative(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<InitiativePatch>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    if let Some(n) = &v.name {
        validate_title(n)?;
    }
    if v.status
        .as_deref()
        .is_some_and(|s| !["active", "paused", "done"].contains(&s))
    {
        return Err(bad("Status must be active, paused or done"));
    }
    let target = v.target_on.as_deref().map(day).transpose()?;
    let row: Option<Value> = sqlx::query_scalar(
        "UPDATE initiatives SET name=COALESCE($1,name), description=COALESCE($2,description), status=COALESCE($3,status), \
         target_on=COALESCE($4,target_on) WHERE tenant_id=$5 AND id=$6 RETURNING to_jsonb(initiatives)",
    )
    .bind(v.name.map(|n| n.trim().to_string()))
    .bind(v.description)
    .bind(v.status)
    .bind(target)
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(row.ok_or_else(|| {
        err(StatusCode::NOT_FOUND, "Initiative not found")
    })?))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct InitiativeEpicsInput {
    /// Epics to link. Each must be an active epic in a project the caller can edit.
    pub(crate) issue_ids: Vec<Uuid>,
}

#[utoipa::path(put, path = "/api/initiatives/{id}/epics", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = InitiativeEpicsInput, responses((status = 200, description = "Linked; per-item refusals are reported in the error field of each item", body = crate::api::agile::MembershipResult), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn link_initiative_epics(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<InitiativeEpicsInput>,
) -> ApiResult<Json<crate::api::agile::MembershipResult>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM initiatives WHERE tenant_id=$1 AND id=$2)")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Initiative not found"));
    }
    if v.issue_ids.is_empty() || v.issue_ids.len() > 100 {
        return Err(bad("Choose between 1 and 100 epics"));
    }
    let mut results = Vec::new();
    let mut changed = 0_i64;
    for issue in v.issue_ids {
        let row: Option<(Uuid, String, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT project_id, kind, archived_at FROM issues WHERE tenant_id=$1 AND id=$2",
        )
        .bind(i.tenant_id)
        .bind(issue)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .map(|(p, k, a)| (p, k, a));
        let reason = match row {
            None => Some("Issue not found".to_string()),
            Some((_, _, Some(_))) => Some("Issue is archived".into()),
            Some((_, kind, _)) if kind != "epic" => {
                Some("Only epics can join an initiative".into())
            }
            Some((project, _, _)) => {
                let level: Option<i32> = sqlx::query_scalar("SELECT project_access($1,$2,$3)")
                    .bind(project)
                    .bind(i.user_id)
                    .bind(&i.role)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db_err)?;
                if level.unwrap_or(0) < 2 {
                    Some("No edit access to this epic's project".into())
                } else {
                    None
                }
            }
        };
        match reason {
            Some(reason) => results.push(crate::api::issues::BulkItemResult {
                id: issue,
                ok: false,
                error: Some(reason),
            }),
            None => {
                sqlx::query(
                    "INSERT INTO initiative_epics(tenant_id,initiative_id,issue_id) VALUES($1,$2,$3) \
                     ON CONFLICT (tenant_id, issue_id) DO UPDATE SET initiative_id=EXCLUDED.initiative_id",
                )
                .bind(i.tenant_id)
                .bind(id)
                .bind(issue)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
                changed += 1;
                results.push(crate::api::issues::BulkItemResult {
                    id: issue,
                    ok: true,
                    error: None,
                });
            }
        }
    }
    Ok(Json(crate::api::agile::MembershipResult {
        changed,
        results,
    }))
}

// ---------------------------------------------------------------------------------------------
// H3. Project updates and goal progress
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ProjectUpdate {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) author_id: Uuid,
    pub(crate) author_name: String,
    /// `on_track`, `at_risk` or `off_track`.
    pub(crate) health: String,
    pub(crate) body: String,
    pub(crate) created_at: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/projects/{id}/updates", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Newest first", body = Vec<ProjectUpdate>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_updates(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<ProjectUpdate>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let rows: Vec<ProjectUpdate> = sqlx::query_as(
        "SELECT pu.id, pu.project_id, pu.author_id, u.display_name AS author_name, pu.health, pu.body, pu.created_at \
         FROM project_updates pu JOIN users u ON u.id=pu.author_id WHERE pu.tenant_id=$1 AND pu.project_id=$2 ORDER BY pu.created_at DESC LIMIT 100",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ProjectUpdateInput {
    pub(crate) health: String,
    pub(crate) body: String,
}

#[utoipa::path(post, path = "/api/projects/{id}/updates", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = ProjectUpdateInput, responses((status = 201, description = "Success", body = ProjectUpdate), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn post_update(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<ProjectUpdateInput>,
) -> ApiResult<(StatusCode, Json<ProjectUpdate>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_project(&mut tx, &i, p).await?;
    if !["on_track", "at_risk", "off_track"].contains(&v.health.as_str()) {
        return Err(bad("Health must be on_track, at_risk or off_track"));
    }
    validate_body(&v.body)?;
    if v.body.len() > 5000 {
        return Err(bad("Update is limited to 5000 characters"));
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO project_updates(tenant_id,project_id,author_id,health,body) VALUES($1,$2,$3,$4,$5) RETURNING id",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(i.user_id)
    .bind(v.health)
    .bind(v.body.trim())
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: ProjectUpdate = sqlx::query_as(
        "SELECT pu.id, pu.project_id, pu.author_id, u.display_name AS author_name, pu.health, pu.body, pu.created_at \
         FROM project_updates pu JOIN users u ON u.id=pu.author_id WHERE pu.tenant_id=$1 AND pu.id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// Progress of a goal: its linked issues, and how many are done.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct GoalProgress {
    pub(crate) goal_id: Uuid,
    pub(crate) linked: i64,
    pub(crate) done: i64,
    /// Percent of linked issues done. `null` when nothing is linked; the stored goal progress applies then.
    pub(crate) progress: Option<i32>,
}

#[utoipa::path(get, path = "/api/goals/{id}/progress", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = GoalProgress), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn goal_progress(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<GoalProgress>> {
    let i = tx.identity.clone();
    let project: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM goals WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .flatten();
    match project {
        Some(p) => ensure_access(&mut tx, p).await?,
        None => return Err(err(StatusCode::NOT_FOUND, "Goal not found")),
    }
    let done = done_predicate("i");
    let (linked, finished): (i64, i64) = sqlx::query_as(&format!(
        "SELECT count(*), count(*) FILTER (WHERE {done}) FROM goal_issues g JOIN issues i ON i.tenant_id=g.tenant_id AND i.id=g.issue_id \
         WHERE g.tenant_id=$1 AND g.goal_id=$2 AND i.archived_at IS NULL"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let progress = if linked == 0 {
        None
    } else {
        Some(((finished * 100) / linked) as i32)
    };
    Ok(Json(GoalProgress {
        goal_id: id,
        linked,
        done: finished,
        progress,
    }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct GoalIssuesInput {
    pub(crate) issue_ids: Vec<Uuid>,
}

#[utoipa::path(put, path = "/api/goals/{id}/issues", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = GoalIssuesInput, responses((status = 200, description = "Linked issues replaced; returns progress", body = GoalProgress), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_goal_issues(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<GoalIssuesInput>,
) -> ApiResult<Json<GoalProgress>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM goals WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .flatten();
    let Some(project) = project else {
        return Err(err(StatusCode::NOT_FOUND, "Goal not found"));
    };
    ensure_access(&mut tx, project).await?;
    let mut ids: Vec<Uuid> = Vec::new();
    for x in v.issue_ids {
        if !ids.contains(&x) {
            ids.push(x);
        }
    }
    if ids.len() > 200 {
        return Err(bad("A goal can link at most 200 issues"));
    }
    if !ids.is_empty() {
        let found: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id = ANY($3)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(&ids)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if found as usize != ids.len() {
            return Err(bad("Every linked issue must be in the goal's project"));
        }
    }
    sqlx::query("DELETE FROM goal_issues WHERE tenant_id=$1 AND goal_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    for issue in &ids {
        sqlx::query("INSERT INTO goal_issues(tenant_id,goal_id,issue_id) VALUES($1,$2,$3)")
            .bind(i.tenant_id)
            .bind(id)
            .bind(issue)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    let done = done_predicate("i");
    let (linked, finished): (i64, i64) = sqlx::query_as(&format!(
        "SELECT count(*), count(*) FILTER (WHERE {done}) FROM goal_issues g JOIN issues i ON i.tenant_id=g.tenant_id AND i.id=g.issue_id \
         WHERE g.tenant_id=$1 AND g.goal_id=$2 AND i.archived_at IS NULL"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let progress = if linked == 0 {
        None
    } else {
        Some(((finished * 100) / linked) as i32)
    };
    Ok(Json(GoalProgress {
        goal_id: id,
        linked,
        done: finished,
        progress,
    }))
}

// ---------------------------------------------------------------------------------------------
// H4. Capacity
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct CapacityRow {
    pub(crate) user_id: Uuid,
    pub(crate) name: String,
    /// Hours a week the member can give to project work. `null` when not set.
    pub(crate) hours_per_week: Option<f64>,
    /// Open issues assigned to the member that the caller can open.
    pub(crate) open_issues: i64,
    /// Remaining estimates of those issues, in hours.
    pub(crate) remaining_hours: f64,
    /// Remaining hours as a percent of weekly capacity. `null` without a capacity.
    pub(crate) utilisation_pct: Option<f64>,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct CapacityQuery {
    /// Only work in this project.
    pub(crate) project_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/capacity", tag = "roadmap", params(CapacityQuery), responses((status = 200, description = "Capacity against remaining estimates for every active member", body = Vec<CapacityRow>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn capacity(
    mut tx: Tx,
    axum::extract::Query(q): axum::extract::Query<CapacityQuery>,
) -> ApiResult<Json<Vec<CapacityRow>>> {
    let i = tx.identity.clone();
    if let Some(p) = q.project_id {
        ensure_access(&mut tx, p).await?;
    }
    let rows: Vec<CapacityRow> = sqlx::query_as(
        "SELECT m.user_id, u.display_name AS name, c.hours_per_week::float8 AS hours_per_week, \
         COALESCE(w.open_issues,0)::bigint AS open_issues, (COALESCE(w.remaining_minutes,0)/60.0)::float8 AS remaining_hours, \
         CASE WHEN c.hours_per_week IS NULL OR c.hours_per_week=0 THEN NULL \
              ELSE (100*(COALESCE(w.remaining_minutes,0)/60.0)/c.hours_per_week)::float8 END AS utilisation_pct \
         FROM memberships m JOIN users u ON u.id=m.user_id \
         LEFT JOIN member_capacity c ON c.tenant_id=m.tenant_id AND c.user_id=m.user_id \
         LEFT JOIN LATERAL (SELECT count(*) AS open_issues, sum(i.remaining_estimate_minutes) AS remaining_minutes FROM issues i \
           WHERE i.tenant_id=m.tenant_id AND i.assignee_id=m.user_id AND i.archived_at IS NULL \
           AND ($2::uuid IS NULL OR i.project_id=$2) AND project_access(i.project_id, $3, $4) >= 1 \
           AND NOT EXISTS (SELECT 1 FROM project_statuses ps WHERE ps.tenant_id=i.tenant_id AND ps.project_id=i.project_id AND ps.key=i.status AND ps.category='done')) w ON true \
         WHERE m.tenant_id=$1 AND m.disabled_at IS NULL ORDER BY u.display_name",
    )
    .bind(i.tenant_id)
    .bind(q.project_id)
    .bind(i.user_id)
    .bind(&i.role)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CapacityInput {
    pub(crate) hours_per_week: f64,
}

#[utoipa::path(put, path = "/api/members/{user_id}/capacity", tag = "roadmap", params(("user_id" = Uuid, Path, description = "Member id")), request_body = CapacityInput, responses((status = 204, description = "Saved"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_capacity(
    mut tx: Tx,
    Path(user): Path<Uuid>,
    Json(v): Json<CapacityInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    if !(0.0..=168.0).contains(&v.hours_per_week) || !v.hours_per_week.is_finite() {
        return Err(bad("hours_per_week must be between 0 and 168"));
    }
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2)",
    )
    .bind(i.tenant_id)
    .bind(user)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if !member {
        return Err(err(StatusCode::NOT_FOUND, "Member not found"));
    }
    sqlx::query(
        "INSERT INTO member_capacity(tenant_id,user_id,hours_per_week) VALUES($1,$2,$3) \
         ON CONFLICT (tenant_id,user_id) DO UPDATE SET hours_per_week=EXCLUDED.hours_per_week, updated_at=now()",
    )
    .bind(i.tenant_id)
    .bind(user)
    .bind(v.hours_per_week)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// H6. Baselines
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Baseline {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) name: String,
    pub(crate) items: i64,
    pub(crate) created_at: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/projects/{id}/baselines", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Baseline>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_baselines(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Baseline>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let rows: Vec<Baseline> = sqlx::query_as(
        "SELECT b.id, b.project_id, b.name, (SELECT count(*) FROM baseline_items x WHERE x.tenant_id=b.tenant_id AND x.baseline_id=b.id) AS items, b.created_at \
         FROM baselines b WHERE b.tenant_id=$1 AND b.project_id=$2 ORDER BY b.created_at DESC",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct BaselineInput {
    pub(crate) name: String,
}

#[utoipa::path(post, path = "/api/projects/{id}/baselines", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = BaselineInput, responses((status = 201, description = "Snapshot of every open issue's due date", body = Baseline), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_baseline(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<BaselineInput>,
) -> ApiResult<(StatusCode, Json<Baseline>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_project(&mut tx, &i, p).await?;
    validate_title(&v.name)?;
    let done = done_predicate("i");
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO baselines(tenant_id,project_id,name) VALUES($1,$2,$3) RETURNING id",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(v.name.trim())
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query(&format!(
        "INSERT INTO baseline_items(tenant_id,baseline_id,issue_id,due_at) \
         SELECT i.tenant_id, $2, i.id, i.due_at FROM issues i WHERE i.tenant_id=$1 AND i.project_id=$3 AND i.archived_at IS NULL AND NOT {done}"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .bind(p)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: Baseline = sqlx::query_as(
        "SELECT b.id, b.project_id, b.name, (SELECT count(*) FROM baseline_items x WHERE x.tenant_id=b.tenant_id AND x.baseline_id=b.id) AS items, b.created_at \
         FROM baselines b WHERE b.tenant_id=$1 AND b.id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// One issue compared with its baseline due date. Positive variance means later than planned.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Variance {
    pub(crate) issue_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) baseline_due: Option<String>,
    pub(crate) current_due: Option<String>,
    pub(crate) variance_days: Option<f64>,
    pub(crate) done: bool,
}

#[utoipa::path(get, path = "/api/baselines/{id}/variance", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Due date against baseline for each issue in the snapshot", body = Vec<Variance>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn baseline_variance(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<Variance>>> {
    let i = tx.identity.clone();
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM baselines WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Baseline not found"))?;
    ensure_access(&mut tx, project).await?;
    let done = done_predicate("i");
    let rows: Vec<Variance> = sqlx::query_as(&format!(
        "SELECT i.id AS issue_id, i.number, i.title, to_char(x.due_at,'YYYY-MM-DD') AS baseline_due, \
         to_char(i.due_at,'YYYY-MM-DD') AS current_due, \
         CASE WHEN x.due_at IS NULL OR i.due_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM (i.due_at - x.due_at))/86400.0)::float8 END AS variance_days, \
         {done} AS done \
         FROM baseline_items x JOIN issues i ON i.tenant_id=x.tenant_id AND i.id=x.issue_id \
         WHERE x.tenant_id=$1 AND x.baseline_id=$2 ORDER BY i.number"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct PortfolioProjectItem {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) key: String,
    pub(crate) health: Option<String>,
    pub(crate) open_issues: i64,
    pub(crate) done_issues: i64,
    pub(crate) total_points: i64,
    pub(crate) active_sprint: Option<String>,
    pub(crate) next_release: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct PortfolioOverview {
    pub(crate) projects: Vec<PortfolioProjectItem>,
    pub(crate) total_open_issues: i64,
    pub(crate) total_done_issues: i64,
}

#[utoipa::path(get, path = "/api/portfolio/overview", tag = "roadmap", responses((status = 200, description = "Cross-project portfolio roll-up", body = PortfolioOverview), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn portfolio_overview(mut tx: Tx) -> ApiResult<Json<PortfolioOverview>> {
    let i = tx.identity.clone();
    let done = done_predicate("i");
    let projects: Vec<PortfolioProjectItem> = sqlx::query_as(&format!(
        "SELECT p.id, p.name, p.key, \
         (SELECT pu.health FROM project_updates pu WHERE pu.tenant_id=p.tenant_id AND pu.project_id=p.id ORDER BY pu.created_at DESC LIMIT 1) AS health, \
         COALESCE((SELECT count(*) FROM issues i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id AND i.archived_at IS NULL AND i.trashed_at IS NULL AND NOT {done}), 0)::bigint AS open_issues, \
         COALESCE((SELECT count(*) FROM issues i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id AND i.archived_at IS NULL AND i.trashed_at IS NULL AND {done}), 0)::bigint AS done_issues, \
         COALESCE((SELECT sum(COALESCE(i.story_points, 0)) FROM issues i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id AND i.archived_at IS NULL AND i.trashed_at IS NULL), 0)::bigint AS total_points, \
         (SELECT s.name FROM sprints s WHERE s.tenant_id=p.tenant_id AND s.project_id=p.id AND s.state='active' LIMIT 1) AS active_sprint, \
         (SELECT r.name FROM releases r WHERE r.tenant_id=p.tenant_id AND r.project_id=p.id AND r.status='planned' ORDER BY r.release_date ASC NULLS LAST LIMIT 1) AS next_release \
         FROM projects p \
         WHERE p.tenant_id=$1 AND project_access(p.id, $2, $3) >= 1 \
         ORDER BY p.name"
    ))
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(&i.role)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;

    let total_open_issues = projects.iter().map(|p| p.open_issues).sum();
    let total_done_issues = projects.iter().map(|p| p.done_issues).sum();

    Ok(Json(PortfolioOverview {
        projects,
        total_open_issues,
        total_done_issues,
    }))
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct RaidItem {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) severity: String,
    pub(crate) status: String,
    pub(crate) owner_id: Option<Uuid>,
    pub(crate) due_date: Option<String>,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewRaidItem {
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) severity: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) owner_id: Option<Uuid>,
    pub(crate) due_date: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct UpdateRaidItem {
    pub(crate) title: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) severity: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) owner_id: Option<Uuid>,
    pub(crate) due_date: Option<String>,
}

#[utoipa::path(get, path = "/api/projects/{id}/raid", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "RAID items for this project", body = Vec<RaidItem>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_raid_items(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<RaidItem>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<RaidItem> = sqlx::query_as(
        "SELECT id, project_id, kind, title, description, severity, status, owner_id, to_char(due_date,'YYYY-MM-DD') AS due_date, created_at \
         FROM raid_items WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/raid", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewRaidItem, responses((status = 201, description = "Created", body = RaidItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_raid_item(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(input): Json<NewRaidItem>,
) -> ApiResult<Json<RaidItem>> {
    ensure_access(&mut tx, project).await?;
    if !["risk", "assumption", "issue", "dependency"].contains(&input.kind.as_str()) {
        return Err(bad("kind must be risk, assumption, issue or dependency"));
    }
    let title = input.title.trim();
    if title.is_empty() || title.len() > 200 {
        return Err(bad("title must be between 1 and 200 characters"));
    }
    let severity = input.severity.unwrap_or_else(|| "medium".to_string());
    if !["low", "medium", "high", "critical"].contains(&severity.as_str()) {
        return Err(bad("severity must be low, medium, high or critical"));
    }
    let status = input.status.unwrap_or_else(|| "open".to_string());

    let row: RaidItem = sqlx::query_as(
        "INSERT INTO raid_items(tenant_id, project_id, kind, title, description, severity, status, owner_id, due_date) \
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9::date) \
         RETURNING id, project_id, kind, title, description, severity, status, owner_id, to_char(due_date,'YYYY-MM-DD') AS due_date, created_at",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .bind(&input.kind)
    .bind(title)
    .bind(input.description.unwrap_or_default())
    .bind(severity)
    .bind(status)
    .bind(input.owner_id)
    .bind(input.due_date)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    Ok(Json(row))
}

#[utoipa::path(patch, path = "/api/raid/{id}", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), request_body = UpdateRaidItem, responses((status = 200, description = "Updated", body = RaidItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_raid_item(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateRaidItem>,
) -> ApiResult<Json<RaidItem>> {
    let i = tx.identity.clone();
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM raid_items WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "RAID item not found"))?;
    ensure_access(&mut tx, project).await?;

    let row: RaidItem = sqlx::query_as(
        "UPDATE raid_items SET \
         title = COALESCE($3, title), \
         description = COALESCE($4, description), \
         severity = COALESCE($5, severity), \
         status = COALESCE($6, status), \
         owner_id = COALESCE($7, owner_id), \
         due_date = COALESCE($8::date, due_date), \
         updated_at = now() \
         WHERE tenant_id=$1 AND id=$2 \
         RETURNING id, project_id, kind, title, description, severity, status, owner_id, to_char(due_date,'YYYY-MM-DD') AS due_date, created_at",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(input.title)
    .bind(input.description)
    .bind(input.severity)
    .bind(input.status)
    .bind(input.owner_id)
    .bind(input.due_date)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;

    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/raid/{id}", tag = "roadmap", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_raid_item(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM raid_items WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "RAID item not found"))?;
    ensure_access(&mut tx, project).await?;

    sqlx::query("DELETE FROM raid_items WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/portfolio/overview", get(portfolio_overview))
        .route(
            "/api/projects/{id}/raid",
            get(list_raid_items).post(create_raid_item),
        )
        .route(
            "/api/raid/{id}",
            axum::routing::patch(update_raid_item).delete(delete_raid_item),
        )
        .route(
            "/api/projects/{id}/milestones",
            get(list_milestones).post(create_milestone),
        )
        .route(
            "/api/milestones/{id}",
            axum::routing::patch(update_milestone).delete(delete_milestone),
        )
        .route("/api/projects/{id}/timeline", get(timeline))
        .route("/api/projects/{id}/dependencies", get(dependencies))
        .route("/api/projects/{id}/critical-path", get(critical_path))
        .route(
            "/api/initiatives",
            get(list_initiatives).post(create_initiative),
        )
        .route(
            "/api/initiatives/{id}",
            axum::routing::patch(update_initiative),
        )
        .route("/api/initiatives/{id}/epics", put(link_initiative_epics))
        .route(
            "/api/projects/{id}/updates",
            get(list_updates).post(post_update),
        )
        .route("/api/goals/{id}/progress", get(goal_progress))
        .route("/api/goals/{id}/issues", put(set_goal_issues))
        .route("/api/capacity", get(capacity))
        .route("/api/members/{user_id}/capacity", put(set_capacity))
        .route(
            "/api/projects/{id}/baselines",
            get(list_baselines).post(create_baseline),
        )
        .route("/api/baselines/{id}/variance", get(baseline_variance))
}
