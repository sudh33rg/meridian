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
    let ts = DateTime::parse_from_rfc3339(updated_at).ok()?.with_timezone(&Utc);
    HeaderValue::from_str(&format!("\"{}\"", ts.to_rfc3339_opts(SecondsFormat::Micros, true))).ok()
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
    let row: IssueDetail = sqlx::query_as(
        "SELECT id,tenant_id,project_id,number,title,description,kind,status,priority,assignee_id,created_by,\
         created_at,updated_at,parent_id,due_at,story_points,labels,custom_fields,archived_at,sprint_id,team_id,backlog_rank \
         FROM issues WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut headers = HeaderMap::new();
    let tag = format!("\"{}\"", row.updated_at.to_rfc3339_opts(SecondsFormat::Micros, true));
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
        if !["task", "bug", "story", "epic"].contains(&s.as_str()) {
            return Err(bad("Invalid issue type"));
        }
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
    let custom_fields = match v.custom_fields.clone() {
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
        crate::api::transitions::check_transition(&mut tx, i.tenant_id, project, &from, next, &after).await?;
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
    let row: Option<Value> = sqlx::query_scalar("UPDATE issues SET title=COALESCE($1,title),description=COALESCE($2,description),kind=COALESCE($3,kind),priority=COALESCE($4,priority),status=COALESCE($5,status),assignee_id=COALESCE($6,assignee_id),sprint_id=COALESCE($7,sprint_id),parent_id=COALESCE($8,parent_id),story_points=COALESCE($9,story_points),due_at=COALESCE($10,due_at),labels=COALESCE($11,labels),custom_fields=COALESCE($12,custom_fields),updated_at=now() WHERE tenant_id=$13 AND id=$14 AND archived_at IS NULL AND ($15::timestamptz IS NULL OR updated_at=$15) RETURNING to_jsonb(issues)")
        .bind(v.title).bind(v.description).bind(v.kind).bind(v.priority).bind(v.status.clone()).bind(v.assignee_id)
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
    if let Some(tag) = row.get("updated_at").and_then(Value::as_str).and_then(issue_etag) {
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
        "SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2 AND archived_at IS NOT NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::CONFLICT, "Issue is not archived"))?;
    sqlx::query("UPDATE issues SET archived_at=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2")
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
    /// `set_status`, `set_priority` or `set_assignee`.
    pub(crate) action: String,
    /// The new status or priority, or a user id for `set_assignee`. Null clears the assignee.
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
    }
    let change = match v.action.as_str() {
        "set_status" => {
            let s = v.value.as_deref().ok_or_else(|| bad("A valid status is required"))?;
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
            if let Err(e) =
                crate::api::transitions::check_transition(&mut tx, i.tenant_id, project, &from, s, &custom).await
            {
                results.push(BulkItemResult { id, ok: false, error: Some(e.to_string()) });
                continue;
            }
        }
        match &change {
            Change::Status(s) => {
                sqlx::query("UPDATE issues SET status=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(s.as_str())
                    .bind(i.tenant_id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            Change::Priority(p) => {
                sqlx::query("UPDATE issues SET priority=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
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
        if matches!(&change, Change::Status(_)) {
            run_automations(&mut tx, &i, project, id, "issue_status_changed").await?;
        }
        updated += 1;
        results.push(BulkItemResult { id, ok: true, error: None });
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
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'body',c.body,'author_id',c.author_id,'author',u.display_name,'parent_id',c.parent_id,'created_at',c.created_at) FROM issue_comments c JOIN users u ON u.id=c.author_id WHERE c.tenant_id=$1 AND c.issue_id=$2 ORDER BY c.created_at ASC LIMIT 1000")
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
    crate::api::issue_depth::notify_mentions(&mut tx, i.tenant_id, i.user_id, id, &body_text).await?;
    log_event(&mut tx, &i, "commented", "issue", id).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct LinkInput {
    pub(crate) target_id: Uuid,
    pub(crate) relation: String,
}
#[utoipa::path(get, path = "/api/issues/{id}/links", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<IssueLink>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_links(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Vec<IssueLink>>> {
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

pub(crate) fn routes() -> Router<App> {
    Router::new()
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
            "/api/issues/{id}/links",
            get(issue_links).post(new_issue_link),
        )
}
