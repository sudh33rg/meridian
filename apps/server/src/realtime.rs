//! Server-sent change feed: `GET /api/sync/stream`.
//!
//! Every committed change appends a row to the per-tenant event log (`sync_id`). A single
//! `LISTEN events` task wakes interested streams; each stream then reads new log rows inside a
//! short **tenant-bound, role-limited transaction** and filters them by what *this* user may see
//! (project and page access), so the feed can never leak a private item. The payload is only
//! `{sync_id, entity_type, entity_id, op, project_id}`; clients re-fetch through the normal,
//! authorized API. `Last-Event-ID` resumes after a reconnect. The session is re-checked on every
//! wake-up, so revoking it (or removing the member) ends the stream.
use crate::*;
use axum::{
    extract::Query,
    response::sse::{Event, KeepAlive, Sse},
};
use serde_json::json;
use std::{collections::HashMap, convert::Infallible, sync::Mutex, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::wrappers::ReceiverStream;

const FEED_TYPES: &[&str] = &[
    "issue",
    "page",
    "project",
    "sprint",
    "release",
    "goal",
    "decision",
    "risk",
    "approval",
    "automation",
    "relation",
    "team",
    "member",
];
const MAX_STREAMS_PER_USER: usize = 8;

/// Fan-out of "tenant X has new events" wake-ups, plus a per-user connection cap.
pub(crate) struct Live {
    pub(crate) wake: broadcast::Sender<Uuid>,
    conns: Mutex<HashMap<Uuid, usize>>,
}
impl Live {
    pub(crate) fn new() -> Live {
        Live {
            wake: broadcast::channel(1024).0,
            conns: Mutex::new(HashMap::new()),
        }
    }
    fn acquire(self: &std::sync::Arc<Self>, user: Uuid) -> Option<ConnGuard> {
        let mut m = self.conns.lock().ok()?;
        let n = m.entry(user).or_insert(0);
        if *n >= MAX_STREAMS_PER_USER {
            return None;
        }
        *n += 1;
        Some(ConnGuard {
            live: self.clone(),
            user,
        })
    }
}
struct ConnGuard {
    live: std::sync::Arc<Live>,
    user: Uuid,
}
impl Drop for ConnGuard {
    fn drop(&mut self) {
        if let Ok(mut m) = self.live.conns.lock() {
            if let Some(n) = m.get_mut(&self.user) {
                *n = n.saturating_sub(1);
            }
        }
    }
}

/// Keep one `LISTEN events` connection alive (reconnecting with backoff) and relay wake-ups.
pub(crate) fn spawn_listener(db: PgPool, live: std::sync::Arc<Live>) {
    tokio::spawn(async move {
        let mut backoff = 1u64;
        loop {
            match sqlx::postgres::PgListener::connect_with(&db).await {
                Ok(mut l) => {
                    if l.listen("events").await.is_ok() {
                        backoff = 1;
                        while let Ok(n) = l.recv().await {
                            if let Ok(t) = Uuid::parse_str(n.payload()) {
                                let _ = live.wake.send(t);
                            }
                        }
                    }
                }
                Err(e) => tracing::warn!(error=%e, "event listener cannot connect"),
            }
            tokio::time::sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(30);
        }
    });
}

/// Identity plus the hash of the presented session token (to re-validate it during the stream).
pub(crate) struct StreamAuth(pub(crate) Identity, pub(crate) String);
impl FromRequestParts<App> for StreamAuth {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self, ApiError> {
        let (i, h) = authenticate(parts, state).await?;
        Ok(StreamAuth(i, h))
    }
}

async fn session_alive(db: &PgPool, hash: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id AND m.disabled_at IS NULL \
         LEFT JOIN session_families f ON f.id=s.family_id WHERE s.token_hash=$1 AND s.expires_at>now() AND (f.id IS NULL OR f.revoked_at IS NULL))",
    )
    .bind(hash)
    .fetch_one(db)
    .await
    .unwrap_or(false)
}

#[derive(Deserialize)]
pub(crate) struct StreamQuery {
    since: Option<i64>,
}

