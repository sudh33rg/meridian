//! Settings that belong to one member: saved issue views and notification preferences.
//! Rows are tenant-scoped by row level security and private to their owner, so every query also
//! filters on the caller's user id.
use crate::api::common::*;
use crate::api::work::ISSUE_PRIORITIES;
use crate::*;
use axum::routing::{delete, get, post, put};
use serde_json::{json, Map, Value};

/// Per member and project. Keeps the list short enough to scan in a dropdown.
const MAX_VIEWS_PER_PROJECT: i64 = 50;
/// Notification kinds a member can switch off. Absent rows mean enabled.
const NOTIFICATION_KINDS: [&str; 2] = ["approval", "automation"];

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct SavedView {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) name: String,
    /// Any of `status`, `priority`, `assignee_id` and `q`, with the same rules as the issue list.
    pub(crate) filters: Value,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
    /// True when the view names a status, field or query term the project no longer has.
    #[sqlx(default)]
    pub(crate) stale: bool,
    /// True when the view was shared with the project. Other members can apply it but cannot change it.
    pub(crate) shared: bool,
    /// The member who saved the view.
    pub(crate) owner_id: Uuid,
    /// Display name of the member who saved the view.
    pub(crate) owner: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewSavedView {
    /// 1 to 80 characters; unique per member and project.
    pub(crate) name: String,
    pub(crate) filters: Value,
    /// Share the view with everyone who can see the project. Defaults to false (private).
    #[serde(default)]
    pub(crate) shared: bool,
}
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct NotificationPreference {
    /// `approval` or `automation`.
    pub(crate) kind: String,
    pub(crate) enabled: bool,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NotificationPreferenceInput {
    pub(crate) kind: String,
    pub(crate) enabled: bool,
}

/// Keeps only the known filter keys and checks each value with the same rules as the issue list.
/// Whether a query term names something the project still has: a status, or a custom field.
async fn check_query_term(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    term: &crate::api::query::Term,
) -> ApiResult<()> {
    use crate::api::query::Field;
    match &term.field {
        Field::Status => {
            if !crate::api::statuses::status_defined(db, tenant, project, &term.value).await? {
                return Err(bad(&format!(
                    "“{}” is not a status in this project",
                    term.value
                )));
            }
        }
        Field::Custom(key) => {
            let defined: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3)",
            )
            .bind(tenant)
            .bind(project)
            .bind(key)
            .fetch_one(&mut *db)
            .await
            .map_err(db_err)?;
            if !defined {
                return Err(bad(&format!("Unknown custom field “{key}”")));
            }
        }
        _ => {}
    }
    Ok(())
}

/// A saved view is stale when it names a status, a custom field or a query term the project no
/// longer has. Stale views are shown with a warning instead of silently returning nothing.
async fn view_is_stale(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    filters: &Value,
) -> bool {
    if let Some(status) = filters.get("status").and_then(Value::as_str) {
        if !crate::api::statuses::status_defined(db, tenant, project, status)
            .await
            .unwrap_or(false)
        {
            return true;
        }
    }
    if let Some(text) = filters.get("query").and_then(Value::as_str) {
        let Ok(terms) = crate::api::query::parse(text) else {
            return true;
        };
        for term in terms {
            if check_query_term(db, tenant, project, &term).await.is_err() {
                return true;
            }
        }
    }
    false
}

