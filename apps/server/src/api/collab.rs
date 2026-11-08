//! Activity, analytics, automations, inbox and approvals.
use crate::api::common::*;
use crate::api::knowledge::{entity_project, relation_entity_exists};
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/projects/{id}/activity", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn activity(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor',u.display_name,'occurred_at',a.occurred_at) FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=$1 AND (EXISTS(SELECT 1 FROM issues t WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=a.entity_id) OR EXISTS(SELECT 1 FROM pages t WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=a.entity_id)) ORDER BY a.occurred_at DESC LIMIT 200")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(get, path = "/api/projects/{id}/analytics", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn analytics(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let counts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('status',status,'count',count(*)) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL GROUP BY status")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    let kinds:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('kind',kind,'count',count(*)) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL GROUP BY kind")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    let overdue:i64=sqlx::query_scalar("SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND due_at<now() AND NOT EXISTS (SELECT 1 FROM project_statuses ps WHERE ps.tenant_id=issues.tenant_id AND ps.project_id=issues.project_id AND ps.key=issues.status AND ps.category='done') AND archived_at IS NULL")
        .bind(i.tenant_id).bind(p).fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok(Json(
        json!({"statuses":counts,"types":kinds,"overdue":overdue}),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct AutomationInput {
    pub(crate) name: String,
    pub(crate) trigger_event: String,
    /// `custom` for rules with conditions and actions. The other two values are the original presets.
    pub(crate) action_type: String,
    /// Each condition: `{"field": "priority|kind|status|label|team_id|assignee_id", "op": "eq|neq", "value": "..."}`. All must hold.
    pub(crate) conditions: Option<Vec<Value>>,
    /// Up to five actions for `custom` rules, each `{"type": ..., "value": ...}`. Types: set_priority, set_status,
    /// set_assignee (a member id, "me" or null), add_label, comment, notify_admins.
    pub(crate) actions: Option<Vec<Value>>,
    /// Only with `trigger_event: scheduled`: `hourly`, `daily` or `weekly`. The first run is soon after creation.
    pub(crate) schedule: Option<String>,
}
#[utoipa::path(get, path = "/api/projects/{id}/automations", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn automations(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(a) FROM automation_rules a WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/automations", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = AutomationInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_automation(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<AutomationInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    valid_project(&mut tx, &i, p).await?;
    validate_title(&v.name)?;
    if ![
        "issue_created",
        "issue_status_changed",
        "issue_updated",
        "comment_added",
        "scheduled",
    ]
    .contains(&v.trigger_event.as_str())
    {
        return Err(bad("Unsupported automation trigger"));
    }
    let scheduled = v.trigger_event == "scheduled";
    if scheduled {
        if !matches!(v.schedule.as_deref(), Some("hourly") | Some("daily") | Some("weekly")) {
            return Err(bad("A scheduled rule needs a schedule: hourly, daily or weekly"));
        }
        if v.action_type != "custom" {
            return Err(bad("Only custom rules can be scheduled"));
        }
    } else if v.schedule.is_some() {
        return Err(bad("A schedule applies only to scheduled rules"));
    }
    let conditions = v.conditions.clone().unwrap_or_default();
    let actions = v.actions.clone().unwrap_or_default();
    match v.action_type.as_str() {
        "notify_project_admins" | "set_priority_high" => {
            if !actions.is_empty() || !conditions.is_empty() {
                return Err(bad("Preset rules take no conditions or actions"));
            }
        }
        "custom" => {
            if actions.is_empty() || actions.len() > 5 {
                return Err(bad("A custom rule needs between 1 and 5 actions"));
            }
            validate_conditions(&conditions)?;
            for a in &actions {
                let kind = a.get("type").and_then(Value::as_str).unwrap_or("");
                let value = a.get("value");
                let text = value.and_then(Value::as_str).unwrap_or("");
                let ok = match kind {
                    "set_priority" => ["low", "medium", "high", "urgent"].contains(&text),
                    "set_status" => !text.is_empty() && text.len() <= 64,
                    "set_assignee" => {
                        text == "me"
                            || value.is_some_and(Value::is_null)
                            || Uuid::parse_str(text).is_ok()
                    }
                    "add_label" => !text.trim().is_empty() && text.len() <= 40,
                    "comment" => !text.trim().is_empty() && text.len() <= 2000,
                    "notify_admins" => true,
                    _ => false,
                };
                if !ok {
                    return Err(bad("Unsupported automation action or value"));
                }
            }
        }
        _ => return Err(bad("Unsupported automation action")),
    }
    let rule = sqlx::query_scalar("INSERT INTO automation_rules(tenant_id,project_id,name,trigger_event,action_type,created_by,conditions,actions,schedule,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10 THEN now() ELSE NULL END) RETURNING to_jsonb(automation_rules)")
        .bind(i.tenant_id).bind(p).bind(v.name.trim()).bind(v.trigger_event).bind(v.action_type).bind(i.user_id)
        .bind(Value::Array(conditions)).bind(Value::Array(actions)).bind(v.schedule).bind(scheduled)
        .fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(rule)))
}
/// Checks rule conditions: at most ten, each with a known field, op `eq` or `neq`, and a value.
fn validate_conditions(conditions: &[Value]) -> ApiResult<()> {
    if conditions.len() > 10 {
        return Err(bad("A rule can have at most 10 conditions"));
    }
    for c in conditions {
        let field = c.get("field").and_then(Value::as_str).unwrap_or("");
        let op = c.get("op").and_then(Value::as_str).unwrap_or("");
        let value = c.get("value").and_then(Value::as_str).unwrap_or("");
        if !["priority", "kind", "status", "label", "team_id", "assignee_id"].contains(&field)
            || !["eq", "neq"].contains(&op)
            || value.is_empty()
            || value.len() > 200
        {
            return Err(bad("Each condition needs a known field, op eq or neq, and a value"));
        }
    }
    Ok(())
}