#[utoipa::path(get, path = "/api/sync/stream", tag = "realtime", params(("since" = Option<i64>, Query, description = "Resume after this sync_id (Last-Event-ID header also works)")), responses((status = 200, description = "text/event-stream of change notifications", content_type = "text/event-stream"), (status = 429, description = "Too many open streams for this user", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn stream(
    State(app): State<App>,
    StreamAuth(i, hash): StreamAuth,
    headers: HeaderMap,
    Query(q): Query<StreamQuery>,
) -> ApiResult<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>> {
    let guard = app.live.acquire(i.user_id).ok_or_else(|| {
        err(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many open live connections for this account",
        )
    })?;
    let resume = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        .or(q.since);
    let mut cursor: i64 = match resume {
        Some(c) => c,
        None => {
            sqlx::query_scalar("SELECT COALESCE(max(sync_id),0) FROM events WHERE tenant_id=$1")
                .bind(i.tenant_id)
                .fetch_one(&app.db)
                .await
                .map_err(db_err)?
        }
    };
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);
    let mut wake = app.live.wake.subscribe();
    tokio::spawn(async move {
        let _guard = guard; // released when the stream ends
        let mut tick = tokio::time::interval(Duration::from_secs(20));
        loop {
            match fetch_batch(&app, &i, cursor).await {
                Ok((rows, upper)) => {
                    for r in rows {
                        let ev = Event::default()
                            .id(r["sync_id"].to_string())
                            .event("change")
                            .data(r.to_string());
                        if tx.send(Ok(ev)).await.is_err() {
                            return; // client went away
                        }
                    }
                    cursor = upper.max(cursor);
                }
                Err(e) => {
                    tracing::warn!(error=%e, "change feed read failed");
                    return;
                }
            }
            // Sleep until this tenant has news, or re-check the session on the heartbeat.
            loop {
                tokio::select! {
                    got = wake.recv() => match got {
                        Ok(t) if t == i.tenant_id => break,
                        Ok(_) => continue,
                        Err(broadcast::error::RecvError::Lagged(_)) => break,
                        Err(_) => return,
                    },
                    _ = tick.tick() => {
                        if tx.is_closed() || !session_alive(&app.db, &hash).await { return; }
                        break;
                    }
                }
            }
            if !session_alive(&app.db, &hash).await {
                return;
            }
        }
    });
    Ok(Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

/// New events after `cursor` that this identity may see, and the new cursor (which also skips
/// events that were filtered out, so they are not re-evaluated).
async fn fetch_batch(
    app: &App,
    i: &Identity,
    cursor: i64,
) -> ApiResult<(Vec<serde_json::Value>, i64)> {
    let mut tx = tenant_tx(&app.db, i.tenant_id).await?;
    let upper: i64 = sqlx::query_scalar("SELECT COALESCE(max(sync_id),0) FROM events WHERE tenant_id=$1 AND sync_id>$2 AND sync_id<=$2+500")
        .bind(i.tenant_id)
        .bind(cursor)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if upper <= cursor {
        tx.rollback().await.map_err(db_err)?;
        return Ok((vec![], cursor));
    }
    let types: Vec<&str> = FEED_TYPES.to_vec();
    let rows: Vec<(i64, String, Uuid, String, Option<Uuid>)> = sqlx::query_as(
        "SELECT sync_id,entity_type,entity_id,op,project_id FROM events \
         WHERE tenant_id=$1 AND sync_id>$2 AND sync_id<=$3 AND entity_type=ANY($4) \
           AND (project_id IS NULL OR project_access(project_id,$5,$6)>=1) \
           AND (entity_type<>'page' OR page_access(entity_id,$5,$6)>=1) \
         ORDER BY sync_id",
    )
    .bind(i.tenant_id)
    .bind(cursor)
    .bind(upper)
    .bind(&types)
    .bind(i.user_id)
    .bind(&i.role)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.rollback().await.map_err(db_err)?;
    Ok((
        rows.into_iter()
            .map(|(s, t, e, o, p)| json!({"sync_id": s, "entity_type": t, "entity_id": e, "op": o, "project_id": p}))
            .collect(),
        upper,
    ))
}

pub(crate) fn routes() -> Router<App> {
    Router::new().route("/api/sync/stream", get(stream))
}