async fn normalize_filters(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    raw: &Value,
) -> ApiResult<Value> {
    let obj = raw
        .as_object()
        .ok_or_else(|| bad("Filters must be an object"))?;
    let mut out = Map::new();
    for (key, value) in obj {
        match key.as_str() {
            "status" => {
                let s = value.as_str().ok_or_else(|| bad("Invalid status filter"))?;
                if !crate::api::statuses::status_defined(db, tenant, project, s).await? {
                    return Err(bad("Invalid status filter"));
                }
                out.insert(key.clone(), json!(s));
            }
            "priority" => {
                let p = value
                    .as_str()
                    .filter(|p| ISSUE_PRIORITIES.contains(p))
                    .ok_or_else(|| bad("Invalid priority filter"))?;
                out.insert(key.clone(), json!(p));
            }
            "assignee_id" => {
                let id = value
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .ok_or_else(|| bad("Invalid assignee filter"))?;
                out.insert(key.clone(), json!(id));
            }
            "q" => {
                let s = value
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| bad("Search text must not be empty"))?;
                if s.chars().count() > 200 {
                    return Err(bad("Search text is limited to 200 characters"));
                }
                out.insert(key.clone(), json!(s));
            }
            "kind" => {
                let k = value
                    .as_str()
                    .filter(|k| crate::api::statuses::valid_key(k))
                    .ok_or_else(|| bad("Kind must be an issue type key"))?;
                out.insert(key.clone(), json!(k));
            }
            "query" => {
                let text = value
                    .as_str()
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .ok_or_else(|| bad("The query must not be empty"))?;
                if text.chars().count() > 500 {
                    return Err(bad("A saved query is limited to 500 characters"));
                }
                // The same syntax as the issue query; status and custom field names must exist now.
                for term in crate::api::query::parse(text)? {
                    check_query_term(db, tenant, project, &term).await?;
                }
                out.insert(key.clone(), json!(text));
            }
            _ => return Err(bad("Unknown filter")),
        }
    }
    Ok(Value::Object(out))
}

#[utoipa::path(get, path = "/api/projects/{id}/views", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Your saved views for this project", body = Vec<SavedView>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_views(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<SavedView>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let mut rows: Vec<SavedView> = sqlx::query_as(
        "SELECT v.id,v.project_id,v.name,v.filters,v.shared,v.user_id AS owner_id,u.display_name AS owner,\
         v.created_at,v.updated_at FROM saved_views v JOIN users u ON u.id=v.user_id \
         WHERE v.tenant_id=$1 AND v.project_id=$3 AND (v.user_id=$2 OR v.shared) \
         ORDER BY (v.user_id<>$2), lower(v.name)",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    for row in rows.iter_mut() {
        row.stale = view_is_stale(&mut tx, i.tenant_id, project, &row.filters).await;
    }
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/views", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewSavedView, responses((status = 201, description = "Saved", body = SavedView), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody), (status = 409, description = "A view with this name already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_view(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewSavedView>,
) -> ApiResult<(StatusCode, Json<SavedView>)> {
    let i = tx.identity.clone();
    // Any member who can see the project may keep personal views; they change nothing shared.
    match project_level(&mut tx, &i, project).await? {
        Some(l) if l >= 1 => {}
        _ => return Err(err(StatusCode::NOT_FOUND, "Project not found")),
    }
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(bad("View name must be 1 to 80 characters"));
    }
    let filters = normalize_filters(&mut tx, i.tenant_id, project, &v.filters).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM saved_views WHERE tenant_id=$1 AND user_id=$2 AND project_id=$3",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if count >= MAX_VIEWS_PER_PROJECT {
        return Err(bad("You can keep up to 50 saved views per project"));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM saved_views WHERE tenant_id=$1 AND user_id=$2 AND project_id=$3 AND name=$4)",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(
            StatusCode::CONFLICT,
            "A view with this name already exists",
        ));
    }
    let row: SavedView = sqlx::query_as(
        "INSERT INTO saved_views(tenant_id,user_id,project_id,name,filters,shared) VALUES($1,$2,$3,$4,$5,$6) \
         RETURNING id,project_id,name,filters,shared,user_id AS owner_id,\
         (SELECT display_name FROM users WHERE id=user_id) AS owner,created_at,updated_at",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .bind(&name)
    .bind(filters)
    .bind(v.shared)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/views/{id}", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_view(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let r = sqlx::query("DELETE FROM saved_views WHERE tenant_id=$1 AND user_id=$2 AND id=$3")
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "View not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn load_preferences(tx: &mut Tx, i: &Identity) -> ApiResult<Vec<NotificationPreference>> {
    let stored: Vec<(String, bool)> = sqlx::query_as(
        "SELECT kind, enabled FROM notification_preferences WHERE tenant_id=$1 AND user_id=$2",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(NOTIFICATION_KINDS
        .iter()
        .map(|kind| NotificationPreference {
            kind: kind.to_string(),
            enabled: stored
                .iter()
                .find(|(k, _)| k.as_str() == *kind)
                .map(|(_, enabled)| *enabled)
                .unwrap_or(true),
        })
        .collect())
}

#[utoipa::path(get, path = "/api/me/notification-preferences", tag = "me", responses((status = 200, description = "Every kind with its current setting; enabled by default", body = Vec<NotificationPreference>), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_notification_preferences(
    mut tx: Tx,
) -> ApiResult<Json<Vec<NotificationPreference>>> {
    let i = tx.identity.clone();
    Ok(Json(load_preferences(&mut tx, &i).await?))
}

