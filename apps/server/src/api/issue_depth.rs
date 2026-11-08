//! Issue depth (Phase F): components, estimates and worklogs, watchers and votes, checklists,
//! subtask roll-up, cloning, moving between projects, and similar-issue suggestions.
//!
//! Every write goes through the issue's project access check, so a viewer cannot change anything,
//! and a watcher, vote or worklog always belongs to the caller's own tenant.
use crate::api::agile::done_predicate;
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get, patch, post};
use chrono::NaiveDate;
use serde_json::{json, Value};
use std::collections::HashSet;

const MAX_MINUTES: i32 = 100_000_000;

// ---------------------------------------------------------------------------------------------
// F1. Components
// ---------------------------------------------------------------------------------------------

/// A component (a named group of work inside a project).
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Component {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) name: String,
    pub(crate) description: String,
    /// Assigned to issues in this component that have no assignee yet, when the component is added.
    pub(crate) default_assignee_id: Option<Uuid>,
    /// Active issues in the component.
    pub(crate) issue_count: i64,
    pub(crate) created_at: DateTime<Utc>,
}

const COMPONENT_SELECT: &str = "SELECT c.id, c.project_id, c.name, c.description, c.default_assignee_id, \
 (SELECT count(*) FROM issue_components ic JOIN issues i ON i.tenant_id=ic.tenant_id AND i.id=ic.issue_id \
  WHERE ic.tenant_id=c.tenant_id AND ic.component_id=c.id AND i.archived_at IS NULL) AS issue_count, c.created_at \
 FROM components c";

async fn load_component(db: &mut PgConnection, tenant: Uuid, id: Uuid) -> ApiResult<Component> {
    sqlx::query_as(&format!(
        "{COMPONENT_SELECT} WHERE c.tenant_id=$1 AND c.id=$2"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Component not found"))
}

async fn active_member(db: &mut PgConnection, tenant: Uuid, user: Uuid) -> ApiResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)")
        .bind(tenant)
        .bind(user)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)
}

#[utoipa::path(get, path = "/api/projects/{id}/components", tag = "components", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Component>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_components(
    mut tx: Tx,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Component>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let rows: Vec<Component> = sqlx::query_as(&format!(
        "{COMPONENT_SELECT} WHERE c.tenant_id=$1 AND c.project_id=$2 ORDER BY c.name"
    ))
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ComponentInput {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) default_assignee_id: Option<Uuid>,
}

#[utoipa::path(post, path = "/api/projects/{id}/components", tag = "components", params(("id" = Uuid, Path, description = "Resource id")), request_body = ComponentInput, responses((status = 201, description = "Success", body = Component), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "A component with this name exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_component(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<ComponentInput>,
) -> ApiResult<(StatusCode, Json<Component>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_project(&mut tx, &i, p).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(bad("Component name must be between 1 and 60 characters"));
    }
    if v.description.as_ref().is_some_and(|d| d.len() > 2000) {
        return Err(bad("Description is limited to 2000 characters"));
    }
    if let Some(user) = v.default_assignee_id {
        if !active_member(&mut tx, i.tenant_id, user).await? {
            return Err(bad(
                "Default assignee must be an active member of this workspace",
            ));
        }
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO components(tenant_id,project_id,name,description,default_assignee_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(&name)
    .bind(v.description.unwrap_or_default())
    .bind(v.default_assignee_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref d) = e {
            if d.code().as_deref() == Some("23505") {
                return err(StatusCode::CONFLICT, "A component with this name already exists");
            }
        }
        db_err(e)
    })?;
    log_event(&mut tx, &i, "created", "component", id).await?;
    Ok((
        StatusCode::CREATED,
        Json(load_component(&mut tx, i.tenant_id, id).await?),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ComponentPatch {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) default_assignee_id: Option<Uuid>,
    /// `true` removes the default assignee.
    pub(crate) clear_default_assignee: Option<bool>,
}

#[utoipa::path(patch, path = "/api/components/{id}", tag = "components", params(("id" = Uuid, Path, description = "Resource id")), request_body = ComponentPatch, responses((status = 200, description = "Success", body = Component), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_component(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ComponentPatch>,
) -> ApiResult<Json<Component>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "components", id).await?;
    require_editor(&i)?;
    if let Some(n) = &v.name {
        let n = n.trim();
        if n.is_empty() || n.chars().count() > 60 {
            return Err(bad("Component name must be between 1 and 60 characters"));
        }
    }
    if let Some(user) = v.default_assignee_id {
        if !active_member(&mut tx, i.tenant_id, user).await? {
            return Err(bad(
                "Default assignee must be an active member of this workspace",
            ));
        }
    }
    let clear = v.clear_default_assignee.unwrap_or(false);
    sqlx::query(
        "UPDATE components SET name=COALESCE($1,name), description=COALESCE($2,description), \
         default_assignee_id=CASE WHEN $3 THEN NULL ELSE COALESCE($4,default_assignee_id) END \
         WHERE tenant_id=$5 AND id=$6",
    )
    .bind(v.name.map(|n| n.trim().to_string()))
    .bind(v.description)
    .bind(clear)
    .bind(v.default_assignee_id)
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref d) = e {
            if d.code().as_deref() == Some("23505") {
                return err(
                    StatusCode::CONFLICT,
                    "A component with this name already exists",
                );
            }
        }
        db_err(e)
    })?;
    log_event(&mut tx, &i, "updated", "component", id).await?;
    Ok(Json(load_component(&mut tx, i.tenant_id, id).await?))
}

