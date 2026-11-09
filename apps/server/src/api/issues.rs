//! Issue details, edits, comments and links.
use crate::api::collab::run_automations;
use crate::api::common::*;
use crate::api::work::ISSUE_PRIORITIES;
use crate::*;
use axum::http::header::{ETAG, IF_MATCH};
use axum::http::HeaderValue;
use axum::routing::{delete, patch};
use chrono::SecondsFormat;
use serde_json::{json, Value};

/// The ETag of an issue is its `updated_at` timestamp at microsecond precision, quoted. Clients
/// send it back as `If-Match` so an edit cannot silently overwrite a newer change.
fn issue_etag(updated_at: &str) -> Option<HeaderValue> {
    let ts = DateTime::parse_from_rfc3339(updated_at)
        .ok()?
        .with_timezone(&Utc);
    HeaderValue::from_str(&format!(
        "\"{}\"",
        ts.to_rfc3339_opts(SecondsFormat::Micros, true)
    ))
    .ok()
}

/// Optional `If-Match` precondition holding the `updated_at` the client last saw.
fn if_match(headers: &HeaderMap) -> ApiResult<Option<DateTime<Utc>>> {
    let Some(value) = headers.get(IF_MATCH) else {
        return Ok(None);
    };
    let raw = value
        .to_str()
        .map_err(|_| bad("If-Match must be the ETag of the issue"))?
        .trim()
        .trim_matches('"');
    DateTime::parse_from_rfc3339(raw)
        .map(|t| Some(t.with_timezone(&Utc)))
        .map_err(|_| bad("If-Match must be the ETag of the issue"))
}

