//! Settings that belong to one member: saved issue views and notification preferences.
//! Rows are tenant-scoped by row level security and private to their owner, so every query also
//! filters on the caller's user id.
use crate::api::common::*;
use crate::api::work::ISSUE_PRIORITIES;
use crate::*;
use axum::routing::{delete, get};
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
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewSavedView {
    /// 1 to 80 characters; unique per member and project.
    pub(crate) name: String,
    pub(crate) filters: Value,
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
        "SELECT id,project_id,name,filters,created_at,updated_at FROM saved_views \
         WHERE tenant_id=$1 AND user_id=$2 AND project_id=$3 ORDER BY lower(name)",
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
        "INSERT INTO saved_views(tenant_id,user_id,project_id,name,filters) VALUES($1,$2,$3,$4,$5) \
         RETURNING id,project_id,name,filters,created_at,updated_at",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(project)
    .bind(&name)
    .bind(filters)
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

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/views",
            get(list_views).post(create_view),
        )
        .route("/api/views/{id}", delete(delete_view))
        .route(
            "/api/me/notification-preferences",
            get(get_notification_preferences).put(set_notification_preference),
        )
}