#[utoipa::path(put, path = "/api/me/notification-preferences", tag = "me", request_body = NotificationPreferenceInput, responses((status = 200, description = "Updated; returns every kind", body = Vec<NotificationPreference>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_notification_preference(
    mut tx: Tx,
    Json(v): Json<NotificationPreferenceInput>,
) -> ApiResult<Json<Vec<NotificationPreference>>> {
    let i = tx.identity.clone();
    if !NOTIFICATION_KINDS.contains(&v.kind.as_str()) {
        return Err(bad("Unknown notification kind"));
    }
    sqlx::query(
        "INSERT INTO notification_preferences(tenant_id,user_id,kind,enabled) VALUES($1,$2,$3,$4) \
         ON CONFLICT (tenant_id,user_id,kind) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now()",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(&v.kind)
    .bind(v.enabled)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(load_preferences(&mut tx, &i).await?))
}

#[derive(Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub(crate) struct ViewSubscription {
    /// `daily` or `weekly`.
    pub(crate) cadence: String,
    pub(crate) next_run_at: DateTime<Utc>,
    pub(crate) last_sent_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ViewSubscriptionInput {
    /// `daily`, `weekly` or `off` (removes the subscription).
    pub(crate) cadence: String,
}

/// The saved view must be one the caller owns or one shared with the project, in a project they can open.
async fn subscribable_view(tx: &mut Tx, i: &Identity, view: Uuid) -> ApiResult<Uuid> {
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM saved_views WHERE tenant_id=$1 AND id=$2 AND (user_id=$3 OR shared)",
    )
    .bind(i.tenant_id)
    .bind(view)
    .bind(i.user_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "View not found"))?;
    valid_project(tx, i, project).await?;
    Ok(project)
}

#[utoipa::path(get, path = "/api/views/{id}/subscription", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Your subscription to this view, or null", body = Option<ViewSubscription>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_view_subscription(mut tx: Tx, Path(view): Path<Uuid>) -> ApiResult<Json<Option<ViewSubscription>>> {
    let i = tx.identity.clone();
    subscribable_view(&mut tx, &i, view).await?;
    let row: Option<ViewSubscription> = sqlx::query_as(
        "SELECT cadence, next_run_at, last_sent_at FROM view_subscriptions WHERE tenant_id=$1 AND user_id=$2 AND view_id=$3",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(view)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(row))
}

#[utoipa::path(put, path = "/api/views/{id}/subscription", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), request_body = ViewSubscriptionInput, responses((status = 200, description = "The subscription after the change, or null when it was turned off", body = Option<ViewSubscription>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn put_view_subscription(
    mut tx: Tx,
    Path(view): Path<Uuid>,
    Json(v): Json<ViewSubscriptionInput>,
) -> ApiResult<Json<Option<ViewSubscription>>> {
    let i = tx.identity.clone();
    subscribable_view(&mut tx, &i, view).await?;
    match v.cadence.as_str() {
        "off" => {
            sqlx::query("DELETE FROM view_subscriptions WHERE tenant_id=$1 AND user_id=$2 AND view_id=$3")
                .bind(i.tenant_id)
                .bind(i.user_id)
                .bind(view)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            Ok(Json(None))
        }
        "daily" | "weekly" => {
            let row: ViewSubscription = sqlx::query_as(
                "INSERT INTO view_subscriptions(tenant_id,user_id,view_id,cadence,next_run_at) \
                 VALUES($1,$2,$3,$4, now() + CASE WHEN $4='weekly' THEN interval '7 days' ELSE interval '1 day' END) \
                 ON CONFLICT (tenant_id,user_id,view_id) DO UPDATE SET \
                   next_run_at = CASE WHEN view_subscriptions.cadence = EXCLUDED.cadence THEN view_subscriptions.next_run_at \
                                      ELSE EXCLUDED.next_run_at END, \
                   cadence = EXCLUDED.cadence \
                 RETURNING cadence, next_run_at, last_sent_at",
            )
            .bind(i.tenant_id)
            .bind(i.user_id)
            .bind(view)
            .bind(&v.cadence)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
            Ok(Json(Some(row)))
        }
        _ => Err(bad("Cadence must be daily, weekly or off")),
    }
}

