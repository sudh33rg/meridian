//! Workflow rules: which status changes a project allows, and what a change needs and does.
//! A status with no rules can move anywhere. Once it has rules, only the listed targets are allowed.
//! A rule can require a field value (validator), a workspace admin (permission validator), and run
//! post-functions in the same transaction as the change: set a field, or notify the admins.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get};
use serde_json::{json, Value};

const MAX_RULES_PER_PROJECT: i64 = 200;
const MAX_ACTIONS_PER_RULE: i64 = 5;

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TransitionRule {
    pub(crate) from: String,
    pub(crate) to: String,
    /// A custom field that must hold a value after the change, or null.
    pub(crate) requires_field: Option<String>,
    /// Only a workspace admin or owner may make this change.
    pub(crate) requires_admin: bool,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewTransition {
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) requires_field: Option<String>,
    /// Defaults to false.
    pub(crate) requires_admin: Option<bool>,
}

/// One post-function of a rule. `set_field` writes `value` into `field`; `notify_admins` tells the
/// workspace admins and owners that the issue changed; `notify_assignee` tells the assignee;
/// `create_subtask` creates a subtask titled `title`.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct TransitionAction {
    pub(crate) id: Uuid,
    pub(crate) action: String,
    pub(crate) field: Option<String>,
    pub(crate) value: Option<Value>,
    pub(crate) title: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewTransitionAction {
    /// `set_field`, `notify_admins`, `notify_assignee` or `create_subtask`.
    pub(crate) action: String,
    /// Required for `set_field`: a custom field of this project.
    pub(crate) field: Option<String>,
    /// Required for `set_field`: a value the field accepts. For `create_subtask`, the subtask title
    /// as a string (1 to 255 characters).
    pub(crate) value: Option<Value>,
}