#[utoipa::path(delete, path = "/api/components/{id}", tag = "components", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted. Issues keep their other components"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_component(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "components", id).await?;
    require_editor(&i)?;
    sqlx::query("DELETE FROM components WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "deleted", "component", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct IssueComponentsInput {
    /// The complete set of components for the issue (at most 20). Empty clears them.
    pub(crate) component_ids: Vec<Uuid>,
}

#[utoipa::path(get, path = "/api/issues/{id}/components", tag = "components", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Component>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_components(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<Component>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let rows: Vec<Component> = sqlx::query_as(&format!(
        "{COMPONENT_SELECT} WHERE c.tenant_id=$1 AND c.id IN (SELECT component_id FROM issue_components WHERE tenant_id=$1 AND issue_id=$2) ORDER BY c.name"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(put, path = "/api/issues/{id}/components", tag = "components", params(("id" = Uuid, Path, description = "Resource id")), request_body = IssueComponentsInput, responses((status = 200, description = "Success", body = Vec<Component>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_issue_components(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<IssueComponentsInput>,
) -> ApiResult<Json<Vec<Component>>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    let mut ids: Vec<Uuid> = Vec::new();
    for c in &v.component_ids {
        if !ids.contains(c) {
            ids.push(*c);
        }
    }
    if ids.len() > 20 {
        return Err(bad("An issue can have at most 20 components"));
    }
    if !ids.is_empty() {
        let found: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM components WHERE tenant_id=$1 AND project_id=$2 AND id = ANY($3)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(&ids)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if found as usize != ids.len() {
            return Err(bad("Every component must belong to this issue's project"));
        }
    }
    sqlx::query("DELETE FROM issue_components WHERE tenant_id=$1 AND issue_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    for c in &ids {
        sqlx::query(
            "INSERT INTO issue_components(tenant_id,issue_id,component_id) VALUES($1,$2,$3)",
        )
        .bind(i.tenant_id)
        .bind(id)
        .bind(c)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    // An unassigned issue takes the default assignee of the first component that has one.
    if let Some(first_default) = ids.iter().copied().next() {
        let default: Option<Uuid> = sqlx::query_scalar(
            "SELECT default_assignee_id FROM components WHERE tenant_id=$1 AND id=$2",
        )
        .bind(i.tenant_id)
        .bind(first_default)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if let Some(user) = default {
            sqlx::query(
                "UPDATE issues SET assignee_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3 AND assignee_id IS NULL",
            )
            .bind(user)
            .bind(i.tenant_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        }
    }
    log_event(&mut tx, &i, "updated", "issue", id).await?;
    let rows: Vec<Component> = sqlx::query_as(&format!(
        "{COMPONENT_SELECT} WHERE c.tenant_id=$1 AND c.id IN (SELECT component_id FROM issue_components WHERE tenant_id=$1 AND issue_id=$2) ORDER BY c.name"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------------------------
// F4. Estimates, worklogs, watchers and votes
// ---------------------------------------------------------------------------------------------

/// Estimates and logged time for one issue. Minutes everywhere.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct Estimates {
    pub(crate) original_minutes: Option<i32>,
    pub(crate) remaining_minutes: Option<i32>,
    /// Sum of worklogs on this issue.
    pub(crate) logged_minutes: i64,
}

async fn load_estimates(db: &mut PgConnection, tenant: Uuid, id: Uuid) -> ApiResult<Estimates> {
    let (original, remaining, logged): (Option<i32>, Option<i32>, i64) = sqlx::query_as(
        "SELECT i.original_estimate_minutes, i.remaining_estimate_minutes, \
         COALESCE((SELECT sum(w.minutes) FROM worklogs w WHERE w.tenant_id=i.tenant_id AND w.issue_id=i.id),0)::bigint \
         FROM issues i WHERE i.tenant_id=$1 AND i.id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))?;
    Ok(Estimates {
        original_minutes: original,
        remaining_minutes: remaining,
        logged_minutes: logged,
    })
}

#[utoipa::path(get, path = "/api/issues/{id}/estimates", tag = "time", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Estimates), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_estimates(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Estimates>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    Ok(Json(load_estimates(&mut tx, i.tenant_id, id).await?))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct EstimatesInput {
    /// Replaces the original estimate. `null` clears it.
    pub(crate) original_minutes: Option<i32>,
    /// Replaces the remaining estimate. `null` clears it.
    pub(crate) remaining_minutes: Option<i32>,
}

#[utoipa::path(put, path = "/api/issues/{id}/estimates", tag = "time", params(("id" = Uuid, Path, description = "Resource id")), request_body = EstimatesInput, responses((status = 200, description = "Success", body = Estimates), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_estimates(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<EstimatesInput>,
) -> ApiResult<Json<Estimates>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    for m in [v.original_minutes, v.remaining_minutes]
        .into_iter()
        .flatten()
    {
        if !(0..=MAX_MINUTES).contains(&m) {
            return Err(bad("Estimates must be between 0 and 100000000 minutes"));
        }
    }
    sqlx::query(
        "UPDATE issues SET original_estimate_minutes=$1, remaining_estimate_minutes=$2, updated_at=now() WHERE tenant_id=$3 AND id=$4",
    )
    .bind(v.original_minutes)
    .bind(v.remaining_minutes)
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "updated", "issue", id).await?;
    Ok(Json(load_estimates(&mut tx, i.tenant_id, id).await?))
}

/// One worklog: time an author spent on an issue.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Worklog {
    pub(crate) id: Uuid,
    pub(crate) issue_id: Uuid,
    pub(crate) author_id: Uuid,
    pub(crate) author_name: String,
    pub(crate) minutes: i32,
    /// Day the work was done, `YYYY-MM-DD`.
    pub(crate) started_on: String,
    pub(crate) comment: String,
    pub(crate) created_at: DateTime<Utc>,
}

const WORKLOG_SELECT: &str = "SELECT w.id, w.issue_id, w.author_id, u.display_name AS author_name, w.minutes, \
 to_char(w.started_on,'YYYY-MM-DD') AS started_on, w.comment, w.created_at FROM worklogs w JOIN users u ON u.id=w.author_id";

#[utoipa::path(get, path = "/api/issues/{id}/worklogs", tag = "time", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Worklog>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_worklogs(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<Worklog>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let rows: Vec<Worklog> = sqlx::query_as(&format!(
        "{WORKLOG_SELECT} WHERE w.tenant_id=$1 AND w.issue_id=$2 ORDER BY w.started_on DESC, w.created_at DESC LIMIT 500"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WorklogInput {
    pub(crate) minutes: i32,
    /// Day the work was done, `YYYY-MM-DD`. Defaults to today (UTC).
    pub(crate) started_on: Option<String>,
    pub(crate) comment: Option<String>,
}

#[utoipa::path(post, path = "/api/issues/{id}/worklogs", tag = "time", params(("id" = Uuid, Path, description = "Resource id")), request_body = WorklogInput, responses((status = 201, description = "Success", body = Worklog), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_worklog(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<WorklogInput>,
) -> ApiResult<(StatusCode, Json<Worklog>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    if !(1..=MAX_MINUTES).contains(&v.minutes) {
        return Err(bad("Worklog minutes must be between 1 and 100000000"));
    }
    let day = match v.started_on.as_deref() {
        None | Some("") => Utc::now().date_naive(),
        Some(raw) => NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map_err(|_| bad("started_on must be YYYY-MM-DD"))?,
    };
    let comment = v.comment.unwrap_or_default();
    if comment.len() > 2000 {
        return Err(bad("Worklog comment is limited to 2000 characters"));
    }
    let row_id: Uuid = sqlx::query_scalar(
        "INSERT INTO worklogs(tenant_id,issue_id,author_id,minutes,started_on,comment) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(i.user_id)
    .bind(v.minutes)
    .bind(day)
    .bind(comment)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "logged_time", "issue", id).await?;
    let row: Worklog = sqlx::query_as(&format!(
        "{WORKLOG_SELECT} WHERE w.tenant_id=$1 AND w.id=$2"
    ))
    .bind(i.tenant_id)
    .bind(row_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/worklogs/{id}", tag = "time", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_worklog(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let (issue, author): (Uuid, Uuid) =
        sqlx::query_as("SELECT issue_id, author_id FROM worklogs WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Worklog not found"))?;
    valid_issue(&mut tx, &i, issue).await?;
    // Only the author, or an admin, may remove logged time.
    if author != i.user_id {
        require_admin(&i)?;
    }
    sqlx::query("DELETE FROM worklogs WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "deleted", "worklog", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A workspace member as shown for watchers.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Person {
    pub(crate) user_id: Uuid,
    pub(crate) display_name: String,
}

#[utoipa::path(get, path = "/api/issues/{id}/watchers", tag = "watch", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Person>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_watchers(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<Person>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    Ok(Json(watchers(&mut tx, i.tenant_id, id).await?))
}

async fn watchers(db: &mut PgConnection, tenant: Uuid, issue: Uuid) -> ApiResult<Vec<Person>> {
    sqlx::query_as(
        "SELECT w.user_id, u.display_name FROM issue_watchers w JOIN users u ON u.id=w.user_id \
         WHERE w.tenant_id=$1 AND w.issue_id=$2 ORDER BY u.display_name",
    )
    .bind(tenant)
    .bind(issue)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WatchInput {
    /// The member to add. Omit to watch the issue yourself.
    pub(crate) user_id: Option<Uuid>,
}

#[utoipa::path(post, path = "/api/issues/{id}/watchers", tag = "watch", params(("id" = Uuid, Path, description = "Resource id")), request_body = WatchInput, responses((status = 200, description = "Watchers after the change", body = Vec<Person>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_watcher(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<WatchInput>,
) -> ApiResult<Json<Vec<Person>>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    let user = v.user_id.unwrap_or(i.user_id);
    if !active_member(&mut tx, i.tenant_id, user).await? {
        return Err(bad("Watcher must be an active member of this workspace"));
    }
    sqlx::query(
        "INSERT INTO issue_watchers(tenant_id,issue_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(user)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(watchers(&mut tx, i.tenant_id, id).await?))
}

#[utoipa::path(delete, path = "/api/issues/{id}/watchers/{user_id}", tag = "watch", params(("id" = Uuid, Path, description = "Resource id"), ("user_id" = Uuid, Path, description = "Member id")), responses((status = 200, description = "Watchers after the change", body = Vec<Person>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_watcher(
    mut tx: Tx,
    Path((id, user)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Vec<Person>>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    if user != i.user_id {
        require_admin(&i)?;
    }
    sqlx::query("DELETE FROM issue_watchers WHERE tenant_id=$1 AND issue_id=$2 AND user_id=$3")
        .bind(i.tenant_id)
        .bind(id)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(Json(watchers(&mut tx, i.tenant_id, id).await?))
}

/// Votes on an issue, and whether the caller has voted.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct Votes {
    pub(crate) count: i64,
    pub(crate) voted: bool,
}