#[utoipa::path(get, path = "/api/issues/{id}/details", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success. The ETag header is the If-Match value for edits", body = IssueDetail), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_details(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<(HeaderMap, Json<IssueDetail>)> {
    let i = tx.identity.clone();
    // Archived issues stay readable (the drawer offers Restore); edits still require active issues.
    ensure_entity_access(&mut tx, "issues", id).await?;
    let mut row: IssueDetail = sqlx::query_as(
        "SELECT id,tenant_id,project_id,number,title,description,kind,status,priority,assignee_id,created_by,\
         created_at,updated_at,parent_id,due_at,story_points,labels,custom_fields,archived_at,sprint_id,team_id,backlog_rank,trashed_at,purge_after \
         FROM issues WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    // Restricted field values are shown to project admins only.
    if project_level(&mut tx, &i, row.project_id).await?.unwrap_or(0) < 3 {
        let hidden = crate::api::fields::restricted_keys(&mut tx, i.tenant_id, row.project_id).await?;
        row.custom_fields = crate::api::fields::without_keys(&row.custom_fields, &hidden);
    }
    let mut headers = HeaderMap::new();
    let tag = format!(
        "\"{}\"",
        row.updated_at.to_rfc3339_opts(SecondsFormat::Micros, true)
    );
    if let Ok(v) = HeaderValue::from_str(&tag) {
        headers.insert(ETAG, v);
    }
    Ok((headers, Json(row)))
}
/// Every column of an issue. Clients receive the same fields as before, now with a fixed schema.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct IssueDetail {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) assignee_id: Option<Uuid>,
    pub(crate) created_by: Uuid,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) parent_id: Option<Uuid>,
    pub(crate) due_at: Option<DateTime<Utc>>,
    pub(crate) story_points: Option<i32>,
    pub(crate) labels: Vec<String>,
    pub(crate) custom_fields: Value,
    pub(crate) archived_at: Option<DateTime<Utc>>,
    pub(crate) sprint_id: Option<Uuid>,
    pub(crate) team_id: Option<Uuid>,
    /// Position in the project's ranking; lower comes first.
    pub(crate) backlog_rank: f64,
    /// When the issue was moved to trash, or null.
    pub(crate) trashed_at: Option<DateTime<Utc>>,
    /// The last moment the issue can be restored from trash, or null.
    pub(crate) purge_after: Option<DateTime<Utc>>,
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
#[utoipa::path(patch, path = "/api/issues/{id}/edit", tag = "issues", params(("id" = Uuid, Path, description = "Resource id"), ("If-Match" = Option<String>, Header, description = "Optional ETag from the issue details. If the issue changed since, the edit is refused with 412 and nothing is written")), request_body = IssueEdit, responses((status = 200, description = "Success", body = Object), (status = 412, description = "The issue changed since the If-Match ETag was issued", body = ErrorBody),(status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn edit_issue(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(v): Json<IssueEdit>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let expected = if_match(&headers)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    if let Some(ref s) = v.title {
        validate_title(s)?;
    }
    if let Some(ref s) = v.kind {
        crate::api::issue_types::check_type(&mut tx, i.tenant_id, project, s).await?;
    }
    if let Some(ref s) = v.status {
        if !crate::api::statuses::status_defined(&mut tx, i.tenant_id, project, s).await? {
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
    // A full set of values replaces the stored ones, so it is checked against every definition.
    // Members cannot change restricted fields, and their edits keep the restricted values as they are.
    let admin = project_level(&mut tx, &i, project).await?.unwrap_or(0) >= 3;
    let restricted = crate::api::fields::restricted_keys(&mut tx, i.tenant_id, project).await?;
    let provided = match v.custom_fields.clone() {
        Some(c) if !admin && !restricted.is_empty() => {
            let stored: Value = sqlx::query_scalar("SELECT custom_fields FROM issues WHERE tenant_id=$1 AND id=$2")
                .bind(i.tenant_id)
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
            for key in &restricted {
                if c.get(key).is_some_and(|next| Some(next) != stored.get(key)) {
                    return Err(err(StatusCode::FORBIDDEN, &format!("“{key}” is restricted to project admins")));
                }
            }
            let mut merged = crate::api::fields::without_keys(&c, &restricted);
            if let (Value::Object(map), Value::Object(kept)) = (&mut merged, &stored) {
                for key in &restricted {
                    if let Some(value) = kept.get(key) {
                        map.insert(key.clone(), value.clone());
                    }
                }
            }
            Some(merged)
        }
        other => other,
    };
    let custom_fields = match provided {
        Some(c) => Some(crate::api::fields::validate_values(&mut tx, i.tenant_id, project, &c).await?),
        None => None,
    };
    if let Some(ref next) = v.status {
        // A status change must follow the workflow, judged on the values the issue will hold afterwards.
        let (from, current): (String, Value) =
            sqlx::query_as("SELECT status, custom_fields FROM issues WHERE tenant_id=$1 AND id=$2")
                .bind(i.tenant_id)
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
        let after = custom_fields.clone().unwrap_or(current);
        crate::api::transitions::check_transition(
            &mut tx,
            i.tenant_id,
            project,
            &from,
            next,
            &after,
            i.role == "admin" || i.role == "owner",
        )
        .await?;
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
    let before_json = crate::api::history::issue_json(&mut tx, i.tenant_id, id).await?;
    // Nullable attributes are intentionally unchanged when omitted. Explicit clearing is a separate operation.
    // The description is markdown: it is cleaned before it is stored.
    let description = match v.description.as_deref() {
        Some(text) => {
            let clean = crate::api::issue_content::sanitize_markdown(text);
            if clean.chars().count() > crate::api::issue_content::DESCRIPTION_MAX {
                return Err(bad("A description is limited to 20,000 characters"));
            }
            Some(clean)
        }
        None => None,
    };
    let row: Option<Value> = sqlx::query_scalar("UPDATE issues SET title=COALESCE($1,title),description=COALESCE($2,description),kind=COALESCE($3,kind),priority=COALESCE($4,priority),status=COALESCE($5,status),assignee_id=COALESCE($6,assignee_id),sprint_id=COALESCE($7,sprint_id),parent_id=COALESCE($8,parent_id),story_points=COALESCE($9,story_points),due_at=COALESCE($10,due_at),labels=COALESCE($11,labels),custom_fields=COALESCE($12,custom_fields),updated_at=now() WHERE tenant_id=$13 AND id=$14 AND archived_at IS NULL AND ($15::timestamptz IS NULL OR updated_at=$15) RETURNING to_jsonb(issues)")
        .bind(v.title).bind(description).bind(v.kind).bind(v.priority).bind(v.status.clone()).bind(v.assignee_id)
        .bind(v.sprint_id).bind(v.parent_id).bind(v.story_points).bind(v.due_at).bind(v.labels).bind(custom_fields)
        .bind(i.tenant_id).bind(id).bind(expected).fetch_optional(&mut *tx).await.map_err(db_err)?;
    // Nothing matched: either the If-Match precondition failed or the issue was archived meanwhile.
    // No write has happened yet, so the transaction rolls back cleanly.
    let Some(row) = row else {
        return Err(match expected {
            Some(_) => ApiError::PreconditionFailed(
                "This issue changed since you loaded it. Reload it and apply your edit again"
                    .into(),
            ),
            None => err(StatusCode::NOT_FOUND, "Issue not found"),
        });
    };
    crate::api::history::record_row_changes(
        &mut tx,
        i.tenant_id,
        i.user_id,
        id,
        &before_json,
        &row,
    )
    .await?;
    run_automations(&mut tx, &i, project, id, "issue_updated").await?;
    log_event(&mut tx, &i, "updated", "issue", id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.updated",
        id,
        json!({"issue_id":id,"project_id":project}),
    )
    .await?;
    if v.status.is_some() {
        run_automations(&mut tx, &i, project, id, "issue_status_changed").await?;
    }
    let mut headers = HeaderMap::new();
    if let Some(tag) = row
        .get("updated_at")
        .and_then(Value::as_str)
        .and_then(issue_etag)
    {
        headers.insert(ETAG, tag);
    }
    Ok((headers, Json(row)))
}
#[utoipa::path(post, path = "/api/issues/{id}/archive", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn archive_issue(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    // Project access first: archiving must not reach issues in projects the caller cannot see.
    ensure_entity_access(&mut tx, "issues", id).await?;
    let r = sqlx::query(
        "UPDATE issues SET archived_at=now() WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::CONFLICT, "Issue is already archived"));
    }
    log_event(&mut tx, &i, "archived", "issue", id).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post, path = "/api/issues/{id}/unarchive", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Restored to the active lists"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "Issue is not archived", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn unarchive_issue(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    ensure_entity_access(&mut tx, "issues", id).await?;
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2 AND archived_at IS NOT NULL AND trashed_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::CONFLICT, "Issue is not archived, or it is in the trash (restore it from there)"))?;
    sqlx::query(
        "UPDATE issues SET archived_at=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "unarchived", "issue", id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.unarchived",
        id,
        json!({"issue_id":id,"project_id":project}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Batch change for issues in one project. Each item is checked and reported; the whole batch
/// commits or rolls back together.
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct BulkIssueInput {
    /// Issue ids in this project: 1 to 100 values; duplicates are ignored.
    pub(crate) ids: Vec<Uuid>,
    /// `set_status`, `set_priority`, `set_assignee`, `set_team`, `set_sprint`, `set_release`,
    /// `add_label`, `remove_label` or `add_watcher`.
    pub(crate) action: String,
    /// The new status or priority; a user id for `set_assignee` or `add_watcher`; a team or sprint id
    /// (or `none`) for `set_team` and `set_sprint`; a planned release id for `set_release`; the label
    /// text for `add_label` and `remove_label`. Null clears the assignee.
    pub(crate) value: Option<String>,
}
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct BulkItemResult {
    pub(crate) id: Uuid,
    pub(crate) ok: bool,
    /// Why the issue was skipped; null when it was updated.
    pub(crate) error: Option<String>,
}
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct BulkResult {
    pub(crate) updated: i64,
    pub(crate) results: Vec<BulkItemResult>,
}
#[utoipa::path(post, path = "/api/projects/{id}/issues/bulk", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = BulkIssueInput, responses((status = 200, description = "Batch applied; per-item results name any skipped issues", body = BulkResult), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn bulk_update_issues(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<BulkIssueInput>,
) -> ApiResult<Json<BulkResult>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    ensure_access(&mut tx, project).await?;
    let mut ids: Vec<Uuid> = Vec::new();
    for id in &v.ids {
        if !ids.contains(id) {
            ids.push(*id);
        }
    }
    if ids.is_empty() || ids.len() > 100 {
        return Err(bad("Choose between 1 and 100 issues"));
    }
    // Validate the action and its value once, before any write.
    enum Change {
        Status(String),
        Priority(String),
        Assignee(Option<Uuid>),
        Team(Option<Uuid>),
        /// Sprint id, or `None` to take the issue out of its sprint.
        Sprint(Option<Uuid>),
        /// Release id and whether the scope is frozen (additions are then flagged).
        Release(Uuid, bool),
        AddLabel(String),
        RemoveLabel(String),
        AddWatcher(Uuid),
    }
    let change = match v.action.as_str() {
        "set_status" => {
            let s = v
                .value
                .as_deref()
                .ok_or_else(|| bad("A valid status is required"))?;
            if !crate::api::statuses::status_defined(&mut tx, i.tenant_id, project, s).await? {
                return Err(bad("A valid status is required"));
            }
            Change::Status(s.to_string())
        }
        "set_priority" => match v.value.as_deref() {
            Some(p) if ISSUE_PRIORITIES.contains(&p) => Change::Priority(p.to_string()),
            _ => return Err(bad("A valid priority is required")),
        },
        "set_assignee" => match v.value.as_deref() {
            None => Change::Assignee(None),
            Some(raw) => {
                let user = Uuid::parse_str(raw).map_err(|_| bad("Assignee must be a user id"))?;
                let member: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2)",
                )
                .bind(i.tenant_id)
                .bind(user)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                if !member {
                    return Err(bad("Assignee must be a member of this workspace"));
                }
                Change::Assignee(Some(user))
            }
        },
        "set_team" => match v.value.as_deref() {
            None | Some("none") => Change::Team(None),
            Some(raw) => {
                let team = Uuid::parse_str(raw).map_err(|_| bad("Team must be a team id, or none"))?;
                let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM teams WHERE tenant_id=$1 AND id=$2)")
                    .bind(i.tenant_id)
                    .bind(team)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db_err)?;
                if !ok {
                    return Err(bad("Team not found in this workspace"));
                }
                Change::Team(Some(team))
            }
        },
        "set_sprint" => match v.value.as_deref() {
            None | Some("none") => Change::Sprint(None),
            Some(raw) => {
                let sprint = Uuid::parse_str(raw).map_err(|_| bad("Sprint must be a sprint id, or none"))?;
                let ok: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM sprints WHERE tenant_id=$1 AND id=$2 AND project_id=$3 AND state<>'completed')",
                )
                .bind(i.tenant_id)
                .bind(sprint)
                .bind(project)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                if !ok {
                    return Err(bad("Choose a planned or active sprint in this project"));
                }
                Change::Sprint(Some(sprint))
            }
        },
        "set_release" => {
            let raw = v.value.as_deref().ok_or_else(|| bad("A release id is required"))?;
            let release = Uuid::parse_str(raw).map_err(|_| bad("Release must be a release id"))?;
            let frozen: Option<Option<chrono::DateTime<chrono::Utc>>> = sqlx::query_scalar(
                "SELECT frozen_at FROM releases WHERE tenant_id=$1 AND id=$2 AND project_id=$3 AND status='planned'",
            )
            .bind(i.tenant_id)
            .bind(release)
            .bind(project)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?;
            match frozen {
                Some(f) => Change::Release(release, f.is_some()),
                None => return Err(bad("Choose a planned release in this project")),
            }
        }
        "add_label" | "remove_label" => {
            let label = v
                .value
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.chars().count() <= 40)
                .ok_or_else(|| bad("A label of 1 to 40 characters is required"))?
                .to_string();
            if v.action == "add_label" {
                Change::AddLabel(label)
            } else {
                Change::RemoveLabel(label)
            }
        }
        "add_watcher" => {
            let raw = v.value.as_deref().ok_or_else(|| bad("A member id is required"))?;
            let user = Uuid::parse_str(raw).map_err(|_| bad("Watcher must be a member id"))?;
            if !crate::api::issue_depth::active_member(&mut tx, i.tenant_id, user).await? {
                return Err(bad("Watcher must be an active member of this workspace"));
            }
            Change::AddWatcher(user)
        }
        _ => return Err(bad("Unknown bulk action")),
    };
    let mut results = Vec::with_capacity(ids.len());
    let mut updated: i64 = 0;
    for id in ids {
        let current: Option<(String, Value)> = sqlx::query_as(
            "SELECT status, custom_fields FROM issues WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let Some((from, custom)) = current else {
            results.push(BulkItemResult {
                id,
                ok: false,
                error: Some("Issue not found in this project, or it is archived".into()),
            });
            continue;
        };
        if let Change::Status(s) = &change {
            // A refused move is reported on its item; the rest of the batch still applies.
            if let Err(e) = crate::api::transitions::check_transition(
                &mut tx,
                i.tenant_id,
                project,
                &from,
                s,
                &custom,
                i.role == "admin" || i.role == "owner",
            )
            .await
            {
                results.push(BulkItemResult {
                    id,
                    ok: false,
                    error: Some(e.to_string()),
                });
                continue;
            }
        }
        // Checks for the newer actions. A refused item is reported and the rest of the batch still applies.
        let refusal: Option<&str> = match &change {
            Change::Team(team) => {
                // An issue inside another team's sprint cannot change team until it leaves that sprint.
                let blocked: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM issues i JOIN sprints s ON s.tenant_id=i.tenant_id AND s.id=i.sprint_id \
                     WHERE i.tenant_id=$1 AND i.id=$2 AND s.team_id IS NOT NULL AND s.team_id IS DISTINCT FROM $3)",
                )
                .bind(i.tenant_id)
                .bind(id)
                .bind(*team)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                blocked.then_some("Remove the issue from its team's sprint before changing its team")
            }
            Change::Sprint(target) => {
                let closed: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM issues i JOIN sprints s ON s.tenant_id=i.tenant_id AND s.id=i.sprint_id \
                     WHERE i.tenant_id=$1 AND i.id=$2 AND s.state='completed')",
                )
                .bind(i.tenant_id)
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                if closed {
                    Some("Issue is in a closed sprint")
                } else if let Some(sp) = target {
                    let sprint_team: Option<Uuid> =
                        sqlx::query_scalar("SELECT team_id FROM sprints WHERE tenant_id=$1 AND id=$2")
                            .bind(i.tenant_id)
                            .bind(*sp)
                            .fetch_one(&mut *tx)
                            .await
                            .map_err(db_err)?;
                    let issue_team: Option<Uuid> =
                        sqlx::query_scalar("SELECT team_id FROM issues WHERE tenant_id=$1 AND id=$2")
                            .bind(i.tenant_id)
                            .bind(id)
                            .fetch_one(&mut *tx)
                            .await
                            .map_err(db_err)?;
                    if sprint_team.is_some() && issue_team != sprint_team {
                        Some("Issue belongs to another team; assign it to this team first")
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            Change::Release(release, _) => {
                let in_scope: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM release_issues WHERE tenant_id=$1 AND release_id=$2 AND issue_id=$3 AND removed_at IS NULL)",
                )
                .bind(i.tenant_id)
                .bind(*release)
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                in_scope.then_some("Already in this release")
            }
            _ => None,
        };
        if let Some(reason) = refusal {
            results.push(BulkItemResult {
                id,
                ok: false,
                error: Some(reason.to_string()),
            });
            continue;
        }
        let before_json = crate::api::history::issue_json(&mut tx, i.tenant_id, id).await?;
        match &change {
            Change::Team(team) => {
                sqlx::query("UPDATE issues SET team_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(*team)
                    .bind(i.tenant_id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            Change::Sprint(sprint) => {
                sqlx::query("UPDATE issues SET sprint_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(*sprint)
                    .bind(i.tenant_id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            Change::Release(release, frozen) => {
                sqlx::query(
                    "INSERT INTO release_issues(tenant_id,release_id,issue_id,added_by,added_after_freeze) VALUES($1,$2,$3,$4,$5)",
                )
                .bind(i.tenant_id)
                .bind(*release)
                .bind(id)
                .bind(i.user_id)
                .bind(*frozen)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
            Change::AddLabel(label) => {
                sqlx::query(
                    "UPDATE issues SET labels=CASE WHEN $1 = ANY(labels) THEN labels ELSE array_append(labels,$1) END, updated_at=now() \
                     WHERE tenant_id=$2 AND id=$3",
                )
                .bind(label.as_str())
                .bind(i.tenant_id)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
            Change::RemoveLabel(label) => {
                sqlx::query("UPDATE issues SET labels=array_remove(labels,$1), updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(label.as_str())
                    .bind(i.tenant_id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            Change::AddWatcher(user) => {
                sqlx::query(
                    "INSERT INTO issue_watchers(tenant_id,issue_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
                )
                .bind(i.tenant_id)
                .bind(id)
                .bind(*user)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
            Change::Status(s) => {
                sqlx::query(
                    "UPDATE issues SET status=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
                )
                .bind(s.as_str())
                .bind(i.tenant_id)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
            Change::Priority(p) => {
                sqlx::query(
                    "UPDATE issues SET priority=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
                )
                .bind(p.as_str())
                .bind(i.tenant_id)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
            Change::Assignee(a) => {
                sqlx::query("UPDATE issues SET assignee_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(*a)
                    .bind(i.tenant_id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
        }
        log_event(&mut tx, &i, "updated", "issue", id).await?;
        log_outbox(
            &mut tx,
            i.tenant_id,
            "issue.updated",
            id,
            json!({"issue_id":id,"project_id":project}),
        )
        .await?;
        let after_json = crate::api::history::issue_json(&mut tx, i.tenant_id, id).await?;
        crate::api::history::record_row_changes(
            &mut tx,
            i.tenant_id,
            i.user_id,
            id,
            &before_json,
            &after_json,
        )
        .await?;
        if matches!(&change, Change::Status(_)) {
            run_automations(&mut tx, &i, project, id, "issue_status_changed").await?;
        }
        updated += 1;
        results.push(BulkItemResult {
            id,
            ok: true,
            error: None,
        });
    }
    Ok(Json(BulkResult { updated, results }))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CommentInput {
    pub(crate) body: String,
    pub(crate) parent_id: Option<Uuid>,
}
#[utoipa::path(get, path = "/api/issues/{id}/comments", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<IssueComment>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_comments(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<IssueComment>>> {
    let i = tx.identity.clone();
    // Reading stays open for archived issues, like the details view; posting still needs an active issue.
    ensure_entity_access(&mut tx, "issues", id).await?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'body',c.body,'author_id',c.author_id,'author',u.display_name,'parent_id',c.parent_id,'created_at',c.created_at,'edited_at',c.edited_at) FROM issue_comments c JOIN users u ON u.id=c.author_id WHERE c.tenant_id=$1 AND c.issue_id=$2 AND c.deleted_at IS NULL ORDER BY c.created_at ASC LIMIT 1000")
        .bind(i.tenant_id).bind(id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(typed_rows(rows)?))
}
/// A comment on an issue, newest first in the list.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueComment {
    pub(crate) id: Uuid,
    pub(crate) body: String,
    pub(crate) author_id: Uuid,
    pub(crate) author: String,
    /// The comment this one replies to, if any.
    pub(crate) parent_id: Option<Uuid>,
    pub(crate) created_at: DateTime<Utc>,
    /// When the author last changed the text, or null if never edited.
    pub(crate) edited_at: Option<DateTime<Utc>>,
}
#[utoipa::path(post, path = "/api/issues/{id}/comments", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = CommentInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_issue_comment(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<CommentInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    validate_body(&v.body)?;
    let body_text = v.body.clone();
    if let Some(parent) = v.parent_id {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM issue_comments WHERE tenant_id=$1 AND issue_id=$2 AND id=$3)")
            .bind(i.tenant_id).bind(id).bind(parent).fetch_one(&mut *tx).await.map_err(db_err)?;
        if !ok {
            return Err(bad("Reply must belong to the same issue"));
        }
    }
    let row:Value=sqlx::query_scalar("INSERT INTO issue_comments(tenant_id,issue_id,parent_id,author_id,body) VALUES($1,$2,$3,$4,$5) RETURNING to_jsonb(issue_comments)")
        .bind(i.tenant_id).bind(id).bind(v.parent_id).bind(i.user_id).bind(v.body).fetch_one(&mut *tx).await.map_err(db_err)?;
    crate::api::issue_depth::notify_mentions(&mut tx, i.tenant_id, i.user_id, id, &body_text)
        .await?;
    run_automations(&mut tx, &i, project, id, "comment_added").await?;
    log_event(&mut tx, &i, "commented", "issue", id).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CommentEdit {
    /// The new text, 1 to 100000 characters.
    pub(crate) body: String,
}

/// The live comment, locked for the rest of the transaction. Deleted comments are not found.
async fn live_comment(
    tx: &mut Tx,
    tenant: Uuid,
    issue: Uuid,
    comment: Uuid,
) -> ApiResult<(Uuid, String)> {
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT author_id, body FROM issue_comments WHERE tenant_id=$1 AND issue_id=$2 AND id=$3 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(tenant)
    .bind(issue)
    .bind(comment)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Comment not found"))
}

/// Keeps the text a change replaces, so the history shows every earlier version.
async fn keep_revision(
    tx: &mut Tx,
    i: &Identity,
    comment: Uuid,
    author: Uuid,
    body: &str,
    change: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO issue_comment_revisions(tenant_id,comment_id,body,author_id,changed_by,change) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(i.tenant_id)
        .bind(comment)
        .bind(body)
        .bind(author)
        .bind(i.user_id)
        .bind(change)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    Ok(())
}

#[utoipa::path(patch, path = "/api/issues/{id}/comments/{comment}", tag = "issues", params(("id" = Uuid, Path, description = "Resource id"), ("comment" = Uuid, Path, description = "Comment id")), request_body = CommentEdit, responses((status = 200, description = "Edited; the previous text is kept in the history", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Only the author can edit a comment", body = ErrorBody), (status = 404, description = "No such comment", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn edit_issue_comment(
    mut tx: Tx,
    Path((id, comment)): Path<(Uuid, Uuid)>,
    Json(v): Json<CommentEdit>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    validate_body(&v.body)?;
    let (author, previous) = live_comment(&mut tx, i.tenant_id, id, comment).await?;
    if author != i.user_id {
        return Err(forbidden());
    }
    keep_revision(&mut tx, &i, comment, author, &previous, "edit").await?;
    // Mentions added by the edit notify their members; mentions that were already there do not repeat.
    let before = crate::api::issue_depth::mention_handles(&previous);
    let fresh: Vec<String> = crate::api::issue_depth::mention_handles(&v.body)
        .into_iter()
        .filter(|h| !before.contains(h))
        .collect();
    crate::api::issue_depth::notify_handles(&mut tx, i.tenant_id, i.user_id, id, &fresh).await?;
    let row: Value = sqlx::query_scalar(
        "UPDATE issue_comments SET body=$1, edited_at=now(), updated_at=now() WHERE tenant_id=$2 AND issue_id=$3 AND id=$4 RETURNING to_jsonb(issue_comments)",
    )
    .bind(&v.body)
    .bind(i.tenant_id)
    .bind(id)
    .bind(comment)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "comment_edited", "issue", id).await?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/issues/{id}/comments/{comment}", tag = "issues", params(("id" = Uuid, Path, description = "Resource id"), ("comment" = Uuid, Path, description = "Comment id")), responses((status = 204, description = "Deleted; the text stays in the history for its author and admins"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Only the author or a workspace admin can delete a comment", body = ErrorBody), (status = 404, description = "No such comment", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_issue_comment(
    mut tx: Tx,
    Path((id, comment)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    let (author, body) = live_comment(&mut tx, i.tenant_id, id, comment).await?;
    let is_admin = i.role == "admin" || i.role == "owner";
    if author != i.user_id && !is_admin {
        return Err(forbidden());
    }
    keep_revision(&mut tx, &i, comment, author, &body, "delete").await?;
    sqlx::query("UPDATE issue_comments SET deleted_at=now(), updated_at=now() WHERE tenant_id=$1 AND issue_id=$2 AND id=$3")
        .bind(i.tenant_id)
        .bind(id)
        .bind(comment)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "comment_deleted", "issue", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// One earlier text of a comment, and who changed it away from that text.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct CommentRevision {
    pub(crate) body: String,
    pub(crate) author: String,
    pub(crate) changed_by: String,
    /// `edit` when the text was replaced, `delete` when the comment was deleted.
    pub(crate) change: String,
    pub(crate) changed_at: DateTime<Utc>,
}
/// A comment's current state and its earlier texts, oldest first.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CommentHistory {
    pub(crate) current_body: String,
    pub(crate) deleted: bool,
    pub(crate) revisions: Vec<CommentRevision>,
}

#[utoipa::path(get, path = "/api/issues/{id}/comments/{comment}/history", tag = "issues", params(("id" = Uuid, Path, description = "Resource id"), ("comment" = Uuid, Path, description = "Comment id")), responses((status = 200, description = "Current text and earlier versions", body = CommentHistory), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Only the author or a workspace admin can read the history", body = ErrorBody), (status = 404, description = "No such comment", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_comment_history(
    mut tx: Tx,
    Path((id, comment)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<CommentHistory>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let found: Option<(Uuid, String, bool)> = sqlx::query_as(
        "SELECT c.author_id, c.body, c.deleted_at IS NOT NULL FROM issue_comments c WHERE c.tenant_id=$1 AND c.issue_id=$2 AND c.id=$3",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(comment)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (author, current_body, deleted) =
        found.ok_or_else(|| err(StatusCode::NOT_FOUND, "Comment not found"))?;
    // Earlier texts of a deleted comment are visible only to its author and admins.
    let is_admin = i.role == "admin" || i.role == "owner";
    if author != i.user_id && !is_admin {
        return Err(forbidden());
    }
    let revisions: Vec<CommentRevision> = sqlx::query_as(
        "SELECT r.body, a.display_name AS author, b.display_name AS changed_by, r.change, r.changed_at          FROM issue_comment_revisions r JOIN users a ON a.id=r.author_id JOIN users b ON b.id=r.changed_by          WHERE r.tenant_id=$1 AND r.comment_id=$2 ORDER BY r.changed_at, r.id",
    )
    .bind(i.tenant_id)
    .bind(comment)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(CommentHistory {
        current_body,
        deleted,
        revisions,
    }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct LinkInput {
    pub(crate) target_id: Uuid,
    pub(crate) relation: String,
}
#[utoipa::path(get, path = "/api/issues/{id}/links", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<IssueLink>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_links(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<IssueLink>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('source_id',source_id,'target_id',target_id,'relation',relation) FROM issue_links WHERE tenant_id=$1 AND (source_id=$2 OR target_id=$2) LIMIT 250")
        .bind(i.tenant_id).bind(id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(typed_rows(rows)?))
}
/// A link between two issues. `relation` is one of blocks, relates, duplicates or depends_on.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueLink {
    pub(crate) source_id: Uuid,
    pub(crate) target_id: Uuid,
    pub(crate) relation: String,
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

/// Where a lifecycle action on an issue finds it: its project, whether it is archived, and whether it is trashed.
async fn lifecycle_state(tx: &mut Tx, tenant: Uuid, id: Uuid) -> ApiResult<(Uuid, bool, bool)> {
    let row: Option<(Uuid, bool, bool)> = sqlx::query_as(
        "SELECT project_id, archived_at IS NOT NULL, trashed_at IS NOT NULL FROM issues WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_err)?;
    row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))
}

#[utoipa::path(post, path = "/api/issues/{id}/trash", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Moved to trash; restorable for 30 days"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "The issue is already in the trash", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn trash_issue(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let (project, _archived, trashed) = lifecycle_state(&mut tx, i.tenant_id, id).await?;
    ensure_access(&mut tx, project).await?;
    ensure_action(&mut tx, project, "delete_issues").await?;
    if trashed {
        return Err(err(
            StatusCode::CONFLICT,
            "The issue is already in the trash",
        ));
    }
    sqlx::query(
        "UPDATE issues SET archived_at=COALESCE(archived_at, now()), trashed_at=now(), purge_after=now()+make_interval(days => COALESCE((SELECT trash_retention_days FROM workspace_settings WHERE tenant_id=$2), 30)), trashed_by=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
    )
    .bind(i.user_id)
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "trashed", "issue", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/issues/{id}/restore", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Back in the active lists"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "The issue is neither archived nor in the trash", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn restore_issue(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let (project, archived, trashed) = lifecycle_state(&mut tx, i.tenant_id, id).await?;
    ensure_access(&mut tx, project).await?;
    if !archived && !trashed {
        return Err(err(
            StatusCode::CONFLICT,
            "Issue is neither archived nor in the trash",
        ));
    }
    sqlx::query(
        "UPDATE issues SET archived_at=NULL, trashed_at=NULL, purge_after=NULL, trashed_by=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(
        &mut tx,
        &i,
        if trashed {
            "restored_from_trash"
        } else {
            "unarchived"
        },
        "issue",
        id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// An issue in a project's trash, with the date it can no longer be restored.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TrashedIssue {
    pub(crate) id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) trashed_at: DateTime<Utc>,
    pub(crate) purge_after: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/projects/{id}/trash", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Trashed issues, most recent first", body = Vec<TrashedIssue>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Editors only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_trash(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<TrashedIssue>>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    ensure_access(&mut tx, project).await?;
    let rows: Vec<TrashedIssue> = sqlx::query_as(
        "SELECT id,number,title,kind,status,trashed_at,purge_after FROM issues WHERE tenant_id=$1 AND project_id=$2 AND trashed_at IS NOT NULL ORDER BY trashed_at DESC LIMIT 500",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/issues/{id}/trash", post(trash_issue))
        .route("/api/issues/{id}/restore", post(restore_issue))
        .route("/api/projects/{id}/trash", get(list_trash))
        .route("/api/issues/{id}/details", get(issue_details))
        .route("/api/issues/{id}/edit", patch(edit_issue))
        .route("/api/issues/{id}/archive", post(archive_issue))
        .route("/api/issues/{id}/unarchive", post(unarchive_issue))
        .route("/api/projects/{id}/issues/bulk", post(bulk_update_issues))
        .route(
            "/api/issues/{id}/comments",
            get(issue_comments).post(new_issue_comment),
        )
        .route(
            "/api/issues/{id}/comments/{comment}",
            patch(edit_issue_comment).delete(delete_issue_comment),
        )
        .route(
            "/api/issues/{id}/comments/{comment}/history",
            get(issue_comment_history),
        )
        .route(
            "/api/issues/{id}/links",
            get(issue_links).post(new_issue_link),
        )
}

/// Permanently removes trashed issues whose restore window has ended. It runs from the
/// hourly maintenance loop on the system connection, in batches of 100 issues, one transaction each.
///
/// Before an issue's row is deleted: its live subtasks become top-level issues; its import keys and
/// release memberships are removed, so the rows that point at it do not block the delete; its
/// attachments are hidden and their objects are removed by an `attachment.purge` job. Everything else
/// goes with the issue through the cascading foreign keys. A purge writes an audit row naming the
/// member who trashed the issue, when that is known.
pub(crate) async fn purge_expired_trash(db: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    let due: Vec<(Uuid, Uuid, Option<Uuid>)> = sqlx::query_as(
        "SELECT id, tenant_id, trashed_by FROM issues WHERE trashed_at IS NOT NULL AND purge_after IS NOT NULL \
         AND purge_after <= now() ORDER BY purge_after LIMIT 100",
    )
    .fetch_all(db)
    .await?;
    let mut purged = 0u64;
    for (id, tenant, trashed_by) in due {
        let mut tx = db.begin().await?;
        sqlx::query("UPDATE issues SET parent_id=NULL WHERE tenant_id=$1 AND parent_id=$2")
            .bind(tenant)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM imported_issue_refs WHERE tenant_id=$1 AND issue_id=$2")
            .bind(tenant)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM release_issues WHERE tenant_id=$1 AND issue_id=$2")
            .bind(tenant)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let keys: Vec<String> = sqlx::query_scalar(
            "UPDATE attachments SET deleted_at=now() WHERE tenant_id=$1 AND entity_type='issue' AND entity_id=$2 \
             AND deleted_at IS NULL RETURNING storage_key",
        )
        .bind(tenant)
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        for key in keys {
            sqlx::query("INSERT INTO jobs(tenant_id,kind,payload) VALUES($1,'attachment.purge',$2)")
                .bind(tenant)
                .bind(json!({ "storage_key": key }))
                .execute(&mut *tx)
                .await?;
        }
        let removed = sqlx::query(
            "DELETE FROM issues WHERE tenant_id=$1 AND id=$2 AND trashed_at IS NOT NULL AND purge_after <= now()",
        )
        .bind(tenant)
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if removed == 1 {
            if let Some(actor) = trashed_by {
                sqlx::query(
                    "INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'issue_purged','issue',$3)",
                )
                .bind(tenant)
                .bind(actor)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            }
            purged += 1;
        }
        tx.commit().await?;
    }
    Ok(purged)
}
