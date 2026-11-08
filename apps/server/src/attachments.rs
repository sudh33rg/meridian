//! Attachments on issues and pages.
//!
//! * Upload: multipart, size-capped, type taken from the file's **magic bytes** (never from the
//!   client), allow-list only (no HTML/SVG/executables/archives of unknown content), plan quota
//!   enforced, stored under an opaque key, virus-scanned by a background job.
//! * Download: only through this API (authorization re-checked against the issue/page), always
//!   `Content-Disposition: attachment` except for the four safe raster image types, with
//!   `nosniff` and a sandboxing CSP so an uploaded file can never run as part of the app.
//! * Infected files are deleted from storage and can never be downloaded; with
//!   `ATTACHMENTS_REQUIRE_SCAN` only files that scanned clean are served.
use crate::api::common::*;
use crate::billing::enforce_storage;
use crate::scan::{clamd_scan, Verdict};
use crate::*;
use axum::{
    extract::{DefaultBodyLimit, Multipart, Query},
    response::{IntoResponse, Response},
    routing::{delete, get},
};
use object_store::{path::Path as ObjPath, ObjectStore, ObjectStoreExt, PutPayload};
use serde_json::{json, Value};

const ALLOWED: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
];
const INLINE_SAFE: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXT: &[&str] = &["txt", "md", "csv", "json", "log", "yaml", "yml"];

fn clean_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("file");
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '"' | '<' | '>' | '|' | '*' | '?' | ':'))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

/// The MIME type we will serve, decided from the bytes; `None` = not allowed.
pub(crate) fn detect(name: &str, data: &[u8]) -> Option<&'static str> {
    if let Some(t) = infer::get(data) {
        return ALLOWED.iter().find(|a| **a == t.mime_type()).copied();
    }
    // Plain text has no magic bytes: no NULs, valid UTF-8, and an expected extension.
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    let head = &data[..data.len().min(8192)];
    let utf8_ok = match std::str::from_utf8(head) {
        Ok(_) => true,
        // A multi-byte character cut by the 8 KiB window is fine; anything else is binary.
        Err(e) => e.error_len().is_none() && e.valid_up_to() > 0,
    };
    (TEXT_EXT.contains(&ext.as_str()) && !head.contains(&0) && utf8_ok).then_some("text/plain")
}

async fn authorize_entity(tx: &mut Tx, kind: &str, id: Uuid) -> ApiResult<Uuid> {
    match kind {
        "issue" => {
            let i = tx.identity.clone();
            valid_issue(tx, &i, id).await
        }
        "page" => {
            let i = tx.identity.clone();
            valid_page(tx, &i, id).await
        }
        _ => Err(bad("entity_type must be issue or page")),
    }
}