async fn votes(db: &mut PgConnection, tenant: Uuid, issue: Uuid, me: Uuid) -> ApiResult<Votes> {
    let (count, voted): (i64, bool) = sqlx::query_as(
        "SELECT count(*), COALESCE(bool_or(user_id=$3), false) FROM issue_votes WHERE tenant_id=$1 AND issue_id=$2",
    )
    .bind(tenant)
    .bind(issue)
    .bind(me)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(Votes { count, voted })
}

#[utoipa::path(get, path = "/api/issues/{id}/votes", tag = "watch", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Votes), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_votes(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Votes>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    Ok(Json(votes(&mut tx, i.tenant_id, id, i.user_id).await?))
}

#[utoipa::path(post, path = "/api/issues/{id}/vote", tag = "watch", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Votes), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn cast_vote(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Votes>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    sqlx::query("INSERT INTO issue_votes(tenant_id,issue_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING")
        .bind(i.tenant_id)
        .bind(id)
        .bind(i.user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(Json(votes(&mut tx, i.tenant_id, id, i.user_id).await?))
}

#[utoipa::path(delete, path = "/api/issues/{id}/vote", tag = "watch", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Votes), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn withdraw_vote(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Votes>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    sqlx::query("DELETE FROM issue_votes WHERE tenant_id=$1 AND issue_id=$2 AND user_id=$3")
        .bind(i.tenant_id)
        .bind(id)
        .bind(i.user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(Json(votes(&mut tx, i.tenant_id, id, i.user_id).await?))
}

