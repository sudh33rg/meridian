//! Page history, comments, search and typed relations.
use crate::api::common::*;
use crate::api::issues::CommentInput;
use crate::*;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/pages/{id}/versions", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn page_versions(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_page(&mut tx, &i, id).await?;
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('version',version,'title',title,'content',content,'editor_id',editor_id,'saved_at',saved_at) FROM page_versions WHERE tenant_id=$1 AND page_id=$2 ORDER BY version DESC LIMIT 200")
        .bind(i.tenant_id).bind(id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct RestoreInput {
    pub(crate) version: i32,
    pub(crate) expected_version: i32,
}
#[utoipa::path(post, path = "/api/pages/{id}/restore", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), request_body = RestoreInput, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn restore_page(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<RestoreInput>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_page(&mut tx, &i, id).await?;
    let current: Option<(i32, String, String)> = sqlx::query_as(
        "SELECT version,title,content FROM pages WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (ver, title, content) =
        current.ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))?;
    if ver != v.expected_version {
        return Err(err(
            StatusCode::CONFLICT,
            "Page was edited; reload before restoring",
        ));
    }
    let chosen: Option<(String, String)> = sqlx::query_as(
        "SELECT title,content FROM page_versions WHERE tenant_id=$1 AND page_id=$2 AND version=$3",
    )
    .bind(i.tenant_id)
    .bind(id)
    .bind(v.version)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (old_title, old_content) =
        chosen.ok_or_else(|| err(StatusCode::NOT_FOUND, "Version not found"))?;
    sqlx::query("INSERT INTO page_versions(tenant_id,page_id,version,title,content,editor_id) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(i.tenant_id).bind(id).bind(ver).bind(title).bind(content).bind(i.user_id).execute(&mut *tx).await.map_err(db_err)?;
    let saved:Value=sqlx::query_scalar("UPDATE pages SET title=$1,content=$2,version=version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING to_jsonb(pages)")
        .bind(old_title).bind(old_content).bind(i.tenant_id).bind(id).fetch_one(&mut *tx).await.map_err(db_err)?;
    log_event(&mut *tx, &i, "restored", "page", id).await?;
    Ok(Json(saved))
}
#[utoipa::path(get, path = "/api/pages/{id}/comments", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn page_comments(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    valid_page(&mut tx, &i, id).await?;
    Ok(Json(sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'body',c.body,'author',u.display_name,'created_at',c.created_at) FROM page_comments c JOIN users u ON u.id=c.author_id WHERE c.tenant_id=$1 AND c.page_id=$2 ORDER BY c.created_at LIMIT 1000")
        .bind(i.tenant_id).bind(id).fetch_all(&mut *tx).await.map_err(db_err)?))
}
#[utoipa::path(post, path = "/api/pages/{id}/comments", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), request_body = CommentInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_page_comment(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<CommentInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    valid_page(&mut tx, &i, id).await?;
    validate_body(&v.body)?;
    let row:Value=sqlx::query_scalar("INSERT INTO page_comments(tenant_id,page_id,author_id,body) VALUES($1,$2,$3,$4) RETURNING to_jsonb(page_comments)")
        .bind(i.tenant_id).bind(id).bind(i.user_id).bind(v.body).fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct SearchParams {
    pub(crate) q: String,
    pub(crate) limit: Option<i64>,
}
#[utoipa::path(get, path = "/api/search", tag = "knowledge", params(SearchParams), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn search(
    mut tx: Tx,
    axum::extract::Query(v): axum::extract::Query<SearchParams>,
) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    let term = v.q.trim();
    if term.len() < 2 || term.len() > 160 {
        return Err(bad("Search must have 2..160 characters"));
    }
    let limit = v.limit.unwrap_or(25).clamp(1, 100);
    let found=sqlx::query_scalar("SELECT jsonb_build_object('id',x.id,'project_id',x.project_id,'title',x.title,'kind',x.kind,'preview',left(x.description,180)) FROM (SELECT id,project_id,title,'issue' AS kind,description,ts_rank(to_tsvector('simple',title || ' ' || description),plainto_tsquery('simple',$2)) AS rank FROM issues WHERE tenant_id=$1 AND archived_at IS NULL AND project_access(project_id,$4,$5)>=1 AND to_tsvector('simple',title || ' ' || description) @@ plainto_tsquery('simple',$2) UNION ALL SELECT id,project_id,title,'page' AS kind,content AS description,ts_rank(to_tsvector('simple',title || ' ' || content),plainto_tsquery('simple',$2)) AS rank FROM pages WHERE tenant_id=$1 AND archived_at IS NULL AND project_access(project_id,$4,$5)>=1 AND to_tsvector('simple',title || ' ' || content) @@ plainto_tsquery('simple',$2)) x ORDER BY rank DESC LIMIT $3")
        .bind(i.tenant_id).bind(term).bind(limit).bind(i.user_id).bind(&i.role).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(found))
}
pub(crate) async fn relation_entity_exists(
    db: &mut PgConnection,
    tenant: Uuid,
    kind: &str,
    id: Uuid,
) -> ApiResult<bool> {
    // Table names are hardcoded; never interpolate user-supplied SQL identifiers.
    let table = match kind {
        "issue" => "issues",
        "page" => "pages",
        "goal" => "goals",
        "decision" => "decisions",
        "risk" => "risks",
        "release" => "releases",
        _ => return Err(bad("Unsupported entity type")),
    };
    let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE tenant_id=$1 AND id=$2)");
    sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct RelationInput {
    pub(crate) source_type: String,
    pub(crate) source_id: Uuid,
    pub(crate) target_type: String,
    pub(crate) target_id: Uuid,
    pub(crate) relation: String,
}
#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct RelationQuery {
    pub(crate) entity_type: String,
    pub(crate) entity_id: Uuid,
}
#[utoipa::path(get, path = "/api/relations", tag = "knowledge", params(RelationQuery), responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn relations(
    mut tx: Tx,
    axum::extract::Query(v): axum::extract::Query<RelationQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    if !relation_entity_exists(&mut *tx, i.tenant_id, &v.entity_type, v.entity_id).await? {
        return Err(err(StatusCode::NOT_FOUND, "Entity not found"));
    }
    let rows=sqlx::query_scalar("SELECT to_jsonb(r) FROM entity_relations r WHERE tenant_id=$1 AND ((source_type=$2 AND source_id=$3) OR (target_type=$2 AND target_id=$3)) ORDER BY created_at DESC LIMIT 250")
        .bind(i.tenant_id).bind(v.entity_type).bind(v.entity_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(post, path = "/api/relations", tag = "knowledge", request_body = RelationInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_relation(
    mut tx: Tx,
    Json(v): Json<RelationInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    if v.source_id == v.target_id
        || ![
            "references",
            "implements",
            "documents",
            "depends_on",
            "verifies",
        ]
        .contains(&v.relation.as_str())
    {
        return Err(bad("Unsupported relationship"));
    }
    if !relation_entity_exists(&mut *tx, i.tenant_id, &v.source_type, v.source_id).await?
        || !relation_entity_exists(&mut *tx, i.tenant_id, &v.target_type, v.target_id).await?
    {
        return Err(err(
            StatusCode::NOT_FOUND,
            "Source or target not in this workspace",
        ));
    }
    let row=sqlx::query_scalar("INSERT INTO entity_relations(tenant_id,source_type,source_id,target_type,target_id,relation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING to_jsonb(entity_relations)")
        .bind(i.tenant_id).bind(v.source_type).bind(v.source_id).bind(v.target_type).bind(v.target_id).bind(v.relation).bind(i.user_id).fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/pages/{id}/versions", get(page_versions))
        .route("/api/pages/{id}/restore", post(restore_page))
        .route(
            "/api/pages/{id}/comments",
            get(page_comments).post(new_page_comment),
        )
        .route("/api/search", get(search))
        .route("/api/relations", get(relations).post(new_relation))
}
