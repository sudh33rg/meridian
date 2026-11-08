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
    let saved:Value=sqlx::query_scalar("UPDATE pages SET title=$1,content=$2,version=version+1,collab_epoch=collab_epoch+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING to_jsonb(pages)")
        .bind(old_title).bind(old_content).bind(i.tenant_id).bind(id).fetch_one(&mut *tx).await.map_err(db_err)?;
    sqlx::query("DELETE FROM page_ydoc_updates WHERE tenant_id=$1 AND page_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "restored", "page", id).await?;
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
/// One search result: an issue or a page, with a short preview.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct SearchHit {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) title: String,
    /// `issue` or `page`.
    pub(crate) kind: String,
    /// The first 180 characters of the description or content.
    pub(crate) preview: String,
}
#[utoipa::path(get, path = "/api/search", tag = "knowledge", params(SearchParams), responses((status = 200, description = "Success", body = Vec<SearchHit>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn search(
    mut tx: Tx,
    axum::extract::Query(v): axum::extract::Query<SearchParams>,
) -> ApiResult<Json<Vec<SearchHit>>> {
    let i = tx.identity.clone();
    let term = v.q.trim();
    if term.len() < 2 || term.len() > 160 {
        return Err(bad("Search must have 2..160 characters"));
    }
    let limit = v.limit.unwrap_or(25).clamp(1, 100);
    let found=sqlx::query_scalar("SELECT jsonb_build_object('id',x.id,'project_id',x.project_id,'title',x.title,'kind',x.kind,'preview',left(x.description,180)) FROM (SELECT id,project_id,title,'issue' AS kind,description,ts_rank(to_tsvector('simple',title || ' ' || description),plainto_tsquery('simple',$2)) AS rank FROM issues WHERE tenant_id=$1 AND archived_at IS NULL AND project_access(project_id,$4,$5)>=1 AND to_tsvector('simple',title || ' ' || description) @@ plainto_tsquery('simple',$2) UNION ALL SELECT id,project_id,title,'page' AS kind,content AS description,ts_rank(to_tsvector('simple',title || ' ' || content),plainto_tsquery('simple',$2)) AS rank FROM pages WHERE tenant_id=$1 AND archived_at IS NULL AND page_access(id,$4,$5)>=1 AND to_tsvector('simple',title || ' ' || content) @@ plainto_tsquery('simple',$2)) x ORDER BY rank DESC LIMIT $3")
        .bind(i.tenant_id).bind(term).bind(limit).bind(i.user_id).bind(&i.role).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(typed_rows(found)?))
}
fn entity_table(kind: &str) -> ApiResult<&'static str> {
    // Table names are hardcoded; never interpolate user-supplied SQL identifiers.
    Ok(match kind {
        "issue" => "issues",
        "page" => "pages",
        "goal" => "goals",
        "decision" => "decisions",
        "risk" => "risks",
        "release" => "releases",
        _ => return Err(bad("Unsupported entity type")),
    })
}
/// The project an entity belongs to: `None` = no such entity in this workspace,
/// `Some(None)` = a workspace-level entity without a project (e.g. a company goal).
pub(crate) async fn entity_project(
    tx: &mut Tx,
    kind: &str,
    id: Uuid,
) -> ApiResult<Option<Option<Uuid>>> {
    let sql = format!(
        "SELECT project_id FROM {} WHERE tenant_id=$1 AND id=$2",
        entity_table(kind)?
    );
    let tenant = tx.identity.tenant_id;
    sqlx::query_scalar::<_, Option<Uuid>>(&sql)
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)
}
/// Does the entity exist **and** can the caller at least see its project? Entities in projects
/// the caller cannot open report as absent, so references never confirm their existence.
pub(crate) async fn relation_entity_exists(tx: &mut Tx, kind: &str, id: Uuid) -> ApiResult<bool> {
    if kind == "page" {
        let i = tx.identity.clone();
        let level: Option<i32> = sqlx::query_scalar("SELECT page_access($1,$2,$3)")
            .bind(id)
            .bind(i.user_id)
            .bind(&i.role)
            .fetch_one(&mut **tx)
            .await
            .map_err(db_err)?;
        return Ok(level.unwrap_or(0) >= 1);
    }
    match entity_project(tx, kind, id).await? {
        None => Ok(false),
        Some(None) => Ok(true),
        Some(Some(project)) => {
            let i = tx.identity.clone();
            Ok(project_level(tx, &i, project).await?.unwrap_or(0) >= 1)
        }
    }
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
    if !relation_entity_exists(&mut tx, &v.entity_type, v.entity_id).await? {
        return Err(err(StatusCode::NOT_FOUND, "Entity not found"));
    }
    let rows=sqlx::query_scalar("SELECT to_jsonb(r) FROM entity_relations r WHERE tenant_id=$1 AND ((source_type=$2 AND source_id=$3) OR (target_type=$2 AND target_id=$3)) ORDER BY created_at DESC LIMIT 250")
        .bind(i.tenant_id).bind(v.entity_type).bind(v.entity_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    // Drop relations whose other end lives in a project the caller cannot see.
    let mut seen: std::collections::HashMap<(String, Uuid), bool> =
        std::collections::HashMap::new();
    let mut visible: Vec<Value> = Vec::with_capacity(rows.len());
    'rows: for r in rows {
        let r: Value = r;
        for side in ["source", "target"] {
            let (Some(kind), Some(id)) = (
                r[format!("{side}_type")].as_str().map(str::to_owned),
                r[format!("{side}_id")]
                    .as_str()
                    .and_then(|x| Uuid::parse_str(x).ok()),
            ) else {
                continue 'rows;
            };
            let ok = match seen.get(&(kind.clone(), id)) {
                Some(ok) => *ok,
                None => {
                    let ok = relation_entity_exists(&mut tx, &kind, id).await?;
                    seen.insert((kind, id), ok);
                    ok
                }
            };
            if !ok {
                continue 'rows;
            }
        }
        visible.push(r);
    }
    Ok(Json(visible))
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
    if !relation_entity_exists(&mut tx, &v.source_type, v.source_id).await?
        || !relation_entity_exists(&mut tx, &v.target_type, v.target_id).await?
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
        .route("/api/pages/{id}/title", axum::routing::put(rename_page))
        .route("/api/pages/{id}/versions", get(page_versions))
        .route("/api/pages/{id}/restore", post(restore_page))
        .route(
            "/api/pages/{id}/comments",
            get(page_comments).post(new_page_comment),
        )
        .route("/api/search", get(search))
        .route("/api/relations", get(relations).post(new_relation))
        .route(
            "/api/projects/{id}/page-templates",
            get(list_page_templates).post(create_page_template),
        )
        .route("/api/page-templates/{id}", delete(delete_page_template))
        .route(
            "/api/projects/{id}/blog-posts",
            get(list_blog_posts).post(create_blog_post),
        )
        .route(
            "/api/projects/{id}/home-page",
            get(get_home_page).put(set_home_page),
        )
        .route("/api/pages/{id}/parent", axum::routing::put(set_page_parent))
}