/// Runs the enabled rules for one event on one issue. Actions write directly and never fire other
/// rules, so a rule cannot start a chain. Every change an action makes is recorded in the history.
pub(crate) async fn run_automations(
    db: &mut PgConnection,
    i: &Identity,
    project: Uuid,
    entity: Uuid,
    event: &str,
) -> ApiResult<()> {
    let rules: Vec<(Uuid, String, Value, Value)> = sqlx::query_as(
        "SELECT id, action_type, conditions, actions FROM automation_rules WHERE tenant_id=$1 AND project_id=$2 AND enabled=true AND trigger_event=$3 ORDER BY created_at LIMIT 30",
    )
    .bind(i.tenant_id).bind(project).bind(event).fetch_all(&mut *db).await.map_err(db_err)?;
    for (rule, action, conditions, actions) in rules {
        apply_rule(db, i, project, entity, rule, &action, &conditions, &actions).await?;
    }
    Ok(())
}

/// Runs one enabled rule on one issue. Returns whether the rule ran (its conditions held).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_rule(
    db: &mut PgConnection,
    i: &Identity,
    project: Uuid,
    entity: Uuid,
    rule: Uuid,
    action: &str,
    conditions: &Value,
    actions: &Value,
) -> ApiResult<bool> {
    if action == "custom" {
        if !conditions_hold(db, i.tenant_id, entity, conditions).await? {
            return Ok(false);
        }
        let before = crate::api::history::issue_json(db, i.tenant_id, entity).await?;
        for a in actions.as_array().cloned().unwrap_or_default().iter().take(5) {
            run_action(db, i, project, entity, a).await?;
        }
        let after = crate::api::history::issue_json(db, i.tenant_id, entity).await?;
        crate::api::history::record_row_changes(db, i.tenant_id, i.user_id, entity, &before, &after).await?;
    } else {
        {
            // Only allowlisted, non-recursive presets.
            match action {
                "set_priority_high" => {
                    sqlx::query("UPDATE issues SET priority='high',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND priority IN ('low','medium')")
                        .bind(i.tenant_id).bind(entity).execute(&mut *db).await.map_err(db_err)?;
                }
                "notify_project_admins" => {
                    sqlx::query("INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,entity_type,entity_id) SELECT $1,m.user_id,$2,'automation','Automation ran for an issue','issue',$3 FROM memberships m WHERE m.tenant_id=$1 AND m.role IN ('owner','admin') AND m.disabled_at IS NULL")
                        .bind(i.tenant_id).bind(i.user_id).bind(entity).execute(&mut *db).await.map_err(db_err)?;
                }
                _ => {}
            }
        }
    }
    sqlx::query("INSERT INTO automation_runs(tenant_id,rule_id,entity_id,result) VALUES($1,$2,$3,'ok')")
        .bind(i.tenant_id)
        .bind(rule)
        .bind(entity)
        .execute(&mut *db)
        .await
        .map_err(db_err)?;
    Ok(true)
}