/// A subscription that is due: tenant, member, view, cadence and the last time it was sent.
type DueSubscription = (Uuid, Uuid, Uuid, String, Option<DateTime<Utc>>);

/// Runs the saved views that subscribers are due for. Each run compiles the view's query
/// with the subscriber's own identity, so visibility and restricted-field rules apply, and adds one
/// inbox notification. A view that is gone or no longer visible ends the subscription.
pub(crate) async fn run_due_view_subscriptions(db: &sqlx::PgPool) -> Result<u64, String> {
    let due: Vec<DueSubscription> = sqlx::query_as(
        "SELECT tenant_id, user_id, view_id, cadence, last_sent_at FROM view_subscriptions \
         WHERE next_run_at <= now() ORDER BY next_run_at LIMIT 50",
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    let mut sent = 0u64;
    for (tenant, user, view, cadence, last_sent) in due {
        let mut tx = crate::db::tenant_tx(db, tenant)
            .await
            .map_err(|_| "could not open a tenant transaction".to_string())?;
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL",
        )
        .bind(tenant)
        .bind(user)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let view_row: Option<(String, Uuid, String)> = sqlx::query_as(
            "SELECT name, project_id, COALESCE(filters->>'query','') FROM saved_views \
             WHERE tenant_id=$1 AND id=$2 AND (user_id=$3 OR shared)",
        )
        .bind(tenant)
        .bind(view)
        .bind(user)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        match (role, view_row) {
            (Some(role), Some((name, project, query))) if !query.is_empty() => {
                let identity = Identity {
                    tenant_id: tenant,
                    user_id: user,
                    role,
                };
                let (mut qb, _order) = crate::api::query::build_search(&mut tx, &identity, project, &query)
                    .await
                    .map_err(|_| "a subscribed view could not run".to_string())?;
                qb.push(" ORDER BY updated_at DESC LIMIT 200");
                let rows: Vec<crate::api::work::Issue> = qb
                    .build_query_as::<crate::api::work::Issue>()
                    .fetch_all(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                let changed = rows
                    .iter()
                    .filter(|r| last_sent.is_none_or(|l| r.updated_at > l))
                    .count();
                let sample: Vec<String> = rows.iter().take(5).map(|r| r.title.clone()).collect();
                let title = format!(
                    "“{name}”: {} matching, {changed} changed since your last update",
                    rows.len()
                );
                sqlx::query(
                    "INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id) \
                     VALUES($1,$2,$2,'view_subscription',$3,$4,'view',$5)",
                )
                .bind(tenant)
                .bind(user)
                .bind(title)
                .bind(sample.join("\n"))
                .bind(view)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                sent += 1;
                let step = if cadence == "weekly" { "7 days" } else { "1 day" };
                sqlx::query(
                    "UPDATE view_subscriptions SET last_sent_at=now(), next_run_at=now() + $1::interval \
                     WHERE tenant_id=$2 AND user_id=$3 AND view_id=$4",
                )
                .bind(step)
                .bind(tenant)
                .bind(user)
                .bind(view)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            }
            _ => {
                sqlx::query("DELETE FROM view_subscriptions WHERE tenant_id=$1 AND user_id=$2 AND view_id=$3")
                    .bind(tenant)
                    .bind(user)
                    .bind(view)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().await.map_err(|e| e.to_string())?;
    }
    Ok(sent)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/views",
            get(list_views).post(create_view),
        )
        .route("/api/views/{id}", delete(delete_view))
        .route(
            "/api/views/{id}/subscription",
            get(get_view_subscription).put(put_view_subscription),
        )
        .route(
            "/api/issues/{id}/favourite",
            put(add_favourite).delete(remove_favourite),
        )
        .route("/api/issues/{id}/viewed", post(record_view))
        .route("/api/projects/{id}/favourites", get(list_favourites))
        .route("/api/projects/{id}/recent", get(list_recent))
        .route(
            "/api/me/notification-preferences",
            get(get_notification_preferences).put(set_notification_preference),
        )
}

/// An issue as the favourites and recent lists show it.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct IssueRef {
    pub(crate) id: Uuid,
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) priority: String,
    pub(crate) updated_at: DateTime<Utc>,
}