// ---------------------------------------------------------------------------------------------
// K3. Blog posts, the project home page and the page tree
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct BlogPost {
    pub(crate) page_id: Uuid,
    pub(crate) title: String,
    pub(crate) published_at: DateTime<Utc>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewBlogPost {
    pub(crate) title: String,
    pub(crate) content: Option<String>,
}

/// The project's home page. `page_id` is null until an admin sets one.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct HomePage {
    pub(crate) page_id: Option<Uuid>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct PageParent {
    /// A page of the same project, or null to move the page to the top level.
    pub(crate) parent_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/projects/{id}/blog-posts", tag = "knowledge", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Newest blog posts you can open (at most 200)", body = Vec<BlogPost>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_blog_posts(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<BlogPost>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let rows: Vec<BlogPost> = sqlx::query_as(
        "SELECT b.page_id, p.title, b.published_at FROM blog_posts b JOIN pages p ON p.tenant_id=b.tenant_id AND p.id=b.page_id \
         WHERE b.tenant_id=$1 AND b.project_id=$2 AND page_access(p.id,$3,$4)>=1 ORDER BY b.published_at DESC LIMIT 200",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(i.user_id)
    .bind(&i.role)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/blog-posts", tag = "knowledge", params(("id" = Uuid, Path, description = "Project id")), request_body = NewBlogPost, responses((status = 201, description = "Published as a page and listed in the blog", body = crate::api::work::Page), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_blog_post(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewBlogPost>,
) -> ApiResult<(StatusCode, Json<crate::api::work::Page>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    if !can_edit(&i) {
        return Err(forbidden());
    }
    let title = v.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(bad("A blog post title is 1 to 200 characters"));
    }
    let page: crate::api::work::Page = sqlx::query_as(
        "INSERT INTO pages(tenant_id,project_id,title,content,created_by) VALUES($1,$2,$3,$4,$5) \
         RETURNING id,project_id,parent_id,title,content,version,updated_at",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&title)
    .bind(v.content.unwrap_or_default())
    .bind(i.user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("INSERT INTO blog_posts(tenant_id,project_id,page_id) VALUES($1,$2,$3)")
        .bind(i.tenant_id)
        .bind(project)
        .bind(page.id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "created", "page", page.id).await?;
    log_event(&mut tx, &i, "blog_post_published", "project", project).await?;
    Ok((StatusCode::CREATED, Json(page)))
}

#[utoipa::path(get, path = "/api/projects/{id}/home-page", tag = "knowledge", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "The home page, if one is set", body = HomePage), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_home_page(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<HomePage>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let page_id: Option<Uuid> = sqlx::query_scalar("SELECT home_page_id FROM projects WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(Json(HomePage { page_id }))
}

#[utoipa::path(put, path = "/api/projects/{id}/home-page", tag = "knowledge", params(("id" = Uuid, Path, description = "Project id")), request_body = HomePage, responses((status = 200, description = "Saved", body = HomePage), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_home_page(mut tx: Tx, Path(project): Path<Uuid>, Json(v): Json<HomePage>) -> ApiResult<Json<HomePage>> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    if let Some(page) = v.page_id {
        let inside: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pages WHERE tenant_id=$1 AND project_id=$2 AND id=$3)")
            .bind(i.tenant_id)
            .bind(project)
            .bind(page)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if !inside {
            return Err(bad("The home page must be a page of this project"));
        }
    }
    sqlx::query("UPDATE projects SET home_page_id=$1 WHERE tenant_id=$2 AND id=$3")
        .bind(v.page_id)
        .bind(i.tenant_id)
        .bind(project)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "home_page_set", "project", project).await?;
    Ok(Json(v))
}