/// Scheduled rules (Phase I1). Each enabled scheduled rule runs its conditions over up to 200 open
/// issues of its project, with its creator's authority: it is skipped while the creator is no longer
/// an owner or admin. Then its next run moves forward by its schedule. Returns the issues it ran on.
pub(crate) async fn run_due_scheduled_rules(db: &sqlx::PgPool) -> Result<u64, String> {
    let due: Vec<(Uuid, Uuid, Uuid, Uuid, String, Value, Value)> = sqlx::query_as(
        "SELECT id, tenant_id, project_id, created_by, schedule, conditions, actions FROM automation_rules \
         WHERE trigger_event='scheduled' AND enabled=true AND next_run_at IS NOT NULL AND next_run_at <= now() \
         ORDER BY next_run_at LIMIT 20",
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;
    let mut ran = 0u64;
    for (rule, tenant, project, creator, schedule, conditions, actions) in due {
        let step = match schedule.as_str() {
            "hourly" => "1 hour",
            "weekly" => "7 days",
            _ => "1 day",
        };
        let mut tx = crate::db::tenant_tx(db, tenant)
            .await
            .map_err(|_| "could not open a tenant transaction".to_string())?;
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL",
        )
        .bind(tenant)
        .bind(creator)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        if matches!(role.as_deref(), Some("owner") | Some("admin")) {
            let identity = Identity {
                tenant_id: tenant,
                user_id: creator,
                role: role.clone().unwrap_or_default(),
            };
            let issues: Vec<Uuid> = sqlx::query_scalar(
                "SELECT id FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL AND trashed_at IS NULL \
                 ORDER BY updated_at DESC LIMIT 200",
            )
            .bind(tenant)
            .bind(project)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
            for issue in issues {
                let held = apply_rule(&mut tx, &identity, project, issue, rule, "custom", &conditions, &actions)
                    .await
                    .map_err(|_| "a scheduled rule failed on an issue".to_string())?;
                if held {
                    ran += 1;
                }
            }
        }
        sqlx::query(
            "UPDATE automation_rules SET last_run_at=now(), next_run_at=now() + $1::interval WHERE tenant_id=$2 AND id=$3",
        )
        .bind(step)
        .bind(tenant)
        .bind(rule)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
    }
    Ok(ran)
}

