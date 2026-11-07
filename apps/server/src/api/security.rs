//! Session management for the signed-in user: list devices/browsers, revoke one, revoke the rest.
use crate::api::common::*;
use crate::*;
use axum::routing::delete;
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/sessions", tag = "security", responses((status = 200, description = "Your active sign-ins in this workspace", body = Vec<Object>), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_sessions(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    let hash = tx.token_hash.clone();
    let rows = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',f.id,'user_agent',f.user_agent,'created_at',f.created_at,\
         'last_seen_at',f.last_seen_at,\
         'current',EXISTS(SELECT 1 FROM sessions s WHERE s.family_id=f.id AND s.token_hash=$3)) \
         FROM session_families f WHERE f.tenant_id=$1 AND f.user_id=$2 AND f.revoked_at IS NULL \
         ORDER BY f.last_seen_at DESC LIMIT 100",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(hash)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(delete, path = "/api/sessions/{id}", tag = "security", params(("id" = Uuid, Path, description = "Session id")), responses((status = 204, description = "Session revoked"), (status = 404, description = "No such active session of yours", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn revoke_session(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let done = sqlx::query("UPDATE session_families SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL")
        .bind(i.tenant_id).bind(i.user_id).bind(id).execute(&mut *tx).await.map_err(db_err)?;
    if done.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "No such active session"));
    }
    sqlx::query("DELETE FROM sessions WHERE tenant_id=$1 AND family_id=$2")
        .bind(i.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "revoked", "session", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/sessions/revoke-others", tag = "security", responses((status = 200, description = "Number of other sign-ins ended", body = Object), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn revoke_other_sessions(mut tx: Tx) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    let hash = tx.token_hash.clone();
    let revoked: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE session_families f SET revoked_at=now() \
         WHERE f.tenant_id=$1 AND f.user_id=$2 AND f.revoked_at IS NULL \
           AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.family_id=f.id AND s.token_hash=$3) \
         RETURNING f.id",
    )
    .bind(i.tenant_id)
    .bind(i.user_id)
    .bind(hash)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    sqlx::query("DELETE FROM sessions WHERE tenant_id=$1 AND family_id = ANY($2)")
        .bind(i.tenant_id)
        .bind(&revoked)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "revoked_others", "session", i.user_id).await?;
    Ok(Json(json!({ "revoked": revoked.len() })))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/{id}", delete(revoke_session))
        .route("/api/sessions/revoke-others", post(revoke_other_sessions))
}