#[utoipa::path(put, path = "/api/pages/{id}/parent", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), request_body = PageParent, responses((status = 200, description = "Moved", body = crate::api::work::Page), (status = 400, description = "A page cannot move under itself or its own children, or to another project", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn set_page_parent(mut tx: Tx, Path(page): Path<Uuid>, Json(v): Json<PageParent>) -> ApiResult<Json<crate::api::work::Page>> {
    let i = tx.identity.clone();
    let project: Uuid = sqlx::query_scalar("SELECT project_id FROM pages WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(page)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))?;
    ensure_access(&mut tx, project).await?;
    if !can_edit(&i) {
        return Err(forbidden());
    }
    if let Some(parent) = v.parent_id {
        if parent == page {
            return Err(bad("A page cannot be its own parent"));
        }
        let same_project: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pages WHERE tenant_id=$1 AND project_id=$2 AND id=$3)")
            .bind(i.tenant_id)
            .bind(project)
            .bind(parent)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
        if !same_project {
            return Err(bad("The parent page must belong to this project"));
        }
        // Walk up from the proposed parent: if this page is reached, the move would create a cycle.
        let cycle: bool = sqlx::query_scalar(
            "WITH RECURSIVE up AS (SELECT id, parent_id FROM pages WHERE tenant_id=$1 AND id=$2 \
               UNION ALL SELECT p.id, p.parent_id FROM pages p JOIN up ON p.tenant_id=$1 AND p.id=up.parent_id) \
             SELECT EXISTS(SELECT 1 FROM up WHERE id=$3)",
        )
        .bind(i.tenant_id)
        .bind(parent)
        .bind(page)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if cycle {
            return Err(bad("A page cannot move under one of its own children"));
        }
    }
    let row: crate::api::work::Page = sqlx::query_as(
        "UPDATE pages SET parent_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3 \
         RETURNING id,project_id,parent_id,title,content,version,updated_at",
    )
    .bind(v.parent_id)
    .bind(i.tenant_id)
    .bind(page)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "page_moved", "page", page).await?;
    Ok(Json(row))
}