/// True when every condition holds for the issue's current values.
async fn conditions_hold(
    db: &mut PgConnection,
    tenant: Uuid,
    issue: Uuid,
    conditions: &Value,
) -> ApiResult<bool> {
    let row: Option<(String, String, String, Option<Uuid>, Option<Uuid>, Vec<String>)> = sqlx::query_as(
        "SELECT priority, kind, status, team_id, assignee_id, labels FROM issues WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant).bind(issue).fetch_optional(&mut *db).await.map_err(db_err)?;
    let Some((priority, kind, status, team, assignee, labels)) = row else {
        return Ok(false);
    };
    for c in conditions.as_array().cloned().unwrap_or_default() {
        let field = c.get("field").and_then(Value::as_str).unwrap_or("");
        let op = c.get("op").and_then(Value::as_str).unwrap_or("eq");
        let value = c.get("value").and_then(Value::as_str).unwrap_or("");
        let holds = match field {
            "priority" => priority == value,
            "kind" => kind == value,
            "status" => status == value,
            "team_id" => team.map(|t| t.to_string()).as_deref() == Some(value),
            "assignee_id" => assignee.map(|a| a.to_string()).as_deref() == Some(value),
            "label" => labels.iter().any(|l| l == value),
            _ => false,
        };
        let pass = if op == "neq" { !holds } else { holds };
        if !pass {
            return Ok(false);
        }
    }
    Ok(true)
}

/// One action of a custom rule. Values were checked when the rule was saved; anything that no longer
/// fits (a status that was removed, a transition that is now refused) is skipped, not forced.
async fn run_action(
    db: &mut PgConnection,
    i: &Identity,
    project: Uuid,
    issue: Uuid,
    action: &Value,
) -> ApiResult<()> {
    let kind = action.get("type").and_then(Value::as_str).unwrap_or("");
    let value = action.get("value");
    let text = value.and_then(Value::as_str).unwrap_or("");
    match kind {
        "set_priority" => {
            if ["low", "medium", "high", "urgent"].contains(&text) {
                sqlx::query(
                    "UPDATE issues SET priority=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3",
                )
                .bind(text)
                .bind(i.tenant_id)
                .bind(issue)
                .execute(&mut *db)
                .await
                .map_err(db_err)?;
            }
        }
        "set_status" => {
            if crate::api::statuses::status_defined(db, i.tenant_id, project, text).await? {
                let (from, custom): (String, Value) = sqlx::query_as(
                    "SELECT status, custom_fields FROM issues WHERE tenant_id=$1 AND id=$2",
                )
                .bind(i.tenant_id)
                .bind(issue)
                .fetch_one(&mut *db)
                .await
                .map_err(db_err)?;
                // Automations never pass the admin-only validator.
                if crate::api::transitions::check_transition(
                    db,
                    i.tenant_id,
                    project,
                    &from,
                    text,
                    &custom,
                    false,
                )
                .await
                .is_ok()
                {
                    sqlx::query("UPDATE issues SET status=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                        .bind(text).bind(i.tenant_id).bind(issue).execute(&mut *db).await.map_err(db_err)?;
                    crate::api::transitions::run_post_functions(
                        db,
                        i.tenant_id,
                        i.user_id,
                        issue,
                        &from,
                        text,
                    )
                    .await?;
                }
            }
        }
        "set_assignee" => {
            let target: Option<Uuid> = if text == "me" {
                Some(i.user_id)
            } else {
                value
                    .and_then(Value::as_str)
                    .and_then(|t| Uuid::parse_str(t).ok())
            };
            let member = match target {
                Some(u) => sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND disabled_at IS NULL)")
                    .bind(i.tenant_id).bind(u).fetch_one(&mut *db).await.map_err(db_err)?,
                None => true,
            };
            if member {
                sqlx::query("UPDATE issues SET assignee_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3")
                    .bind(target).bind(i.tenant_id).bind(issue).execute(&mut *db).await.map_err(db_err)?;
            }
        }
        "add_label" => {
            let label = text.trim();
            if !label.is_empty() && label.len() <= 40 {
                sqlx::query("UPDATE issues SET labels=array_append(labels,$1), updated_at=now() WHERE tenant_id=$2 AND id=$3 AND NOT ($1 = ANY(labels)) AND cardinality(labels) < 30")
                    .bind(label).bind(i.tenant_id).bind(issue).execute(&mut *db).await.map_err(db_err)?;
            }
        }
        "comment" => {
            if !text.trim().is_empty() && text.len() <= 2000 {
                sqlx::query("INSERT INTO issue_comments(tenant_id,issue_id,author_id,body) VALUES($1,$2,$3,$4)")
                    .bind(i.tenant_id).bind(issue).bind(i.user_id).bind(text.trim()).execute(&mut *db).await.map_err(db_err)?;
            }
        }
        "notify_admins" => {
            sqlx::query("INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,entity_type,entity_id) SELECT $1,m.user_id,$2,'automation','Automation ran for an issue','issue',$3 FROM memberships m WHERE m.tenant_id=$1 AND m.role IN ('owner','admin') AND m.disabled_at IS NULL")
                .bind(i.tenant_id).bind(i.user_id).bind(issue).execute(&mut *db).await.map_err(db_err)?;
        }
        _ => {}
    }
    Ok(())
}
/// One inbox entry. Columns match the `notifications` table.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Notification {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) recipient_id: Uuid,
    pub(crate) actor_id: Option<Uuid>,
    /// `approval` or `automation`.
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) entity_type: Option<String>,
    pub(crate) entity_id: Option<Uuid>,
    pub(crate) read_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
}
#[utoipa::path(get, path = "/api/notifications", tag = "collab", responses((status = 200, description = "Success", body = Vec<Notification>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn inbox(mut tx: Tx) -> ApiResult<Json<Vec<Notification>>> {
    let i = tx.identity.clone();
    let rows: Vec<Notification> = sqlx::query_as("SELECT id,tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id,read_at,created_at FROM notifications WHERE tenant_id=$1 AND recipient_id=$2 ORDER BY created_at DESC LIMIT 100")
        .bind(i.tenant_id).bind(i.user_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(post, path = "/api/notifications/{id}/read", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn mark_read(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let r=sqlx::query("UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3 AND read_at IS NULL")
        .bind(i.tenant_id).bind(i.user_id).bind(id).execute(&mut *tx).await.map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Unread notification not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ApprovalInput {
    pub(crate) title: String,
    pub(crate) subject_type: String,
    pub(crate) subject_id: Uuid,
    pub(crate) reviewer_id: Uuid,
    pub(crate) note: Option<String>,
}
#[utoipa::path(get, path = "/api/projects/{id}/approvals", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn approvals(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(a) FROM approvals a WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 250")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/approvals", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = ApprovalInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_approval(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<ApprovalInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_project(&mut tx, &i, p).await?;
    validate_title(&v.title)?;
    if !["issue", "page", "decision"].contains(&v.subject_type.as_str())
        || !relation_entity_exists(&mut tx, &v.subject_type, v.subject_id).await?
    {
        return Err(bad("Referenced work item not found"));
    }
    // The item must belong to this project, and the reviewer must be able to open that project.
    if entity_project(&mut tx, &v.subject_type, v.subject_id).await? != Some(Some(p)) {
        return Err(bad("The item does not belong to this project"));
    }
    let reviewer: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2)",
    )
    .bind(i.tenant_id)
    .bind(v.reviewer_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if !reviewer {
        return Err(bad("Reviewer must be a workspace member"));
    }
    let reviewer_level: Option<i32> = sqlx::query_scalar(
        "SELECT project_access($1,$2,m.role) FROM memberships m WHERE m.tenant_id=$3 AND m.user_id=$2 AND m.disabled_at IS NULL",
    )
    .bind(p)
    .bind(v.reviewer_id)
    .bind(i.tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .flatten();
    if reviewer_level.unwrap_or(0) < 1 {
        return Err(bad("The reviewer cannot access this project"));
    }
    let row:Value=sqlx::query_scalar("INSERT INTO approvals(tenant_id,project_id,title,subject_type,subject_id,requester_id,reviewer_id,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(approvals)")
        .bind(i.tenant_id).bind(p).bind(v.title).bind(v.subject_type).bind(v.subject_id).bind(i.user_id).bind(v.reviewer_id).bind(v.note.unwrap_or_default())
        .fetch_one(&mut *tx).await.map_err(db_err)?;
    let id = Uuid::parse_str(row["id"].as_str().unwrap_or(""))
        .map_err(|_| bad("Invalid approval ID"))?;
    sqlx::query("INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,entity_type,entity_id) SELECT $1::uuid,$2::uuid,$3::uuid,'approval','Approval requested','approval',$4::uuid WHERE NOT EXISTS (SELECT 1 FROM notification_preferences np WHERE np.tenant_id=$1 AND np.user_id=$2 AND np.kind='approval' AND np.enabled=false)")
        .bind(i.tenant_id).bind(v.reviewer_id).bind(i.user_id).bind(id).execute(&mut *tx).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
/// An approval request. Columns match the `approvals` table.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Approval {
    pub(crate) id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) title: String,
    /// `issue`, `page` or `decision`.
    pub(crate) subject_type: String,
    pub(crate) subject_id: Uuid,
    pub(crate) requester_id: Uuid,
    pub(crate) reviewer_id: Uuid,
    /// `pending`, `approved` or `rejected`.
    pub(crate) status: String,
    pub(crate) note: String,
    pub(crate) decided_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
}
#[utoipa::path(get, path = "/api/approvals/mine", tag = "collab", responses((status = 200, description = "Success", body = Vec<Approval>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn my_approvals(mut tx: Tx) -> ApiResult<Json<Vec<Approval>>> {
    let i = tx.identity.clone();
    let rows: Vec<Approval> = sqlx::query_as("SELECT id,tenant_id,project_id,title,subject_type,subject_id,requester_id,reviewer_id,status,note,decided_at,created_at FROM approvals WHERE tenant_id=$1 AND reviewer_id=$2 ORDER BY created_at DESC LIMIT 250")
        .bind(i.tenant_id).bind(i.user_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ApprovalDecision {
    pub(crate) status: String,
    pub(crate) note: Option<String>,
}
#[utoipa::path(patch, path = "/api/approvals/{id}", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = ApprovalDecision, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn decide_approval(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<ApprovalDecision>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    if !["approved", "rejected"].contains(&v.status.as_str()) {
        return Err(bad("Invalid approval outcome"));
    }
    let row:Option<Value>=sqlx::query_scalar("UPDATE approvals SET status=$1,note=COALESCE($2,note),decided_at=now() WHERE tenant_id=$3 AND id=$4 AND reviewer_id=$5 AND status='pending' RETURNING to_jsonb(approvals)")
        .bind(v.status).bind(v.note).bind(i.tenant_id).bind(id).bind(i.user_id).fetch_optional(&mut *tx).await.map_err(db_err)?;
    Ok(Json(row.ok_or_else(|| {
        err(StatusCode::CONFLICT, "Not pending or not assigned to you")
    })?))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct AutomationPatch {
    /// Turn the rule on or off. A disabled rule keeps its history and does not run.
    pub(crate) enabled: Option<bool>,
    pub(crate) name: Option<String>,
}

#[utoipa::path(patch, path = "/api/automations/{id}", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = AutomationPatch, responses((status = 200, description = "The rule after the change", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_automation(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<AutomationPatch>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    if let Some(name) = &v.name {
        validate_title(name)?;
    }
    let rule: Option<Value> = sqlx::query_scalar(
        "UPDATE automation_rules SET enabled=COALESCE($1,enabled), name=COALESCE($2,name) \
         WHERE tenant_id=$3 AND id=$4 RETURNING to_jsonb(automation_rules)",
    )
    .bind(v.enabled)
    .bind(v.name.as_ref().map(|n| n.trim().to_string()))
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let rule = rule.ok_or_else(|| err(StatusCode::NOT_FOUND, "Rule not found"))?;
    Ok(Json(rule))
}