/// Most recently opened issues kept per member. Older entries are dropped when a new one is recorded.
const RECENT_KEEP: i64 = 20;
/// How many recent issues one project's list shows.
const RECENT_SHOWN: i64 = 10;

/// Personal lists are open to any member who can see the project, as saved views are. They change
/// only the caller's own rows, so viewers may use them.
async fn member_of(tx: &mut Tx, i: &Identity, project: Uuid) -> ApiResult<()> {
    match project_level(&mut **tx, i, project).await? {
        Some(l) if l >= 1 => Ok(()),
        _ => Err(err(StatusCode::NOT_FOUND, "Project not found")),
    }
}

async fn project_of_issue(tx: &mut Tx, tenant: Uuid, issue: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar("SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(issue)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))
}

#[utoipa::path(put, path = "/api/issues/{id}/favourite", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Added to your favourites"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Issue not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_favourite(mut tx: Tx, Path(issue): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = project_of_issue(&mut tx, i.tenant_id, issue).await?;
    member_of(&mut tx, &i, project).await?;
    sqlx::query("INSERT INTO issue_favourites(tenant_id,user_id,issue_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING")
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(issue)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/issues/{id}/favourite", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Removed from your favourites, or was not a favourite"), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_favourite(mut tx: Tx, Path(issue): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    sqlx::query("DELETE FROM issue_favourites WHERE tenant_id=$1 AND user_id=$2 AND issue_id=$3")
        .bind(i.tenant_id)
        .bind(i.user_id)
        .bind(issue)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/issues/{id}/viewed", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Recorded as recently viewed"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Issue not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn record_view(mut tx: Tx, Path(issue): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project = project_of_issue(&mut tx, i.tenant_id, issue).await?;
    member_of(&mut tx, &i, project).await?;
    sqlx::query(
        "INSERT INTO issue_recent(tenant_id,user_id,issue_id,viewed_at) VALUES($1,$2,$3,now()) \
         ON CONFLICT (tenant_id,user_id,issue_id) DO UPDATE SET viewed_at=now()",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(issue)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query(
        "DELETE FROM issue_recent WHERE tenant_id=$1 AND user_id=$2 AND issue_id IN ( \
         SELECT issue_id FROM issue_recent WHERE tenant_id=$1 AND user_id=$2 ORDER BY viewed_at DESC OFFSET $3)",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(RECENT_KEEP)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/projects/{id}/favourites", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Your favourite issues in this project, newest first", body = Vec<IssueRef>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_favourites(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<IssueRef>>> {
    let i = tx.identity.clone();
    member_of(&mut tx, &i, project).await?;
    let rows: Vec<IssueRef> = sqlx::query_as(
        "SELECT i.id,i.number,i.title,i.kind,i.status,i.priority,i.updated_at FROM issue_favourites f \
         JOIN issues i ON i.tenant_id=f.tenant_id AND i.id=f.issue_id \
         WHERE f.tenant_id=$1 AND f.user_id=$2 AND i.project_id=$3 AND i.archived_at IS NULL AND i.trashed_at IS NULL \
         ORDER BY f.created_at DESC LIMIT 100",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(get, path = "/api/projects/{id}/recent", tag = "views", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Issues you opened most recently in this project", body = Vec<IssueRef>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_recent(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<IssueRef>>> {
    let i = tx.identity.clone();
    member_of(&mut tx, &i, project).await?;
    let rows: Vec<IssueRef> = sqlx::query_as(
        "SELECT i.id,i.number,i.title,i.kind,i.status,i.priority,i.updated_at FROM issue_recent r \
         JOIN issues i ON i.tenant_id=r.tenant_id AND i.id=r.issue_id \
         WHERE r.tenant_id=$1 AND r.user_id=$2 AND i.project_id=$3 AND i.archived_at IS NULL AND i.trashed_at IS NULL \
         ORDER BY r.viewed_at DESC LIMIT $4",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .bind(RECENT_SHOWN)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}