// ---------------------------------------------------------------------------------------------
// K3. Page templates
// ---------------------------------------------------------------------------------------------

const TEMPLATE_BODY_MAX: usize = 100_000;
const TEMPLATES_PER_PROJECT: i64 = 50;

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct PageTemplate {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    /// The starting text for a new page.
    pub(crate) body: String,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewPageTemplate {
    /// 1 to 80 characters; unique per project.
    pub(crate) name: String,
    /// Up to 100,000 characters.
    pub(crate) body: String,
}

#[utoipa::path(get, path = "/api/projects/{id}/page-templates", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Templates for this project", body = Vec<PageTemplate>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_page_templates(
    mut tx: Tx,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<PageTemplate>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let rows: Vec<PageTemplate> = sqlx::query_as(
        "SELECT id,name,body,created_at FROM page_templates WHERE tenant_id=$1 AND project_id=$2 ORDER BY lower(name)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/page-templates", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewPageTemplate, responses((status = 201, description = "Saved", body = PageTemplate), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 409, description = "A template with this name already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_page_template(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewPageTemplate>,
) -> ApiResult<(StatusCode, Json<PageTemplate>)> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let name = v.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(bad("Template name must be 1 to 80 characters"));
    }
    if v.body.len() > TEMPLATE_BODY_MAX {
        return Err(bad("A template body is limited to 100,000 characters"));
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM page_templates WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if count >= TEMPLATES_PER_PROJECT {
        return Err(bad("A project can keep up to 50 page templates"));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM page_templates WHERE tenant_id=$1 AND project_id=$2 AND name=$3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(StatusCode::CONFLICT, "A template with this name already exists"));
    }
    let row: PageTemplate = sqlx::query_as(
        "INSERT INTO page_templates(tenant_id,project_id,name,body,created_by) VALUES($1,$2,$3,$4,$5) \
         RETURNING id,name,body,created_at",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&name)
    .bind(&v.body)
    .bind(i.user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "page_template_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/page-templates/{id}", tag = "knowledge", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Deleted"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_page_template(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM page_templates WHERE tenant_id=$1 AND id=$2",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Template not found"))?;
    ensure_access(&mut tx, project).await?;
    sqlx::query("DELETE FROM page_templates WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "page_template_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct TitleInput {
    pub(crate) title: String,
}
#[utoipa::path(put, path = "/api/pages/{id}/title", tag = "knowledge", params(("id" = Uuid, Path, description = "Page id")), request_body = TitleInput, responses((status = 204, description = "Renamed (live editors are not disturbed)"), (status = 400, description = "Invalid title", body = ErrorBody), (status = 403, description = "Editor access required", body = ErrorBody), (status = 404, description = "Page not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn rename_page(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Json(v): Json<TitleInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    validate_title(&v.title)?;
    valid_page(&mut tx, &i, id).await?;
    sqlx::query("UPDATE pages SET title=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .bind(v.title.trim())
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "renamed", "page", id).await?;
    Ok(StatusCode::NO_CONTENT)
}