#[utoipa::path(delete, path = "/api/automations/{id}", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted with its run log"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_automation(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    sqlx::query("DELETE FROM automation_runs WHERE tenant_id=$1 AND rule_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let removed = sqlx::query("DELETE FROM automation_rules WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if removed.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Rule not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/automations/{id}/runs", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "The last 50 runs, newest first", body = Vec<Object>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn automation_runs(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',r.id,'issue_number',i.number,'issue_title',i.title,'result',r.result,'at',r.created_at) \
         FROM automation_runs r LEFT JOIN issues i ON i.tenant_id=r.tenant_id AND i.id=r.entity_id \
         WHERE r.tenant_id=$1 AND r.rule_id=$2 ORDER BY r.id DESC LIMIT 50",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct AutomationPreviewInput {
    /// The conditions to test, in the same shape as a rule's conditions.
    pub(crate) conditions: Vec<Value>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct AutomationPreview {
    /// Open issues checked (at most 300, newest first).
    pub(crate) checked: i64,
    /// Issues whose current values satisfy every condition.
    pub(crate) matching: i64,
    /// Up to ten matching issues, as keys and titles.
    pub(crate) sample: Vec<Value>,
}

#[utoipa::path(post, path = "/api/projects/{id}/automations/preview", tag = "collab", params(("id" = Uuid, Path, description = "Resource id")), request_body = AutomationPreviewInput, responses((status = 200, description = "What a rule with these conditions would match now. Nothing is changed", body = AutomationPreview), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn automation_preview(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<AutomationPreviewInput>,
) -> ApiResult<Json<AutomationPreview>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    valid_project(&mut tx, &i, p).await?;
    validate_conditions(&v.conditions)?;
    let conditions = Value::Array(v.conditions);
    let issues: Vec<(Uuid, i64, String)> = sqlx::query_as(
        "SELECT id, number, title FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL AND trashed_at IS NULL \
         ORDER BY updated_at DESC LIMIT 300",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let key: String = sqlx::query_scalar("SELECT key FROM projects WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(p)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let checked = issues.len() as i64;
    let mut matching = 0i64;
    let mut sample = Vec::new();
    for (id, number, title) in issues {
        if conditions_hold(&mut tx, i.tenant_id, id, &conditions).await? {
            matching += 1;
            if sample.len() < 10 {
                sample.push(json!({"key": format!("{key}-{number}"), "title": title}));
            }
        }
    }
    Ok(Json(AutomationPreview {
        checked,
        matching,
        sample,
    }))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/activity", get(activity))
        .route("/api/projects/{id}/analytics", get(analytics))
        .route(
            "/api/projects/{id}/automations",
            get(automations).post(new_automation),
        )
        .route(
            "/api/projects/{id}/automations/preview",
            post(automation_preview),
        )
        .route(
            "/api/automations/{id}",
            patch(update_automation).delete(delete_automation),
        )
        .route("/api/automations/{id}/runs", get(automation_runs))
        .route("/api/notifications", get(inbox))
        .route("/api/notifications/{id}/read", post(mark_read))
        .route(
            "/api/projects/{id}/approvals",
            get(approvals).post(new_approval),
        )
        .route("/api/approvals/mine", get(my_approvals))
        .route("/api/approvals/{id}", patch(decide_approval))
}
