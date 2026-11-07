//! Collaborative page editing: the Yjs sync protocol over WebSocket (`/api/collab/{page_id}`).
//!
//! * One in-memory `yrs` document ("room") per page being edited; clients (y-websocket) exchange
//!   standard y-protocols sync/awareness messages, so any number of people can type at once and
//!   everyone converges (CRDT), including after offline edits.
//! * Every accepted update is appended to `page_ydoc_updates` (compacted periodically), so a
//!   restart or a late joiner loses nothing. `pages.content` is refreshed as a plain-text
//!   snapshot (search, export, mobile) and a history version is cut at most every 5 minutes.
//! * Security: the upgrade is cookie/bearer authenticated, **Origin-checked** (a cross-site page
//!   cannot open the socket with the victim's cookies), and authorized through
//!   `page_access()` inside a tenant-bound transaction. Viewers can read but their updates are
//!   dropped. Access and the session are re-checked every 30 s, so revoking a restriction or a
//!   session closes the socket. REST saves/restores bump `pages.collab_epoch`, which resets rooms.
use crate::*;
use axum::{
    extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, Mutex};
use yrs::{
    sync::{Message, SyncMessage},
    updates::{decoder::Decode, encoder::Encode},
    Doc, GetString, ReadTxn, StateVector, Transact, Update, XmlElementPrelim, XmlFragment, XmlOut,
    XmlTextPrelim,
};

const FRAGMENT: &str = "default"; // the name y-prosemirror / Tiptap use
const COMPACT_AFTER: u64 = 150;
const IDLE_BEFORE_SNAPSHOT: Duration = Duration::from_secs(3);
const VERSION_EVERY: Duration = Duration::from_secs(300);
const MAX_FRAME: usize = 2 * 1024 * 1024;

struct RoomState {
    conns: usize,
    dirty_since: Option<Instant>,
    last_edit: Instant,
    last_editor: Option<Uuid>,
    updates_since_compact: u64,
    last_version_cut: Instant,
    closed: bool,
}

pub(crate) struct Room {
    page: Uuid,
    tenant: Uuid,
    epoch: i32,
    doc: Doc,
    tx: broadcast::Sender<(u64, Vec<u8>)>,
    next_conn: AtomicU64,
    state: StdMutex<RoomState>,
}

#[derive(Default)]
pub(crate) struct Rooms {
    map: Mutex<HashMap<Uuid, Arc<Room>>>,
}

/// Text of the document for the plain-text snapshot.
fn plain_text(doc: &Doc) -> String {
    fn walk(txn: &impl ReadTxn, node: XmlOut, out: &mut String) {
        match node {
            XmlOut::Text(t) => {
                // XmlText renders formatting marks as tags; keep only the characters.
                let mut in_tag = false;
                for c in t.get_string(txn).chars() {
                    match c {
                        '<' => in_tag = true,
                        '>' => in_tag = false,
                        c if !in_tag => out.push(c),
                        _ => {}
                    }
                }
            }
            XmlOut::Element(e) => {
                for child in e.children(txn) {
                    walk(txn, child, out);
                }
                out.push('\n');
            }
            XmlOut::Fragment(f) => {
                for child in f.children(txn) {
                    walk(txn, child, out);
                }
            }
        }
    }
    let frag = doc.get_or_insert_xml_fragment(FRAGMENT);
    let txn = doc.transact();
    let mut out = String::new();
    for child in frag.children(&txn) {
        walk(&txn, child, &mut out);
    }
    out.trim_end().to_string()
}

fn seed_from_text(doc: &Doc, text: &str) {
    let frag = doc.get_or_insert_xml_fragment(FRAGMENT);
    let mut txn = doc.transact_mut();
    for line in text.split('\n') {
        let p = frag.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        if !line.is_empty() {
            p.push_back(&mut txn, XmlTextPrelim::new(line));
        }
    }
}

