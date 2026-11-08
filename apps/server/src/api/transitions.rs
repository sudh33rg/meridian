//! Workflow rules: which status changes a project allows, and which custom field a change needs.
//! A status with no rules can move anywhere. Once it has rules, only the listed targets are allowed.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get};
use serde_json::Value;

const MAX_RULES_PER_PROJECT: i64 = 200;

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TransitionRule {
    pub(crate) from: String,
    pub(crate) to: String,
    /// A custom field that must hold a value after the change, or null.
    pub(crate) requires_field: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewTransition {
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) requires_field: Option<String>,
}

/// Refuses a status change the project's rules do not allow. `custom` is the issue's custom field
/// values after the change, so a required field can be checked.
pub(crate) async fn check_transition(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    from: &str,
    to: &str,
    custom: &Value,
) -> ApiResult<()> {
    if from == to {
        return Ok(());
    }
    let has_rules: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3)",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    if !has_rules {
        return Ok(());
    }
    let rule: Option<Option<String>> = sqlx::query_scalar(
        "SELECT requires_field FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?;
    let requires = rule.ok_or_else(|| {
        bad(&format!("This project's workflow does not allow moving from “{from}” to “{to}”"))
    })?;
    if let Some(field) = requires {
        let filled = custom.get(&field).map(|v| !v.is_null()).unwrap_or(false);
        if !filled {
            let label: String = sqlx::query_scalar(
                "SELECT label FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
            )
            .bind(tenant)
            .bind(project)
            .bind(&field)
            .fetch_one(&mut *db)
            .await
            .map_err(db_err)?;
            return Err(bad(&format!("Fill in “{label}” before moving to “{to}”")));
        }
    }
    Ok(())
}

/// Whether any rule names this field (used to refuse deleting a field a rule needs).
pub(crate) async fn field_is_required_by_rule(db: &mut PgConnection, tenant: Uuid, project: Uuid, key: &str) -> ApiResult<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND requires_field=$3)",
    )
    .bind(tenant)
    .bind(project)
    .bind(key)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)
}

#[utoipa::path(get, path = "/api/projects/{id}/transitions", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Allowed changes; a status with none can move anywhere", body = Vec<TransitionRule>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_transitions(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<TransitionRule>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<TransitionRule> = sqlx::query_as(
        "SELECT from_key AS \"from\", to_key AS \"to\", requires_field FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 ORDER BY from_key, to_key",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/transitions", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewTransition, responses((status = 201, description = "Rule added", body = TransitionRule), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 409, description = "The rule already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_transition(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewTransition>,
) -> ApiResult<(StatusCode, Json<TransitionRule>)> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    if v.from == v.to {
        return Err(bad("A status cannot move to itself; that is always allowed"));
    }
    for key in [&v.from, &v.to] {
        if !crate::api::statuses::status_defined(&mut tx, i.tenant_id, project, key).await? {
            return Err(bad(&format!("“{key}” is not a status in this project")));
        }
    }
    if let Some(field) = &v.requires_field {
        let defined: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3)",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(field)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if !defined {
            return Err(bad(&format!("“{field}” is not a custom field in this project")));
        }
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM status_transitions WHERE tenant_id=$1 AND project_id=$2")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if count >= MAX_RULES_PER_PROJECT {
        return Err(bad("A project can have up to 200 workflow rules"));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&v.from)
    .bind(&v.to)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(StatusCode::CONFLICT, "That change is already in the workflow"));
    }
    let row: TransitionRule = sqlx::query_as(
        "INSERT INTO status_transitions(tenant_id,project_id,from_key,to_key,requires_field) VALUES($1,$2,$3,$4,$5) RETURNING from_key AS \"from\", to_key AS \"to\", requires_field",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&v.from)
    .bind(&v.to)
    .bind(&v.requires_field)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "transition_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/projects/{id}/transitions/{from}/{to}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("from" = String, Path, description = "From status key"), ("to" = String, Path, description = "To status key")), responses((status = 204, description = "Rule removed"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such rule", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_transition(mut tx: Tx, Path((project, from, to)): Path<(Uuid, String, String)>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let r = sqlx::query("DELETE FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&from)
        .bind(&to)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Rule not found"));
    }
    log_event(&mut tx, &i, "transition_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/transitions", get(list_transitions).post(create_transition))
        .route("/api/projects/{id}/transitions/{from}/{to}", delete(delete_transition))
}