// ---------------------------------------------------------------------------------------------
// F5. Checklists
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ChecklistItem {
    pub(crate) id: Uuid,
    pub(crate) issue_id: Uuid,
    pub(crate) text: String,
    pub(crate) done: bool,
    pub(crate) position: f64,
}

#[utoipa::path(get, path = "/api/issues/{id}/checklist", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<ChecklistItem>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_checklist(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<ChecklistItem>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let rows: Vec<ChecklistItem> = sqlx::query_as(
        "SELECT id, issue_id, text, done, position FROM checklist_items WHERE tenant_id=$1 AND issue_id=$2 ORDER BY position",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ChecklistInput {
    pub(crate) text: String,
}

#[utoipa::path(post, path = "/api/issues/{id}/checklist", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = ChecklistInput, responses((status = 201, description = "Success", body = ChecklistItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_checklist_item(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ChecklistInput>,
) -> ApiResult<(StatusCode, Json<ChecklistItem>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_issue(&mut tx, &i, id).await?;
    let text = v.text.trim().to_string();
    if text.is_empty() || text.chars().count() > 500 {
        return Err(bad("Checklist items must be between 1 and 500 characters"));
    }
    let row: ChecklistItem = sqlx::query_as(
        "INSERT INTO checklist_items(tenant_id,issue_id,text,position) VALUES($1,$2,$3, \
         COALESCE((SELECT max(position) FROM checklist_items WHERE tenant_id=$1 AND issue_id=$2),0)+1) \
         RETURNING id, issue_id, text, done, position",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(text)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ChecklistPatch {
    pub(crate) text: Option<String>,
    pub(crate) done: Option<bool>,
    /// New position. Items keep their order between neighbours, like the backlog rank.
    pub(crate) position: Option<f64>,
}

#[utoipa::path(patch, path = "/api/checklist/{id}", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = ChecklistPatch, responses((status = 200, description = "Success", body = ChecklistItem), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_checklist_item(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ChecklistPatch>,
) -> ApiResult<Json<ChecklistItem>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let issue: Uuid =
        sqlx::query_scalar("SELECT issue_id FROM checklist_items WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Checklist item not found"))?;
    valid_issue(&mut tx, &i, issue).await?;
    if let Some(t) = &v.text {
        let t = t.trim();
        if t.is_empty() || t.chars().count() > 500 {
            return Err(bad("Checklist items must be between 1 and 500 characters"));
        }
    }
    if v.position.is_some_and(|p| !p.is_finite()) {
        return Err(bad("position must be a finite number"));
    }
    let row: ChecklistItem = sqlx::query_as(
        "UPDATE checklist_items SET text=COALESCE($1,text), done=COALESCE($2,done), position=COALESCE($3,position) \
         WHERE tenant_id=$4 AND id=$5 RETURNING id, issue_id, text, done, position",
    )
    .bind(v.text.map(|t| t.trim().to_string()))
    .bind(v.done)
    .bind(v.position)
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/checklist/{id}", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_checklist_item(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let issue: Uuid =
        sqlx::query_scalar("SELECT issue_id FROM checklist_items WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "Checklist item not found"))?;
    valid_issue(&mut tx, &i, issue).await?;
    sqlx::query("DELETE FROM checklist_items WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// F2. Subtasks and roll-up
// ---------------------------------------------------------------------------------------------

/// A subtask of an issue.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct ChildIssue {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) assignee_id: Option<Uuid>,
    pub(crate) story_points: Option<i32>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) done: bool,
}