impl Rooms {
    /// The live room for a page, loading it from the update log (or seeding it from the plain
    /// text on first use).
    async fn join(&self, app: &App, tenant: Uuid, page: Uuid) -> ApiResult<(Arc<Room>, u64)> {
        let mut map = self.map.lock().await;
        if let Some(r) = map.get(&page) {
            let mut st = r.state.lock().expect("room state");
            if !st.closed {
                st.conns += 1;
                let id = r.next_conn.fetch_add(1, Ordering::Relaxed) + 1;
                return Ok((r.clone(), id));
            }
        }
        let (content, epoch): (String, i32) =
            sqlx::query_as("SELECT content,collab_epoch FROM pages WHERE tenant_id=$1 AND id=$2")
                .bind(tenant)
                .bind(page)
                .fetch_optional(&app.db)
                .await
                .map_err(db_err)?
                .ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))?;
        let updates: Vec<Vec<u8>> = sqlx::query_scalar("SELECT update FROM page_ydoc_updates WHERE tenant_id=$1 AND page_id=$2 AND epoch=$3 ORDER BY id")
            .bind(tenant).bind(page).bind(epoch).fetch_all(&app.db).await.map_err(db_err)?;
        let doc = Doc::new();
        if updates.is_empty() {
            seed_from_text(&doc, &content);
            let seed = doc
                .transact()
                .encode_state_as_update_v1(&StateVector::default());
            sqlx::query(
                "INSERT INTO page_ydoc_updates(tenant_id,page_id,epoch,update) VALUES($1,$2,$3,$4)",
            )
            .bind(tenant)
            .bind(page)
            .bind(epoch)
            .bind(seed)
            .execute(&app.db)
            .await
            .map_err(db_err)?;
        } else {
            let mut txn = doc.transact_mut();
            for u in &updates {
                if let Ok(u) = Update::decode_v1(u) {
                    let _ = txn.apply_update(u);
                }
            }
        }
        let room = Arc::new(Room {
            page,
            tenant,
            epoch,
            doc,
            tx: broadcast::channel(256).0,
            next_conn: AtomicU64::new(1),
            state: StdMutex::new(RoomState {
                conns: 1,
                dirty_since: None,
                last_edit: Instant::now(),
                last_editor: None,
                updates_since_compact: updates.len() as u64,
                last_version_cut: Instant::now(),
                closed: false,
            }),
        });
        map.insert(page, room.clone());
        tokio::spawn(maintain(app.clone(), room.clone()));
        Ok((room, 1))
    }

    async fn leave(&self, app: &App, room: &Arc<Room>) {
        let last = {
            let mut map = self.map.lock().await;
            let mut st = room.state.lock().expect("room state");
            st.conns = st.conns.saturating_sub(1);
            if st.conns == 0 {
                st.closed = true;
                if map.get(&room.page).is_some_and(|r| Arc::ptr_eq(r, room)) {
                    map.remove(&room.page);
                }
                true
            } else {
                false
            }
        };
        if last {
            if let Err(e) = flush(app, room, true).await {
                tracing::warn!(page=%room.page, error=%e, "final collaboration flush failed");
            }
        }
    }
}

