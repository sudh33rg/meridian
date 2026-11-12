//! Release scope: which issues ship in a release, the scope freeze, the history of
//! additions and removals, the release action that moves unfinished work, and release notes.
//!
//! Membership is a row with an add time and, once removed, a remove time. Nothing is deleted, so
//! the history a release shows is the history that happened.
use crate::api::agile::done_predicate;
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get};
use chrono::SecondsFormat;

const RELEASE_COLUMNS: &str =
    "id,tenant_id,project_id,name,description,target_at,status,created_at,frozen_at,released_at";

/// A release as stored.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Release {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) target_at: Option<DateTime<Utc>>,
    /// `planned`, `released` or `cancelled`.
    pub(crate) status: String,
    pub(crate) created_at: DateTime<Utc>,
    /// When scope was frozen. Later additions and removals are flagged.
    pub(crate) frozen_at: Option<DateTime<Utc>>,
    pub(crate) released_at: Option<DateTime<Utc>>,
}

/// Progress of a release's active scope.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct ReleaseTotals {
    pub(crate) scope_count: i32,
    pub(crate) done_count: i32,
    pub(crate) scope_points: i32,
    pub(crate) done_points: i32,
    /// Issues that joined the scope after the freeze, still in scope.
    pub(crate) added_after_freeze: i64,
    /// Issues that were ever removed from the scope.
    pub(crate) removed_count: i64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct ReleaseDetail {
    pub(crate) release: Release,
    pub(crate) totals: ReleaseTotals,
}

/// One issue in a release's active scope.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ReleaseScopeItem {
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
    pub(crate) backlog_rank: f64,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) added_at: DateTime<Utc>,
    pub(crate) added_after_freeze: bool,
    pub(crate) done: bool,
}

/// One entry in a release's scope history.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ScopeEvent {
    pub(crate) issue_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    /// `added` or `removed`.
    pub(crate) action: String,
    pub(crate) at: DateTime<Utc>,
    pub(crate) by: Uuid,
    /// Whether the change happened after the scope freeze.
    pub(crate) after_freeze: bool,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct ReleaseNotes {
    pub(crate) release_id: Uuid,
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) generated_at: String,
    /// Markdown: done bugs, other done work, and scope that did not ship.
    pub(crate) markdown: String,
}

