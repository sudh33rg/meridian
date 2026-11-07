//! Sprints, releases, goals, RAID records, portfolio and workload.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/projects/{id}/overview", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn project_overview(
    State(app): State<App>,
    i: Identity,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    valid_project(&app.db, &i, project).await?;
    let data:Value=sqlx::query_scalar("SELECT jsonb_build_object('issues', (SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL),'completed',(SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND status='done' AND archived_at IS NULL),'pages',(SELECT count(*) FROM pages WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL),'active_sprints',(SELECT count(*) FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND state='active'),'open_risks',(SELECT count(*) FROM risks WHERE tenant_id=$1 AND project_id=$2 AND status='open'))")
        .bind(i.tenant_id).bind(project).fetch_one(&app.db).await.map_err(db_err)?;
    Ok(Json(data))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SprintInput {
    pub(crate) name: String,
    pub(crate) goal: Option<String>,
    pub(crate) starts_at: Option<DateTime<Utc>>,
    pub(crate) ends_at: Option<DateTime<Utc>>,
}
#[utoipa::path(get, path = "/api/projects/{id}/sprints", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn sprints(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    let v=sqlx::query_scalar("SELECT to_jsonb(s) FROM sprints s WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(v))
}
#[utoipa::path(post, path = "/api/projects/{id}/sprints", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), request_body = SprintInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_sprint(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<SprintInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_editor(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.name)?;
    if v.starts_at
        .as_ref()
        .zip(v.ends_at.as_ref())
        .is_some_and(|(a, b)| a >= b)
    {
        return Err(bad("Sprint end must follow start"));
    }
    let rec:Value=sqlx::query_scalar("INSERT INTO sprints(tenant_id,project_id,name,goal,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(sprints)")
        .bind(i.tenant_id).bind(p).bind(v.name.trim()).bind(v.goal.unwrap_or_default()).bind(v.starts_at).bind(v.ends_at).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(rec)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SprintUpdate {
    pub(crate) state: String,
}
#[utoipa::path(patch, path = "/api/sprints/{id}", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), request_body = SprintUpdate, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_sprint(
    State(app): State<App>,
    i: Identity,
    Path(id): Path<Uuid>,
    Json(v): Json<SprintUpdate>,
) -> ApiResult<Json<Value>> {
    require_editor(&i)?;
    if !["active", "completed"].contains(&v.state.as_str()) {
        return Err(bad("Only active or completed transitions are supported"));
    }
    let changed:Option<Value>=sqlx::query_scalar("UPDATE sprints SET state=$1 WHERE tenant_id=$2 AND id=$3 AND ((state='planned' AND $1='active') OR (state='active' AND $1='completed')) RETURNING to_jsonb(sprints)")
        .bind(v.state).bind(i.tenant_id).bind(id).fetch_optional(&app.db).await.map_err(|e|{
            if let sqlx::Error::Database(ref d)=e {if d.code().as_deref()==Some("23505"){return err(StatusCode::CONFLICT,"Another sprint is active");}} db_err(e)
        })?;
    Ok(Json(changed.ok_or_else(|| {
        err(
            StatusCode::CONFLICT,
            "Sprint not found or invalid transition",
        )
    })?))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ReleaseInput {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) target_at: Option<DateTime<Utc>>,
}
#[utoipa::path(get, path = "/api/projects/{id}/releases", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn releases(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(r) FROM releases r WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/releases", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), request_body = ReleaseInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_release(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<ReleaseInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_editor(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.name)?;
    let row=sqlx::query_scalar("INSERT INTO releases(tenant_id,project_id,name,description,target_at) VALUES($1,$2,$3,$4,$5) RETURNING to_jsonb(releases)")
        .bind(i.tenant_id).bind(p).bind(v.name.trim()).bind(v.description.unwrap_or_default()).bind(v.target_at).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct GoalInput {
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) target_at: Option<DateTime<Utc>>,
    pub(crate) status: Option<String>,
    pub(crate) progress: Option<i32>,
}
#[utoipa::path(get, path = "/api/projects/{id}/goals", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn goals(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(g) FROM goals g WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 500")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/goals", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), request_body = GoalInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_goal(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<GoalInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_editor(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.title)?;
    let status = v.status.unwrap_or_else(|| "on_track".into());
    let progress = v.progress.unwrap_or(0);
    if !["on_track", "at_risk", "off_track", "done"].contains(&status.as_str())
        || !(0..=100).contains(&progress)
    {
        return Err(bad("Invalid goal status or progress"));
    }
    let row=sqlx::query_scalar("INSERT INTO goals(tenant_id,project_id,title,description,target_at,status,progress) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING to_jsonb(goals)")
        .bind(i.tenant_id).bind(p).bind(v.title.trim()).bind(v.description.unwrap_or_default()).bind(v.target_at).bind(status).bind(progress).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct RiskInput {
    pub(crate) title: String,
    pub(crate) mitigation: Option<String>,
    pub(crate) likelihood: Option<i32>,
    pub(crate) impact: Option<i32>,
}
#[utoipa::path(get, path = "/api/projects/{id}/risks", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn risks(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(r) FROM risks r WHERE tenant_id=$1 AND project_id=$2 ORDER BY likelihood*impact DESC,created_at DESC LIMIT 500")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/risks", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), request_body = RiskInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_risk(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<RiskInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_editor(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.title)?;
    let likelihood = v.likelihood.unwrap_or(2);
    let impact = v.impact.unwrap_or(2);
    if !(1..=5).contains(&likelihood) || !(1..=5).contains(&impact) {
        return Err(bad("Risk scores must be 1..5"));
    }
    let row=sqlx::query_scalar("INSERT INTO risks(tenant_id,project_id,title,mitigation,likelihood,impact) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(risks)")
        .bind(i.tenant_id).bind(p).bind(v.title.trim()).bind(v.mitigation.unwrap_or_default()).bind(likelihood).bind(impact).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct DecisionInput {
    pub(crate) title: String,
    pub(crate) context: Option<String>,
    pub(crate) outcome: Option<String>,
}
#[utoipa::path(get, path = "/api/projects/{id}/decisions", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn decisions(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
) -> ApiResult<Json<Vec<Value>>> {
    valid_project(&app.db, &i, p).await?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(d) FROM decisions d WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 500")
        .bind(i.tenant_id).bind(p).fetch_all(&app.db).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/projects/{id}/decisions", tag = "planning", params(("id" = Uuid, Path, description = "Resource id")), request_body = DecisionInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_decision(
    State(app): State<App>,
    i: Identity,
    Path(p): Path<Uuid>,
    Json(v): Json<DecisionInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    require_editor(&i)?;
    valid_project(&app.db, &i, p).await?;
    validate_title(&v.title)?;
    let row=sqlx::query_scalar("INSERT INTO decisions(tenant_id,project_id,title,context,outcome,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(decisions)")
        .bind(i.tenant_id).bind(p).bind(v.title.trim()).bind(v.context.unwrap_or_default()).bind(v.outcome.unwrap_or_default()).bind(i.user_id).fetch_one(&app.db).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[utoipa::path(get, path = "/api/portfolio", tag = "planning", responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn portfolio(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    let projects:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'name',p.name,'key',p.key,'issues',(SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=p.id AND archived_at IS NULL),'done',(SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=p.id AND status='done' AND archived_at IS NULL),'open_risks',(SELECT count(*) FROM risks WHERE tenant_id=$1 AND project_id=p.id AND status='open')) FROM projects p WHERE p.tenant_id=$1 AND archived_at IS NULL ORDER BY name LIMIT 500")
        .bind(i.tenant_id).fetch_all(&app.db).await.map_err(db_err)?;
    let goals:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'title',title,'status',status,'progress',progress,'project_id',project_id) FROM goals WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 500")
        .bind(i.tenant_id).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(json!({"projects":projects,"goals":goals})))
}
#[utoipa::path(get, path = "/api/workload", tag = "planning", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn workload(State(app): State<App>, i: Identity) -> ApiResult<Json<Vec<Value>>> {
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('user_id',m.user_id,'name',u.display_name,'open_issues',count(issues.id),'story_points',COALESCE(sum(issues.story_points),0)) FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN issues ON issues.tenant_id=m.tenant_id AND issues.assignee_id=m.user_id AND issues.status<>'done' AND issues.archived_at IS NULL WHERE m.tenant_id=$1 GROUP BY m.user_id,u.display_name ORDER BY count(issues.id) DESC LIMIT 250")
        .bind(i.tenant_id).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(rows))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/overview", get(project_overview))
        .route("/api/projects/{id}/sprints", get(sprints).post(new_sprint))
        .route("/api/sprints/{id}", patch(update_sprint))
        .route(
            "/api/projects/{id}/releases",
            get(releases).post(new_release),
        )
        .route("/api/projects/{id}/goals", get(goals).post(new_goal))
        .route("/api/projects/{id}/risks", get(risks).post(new_risk))
        .route(
            "/api/projects/{id}/decisions",
            get(decisions).post(new_decision),
        )
        .route("/api/portfolio", get(portfolio))
        .route("/api/workload", get(workload))
}
