//! Issue content (Phase F5): descriptions written as markdown and cleaned on the server, reactions on
//! comments, and personal reminders on issues.
//!
//! The description is stored as markdown source. Raw HTML is removed and links that would run script
//! (`javascript:`, `data:`, `vbscript:`) are neutralised before it is saved. The web client renders the
//! subset it understands without inserting HTML, so the stored text is never trusted as markup.
use crate::api::common::*;
use crate::*;
use axum::routing::{delete, get, put};
use chrono::{DateTime, Duration, Utc};

pub(crate) const DESCRIPTION_MAX: usize = 20_000;
/// The reactions a member can add to a comment.
pub(crate) const REACTIONS: [&str; 6] = ["thumbs_up", "party", "eyes", "heart", "rocket", "check"];
const REMINDER_HORIZON_DAYS: i64 = 366;

/// Makes a description safe to store and to show: HTML tags are dropped, script-capable link targets
/// are replaced, and control characters other than line breaks and tabs are removed.
pub(crate) fn sanitize_markdown(source: &str) -> String {
    let no_control: String = source
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect();
    // Drop anything that looks like an HTML tag: a '<' followed by a letter, '/' or '!', up to the next '>'.
    let mut out = String::with_capacity(no_control.len());
    let chars: Vec<char> = no_control.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '<' && i + 1 < chars.len() && (chars[i + 1].is_ascii_alphabetic() || matches!(chars[i + 1], '/' | '!')) {
            if let Some(end) = chars[i..].iter().position(|c| *c == '>') {
                i += end + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    // Neutralise link targets that would run script when followed.
    let mut result = out;
    for scheme in ["javascript:", "vbscript:", "data:"] {
        loop {
            let lower = result.to_ascii_lowercase();
            let Some(pos) = lower.find(&format!("]({scheme}")) else { break };
            let start = pos + 2;
            result.replace_range(start..start + scheme.len(), "#");
        }
    }
    result
}

/// Fixed reactions on one comment, with counts and whether the caller added each one.
#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct CommentReaction {
    pub(crate) comment_id: Uuid,
    pub(crate) reaction: String,
    pub(crate) count: i64,
    pub(crate) mine: bool,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct Reminder {
    pub(crate) id: Uuid,
    pub(crate) remind_at: DateTime<Utc>,
    pub(crate) note: String,
    pub(crate) sent_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewReminder {
    /// When to remind, in UTC. Between now and one year ahead.
    pub(crate) remind_at: DateTime<Utc>,
    /// Up to 500 characters.
    pub(crate) note: Option<String>,
}

fn reaction_ok(name: &str) -> ApiResult<()> {
    if REACTIONS.contains(&name) {
        Ok(())
    } else {
        Err(bad("Unknown reaction"))
    }
}

async fn comment_issue(tx: &mut Tx, tenant: Uuid, comment: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar("SELECT issue_id FROM issue_comments WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(comment)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Comment not found"))
}

#[utoipa::path(get, path = "/api/issues/{id}/reactions", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Reactions on the issue's comments", body = Vec<CommentReaction>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Issue not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_reactions(mut tx: Tx, Path(issue): Path<Uuid>) -> ApiResult<Json<Vec<CommentReaction>>> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, issue).await?;
    let rows: Vec<CommentReaction> = sqlx::query_as(
        "SELECT r.comment_id, r.reaction, count(*)::int8 AS count, bool_or(r.user_id=$3) AS mine \
         FROM issue_comment_reactions r JOIN issue_comments c ON c.tenant_id=r.tenant_id AND c.id=r.comment_id \
         WHERE r.tenant_id=$1 AND c.issue_id=$2 GROUP BY r.comment_id, r.reaction ORDER BY r.comment_id, r.reaction",
    )
    .bind(i.tenant_id)
    .bind(issue)
    .bind(i.user_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(put, path = "/api/comments/{id}/reactions/{reaction}", tag = "issues", params(("id" = Uuid, Path, description = "Comment id"), ("reaction" = String, Path, description = "thumbs_up, party, eyes, heart, rocket or check")), responses((status = 204, description = "Added"), (status = 400, description = "Unknown reaction", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Editors only", body = ErrorBody), (status = 404, description = "Comment not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_reaction(mut tx: Tx, Path((comment, reaction)): Path<(Uuid, String)>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    reaction_ok(&reaction)?;
    let issue = comment_issue(&mut tx, i.tenant_id, comment).await?;
    valid_issue(&mut tx, &i, issue).await?;
    sqlx::query(
        "INSERT INTO issue_comment_reactions(tenant_id,comment_id,user_id,reaction) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(i.tenant_id)
    .bind(comment)
    .bind(i.user_id)
    .bind(&reaction)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/comments/{id}/reactions/{reaction}", tag = "issues", params(("id" = Uuid, Path, description = "Comment id"), ("reaction" = String, Path, description = "thumbs_up, party, eyes, heart, rocket or check")), responses((status = 204, description = "Removed, or was not there"), (status = 400, description = "Unknown reaction", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Comment not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_reaction(mut tx: Tx, Path((comment, reaction)): Path<(Uuid, String)>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    reaction_ok(&reaction)?;
    let issue = comment_issue(&mut tx, i.tenant_id, comment).await?;
    valid_issue(&mut tx, &i, issue).await?;
    sqlx::query(
        "DELETE FROM issue_comment_reactions WHERE tenant_id=$1 AND comment_id=$2 AND user_id=$3 AND reaction=$4",
    )
    .bind(i.tenant_id)
    .bind(comment)
    .bind(i.user_id)
    .bind(&reaction)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/issues/{id}/reminders", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "Your reminders on this issue", body = Vec<Reminder>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Issue not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_reminders(mut tx: Tx, Path(issue): Path<Uuid>) -> ApiResult<Json<Vec<Reminder>>> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, issue).await?;
    let rows: Vec<Reminder> = sqlx::query_as(
        "SELECT id, remind_at, note, sent_at FROM issue_reminders WHERE tenant_id=$1 AND issue_id=$2 AND user_id=$3 ORDER BY remind_at",
    )
    .bind(i.tenant_id)
    .bind(issue)
    .bind(i.user_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/issues/{id}/reminders", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewReminder, responses((status = 201, description = "Scheduled", body = Reminder), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Editors only", body = ErrorBody), (status = 404, description = "Issue not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn add_reminder(
    mut tx: Tx,
    Path(issue): Path<Uuid>,
    Json(v): Json<NewReminder>,
) -> ApiResult<(StatusCode, Json<Reminder>)> {
    let i = tx.identity.clone();
    valid_issue(&mut tx, &i, issue).await?;
    let now = Utc::now();
    if v.remind_at <= now || v.remind_at > now + Duration::days(REMINDER_HORIZON_DAYS) {
        return Err(bad("A reminder must be set between now and one year ahead"));
    }
    let note = v.note.unwrap_or_default();
    if note.chars().count() > 500 {
        return Err(bad("A reminder note is limited to 500 characters"));
    }
    let row: Reminder = sqlx::query_as(
        "INSERT INTO issue_reminders(tenant_id,issue_id,user_id,remind_at,note) VALUES($1,$2,$3,$4,$5) RETURNING id, remind_at, note, sent_at",
    )
    .bind(i.tenant_id)
    .bind(issue)
    .bind(i.user_id)
    .bind(v.remind_at)
    .bind(&note)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(delete, path = "/api/reminders/{id}", tag = "issues", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Removed"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found for you", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_reminder(mut tx: Tx, Path(id): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    let removed = sqlx::query("DELETE FROM issue_reminders WHERE tenant_id=$1 AND id=$2 AND user_id=$3")
        .bind(i.tenant_id)
        .bind(id)
        .bind(i.user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?
        .rows_affected();
    if removed == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Reminder not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Turns due reminders into notifications and marks them sent. It runs from the hourly maintenance
/// loop on the system connection, at most 500 reminders per run.
pub(crate) async fn send_due_reminders(db: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "WITH due AS (UPDATE issue_reminders r SET sent_at=now() \
           WHERE r.id IN (SELECT id FROM issue_reminders WHERE sent_at IS NULL AND remind_at <= now() ORDER BY remind_at LIMIT 500) \
           RETURNING r.tenant_id, r.user_id, r.issue_id, r.note) \
         INSERT INTO notifications(tenant_id,recipient_id,actor_id,kind,title,body,entity_type,entity_id) \
         SELECT tenant_id, user_id, user_id, 'reminder', 'Reminder for an issue', note, 'issue', issue_id FROM due",
    )
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/issues/{id}/reactions", get(list_reactions))
        .route(
            "/api/comments/{id}/reactions/{reaction}",
            put(add_reaction).delete(remove_reaction),
        )
        .route("/api/issues/{id}/reminders", get(list_reminders).post(add_reminder))
        .route("/api/reminders/{id}", delete(remove_reminder))
}