/// Persist the plain-text snapshot (and cut a history version at most every few minutes).
async fn flush(app: &App, room: &Room, force: bool) -> Result<(), String> {
    let (dirty, editor, cut) = {
        let st = room.state.lock().map_err(|_| "poisoned")?;
        (
            st.dirty_since.is_some() && (force || st.last_edit.elapsed() >= IDLE_BEFORE_SNAPSHOT),
            st.last_editor,
            st.last_version_cut.elapsed() >= VERSION_EVERY,
        )
    };
    if !dirty {
        return Ok(());
    }
    let text = plain_text(&room.doc);
    let mut tx = app.db.begin().await.map_err(|e| e.to_string())?;
    let cur: Option<(String, String, i32, i32)> = sqlx::query_as("SELECT title,content,version,collab_epoch FROM pages WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(room.tenant).bind(room.page).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    let Some((title, content, version, epoch)) = cur else {
        return Ok(());
    };
    if epoch != room.epoch {
        return Ok(()); // replaced from outside while we were editing; the room is about to reset
    }
    if content != text {
        let actor = editor.unwrap_or_default();
        if cut && !actor.is_nil() {
            sqlx::query("INSERT INTO page_versions(tenant_id,page_id,version,title,content,editor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
                .bind(room.tenant).bind(room.page).bind(version).bind(&title).bind(&content).bind(actor)
                .execute(&mut *tx).await.map_err(|e| e.to_string())?;
            sqlx::query("UPDATE pages SET content=$3, version=version+1, updated_at=now() WHERE tenant_id=$1 AND id=$2")
                .bind(room.tenant).bind(room.page).bind(&text).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        } else {
            sqlx::query(
                "UPDATE pages SET content=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2",
            )
            .bind(room.tenant)
            .bind(room.page)
            .bind(&text)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
        if !actor.is_nil() {
            crate::api::common::emit_event(
                &mut tx,
                room.tenant,
                Some(actor),
                "page",
                room.page,
                "edited",
                serde_json::json!({}),
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        if cut {
            if let Ok(mut st) = room.state.lock() {
                st.last_version_cut = Instant::now();
            }
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    if let Ok(mut st) = room.state.lock() {
        if st.last_edit.elapsed() >= IDLE_BEFORE_SNAPSHOT || force {
            st.dirty_since = None;
        }
    }
    Ok(())
}

/// Replace the many small updates by one full-state update.
async fn compact(app: &App, room: &Room) -> Result<(), String> {
    let full = room
        .doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    let mut tx = app.db.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM page_ydoc_updates WHERE tenant_id=$1 AND page_id=$2 AND epoch=$3")
        .bind(room.tenant)
        .bind(room.page)
        .bind(room.epoch)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO page_ydoc_updates(tenant_id,page_id,epoch,update) VALUES($1,$2,$3,$4)",
    )
    .bind(room.tenant)
    .bind(room.page)
    .bind(room.epoch)
    .bind(full)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    if let Ok(mut st) = room.state.lock() {
        st.updates_since_compact = 1;
    }
    Ok(())
}

/// Per-room housekeeping: reset when the page was replaced from outside, snapshot, compact.
async fn maintain(app: App, room: Arc<Room>) {
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    loop {
        tick.tick().await;
        if room.state.lock().map(|s| s.closed).unwrap_or(true) {
            return;
        }
        let epoch: Option<i32> =
            sqlx::query_scalar("SELECT collab_epoch FROM pages WHERE tenant_id=$1 AND id=$2")
                .bind(room.tenant)
                .bind(room.page)
                .fetch_optional(&app.db)
                .await
                .ok()
                .flatten();
        if epoch != Some(room.epoch) {
            // Content was replaced (REST save / restore) or the page is gone: drop the room;
            // an empty frame tells every connection to close so clients reconnect to a fresh one.
            if let Ok(mut st) = room.state.lock() {
                st.closed = true;
            }
            app.rooms
                .map
                .lock()
                .await
                .retain(|_, r| !Arc::ptr_eq(r, &room));
            let _ = room.tx.send((0, vec![]));
            return;
        }
        if let Err(e) = flush(&app, &room, false).await {
            tracing::warn!(page=%room.page, error=%e, "collaboration snapshot failed");
        }
        let need_compact = room
            .state
            .lock()
            .map(|s| s.updates_since_compact >= COMPACT_AFTER)
            .unwrap_or(false);
        if need_compact {
            if let Err(e) = compact(&app, &room).await {
                tracing::warn!(page=%room.page, error=%e, "collaboration compaction failed");
            }
        }
    }
}

// ---------------------------------------------------------------- the WebSocket

fn origin_allowed(headers: &HeaderMap, cfg: &crate::config::Config) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return false; // browsers always send Origin on WebSocket handshakes
    };
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let origin_host = origin.split_once("://").map(|(_, h)| h).unwrap_or(origin);
    origin_host == host || cfg.allowed_origins.iter().any(|o| o == origin)
}

async fn page_level(app: &App, i: &Identity, page: Uuid) -> i32 {
    let Ok(mut tx) = tenant_tx(&app.db, i.tenant_id).await else {
        return 0;
    };
    let level: Option<i32> = sqlx::query_scalar("SELECT page_access($1,$2,$3)")
        .bind(page)
        .bind(i.user_id)
        .bind(&i.role)
        .fetch_one(&mut *tx)
        .await
        .ok()
        .flatten();
    let _ = tx.rollback().await;
    level.unwrap_or(0)
}

async fn session_alive(app: &App, hash: &str) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id AND m.disabled_at IS NULL LEFT JOIN session_families f ON f.id=s.family_id WHERE s.token_hash=$1 AND s.expires_at>now() AND (f.id IS NULL OR f.revoked_at IS NULL))")
        .bind(hash).fetch_one(&app.db).await.unwrap_or(false)
}

pub(crate) async fn connect(
    State(app): State<App>,
    Path(page): Path<Uuid>,
    headers: HeaderMap,
    crate::realtime::StreamAuth(i, hash): crate::realtime::StreamAuth,
    ws: WebSocketUpgrade,
) -> ApiResult<Response> {
    if !origin_allowed(&headers, &app.cfg) {
        return Err(forbidden_msg(
            "Cross-site WebSocket connections are not allowed",
        ));
    }
    let level = page_level(&app, &i, page).await;
    if level < 1 {
        return Err(err(StatusCode::NOT_FOUND, "Page not found"));
    }
    Ok(ws
        .max_message_size(MAX_FRAME)
        .max_frame_size(MAX_FRAME)
        .on_upgrade(move |socket| serve(app, socket, i, hash, page, level)))
}

async fn serve(app: App, socket: WebSocket, i: Identity, hash: String, page: Uuid, mut level: i32) {
    let Ok((room, conn)) = app.rooms.join(&app, i.tenant_id, page).await else {
        return;
    };
    let mut rx = room.tx.subscribe();
    let (mut sink, mut stream) = socket.split();
    let hello =
        Message::Sync(SyncMessage::SyncStep1(room.doc.transact().state_vector())).encode_v1();
    if sink.send(WsMessage::Binary(hello.into())).await.is_err() {
        app.rooms.leave(&app, &room).await;
        return;
    }
    let mut recheck = tokio::time::interval(Duration::from_secs(30));
    recheck.tick().await;
    loop {
        tokio::select! {
            incoming = stream.next() => {
                let Some(Ok(msg)) = incoming else { break };
                match msg {
                    WsMessage::Binary(bytes) => {
                        match handle_frame(&app, &room, conn, &i, level >= 2, &bytes).await {
                            Ok(Some(reply)) => { if sink.send(WsMessage::Binary(reply.into())).await.is_err() { break; } }
                            Ok(None) => {}
                            Err(()) => break,
                        }
                    }
                    WsMessage::Close(_) => break,
                    _ => {}
                }
            }
            fanned = rx.recv() => match fanned {
                Ok((origin, bytes)) => {
                    if bytes.is_empty() { break; } // room reset
                    if origin != conn && sink.send(WsMessage::Binary(bytes.into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // We missed frames: ask the client to resynchronise from scratch.
                    let again = Message::Sync(SyncMessage::SyncStep1(room.doc.transact().state_vector())).encode_v1();
                    if sink.send(WsMessage::Binary(again.into())).await.is_err() { break; }
                }
                Err(_) => break,
            },
            _ = recheck.tick() => {
                if !session_alive(&app, &hash).await { break; }
                level = page_level(&app, &i, page).await;
                if level < 1 { break; }
            }
        }
    }
    let _ = sink.close().await;
    app.rooms.leave(&app, &room).await;
}

/// Handle one y-protocols frame. `Ok(Some(bytes))` is a direct reply; `Err` closes the socket.
async fn handle_frame(
    app: &App,
    room: &Arc<Room>,
    conn: u64,
    i: &Identity,
    can_write: bool,
    bytes: &[u8],
) -> Result<Option<Vec<u8>>, ()> {
    let Ok(msg) = Message::decode_v1(bytes) else {
        return Err(());
    };
    match msg {
        Message::Sync(SyncMessage::SyncStep1(sv)) => {
            let diff = room.doc.transact().encode_state_as_update_v1(&sv);
            Ok(Some(
                Message::Sync(SyncMessage::SyncStep2(diff)).encode_v1(),
            ))
        }
        Message::Sync(SyncMessage::SyncStep2(update))
        | Message::Sync(SyncMessage::Update(update)) => {
            if !can_write {
                return Ok(None); // viewers may read, never write
            }
            let Ok(decoded) = Update::decode_v1(&update) else {
                return Err(());
            };
            if room.doc.transact_mut().apply_update(decoded).is_err() {
                return Err(());
            }
            sqlx::query(
                "INSERT INTO page_ydoc_updates(tenant_id,page_id,epoch,update) VALUES($1,$2,$3,$4)",
            )
            .bind(room.tenant)
            .bind(room.page)
            .bind(room.epoch)
            .bind(&update)
            .execute(&app.db)
            .await
            .map_err(|_| ())?;
            if let Ok(mut st) = room.state.lock() {
                st.last_edit = Instant::now();
                st.dirty_since.get_or_insert_with(Instant::now);
                st.last_editor = Some(i.user_id);
                st.updates_since_compact += 1;
            }
            let _ = room.tx.send((conn, bytes.to_vec()));
            Ok(None)
        }
        Message::Awareness(_) => {
            // Cursors/presence: relay as is (clients expire stale entries themselves).
            let _ = room.tx.send((conn, bytes.to_vec()));
            Ok(None)
        }
        _ => Ok(None),
    }
}

pub(crate) fn routes() -> Router<App> {
    Router::new().route("/api/collab/{id}", get(connect))
}