#[utoipa::path(get, path = "/api/issues/{id}/children", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<ChildIssue>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_children(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<ChildIssue>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let done = done_predicate("i");
    let rows: Vec<ChildIssue> = sqlx::query_as(&format!(
        "SELECT i.id, i.project_id, i.number, i.title, i.kind, i.status, i.priority, i.assignee_id, i.story_points, i.updated_at, {done} AS done \
         FROM issues i WHERE i.tenant_id=$1 AND i.parent_id=$2 AND i.archived_at IS NULL ORDER BY i.number"
    ))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

/// Progress of an issue's subtasks, with time totals across the subtasks and the issue itself.
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct Rollup {
    pub(crate) children: i64,
    pub(crate) children_done: i64,
    pub(crate) points_total: i64,
    pub(crate) points_done: i64,
    pub(crate) original_minutes_total: i64,
    pub(crate) remaining_minutes_total: i64,
    pub(crate) logged_minutes_total: i64,
}

#[utoipa::path(get, path = "/api/issues/{id}/rollup", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Rollup), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn rollup(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Rollup>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let done = done_predicate("c");
    let sql = format!(
        "SELECT count(*), count(*) FILTER (WHERE {done}), COALESCE(sum(c.story_points),0)::bigint, \
         COALESCE(sum(c.story_points) FILTER (WHERE {done}),0)::bigint, \
         COALESCE(sum(c.original_estimate_minutes),0)::bigint, COALESCE(sum(c.remaining_estimate_minutes),0)::bigint \
         FROM issues c WHERE c.tenant_id=$1 AND c.parent_id=$2 AND c.archived_at IS NULL"
    );
    let (children, children_done, points_total, points_done, orig, rem): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = sqlx::query_as(&sql)
        .bind(i.tenant_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let logged: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(w.minutes),0)::bigint FROM worklogs w JOIN issues c ON c.tenant_id=w.tenant_id AND c.id=w.issue_id \
         WHERE w.tenant_id=$1 AND (c.id=$2 OR (c.parent_id=$2 AND c.archived_at IS NULL))",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let own: (Option<i32>, Option<i32>) = sqlx::query_as(
        "SELECT original_estimate_minutes, remaining_estimate_minutes FROM issues WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(Rollup {
        children,
        children_done,
        points_total,
        points_done,
        original_minutes_total: orig + i64::from(own.0.unwrap_or(0)),
        remaining_minutes_total: rem + i64::from(own.1.unwrap_or(0)),
        logged_minutes_total: logged,
    }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SubtaskInput {
    pub(crate) title: String,
    pub(crate) kind: Option<String>,
}