#[utoipa::path(post, path = "/api/attachments", tag = "attachments", request_body(content_type = "multipart/form-data", description = "Fields: entity_type (issue|page), entity_id, file"), responses((status = 201, description = "Stored; scanning continues in the background", body = Object), (status = 400, description = "Bad field, file type not allowed, or empty file", body = ErrorBody), (status = 402, description = "Storage quota reached", body = ErrorBody), (status = 413, description = "File too large", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn upload(
    mut tx: Tx,
    mut form: Multipart,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_editor(&i)?;
    let max = tx.cfg.max_attachment_mb * 1024 * 1024;
    let (mut kind, mut entity, mut file): (
        Option<String>,
        Option<Uuid>,
        Option<(String, Vec<u8>)>,
    ) = (None, None, None);
    while let Some(field) = form
        .next_field()
        .await
        .map_err(|_| bad("Malformed upload"))?
    {
        match field.name().unwrap_or("") {
            "entity_type" => kind = field.text().await.ok(),
            "entity_id" => {
                entity = field
                    .text()
                    .await
                    .ok()
                    .and_then(|t| Uuid::parse_str(t.trim()).ok())
            }
            "file" => {
                let name = clean_name(field.file_name().unwrap_or("file"));
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| err(StatusCode::PAYLOAD_TOO_LARGE, "The file is too large"))?;
                if bytes.len() > max {
                    return Err(err(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        &format!("Files can be at most {} MB", tx.cfg.max_attachment_mb),
                    ));
                }
                file = Some((name, bytes.to_vec()));
            }
            _ => {}
        }
    }
    let (kind, entity, (name, data)) = (
        kind.ok_or_else(|| bad("entity_type is required"))?,
        entity.ok_or_else(|| bad("entity_id is required"))?,
        file.ok_or_else(|| bad("file is required"))?,
    );
    if data.is_empty() {
        return Err(bad("The file is empty"));
    }
    let project = authorize_entity(&mut tx, &kind, entity).await?;
    let mime = detect(&name, &data).ok_or_else(|| {
        bad("This file type is not allowed. Use images, PDF, Office documents, ZIP or plain text")
    })?;
    enforce_storage(&mut tx, i.tenant_id, data.len() as i64).await?;
    let id = Uuid::new_v4();
    let key = format!("{}/{}", i.tenant_id, id);
    let sha = hex::encode(Sha256::digest(&data));
    let size = data.len() as i64;
    tx.store
        .put(
            &ObjPath::from(key.as_str()),
            PutPayload::from(bytes::Bytes::from(data)),
        )
        .await
        .map_err(|e| ApiError::Internal(format!("storage unavailable: {e}")))?;
    let inserted = sqlx::query("INSERT INTO attachments(id,tenant_id,project_id,entity_type,entity_id,file_name,content_type,size_bytes,sha256,storage_key,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(id).bind(i.tenant_id).bind(project).bind(&kind).bind(entity).bind(&name).bind(mime).bind(size).bind(&sha).bind(&key).bind(i.user_id)
        .execute(&mut *tx).await;
    if let Err(e) = inserted {
        let _ = tx.store.delete(&ObjPath::from(key.as_str())).await;
        return Err(db_err(e));
    }
    crate::jobs::enqueue(
        &mut *tx,
        Some(i.tenant_id),
        "attachment.scan",
        crate::jobs::payload("attachment_id", id),
    )
    .await?;
    log_event(&mut *tx, &i, "attached", &kind, entity).await?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"id": id, "file_name": name, "content_type": mime, "size_bytes": size, "scan_status": "pending"}),
        ),
    ))
}

#[derive(Deserialize)]
pub(crate) struct ListQuery {
    entity_type: String,
    entity_id: Uuid,
}

#[utoipa::path(get, path = "/api/attachments", tag = "attachments", params(("entity_type" = String, Query, description = "issue or page"), ("entity_id" = Uuid, Query, description = "Issue or page id")), responses((status = 200, description = "Files on the entity", body = Vec<Object>), (status = 404, description = "Entity not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list(mut tx: Tx, Query(q): Query<ListQuery>) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    // Reading attachments stays open on archived issues, like their details; uploads still need an active issue.
    if q.entity_type == "issue" {
        ensure_entity_access(&mut tx, "issues", q.entity_id).await?;
    } else {
        authorize_entity(&mut tx, &q.entity_type, q.entity_id).await?;
    }
    let rows = sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'file_name',a.file_name,'content_type',a.content_type,'size_bytes',a.size_bytes,'scan_status',a.scan_status,'uploaded_by',u.display_name,'created_at',a.created_at) FROM attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.tenant_id=$1 AND a.entity_type=$2 AND a.entity_id=$3 AND a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 200")
        .bind(i.tenant_id).bind(&q.entity_type).bind(q.entity_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub(crate) struct DownloadQuery {
    inline: Option<bool>,
}

#[utoipa::path(get, path = "/api/attachments/{id}/download", tag = "attachments", params(("id" = Uuid, Path, description = "Attachment id"), ("inline" = Option<bool>, Query, description = "Show images inline (raster images only)")), responses((status = 200, description = "The file", content_type = "application/octet-stream"), (status = 403, description = "Blocked by the malware scan", body = ErrorBody), (status = 404, description = "Not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn download(
    mut tx: Tx,
    Path(id): Path<Uuid>,
    Query(q): Query<DownloadQuery>,
) -> ApiResult<Response> {
    let i = tx.identity.clone();
    let row: Option<(String, String, String, String, Uuid)> = sqlx::query_as("SELECT file_name,content_type,storage_key,scan_status,entity_id FROM attachments WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL")
        .bind(i.tenant_id).bind(id).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let (name, mime, key, scan, entity) =
        row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Attachment not found"))?;
    let kind: String =
        sqlx::query_scalar("SELECT entity_type FROM attachments WHERE tenant_id=$1 AND id=$2")
            .bind(i.tenant_id)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
    authorize_entity(&mut tx, &kind, entity).await?;
    if scan == "infected" || (tx.cfg.scan_required && scan != "clean") {
        return Err(forbidden_msg(if scan == "infected" {
            "This file was blocked by the malware scan"
        } else {
            "This file has not passed the malware scan yet"
        }));
    }
    let bytes = tx
        .store
        .get(&ObjPath::from(key.as_str()))
        .await
        .map_err(|_| err(StatusCode::NOT_FOUND, "The file is no longer in storage"))?
        .bytes()
        .await
        .map_err(|e| ApiError::Internal(format!("storage read failed: {e}")))?;
    let inline = q.inline.unwrap_or(false) && INLINE_SAFE.contains(&mime.as_str());
    let disposition = format!(
        "{}; filename=\"{}\"",
        if inline { "inline" } else { "attachment" },
        name.replace('"', "")
    );
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CONTENT_DISPOSITION, disposition),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; sandbox".to_string(),
            ),
            (header::CACHE_CONTROL, "private, no-store".to_string()),
        ],
        bytes,
    )
        .into_response())
}