/// Refuses a status change the project's rules do not allow. `custom` is the issue's custom field
/// values after the change, so a required field can be checked. `is_admin` says whether the actor is
/// a workspace admin or owner; automations pass false.
pub(crate) async fn check_transition(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    from: &str,
    to: &str,
    custom: &Value,
    is_admin: bool,
) -> ApiResult<()> {
    if from == to {
        return Ok(());
    }
    // A full column refuses the move, whatever the rules say.
    let limit: Option<i32> = sqlx::query_scalar(
        "SELECT wip_limit FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(tenant)
    .bind(project)
    .bind(to)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .flatten();
    if let Some(limit) = limit {
        let held: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND status=$3 AND archived_at IS NULL",
        )
        .bind(tenant)
        .bind(project)
        .bind(to)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)?;
        if held >= i64::from(limit) {
            return Err(bad(&format!("“{to}” is full: its WIP limit is {limit} and it holds {held} issues")));
        }
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
    let rule: Option<(Option<String>, bool)> = sqlx::query_as(
        "SELECT requires_field, requires_admin FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?;
    let (requires, requires_admin) = rule.ok_or_else(|| {
        bad(&format!(
            "This project's workflow does not allow moving from “{from}” to “{to}”"
        ))
    })?;
    if requires_admin && !is_admin {
        return Err(forbidden_msg(&format!(
            "Only a workspace admin can move this issue from “{from}” to “{to}”"
        )));
    }
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

/// Runs the post-functions of the rule an issue just moved along, inside the caller's transaction.
/// Called from every write path after the status change is written.
pub(crate) async fn run_post_functions(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Uuid,
    issue: Uuid,
    from: &str,
    to: &str,
) -> ApiResult<()> {
    let actions: Vec<(String, Option<String>, Option<Value>, Option<String>, Uuid)> = sqlx::query_as(
        "SELECT a.action, a.field_key, a.field_value, a.title, i.project_id FROM transition_actions a \
         JOIN issues i ON i.tenant_id=a.tenant_id AND i.project_id=a.project_id \
         WHERE a.tenant_id=$1 AND i.id=$2 AND a.from_key=$3 AND a.to_key=$4 ORDER BY a.created_at, a.id",
    )
    .bind(tenant)
    .bind(issue)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)?;
    for (action, field, value, title, _project) in actions {
        match action.as_str() {
            "set_field" => {
                let field = field
                    .ok_or_else(|| ApiError::Internal("A set_field action has no field".into()))?;
                // Keeps updated_at: the post-function is part of the status change, not a separate edit.
                sqlx::query(
                    "UPDATE issues SET custom_fields = jsonb_set(COALESCE(custom_fields,'{}'::jsonb), ARRAY[$1]::text[], $2, true) WHERE tenant_id=$3 AND id=$4",
                )
                .bind(&field)
                .bind(value.unwrap_or(Value::Null))
                .bind(tenant)
                .bind(issue)
                .execute(&mut *db)
                .await
                .map_err(db_err)?;
            }
            "notify_admins" => {
                sqlx::query(
                    "INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id) \
                     SELECT $1,m.user_id,$2,'automation','Issue moved by a workflow rule',$3,'issue',$4 \
                     FROM memberships m WHERE m.tenant_id=$1 AND m.role IN ('owner','admin') AND m.disabled_at IS NULL",
                )
                .bind(tenant)
                .bind(actor)
                .bind(format!("Moved from “{from}” to “{to}”."))
                .bind(issue)
                .execute(&mut *db)
                .await
                .map_err(db_err)?;
            }
            "notify_assignee" => {
                sqlx::query(
                    "INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id) \
                     SELECT $1,i.assignee_id,$2,'automation','Issue moved by a workflow rule',$3,'issue',i.id \
                     FROM issues i WHERE i.tenant_id=$1 AND i.id=$4 AND i.assignee_id IS NOT NULL AND i.assignee_id<>$2",
                )
                .bind(tenant)
                .bind(actor)
                .bind(format!("Moved from “{from}” to “{to}”."))
                .bind(issue)
                .execute(&mut *db)
                .await
                .map_err(db_err)?;
            }
            "create_subtask" => {
                let title = title
                    .ok_or_else(|| ApiError::Internal("A create_subtask action has no title".into()))?;
                create_subtask_in(db, tenant, actor, issue, &title).await?;
            }
            _ => {}
        }
    }
    Ok(())
}

/// A subtask a post-function creates. It follows the rules for a subtask made by hand: it sits one
/// level below its parent, takes a standard (non-epic) type and the project's default status. A
/// transition that would nest a subtask under a subtask is refused, so the whole change is refused.
async fn create_subtask_in(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Uuid,
    parent: Uuid,
    title: &str,
) -> ApiResult<()> {
    crate::api::common::validate_title(title)?;
    let (project, parent_parent): (Uuid, Option<Uuid>) =
        sqlx::query_as("SELECT project_id, parent_id FROM issues WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(parent)
            .fetch_one(&mut *db)
            .await
            .map_err(db_err)?;
    if parent_parent.is_some() {
        return Err(bad("This transition creates a subtask, but the issue is already a subtask"));
    }
    let kind = crate::api::issue_types::default_type(db, tenant, project).await?;
    if crate::api::issue_types::type_level(db, tenant, project, &kind).await? != Some(0) {
        return Err(bad("The project's default type is an epic level type, so no subtask can be created"));
    }
    // Same lock and numbering as a subtask made by hand, so two creates cannot take one number.
    sqlx::query("SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(tenant)
        .bind(project)
        .fetch_optional(&mut *db)
        .await
        .map_err(db_err)?;
    let number: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(tenant)
    .bind(project)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    let status = crate::api::statuses::default_status(db, tenant, project).await?;
    let child: Uuid = sqlx::query_scalar(
        "INSERT INTO issues(tenant_id,project_id,number,title,kind,priority,created_by,status,parent_id) \
         VALUES($1,$2,$3,$4,$5,'medium',$6,$7,$8) RETURNING id",
    )
    .bind(tenant)
    .bind(project)
    .bind(number)
    .bind(title.trim())
    .bind(&kind)
    .bind(actor)
    .bind(&status)
    .bind(parent)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    log_event_system(db, tenant, actor, "created", "issue", child).await?;
    crate::api::history::record_status(db, tenant, child, None, &status, actor).await?;
    log_outbox(
        db,
        tenant,
        "issue.created",
        child,
        json!({"project_id": project, "parent_id": parent}),
    )
    .await?;
    Ok(())
}

/// Whether any rule names this field, as a requirement or as a post-function target (used to refuse
/// deleting a field a rule needs).
pub(crate) async fn field_is_required_by_rule(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    key: &str,
) -> ApiResult<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND requires_field=$3) \
         OR EXISTS(SELECT 1 FROM transition_actions WHERE tenant_id=$1 AND project_id=$2 AND field_key=$3)",
    )
    .bind(tenant)
    .bind(project)
    .bind(key)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)
}

#[utoipa::path(get, path = "/api/projects/{id}/transitions", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Allowed changes; a status with none can move anywhere", body = Vec<TransitionRule>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_transitions(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<TransitionRule>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<TransitionRule> = sqlx::query_as(
        "SELECT from_key AS \"from\", to_key AS \"to\", requires_field, requires_admin FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 ORDER BY from_key, to_key",
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
        return Err(bad(
            "A status cannot move to itself; that is always allowed",
        ));
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
            return Err(bad(&format!(
                "“{field}” is not a custom field in this project"
            )));
        }
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM status_transitions WHERE tenant_id=$1 AND project_id=$2",
    )
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
        return Err(err(
            StatusCode::CONFLICT,
            "That change is already in the workflow",
        ));
    }
    let row: TransitionRule = sqlx::query_as(
        "INSERT INTO status_transitions(tenant_id,project_id,from_key,to_key,requires_field,requires_admin) VALUES($1,$2,$3,$4,$5,$6) RETURNING from_key AS \"from\", to_key AS \"to\", requires_field, requires_admin",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&v.from)
    .bind(&v.to)
    .bind(&v.requires_field)
    .bind(v.requires_admin.unwrap_or(false))
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "transition_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/projects/{id}/transitions/{from}/{to}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("from" = String, Path, description = "From status key"), ("to" = String, Path, description = "To status key")), responses((status = 204, description = "Rule removed"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such rule", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_transition(
    mut tx: Tx,
    Path((project, from, to)): Path<(Uuid, String, String)>,
) -> ApiResult<StatusCode> {
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

/// Refuses a rule that does not exist in the project.
async fn rule_exists(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    from: &str,
    to: &str,
) -> ApiResult<()> {
    let ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM status_transitions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4)",
    )
    .bind(tenant)
    .bind(project)
    .bind(from)
    .bind(to)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    if ok {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Rule not found"))
    }
}