#[utoipa::path(post, path = "/api/issues/{id}/subtasks", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = SubtaskInput, responses((status = 201, description = "Success", body = crate::api::work::Issue), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_subtask(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<SubtaskInput>,
) -> ApiResult<(StatusCode, Json<crate::api::work::Issue>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    validate_title(&v.title)?;
    let kind = match v.kind {
        Some(k) => k,
        None => crate::api::issue_types::default_type(&mut tx, i.tenant_id, project).await?,
    };
    if crate::api::issue_types::type_level(&mut tx, i.tenant_id, project, &kind).await? != Some(0) {
        return Err(bad(
            "A subtask is a standard issue type of this project (not epic level)",
        ));
    }
    // Subtasks sit one level below their parent; a subtask cannot take its own subtasks.
    let parent_parent: Option<Uuid> =
        sqlx::query_scalar("SELECT parent_id FROM issues WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if parent_parent.is_some() {
        return Err(bad("Subtasks cannot have subtasks of their own"));
    }
    sqlx::query("SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let status = crate::api::statuses::default_status(&mut tx, i.tenant_id, project).await?;
    let row: crate::api::work::Issue = sqlx::query_as(
        "INSERT INTO issues(tenant_id,project_id,number,title,kind,priority,created_by,status,parent_id) \
         VALUES($1,$2,$3,$4,$5,'medium',$6,$7,$8) \
         RETURNING id,project_id,number,title,description,kind,status,priority,created_at,updated_at",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(next)
    .bind(v.title.trim())
    .bind(kind)
    .bind(i.user_id)
    .bind(status)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "created", "issue", row.id).await?;
    crate::api::history::record_status(&mut tx, i.tenant_id, row.id, None, &row.status, i.user_id)
        .await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.created",
        row.id,
        json!({"project_id":project,"parent_id":id}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

// ---------------------------------------------------------------------------------------------
// F6. Clone, move and similar issues
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct CloneInput {
    /// Title of the copy. Defaults to "Copy of" the original title.
    pub(crate) title: Option<String>,
}

#[utoipa::path(post, path = "/api/issues/{id}/clone", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = CloneInput, responses((status = 201, description = "Success", body = crate::api::work::Issue), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn clone_issue(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<CloneInput>,
) -> ApiResult<(StatusCode, Json<crate::api::work::Issue>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let project = valid_issue(&mut tx, &i, id).await?;
    let title = match v.title {
        Some(t) => {
            validate_title(&t)?;
            t.trim().to_string()
        }
        None => {
            let original: String =
                sqlx::query_scalar("SELECT title FROM issues WHERE tenant_id=$1 AND id=$2")
                    .bind(i.tenant_id)
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db_err)?;
            let copy = format!("Copy of {original}");
            copy.chars().take(250).collect()
        }
    };
    sqlx::query("SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let status = crate::api::statuses::default_status(&mut tx, i.tenant_id, project).await?;
    // The copy keeps content, classification, estimates and components. It does not keep the
    // assignee, sprint, parent or subtasks, and it starts in the project's first To do status.
    let row_project = sqlx::query_scalar::<_, Uuid>("SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let row: crate::api::work::Issue = sqlx::query_as(
        "INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,created_by,status,labels,custom_fields,story_points,team_id,original_estimate_minutes,remaining_estimate_minutes) \
         SELECT tenant_id,project_id,$3,$4,description,kind,priority,$5,$6,labels,custom_fields,story_points,team_id,original_estimate_minutes,remaining_estimate_minutes \
         FROM issues WHERE tenant_id=$1 AND id=$2 \
         RETURNING id,project_id,number,title,description,kind,status,priority,created_at,updated_at",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(next)
    .bind(title)
    .bind(i.user_id)
    .bind(status)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    // A copy made by a member does not carry restricted field values (Phase J2).
    if project_level(&mut tx, &i, row_project).await?.unwrap_or(0) < 3 {
        let hidden = crate::api::fields::restricted_keys(&mut tx, i.tenant_id, row_project).await?;
        sqlx::query("UPDATE issues SET custom_fields = custom_fields - $3::text[] WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(row.id)
            .bind(&hidden)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    sqlx::query(
        "INSERT INTO issue_components(tenant_id,issue_id,component_id) SELECT tenant_id,$3,component_id FROM issue_components WHERE tenant_id=$1 AND issue_id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(row.id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "created", "issue", row.id).await?;
    crate::api::history::record_status(&mut tx, i.tenant_id, row.id, None, &row.status, i.user_id)
        .await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.created",
        row.id,
        json!({"project_id":project,"cloned_from":id}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct MoveInput {
    pub(crate) project_id: Uuid,
}

/// Result of a move: the issue under its new key, and any custom field values the target project
/// does not define (those are dropped, and named here so nothing disappears silently).
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct MoveResult {
    pub(crate) issue: crate::api::work::Issue,
    pub(crate) dropped_fields: Vec<String>,
}

#[utoipa::path(post, path = "/api/issues/{id}/move", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = MoveInput, responses((status = 200, description = "Success", body = MoveResult), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn move_issue(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<MoveInput>,
) -> ApiResult<Json<MoveResult>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let source = valid_issue(&mut tx, &i, id).await?;
    if v.project_id == source {
        return Err(bad("Choose a different project"));
    }
    valid_project(&mut tx, &i, v.project_id).await?;
    let (number, parent): (i64, Option<Uuid>) =
        sqlx::query_as("SELECT number, parent_id FROM issues WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    if parent.is_some() {
        return Err(bad("Detach the issue from its parent before moving it"));
    }
    let has_children: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues WHERE tenant_id=$1 AND parent_id=$2 AND archived_at IS NULL)",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if has_children {
        return Err(bad("Move or detach the subtasks before moving this issue"));
    }
    // Keep the current status when the target project has it, otherwise start from its first To do status.
    let current_status: String =
        sqlx::query_scalar("SELECT status FROM issues WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    let previous_status = current_status.clone();
    let status = if crate::api::statuses::status_defined(
        &mut tx,
        i.tenant_id,
        v.project_id,
        &current_status,
    )
    .await?
    {
        current_status
    } else {
        crate::api::statuses::default_status(&mut tx, i.tenant_id, v.project_id).await?
    };
    // The issue type survives when the target project defines it; otherwise the target's default applies.
    let current_kind: String =
        sqlx::query_scalar("SELECT kind FROM issues WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    let kind =
        crate::api::issue_types::type_or_default(&mut tx, i.tenant_id, v.project_id, &current_kind)
            .await?;
    // Custom fields survive only when the target project defines the same key.
    let custom: Value =
        sqlx::query_scalar("SELECT custom_fields FROM issues WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    // Members cannot move an issue that holds restricted values: the values would be lost or exposed.
    if project_level(&mut tx, &i, source).await?.unwrap_or(0) < 3 {
        let hidden = crate::api::fields::restricted_keys(&mut tx, i.tenant_id, source).await?;
        if hidden.iter().any(|k| custom.get(k).is_some()) {
            return Err(bad("This issue holds restricted fields. A project admin must move it"));
        }
    }
    let defined: Vec<String> = sqlx::query_scalar(
        "SELECT key FROM field_definitions WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(v.project_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let defined: HashSet<String> = defined.into_iter().collect();
    let mut kept = serde_json::Map::new();
    let mut dropped = Vec::new();
    if let Some(obj) = custom.as_object() {
        for (k, val) in obj {
            if defined.contains(k) {
                kept.insert(k.clone(), val.clone());
            } else {
                dropped.push(k.clone());
            }
        }
    }
    sqlx::query("SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(i.tenant_id)
        .bind(v.project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(v.project_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: crate::api::work::Issue = sqlx::query_as(
        "UPDATE issues SET project_id=$1, number=$2, status=$3, custom_fields=$4, kind=$7, sprint_id=NULL, \
         backlog_rank=(SELECT COALESCE(MAX(backlog_rank),0)+1 FROM issues WHERE tenant_id=$5 AND project_id=$1), updated_at=now() \
         WHERE tenant_id=$5 AND id=$6 \
         RETURNING id,project_id,number,title,description,kind,status,priority,created_at,updated_at",
    )
    .bind(v.project_id)
    .bind(next)
    .bind(status)
    .bind(Value::Object(kept))
    .bind(i.tenant_id)
    .bind(id)
    .bind(kind)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    // Components belong to a project, and release scope is per project: both are released here.
    sqlx::query("DELETE FROM issue_components WHERE tenant_id=$1 AND issue_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query(
        "UPDATE release_issues SET removed_at=now(), removed_by=$1, removed_after_freeze=false \
         WHERE tenant_id=$2 AND issue_id=$3 AND removed_at IS NULL",
    )
    .bind(i.user_id)
    .bind(i.tenant_id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    let old_key: String =
        sqlx::query_scalar("SELECT key FROM projects WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(source)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    let new_key: String =
        sqlx::query_scalar("SELECT key FROM projects WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(v.project_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    // A comment records where the issue came from, so the old key still leads to the story.
    sqlx::query(
        "INSERT INTO issue_comments(tenant_id,issue_id,author_id,body) VALUES($1,$2,$3,$4)",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(i.user_id)
    .bind(format!(
        "Moved from {old_key}-{number} to {new_key}-{}",
        row.number
    ))
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    if previous_status != row.status {
        crate::api::history::record_status(
            &mut tx,
            i.tenant_id,
            id,
            Some(&previous_status),
            &row.status,
            i.user_id,
        )
        .await?;
    }
    crate::api::history::record_change(
        &mut tx,
        i.tenant_id,
        id,
        i.user_id,
        "project",
        Some(old_key.clone()),
        Some(new_key.clone()),
    )
    .await?;
    log_event(&mut tx, &i, "moved", "issue", id).await?;
    log_outbox(
        &mut tx,
        i.tenant_id,
        "issue.updated",
        id,
        json!({"project_id":v.project_id,"moved_from":source}),
    )
    .await?;
    Ok(Json(MoveResult {
        issue: row,
        dropped_fields: dropped,
    }))
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct SimilarQuery {
    /// Words from a title to look for, up to 200 characters.
    pub(crate) title: String,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct SimilarIssue {
    pub(crate) id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) status: String,
    /// Full-text relevance; higher is closer.
    pub(crate) score: f32,
}

#[utoipa::path(get, path = "/api/projects/{id}/similar", tag = "issues", params(("id" = Uuid, Path, description = "Resource id"), SimilarQuery), responses((status = 200, description = "Up to five active issues whose titles share words with the query", body = Vec<SimilarIssue>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn similar_issues(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<SimilarQuery>,
) -> ApiResult<Json<Vec<SimilarIssue>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let text = q.title.trim();
    if text.is_empty() || text.chars().count() > 200 {
        return Err(bad("title must be between 1 and 200 characters"));
    }
    let rows: Vec<SimilarIssue> = sqlx::query_as(
        "SELECT id, number, title, status, ts_rank(to_tsvector('simple', title), plainto_tsquery('simple', $3))::real AS score \
         FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL \
         AND to_tsvector('simple', title) @@ plainto_tsquery('simple', $3) \
         ORDER BY score DESC, number DESC LIMIT 5",
    )
    .bind(i.tenant_id)
    .bind(p)
    .bind(text)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route(
            "/api/projects/{id}/components",
            get(list_components).post(create_component),
        )
        .route(
            "/api/components/{id}",
            patch(update_component).delete(delete_component),
        )
        .route(
            "/api/issues/{id}/components",
            get(issue_components).put(set_issue_components),
        )
        .route(
            "/api/issues/{id}/estimates",
            get(get_estimates).put(set_estimates),
        )
        .route(
            "/api/issues/{id}/worklogs",
            get(list_worklogs).post(add_worklog),
        )
        .route("/api/worklogs/{id}", delete(delete_worklog))
        .route(
            "/api/issues/{id}/watchers",
            get(list_watchers).post(add_watcher),
        )
        .route(
            "/api/issues/{id}/watchers/{user_id}",
            delete(remove_watcher),
        )
        .route("/api/issues/{id}/votes", get(get_votes))
        .route(
            "/api/issues/{id}/vote",
            post(cast_vote).delete(withdraw_vote),
        )
        .route(
            "/api/issues/{id}/checklist",
            get(list_checklist).post(add_checklist_item),
        )
        .route(
            "/api/checklist/{id}",
            patch(update_checklist_item).delete(delete_checklist_item),
        )
        .route("/api/issues/{id}/children", get(list_children))
        .route("/api/issues/{id}/rollup", get(rollup))
        .route("/api/issues/{id}/subtasks", post(create_subtask))
        .route("/api/issues/{id}/clone", post(clone_issue))
        .route("/api/issues/{id}/move", post(move_issue))
        .route("/api/projects/{id}/similar", get(similar_issues))
}

/// `@handle` mentions in a comment. A handle is the part of a member's email before the `@`,
/// lower case, letters, digits, dots, dashes and underscores. Duplicates are removed.
pub(crate) fn mention_handles(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let chars: Vec<char> = body.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '@' && (i == 0 || !chars[i - 1].is_alphanumeric()) {
            let start = i + 1;
            let mut end = start;
            while end < chars.len()
                && (chars[end].is_ascii_alphanumeric() || "._-".contains(chars[end]))
            {
                end += 1;
            }
            if end > start && end - start <= 64 {
                let handle: String = chars[start..end]
                    .iter()
                    .collect::<String>()
                    .to_ascii_lowercase();
                if !out.contains(&handle) {
                    out.push(handle);
                }
            }
            i = end.max(i + 1);
        } else {
            i += 1;
        }
    }
    out
}

/// Notifies members named in a comment. Runs in the comment's transaction.
pub(crate) async fn notify_mentions(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Uuid,
    issue: Uuid,
    body: &str,
) -> ApiResult<()> {
    notify_handles(db, tenant, actor, issue, &mention_handles(body)).await
}

/// Tells each member named by a handle that they were mentioned on the issue.
pub(crate) async fn notify_handles(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Uuid,
    issue: Uuid,
    handles: &[String],
) -> ApiResult<()> {
    if handles.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id) \
         SELECT m.tenant_id, m.user_id, $2, 'mention', 'You were mentioned in a comment', '', 'issue', $3 \
         FROM memberships m JOIN users u ON u.id=m.user_id \
         WHERE m.tenant_id=$1 AND m.disabled_at IS NULL AND m.user_id<>$2 AND lower(split_part(u.email,'@',1)) = ANY($4)",
    )
    .bind(tenant)
    .bind(actor)
    .bind(issue)
    .bind(handles)
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(())
}
