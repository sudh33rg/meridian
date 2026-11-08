//! Issue history (Phase G1 and G3): every status change and every tracked field change is written
//! in the same transaction as the change. Reports and the issue timeline read these rows.
use crate::api::common::*;
use crate::*;
use axum::routing::get;
use serde_json::Value;

/// Fields whose before and after values are recorded in the change log. Status has its own table.
const TRACKED_FIELDS: [&str; 10] = [
    "title",
    "description",
    "kind",
    "priority",
    "assignee_id",
    "sprint_id",
    "parent_id",
    "story_points",
    "due_at",
    "team_id",
];

/// Records a status change. `from` is `None` when the issue is created.
pub(crate) async fn record_status(
    db: &mut PgConnection,
    tenant: Uuid,
    issue: Uuid,
    from: Option<&str>,
    to: &str,
    actor: Uuid,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO issue_status_history(tenant_id,issue_id,from_status,to_status,actor_id) VALUES($1,$2,$3,$4,$5)",
    )
    .bind(tenant)
    .bind(issue)
    .bind(from)
    .bind(to)
    .bind(actor)
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    // The chat message for this change is queued in the same transaction (Phase I3).
    crate::api::chat::queue_change(db, tenant, issue, from, to, actor).await?;
    Ok(())
}

/// Records one field change with its before and after text.
pub(crate) async fn record_change(
    db: &mut PgConnection,
    tenant: Uuid,
    issue: Uuid,
    actor: Uuid,
    field: &str,
    old: Option<String>,
    new: Option<String>,
) -> ApiResult<()> {
    if old == new {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO issue_changes(tenant_id,issue_id,field,old_value,new_value,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(tenant)
    .bind(issue)
    .bind(field)
    .bind(old)
    .bind(new)
    .bind(actor)
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(())
}

/// The issue as a JSON row, taken before a change so the change can be compared with it afterwards.
pub(crate) async fn issue_json(
    db: &mut PgConnection,
    tenant: Uuid,
    issue: Uuid,
) -> ApiResult<Value> {
    sqlx::query_scalar("SELECT to_jsonb(issues) FROM issues WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(issue)
        .fetch_optional(&mut *db)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))
}

fn text_of(v: Option<&Value>) -> Option<String> {
    match v {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(other) => Some(other.to_string()),
    }
}

/// Compares an issue before and after a write and records what changed: status into the status
/// history, tracked fields into the change log. Called from every write path that edits an issue.
pub(crate) async fn record_row_changes(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Uuid,
    issue: Uuid,
    before: &Value,
    after: &Value,
) -> ApiResult<()> {
    let (old_status, new_status) = (text_of(before.get("status")), text_of(after.get("status")));
    if old_status != new_status {
        if let Some(to) = new_status.as_deref() {
            record_status(db, tenant, issue, old_status.as_deref(), to, actor).await?;
            if let Some(from) = old_status.as_deref() {
                crate::api::transitions::run_post_functions(db, tenant, actor, issue, from, to)
                    .await?;
            }
        }
    }
    for field in TRACKED_FIELDS {
        record_change(
            db,
            tenant,
            issue,
            actor,
            field,
            text_of(before.get(field)),
            text_of(after.get(field)),
        )
        .await?;
    }
    Ok(())
}

/// One entry of an issue's timeline.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct IssueHistoryEntry {
    /// `status` or `field`.
    pub(crate) kind: String,
    /// The field that changed, for `field` entries.
    pub(crate) field: Option<String>,
    pub(crate) old_value: Option<String>,
    pub(crate) new_value: Option<String>,
    pub(crate) actor_id: Uuid,
    pub(crate) actor_name: String,
    pub(crate) changed_at: DateTime<Utc>,
}

#[utoipa::path(get, path = "/api/issues/{id}/history", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Status and field changes, newest first", body = Vec<IssueHistoryEntry>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn issue_history(
    mut tx: Tx,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<IssueHistoryEntry>>> {
    let i = tx.identity.clone();
    ensure_entity_access(&mut tx, "issues", id).await?;
    let project: Uuid = sqlx::query_scalar("SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let rows: Vec<IssueHistoryEntry> = sqlx::query_as(
        "SELECT x.kind, x.field, x.old_value, x.new_value, x.actor_id, x.actor_name, x.changed_at FROM (\
           SELECT 'status'::text AS kind, NULL::text AS field, h.from_status AS old_value, h.to_status AS new_value, \
             h.actor_id, u.display_name AS actor_name, h.changed_at \
           FROM issue_status_history h JOIN users u ON u.id=h.actor_id WHERE h.tenant_id=$1 AND h.issue_id=$2 \
           UNION ALL \
           SELECT 'field'::text, c.field, c.old_value, c.new_value, c.actor_id, u.display_name, c.changed_at \
           FROM issue_changes c JOIN users u ON u.id=c.actor_id WHERE c.tenant_id=$1 AND c.issue_id=$2) x \
         ORDER BY x.changed_at DESC LIMIT 500",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    // Changes to restricted fields are shown to project admins only (Phase J2).
    let mut rows = rows;
    if project_level(&mut tx, &i, project).await?.unwrap_or(0) < 3 {
        let hidden = crate::api::fields::restricted_keys(&mut tx, i.tenant_id, project).await?;
        rows.retain(|r| match r.field.as_deref().and_then(|f| f.strip_prefix("custom_fields.")) {
            Some(key) => !hidden.iter().any(|k| k == key),
            None => true,
        });
    }
    Ok(Json(rows))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new().route("/api/issues/{id}/history", get(issue_history))
}
