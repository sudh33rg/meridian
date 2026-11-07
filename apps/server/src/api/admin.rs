//! Audit, webhooks, entitlements, export and import.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/entitlements", tag = "admin", responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn entitlements(tx: Tx) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    // No payment gateway is connected; this is a baseline configuration, not enforced billing.
    Ok(Json(
        json!({"tenant_id":i.tenant_id,"plan":"development","billing_connected":false,"features":["projects","issues","knowledge","sprints","goals","search","basic_automation"]}),
    ))
}
#[utoipa::path(get, path = "/api/audit", tag = "admin", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn audit_log(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor',u.display_name,'occurred_at',a.occurred_at) FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=$1 ORDER BY a.occurred_at DESC LIMIT 500")
        .bind(i.tenant_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WebhookInput {
    pub(crate) name: String,
    pub(crate) url: String,
}
#[utoipa::path(get, path = "/api/admin/webhooks", tag = "admin", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn webhooks(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    Ok(Json(sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'url',url,'enabled',enabled,'created_at',created_at) FROM webhooks WHERE tenant_id=$1 LIMIT 100")
        .bind(i.tenant_id).fetch_all(&mut *tx).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/admin/webhooks", tag = "admin", request_body = WebhookInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_webhook(
    mut tx: Tx,
    Json(v): Json<WebhookInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    validate_title(&v.name)?;
    if !v.url.starts_with("https://") || v.url.len() > 500 || v.url.contains('@') {
        return Err(bad("A public HTTPS URL is required"));
    }
    // Delivery disabled by default. Before dispatch, enforce DNS+IP allow/deny checks to prevent SSRF.
    let secret = mint_token();
    let row:Value=sqlx::query_scalar("INSERT INTO webhooks(tenant_id,name,url,secret_hash) VALUES($1,$2,$3,$4) RETURNING jsonb_build_object('id',id,'name',name,'url',url,'enabled',enabled)")
        .bind(i.tenant_id).bind(v.name).bind(v.url).bind(token_hash(&secret)).fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"webhook":row,"signing_secret_once":secret,"delivery_configured":false})),
    ))
}
#[utoipa::path(delete, path = "/api/admin/webhooks/{id}", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_webhook(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let r = sqlx::query("DELETE FROM webhooks WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Webhook not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/projects/{id}/export", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn export_project(mut tx: Tx, Path(p): Path<Uuid>) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    valid_project(&mut tx, &i, p).await?;
    let project: Value = sqlx::query_scalar(
        "SELECT to_jsonb(t) - 'tenant_id' FROM projects t WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let issues:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) - 'tenant_id' FROM issues t WHERE tenant_id=$1 AND project_id=$2 ORDER BY number LIMIT 10000")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    let pages:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) - 'tenant_id' FROM pages t WHERE tenant_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 10000")
        .bind(i.tenant_id).bind(p).fetch_all(&mut *tx).await.map_err(db_err)?;
    let sprints: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(t) - 'tenant_id' FROM sprints t WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(
        json!({"format":"meridian-project-v1","exported_at":Utc::now(),"project":project,"issues":issues,"pages":pages,"sprints":sprints,"warning":"Bounded export: each collection has a 10000 row cap; paginated export is needed for larger projects."}),
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ImportItem {
    pub(crate) external_ref: String,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) priority: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ImportInput {
    pub(crate) items: Vec<ImportItem>,
}
#[utoipa::path(post, path = "/api/projects/{id}/import/issues", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), request_body = ImportInput, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_issues(
    mut tx: Tx,
    Path(p): Path<Uuid>,
    Json(v): Json<ImportInput>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    if v.items.is_empty() || v.items.len() > 100 {
        return Err(bad("Import accepts 1..100 issues per batch"));
    }
    for item in &v.items {
        validate_title(&item.title)?;
        if item.external_ref.len() > 200 || item.external_ref.is_empty() {
            return Err(bad(
                "Each imported issue needs an external_ref <=200 characters",
            ));
        }
        if !["task", "bug", "story", "epic"].contains(&item.kind.as_deref().unwrap_or("task"))
            || !["low", "medium", "high", "urgent"]
                .contains(&item.priority.as_deref().unwrap_or("medium"))
        {
            return Err(bad("Invalid kind or priority"));
        }
    }
    let present: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    if present.is_none() {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    let mut next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(p)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let mut created = 0;
    let mut skipped = 0;
    for item in v.items {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM imported_issue_refs WHERE tenant_id=$1 AND project_id=$2 AND external_ref=$3)")
            .bind(i.tenant_id).bind(p).bind(&item.external_ref).fetch_one(&mut *tx).await.map_err(db_err)?;
        if exists {
            skipped += 1;
            continue;
        }
        let id:Uuid=sqlx::query_scalar("INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id")
            .bind(i.tenant_id).bind(p).bind(next).bind(item.title).bind(item.description.unwrap_or_default())
            .bind(item.kind.unwrap_or_else(||"task".into())).bind(item.priority.unwrap_or_else(||"medium".into())).bind(i.user_id)
            .fetch_one(&mut *tx).await.map_err(db_err)?;
        sqlx::query("INSERT INTO imported_issue_refs(tenant_id,project_id,external_ref,issue_id) VALUES($1,$2,$3,$4)")
            .bind(i.tenant_id).bind(p).bind(item.external_ref).bind(id).execute(&mut *tx).await.map_err(db_err)?;
        created += 1;
        next += 1;
    }
    log_event(&mut *tx, &i, "imported", "project", p).await?;
    Ok(Json(
        json!({"created":created,"skipped":skipped,"idempotent_by":"external_ref"}),
    ))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/export", get(export_project))
        .route("/api/projects/{id}/import/issues", post(import_issues))
        .route("/api/entitlements", get(entitlements))
        .route("/api/audit", get(audit_log))
        .route("/api/admin/webhooks", get(webhooks).post(new_webhook))
        .route("/api/admin/webhooks/{id}", delete(delete_webhook))
}