#[utoipa::path(delete, path = "/api/attachments/{id}", tag = "attachments", params(("id" = Uuid, Path, description = "Attachment id")), responses((status = 204, description = "Deleted"), (status = 403, description = "Only the uploader or a project admin can delete", body = ErrorBody), (status = 404, description = "Not found or not visible", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let row: Option<(Uuid, String, Uuid, String, Uuid)> = sqlx::query_as("SELECT project_id,entity_type,entity_id,storage_key,uploaded_by FROM attachments WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL")
        .bind(i.tenant_id).bind(id).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let (project, kind, entity, key, uploader) =
        row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Attachment not found"))?;
    authorize_entity(&mut tx, &kind, entity).await?;
    if uploader != i.user_id && project_level(&mut tx, &i, project).await?.unwrap_or(0) < 3 {
        return Err(forbidden());
    }
    sqlx::query("UPDATE attachments SET deleted_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut *tx, &i, "detached", &kind, entity).await?;
    // The object goes immediately; if the delete is lost the row is already hidden and the quota freed.
    let _ = tx.store.delete(&ObjPath::from(key.as_str())).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Background job: scan an upload (or mark it skipped when no scanner is configured).
pub(crate) async fn scan_job(
    db: &PgPool,
    cfg: &crate::config::Config,
    store: &crate::storage::Store,
    attachment: Uuid,
) -> Result<(), String> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT storage_key,scan_status FROM attachments WHERE id=$1 AND deleted_at IS NULL",
    )
    .bind(attachment)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;
    let Some((key, status)) = row else {
        return Ok(());
    };
    if status != "pending" {
        return Ok(());
    }
    let set = |s: &'static str, d: Option<String>| async move {
        sqlx::query("UPDATE attachments SET scan_status=$2, scan_detail=$3 WHERE id=$1")
            .bind(attachment)
            .bind(s)
            .bind(d)
            .execute(db)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    };
    let Some(addr) = &cfg.clamav_addr else {
        return set("skipped", Some("no scanner configured".into())).await;
    };
    let data = store
        .get(&ObjPath::from(key.as_str()))
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    match clamd_scan(addr, &data).await? {
        Verdict::Clean => set("clean", None).await,
        Verdict::Infected(sig) => {
            let _ = store.delete(&ObjPath::from(key.as_str())).await;
            tracing::warn!(%attachment, signature=%sig, "attachment blocked by malware scan");
            set("infected", Some(sig)).await
        }
    }
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/attachments",
            get(list)
                .post(upload)
                .layer(DefaultBodyLimit::max(30 * 1024 * 1024)),
        )
        .route("/api/attachments/{id}/download", get(download))
        .route("/api/attachments/{id}", delete(remove))
}