#[utoipa::path(get, path = "/api/projects/{id}/transitions/{from}/{to}/actions", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("from" = String, Path, description = "From status key"), ("to" = String, Path, description = "To status key")), responses((status = 200, description = "The rule's post-functions", body = Vec<TransitionAction>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "No such rule", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_actions(
    mut tx: Tx,
    Path((project, from, to)): Path<(Uuid, String, String)>,
) -> ApiResult<Json<Vec<TransitionAction>>> {
    ensure_access(&mut tx, project).await?;
    let tenant = tx.identity.tenant_id;
    rule_exists(&mut tx, tenant, project, &from, &to).await?;
    let rows: Vec<TransitionAction> = sqlx::query_as(
        "SELECT id, action, field_key AS field, field_value AS value, title FROM transition_actions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4 ORDER BY created_at, id",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .bind(&from)
    .bind(&to)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/transitions/{from}/{to}/actions", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("from" = String, Path, description = "From status key"), ("to" = String, Path, description = "To status key")), request_body = NewTransitionAction, responses((status = 201, description = "Added", body = TransitionAction), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such rule", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_action(
    mut tx: Tx,
    Path((project, from, to)): Path<(Uuid, String, String)>,
    Json(v): Json<NewTransitionAction>,
) -> ApiResult<(StatusCode, Json<TransitionAction>)> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    rule_exists(&mut tx, i.tenant_id, project, &from, &to).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM transition_actions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&from)
    .bind(&to)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if count >= MAX_ACTIONS_PER_RULE {
        return Err(bad("A rule can have up to 5 post-functions"));
    }
    let mut title: Option<String> = None;
    let (field, value) = match v.action.as_str() {
        "set_field" => {
            let field = v
                .field
                .ok_or_else(|| bad("A set_field action names a custom field"))?;
            let value = v
                .value
                .ok_or_else(|| bad("A set_field action needs a value"))?;
            let def: crate::api::fields::FieldDefinition = sqlx::query_as(
                "SELECT key,label,field_type,options,required,position FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
            )
            .bind(i.tenant_id)
            .bind(project)
            .bind(&field)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?
            .ok_or_else(|| bad(&format!("“{field}” is not a custom field in this project")))?;
            let checked = crate::api::fields::check_value(&def, &value)?;
            (Some(field), Some(checked))
        }
        "notify_admins" | "notify_assignee" => {
            if v.field.is_some() || v.value.is_some() {
                return Err(bad(&format!("{} takes no field or value", v.action)));
            }
            (None, None)
        }
        "create_subtask" => {
            if v.field.is_some() {
                return Err(bad("create_subtask takes a title, not a field"));
            }
            let text = v
                .value
                .as_ref()
                .and_then(Value::as_str)
                .ok_or_else(|| bad("create_subtask needs the subtask title as a string"))?
                .trim()
                .to_string();
            if text.is_empty() || text.chars().count() > 255 {
                return Err(bad("A subtask title is 1 to 255 characters"));
            }
            title = Some(text);
            (None, None)
        }
        _ => {
            return Err(bad(
                "Action must be set_field, notify_admins, notify_assignee or create_subtask",
            ))
        }
    };
    let row: TransitionAction = sqlx::query_as(
        "INSERT INTO transition_actions(tenant_id,project_id,from_key,to_key,action,field_key,field_value,title) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, action, field_key AS field, field_value AS value, title",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&from)
    .bind(&to)
    .bind(&v.action)
    .bind(&field)
    .bind(&value)
    .bind(&title)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "transition_action_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/projects/{id}/transitions/{from}/{to}/actions/{action}", tag = "workflow", params(("id" = Uuid, Path, description = "Resource id"), ("from" = String, Path, description = "From status key"), ("to" = String, Path, description = "To status key"), ("action" = Uuid, Path, description = "Post-function id")), responses((status = 204, description = "Removed"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such post-function", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_action(
    mut tx: Tx,
    Path((project, from, to, action)): Path<(Uuid, String, String, Uuid)>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let r = sqlx::query("DELETE FROM transition_actions WHERE tenant_id=$1 AND project_id=$2 AND from_key=$3 AND to_key=$4 AND id=$5")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&from)
        .bind(&to)
        .bind(action)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Post-function not found"));
    }
    log_event(&mut tx, &i, "transition_action_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/transitions",
            get(list_transitions).post(create_transition),
        )
        .route(
            "/api/projects/{id}/transitions/{from}/{to}",
            delete(delete_transition),
        )
        .route(
            "/api/projects/{id}/transitions/{from}/{to}/actions",
            get(list_actions).post(create_action),
        )
        .route(
            "/api/projects/{id}/transitions/{from}/{to}/actions/{action}",
            delete(delete_action),
        )
}