pub(crate) async fn load_release(
    db: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
) -> ApiResult<Release> {
    sqlx::query_as(&format!(
        "SELECT {RELEASE_COLUMNS} FROM releases WHERE tenant_id=$1 AND id=$2"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Release not found"))
}

async fn release_totals(
    db: &mut PgConnection,
    tenant: Uuid,
    release: Uuid,
) -> ApiResult<ReleaseTotals> {
    let done = done_predicate("i");
    let sql = format!(
        "SELECT count(*)::int4, count(*) FILTER (WHERE {done})::int4, COALESCE(sum(i.story_points),0)::int4, \
         COALESCE(sum(i.story_points) FILTER (WHERE {done}),0)::int4 \
         FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id \
         WHERE ri.tenant_id=$1 AND ri.release_id=$2 AND ri.removed_at IS NULL AND i.archived_at IS NULL"
    );
    let (scope_count, done_count, scope_points, done_points): (i32, i32, i32, i32) =
        sqlx::query_as(&sql)
            .bind(tenant)
            .bind(release)
            .fetch_one(&mut *db)
            .await
            .map_err(db_err)?;
    let (added_after_freeze, removed_count): (i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE added_after_freeze AND removed_at IS NULL), count(*) FILTER (WHERE removed_at IS NOT NULL) \
         FROM release_issues WHERE tenant_id=$1 AND release_id=$2",
    )
    .bind(tenant)
    .bind(release)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(ReleaseTotals {
        scope_count,
        done_count,
        scope_points,
        done_points,
        added_after_freeze,
        removed_count,
    })
}

#[utoipa::path(get, path = "/api/releases/{id}", tag = "releases", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = ReleaseDetail), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn release_detail(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<ReleaseDetail>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    let release = load_release(&mut tx, i.tenant_id, id).await?;
    let totals = release_totals(&mut tx, i.tenant_id, id).await?;
    Ok(Json(ReleaseDetail { release, totals }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ReleaseUpdate {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) target_at: Option<DateTime<Utc>>,
    /// `released` ships the release; `cancelled` drops it. Only a planned release can change status.
    pub(crate) status: Option<String>,
    /// `true` freezes the scope (only while planned). Once frozen it stays frozen.
    pub(crate) freeze: Option<bool>,
    /// Only with `status: released`. `backlog` (the default) removes unfinished work from the scope;
    /// a release id moves it to another planned release in the same project.
    pub(crate) move_unfinished_to: Option<String>,
}

#[utoipa::path(patch, path = "/api/releases/{id}", tag = "releases", params(("id" = Uuid, Path, description = "Resource id")), request_body = ReleaseUpdate, responses((status = 200, description = "Success", body = Release), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "The release is not in a state that allows this change", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_release(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ReleaseUpdate>,
) -> ApiResult<Json<Release>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    require_editor(&i)?;
    ensure_action_on(&mut tx, "releases", id, "manage_releases").await?;
    let current = load_release(&mut tx, i.tenant_id, id).await?;
    if v.name.is_none()
        && v.description.is_none()
        && v.target_at.is_none()
        && v.status.is_none()
        && v.freeze.is_none()
    {
        return Err(bad("Nothing to change"));
    }
    if let Some(n) = &v.name {
        validate_title(n)?;
    }
    if v.move_unfinished_to.is_some() && v.status.as_deref() != Some("released") {
        return Err(bad("move_unfinished_to applies when a release is released"));
    }
    if v.freeze == Some(false) {
        return Err(bad("A scope freeze cannot be undone"));
    }
    // Names, descriptions and dates stay editable after a release ships or is cancelled, so they can be corrected.
    if v.freeze == Some(true) && current.status != "planned" {
        return Err(err(
            StatusCode::CONFLICT,
            "Only a planned release can freeze its scope",
        ));
    }
    if let Some(name) = &v.name {
        sqlx::query("UPDATE releases SET name=$1 WHERE tenant_id=$2 AND id=$3")
            .bind(name.trim())
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    if let Some(d) = &v.description {
        sqlx::query("UPDATE releases SET description=$1 WHERE tenant_id=$2 AND id=$3")
            .bind(d)
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    if let Some(t) = v.target_at {
        sqlx::query("UPDATE releases SET target_at=$1 WHERE tenant_id=$2 AND id=$3")
            .bind(t)
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    if v.freeze == Some(true) && current.frozen_at.is_none() {
        sqlx::query("UPDATE releases SET frozen_at=now() WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        log_event(&mut tx, &i, "frozen", "release", id).await?;
    }
    match v.status.as_deref() {
        None => {}
        Some("cancelled") => {
            if current.status != "planned" {
                return Err(err(
                    StatusCode::CONFLICT,
                    "Only a planned release can be cancelled",
                ));
            }
            sqlx::query("UPDATE releases SET status='cancelled' WHERE tenant_id=$1 AND id=$2")
                .bind(i.tenant_id)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            log_event(&mut tx, &i, "cancelled", "release", id).await?;
        }
        Some("released") => {
            if current.status != "planned" {
                return Err(err(
                    StatusCode::CONFLICT,
                    "Only a planned release can be released",
                ));
            }
            let target =
                unfinished_target(&mut tx, &i, &current, v.move_unfinished_to.as_deref()).await?;
            move_unfinished(&mut tx, &i, &current, target).await?;
            sqlx::query("UPDATE releases SET status='released', released_at=now() WHERE tenant_id=$1 AND id=$2")
                .bind(i.tenant_id)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            log_event(&mut tx, &i, "released", "release", id).await?;
        }
        Some(_) => return Err(bad("Release status must be released or cancelled")),
    }
    Ok(Json(load_release(&mut tx, i.tenant_id, id).await?))
}

/// Where unfinished work goes when a release ships. `None` means it leaves the release.
async fn unfinished_target(
    db: &mut PgConnection,
    i: &Identity,
    release: &Release,
    to: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    match to {
        None | Some("backlog") => Ok(None),
        Some(raw) => {
            let target: Uuid = raw
                .parse()
                .map_err(|_| bad("move_unfinished_to must be backlog or a release id"))?;
            if target == release.id {
                return Err(bad("Unfinished work must move to a different release"));
            }
            let ok: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM releases WHERE tenant_id=$1 AND id=$2 AND project_id=$3 AND status='planned')",
            )
            .bind(i.tenant_id)
            .bind(target)
            .bind(release.project_id)
            .fetch_one(&mut *db)
            .await
            .map_err(db_err)?;
            if !ok {
                return Err(bad(
                    "The target release must be planned and in this project",
                ));
            }
            Ok(Some(target))
        }
    }
}

/// Removes unfinished issues from a shipping release, optionally adding them to another planned one.
async fn move_unfinished(
    db: &mut PgConnection,
    i: &Identity,
    release: &Release,
    target: Option<Uuid>,
) -> ApiResult<()> {
    let done = done_predicate("i");
    let ids: Vec<Uuid> = sqlx::query_scalar(&format!(
        "SELECT ri.issue_id FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id \
         WHERE ri.tenant_id=$1 AND ri.release_id=$2 AND ri.removed_at IS NULL AND i.archived_at IS NULL AND NOT {done}"
    ))
    .bind(i.tenant_id)
    .bind(release.id)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)?;
    for issue in ids {
        sqlx::query(
            "UPDATE release_issues SET removed_at=now(), removed_by=$1, removed_after_freeze=($2::timestamptz IS NOT NULL) \
             WHERE tenant_id=$3 AND release_id=$4 AND issue_id=$5 AND removed_at IS NULL",
        )
        .bind(i.user_id)
        .bind(release.frozen_at)
        .bind(i.tenant_id)
        .bind(release.id)
        .bind(issue)
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
        if let Some(t) = target {
            let frozen: Option<DateTime<Utc>> =
                sqlx::query_scalar("SELECT frozen_at FROM releases WHERE tenant_id=$1 AND id=$2")
                    .bind(i.tenant_id)
                    .bind(t)
                    .fetch_one(&mut *db)
                    .await
                    .map_err(db_err)?;
            sqlx::query(
                "INSERT INTO release_issues(tenant_id,release_id,issue_id,added_by,added_after_freeze) VALUES($1,$2,$3,$4,$5)",
            )
            .bind(i.tenant_id)
            .bind(t)
            .bind(issue)
            .bind(i.user_id)
            .bind(frozen.is_some())
            .execute(&mut *db)
            .await
            .map_err(db_err)?;
        }
    }
    Ok(())
}

#[utoipa::path(get, path = "/api/releases/{id}/issues", tag = "releases", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Active scope in rank order", body = Vec<ReleaseScopeItem>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn release_scope(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<ReleaseScopeItem>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    let done = done_predicate("i");
    let rows: Vec<ReleaseScopeItem> = sqlx::query_as(&format!(
        "SELECT i.id, i.project_id, i.number, i.title, i.kind, i.status, i.priority, i.assignee_id, i.team_id, i.sprint_id, \
         i.story_points, i.backlog_rank, i.updated_at, ri.added_at, ri.added_after_freeze, {done} AS done \
         FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id \
         WHERE ri.tenant_id=$1 AND ri.release_id=$2 AND ri.removed_at IS NULL AND i.archived_at IS NULL \
         ORDER BY i.backlog_rank, i.number"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ReleaseIssuesInput {
    pub(crate) issue_ids: Vec<Uuid>,
}

#[utoipa::path(post, path = "/api/releases/{id}/issues", tag = "releases", params(("id" = Uuid, Path, description = "Resource id")), request_body = ReleaseIssuesInput, responses((status = 200, description = "Applied; per-item results name any refused issue", body = crate::api::agile::MembershipResult), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "The release is shipped or cancelled", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_release_issues(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ReleaseIssuesInput>,
) -> ApiResult<Json<crate::api::agile::MembershipResult>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    require_editor(&i)?;
    ensure_action_on(&mut tx, "releases", id, "manage_releases").await?;
    let mut ids: Vec<Uuid> = Vec::new();
    for issue in &v.issue_ids {
        if !ids.contains(issue) {
            ids.push(*issue);
        }
    }
    if ids.is_empty() || ids.len() > 100 {
        return Err(bad("Choose between 1 and 100 issues"));
    }
    let release = load_release(&mut tx, i.tenant_id, id).await?;
    if release.status != "planned" {
        return Err(err(
            StatusCode::CONFLICT,
            "Scope can change only while the release is planned",
        ));
    }
    let mut results = Vec::with_capacity(ids.len());
    let mut changed = 0_i64;
    for issue in ids {
        let row: Option<(Uuid, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT project_id, archived_at FROM issues WHERE tenant_id=$1 AND id=$2",
        )
        .bind(i.tenant_id)
        .bind(issue)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let reason = match row {
            None => Some("Issue not found".to_string()),
            Some((project, _)) if project != release.project_id => {
                Some("Issue is in another project".into())
            }
            Some((_, Some(_))) => Some("Issue is archived".into()),
            Some(_) => {
                let active: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM release_issues WHERE tenant_id=$1 AND release_id=$2 AND issue_id=$3 AND removed_at IS NULL)",
                )
                .bind(i.tenant_id)
                .bind(id)
                .bind(issue)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                if active {
                    Some("Already in this release".into())
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
                    "INSERT INTO release_issues(tenant_id,release_id,issue_id,added_by,added_after_freeze) VALUES($1,$2,$3,$4,$5)",
                )
                .bind(i.tenant_id)
                .bind(id)
                .bind(issue)
                .bind(i.user_id)
                .bind(release.frozen_at.is_some())
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
    log_event(&mut tx, &i, "scope_changed", "release", id).await?;
    Ok(Json(crate::api::agile::MembershipResult {
        changed,
        results,
    }))
}

#[utoipa::path(delete, path = "/api/releases/{id}/issues/{issue_id}", tag = "releases", params(("id" = Uuid, Path, description = "Resource id"), ("issue_id" = Uuid, Path, description = "Issue id")), responses((status = 200, description = "Removed from scope; the removal is recorded in the history", body = crate::api::agile::MembershipResult), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "The release is shipped or cancelled", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_release_issue(
    mut tx: Tx,
    Path((id, issue)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<crate::api::agile::MembershipResult>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    require_editor(&i)?;
    ensure_action_on(&mut tx, "releases", id, "manage_releases").await?;
    let release = load_release(&mut tx, i.tenant_id, id).await?;
    if release.status != "planned" {
        return Err(err(
            StatusCode::CONFLICT,
            "Scope can change only while the release is planned",
        ));
    }
    let affected = sqlx::query(
        "UPDATE release_issues SET removed_at=now(), removed_by=$1, removed_after_freeze=($2::timestamptz IS NOT NULL) \
         WHERE tenant_id=$3 AND release_id=$4 AND issue_id=$5 AND removed_at IS NULL",
    )
    .bind(i.user_id)
    .bind(release.frozen_at)
    .bind(i.tenant_id)
    .bind(id)
    .bind(issue)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected();
    if affected == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Issue is not in this release"));
    }
    log_event(&mut tx, &i, "scope_changed", "release", id).await?;
    Ok(Json(crate::api::agile::MembershipResult {
        changed: 1,
        results: vec![crate::api::issues::BulkItemResult {
            id: issue,
            ok: true,
            error: None,
        }],
    }))
}

#[utoipa::path(get, path = "/api/releases/{id}/history", tag = "releases", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Additions and removals, oldest first", body = Vec<ScopeEvent>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn release_history(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<ScopeEvent>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    let rows: Vec<ScopeEvent> = sqlx::query_as(
        "SELECT h.issue_id, h.number, h.title, h.action, h.at, h.by, h.after_freeze FROM (\
           SELECT ri.issue_id, i.number, i.title, 'added'::text AS action, ri.added_at AS at, ri.added_by AS by, ri.added_after_freeze AS after_freeze, ri.id AS seq \
           FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id WHERE ri.tenant_id=$1 AND ri.release_id=$2 \
           UNION ALL \
           SELECT ri.issue_id, i.number, i.title, 'removed'::text, ri.removed_at, ri.removed_by, ri.removed_after_freeze, ri.id \
           FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id \
           WHERE ri.tenant_id=$1 AND ri.release_id=$2 AND ri.removed_at IS NOT NULL) h \
         ORDER BY h.at, h.seq, h.action",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(get, path = "/api/releases/{id}/notes", tag = "releases", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = ReleaseNotes), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn release_notes(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<ReleaseNotes>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "releases", id).await?;
    let release = load_release(&mut tx, i.tenant_id, id).await?;
    let key: String = sqlx::query_scalar("SELECT key FROM projects WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(release.project_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let scope = release_scope_rows(&mut tx, i.tenant_id, id).await?;
    let mut md = format!("# {}\n", release.name);
    if !release.description.trim().is_empty() {
        md.push_str(&format!("\n{}\n", release.description.trim()));
    }
    let (bugs_done, other_done): (Vec<_>, Vec<_>) = scope
        .iter()
        .filter(|s| s.done)
        .partition(|s| s.kind == "bug");
    let open: Vec<_> = scope.iter().filter(|s| !s.done).collect();
    let line = |s: &ReleaseScopeItem| format!("- {key}-{} {}\n", s.number, s.title);
    if !bugs_done.is_empty() {
        md.push_str("\n## Bugs fixed\n");
        bugs_done.iter().for_each(|s| md.push_str(&line(s)));
    }
    if !other_done.is_empty() {
        md.push_str("\n## Changes\n");
        other_done.iter().for_each(|s| md.push_str(&line(s)));
    }
    if !open.is_empty() {
        md.push_str("\n## Not shipped\n");
        open.iter().for_each(|s| md.push_str(&line(s)));
    }
    if scope.is_empty() {
        md.push_str("\nNo issues are in this release.\n");
    }
    Ok(Json(ReleaseNotes {
        release_id: id,
        name: release.name,
        status: release.status,
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        markdown: md,
    }))
}

async fn release_scope_rows(
    db: &mut PgConnection,
    tenant: Uuid,
    release: Uuid,
) -> ApiResult<Vec<ReleaseScopeItem>> {
    let done = done_predicate("i");
    sqlx::query_as(&format!(
        "SELECT i.id, i.project_id, i.number, i.title, i.kind, i.status, i.priority, i.assignee_id, i.team_id, i.sprint_id, \
         i.story_points, i.backlog_rank, i.updated_at, ri.added_at, ri.added_after_freeze, {done} AS done \
         FROM release_issues ri JOIN issues i ON i.tenant_id=ri.tenant_id AND i.id=ri.issue_id \
         WHERE ri.tenant_id=$1 AND ri.release_id=$2 AND ri.removed_at IS NULL AND i.archived_at IS NULL \
         ORDER BY i.backlog_rank, i.number"
    ))
    .bind(tenant)
    .bind(release)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route(
            "/api/releases/{id}",
            get(release_detail).patch(update_release),
        )
        .route(
            "/api/releases/{id}/issues",
            get(release_scope).post(add_release_issues),
        )
        .route(
            "/api/releases/{id}/issues/{issue_id}",
            delete(remove_release_issue),
        )
        .route("/api/releases/{id}/history", get(release_history))
        .route("/api/releases/{id}/notes", get(release_notes))
}
