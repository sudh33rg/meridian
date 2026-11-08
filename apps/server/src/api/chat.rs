//! Chat notifications (Phase I3). A project can post status changes and new issues to a Slack and/or a
//! Microsoft Teams incoming webhook. Each message carries the issue key, its title, the status change
//! and who made it; never the description, comments or attachments. The webhook URL is the secret: it
//! is stored sealed, never returned, and checked on every use against the safe outbound rules (https,
//! public address, no redirects). Messages are queued in the same transaction as the change they report,
//! and a per-project quota caps deliveries per hour.
use crate::api::common::*;
use crate::*;
use axum::routing::get;

/// Deliveries per project per hour. Excess messages are dropped with a log line, never retried forever.
const HOURLY_QUOTA: i64 = 120;

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct ChatChannels {
    pub(crate) slack_configured: bool,
    pub(crate) teams_configured: bool,
    pub(crate) slack_enabled: bool,
    pub(crate) teams_enabled: bool,
    pub(crate) notify_status_changes: bool,
    pub(crate) notify_new_issues: bool,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ChatChannelsInput {
    /// The Slack incoming webhook URL. Omit to keep the current one; an empty string clears it.
    pub(crate) slack_url: Option<String>,
    /// The Microsoft Teams incoming webhook URL. Omit to keep the current one; an empty string clears it.
    pub(crate) teams_url: Option<String>,
    pub(crate) slack_enabled: bool,
    pub(crate) teams_enabled: bool,
    pub(crate) notify_status_changes: bool,
    pub(crate) notify_new_issues: bool,
}

fn aad(tenant: Uuid, project: Uuid, kind: &str) -> String {
    format!("chat:{tenant}:{project}:{kind}")
}

#[derive(FromRow)]
struct ChannelRow {
    slack_url_sealed: Option<String>,
    teams_url_sealed: Option<String>,
    slack_enabled: bool,
    teams_enabled: bool,
    notify_status_changes: bool,
    notify_new_issues: bool,
}

#[utoipa::path(get, path = "/api/projects/{id}/chat-channels", tag = "integrations", params(("id" = Uuid, Path, description = "Project id")), responses((status = 200, description = "Chat setup. URLs are never returned", body = ChatChannels), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_channels(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<ChatChannels>> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let row: Option<ChannelRow> = sqlx::query_as(
        "SELECT slack_url_sealed, teams_url_sealed, slack_enabled, teams_enabled, notify_status_changes, notify_new_issues \
         FROM project_chat_channels WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(match row {
        Some(r) => ChatChannels {
            slack_configured: r.slack_url_sealed.is_some(),
            teams_configured: r.teams_url_sealed.is_some(),
            slack_enabled: r.slack_enabled,
            teams_enabled: r.teams_enabled,
            notify_status_changes: r.notify_status_changes,
            notify_new_issues: r.notify_new_issues,
        },
        None => ChatChannels {
            slack_configured: false,
            teams_configured: false,
            slack_enabled: false,
            teams_enabled: false,
            notify_status_changes: true,
            notify_new_issues: false,
        },
    }))
}

#[utoipa::path(put, path = "/api/projects/{id}/chat-channels", tag = "integrations", params(("id" = Uuid, Path, description = "Project id")), request_body = ChatChannelsInput, responses((status = 200, description = "Saved", body = ChatChannels), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn put_channels(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<ChatChannelsInput>,
) -> ApiResult<Json<ChatChannels>> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let existing: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT slack_url_sealed, teams_url_sealed FROM project_chat_channels WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (mut slack, mut teams) = existing.unwrap_or((None, None));
    if let Some(url) = &v.slack_url {
        slack = seal_url(&tx.cfg, i.tenant_id, project, "slack", url)?;
    }
    if let Some(url) = &v.teams_url {
        teams = seal_url(&tx.cfg, i.tenant_id, project, "teams", url)?;
    }
    if v.slack_enabled && slack.is_none() {
        return Err(bad("Slack needs a webhook URL before it can be turned on"));
    }
    if v.teams_enabled && teams.is_none() {
        return Err(bad("Teams needs a webhook URL before it can be turned on"));
    }
    sqlx::query(
        "INSERT INTO project_chat_channels(tenant_id,project_id,slack_url_sealed,teams_url_sealed,slack_enabled,teams_enabled,notify_status_changes,notify_new_issues,updated_at) \
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (tenant_id,project_id) DO UPDATE SET \
         slack_url_sealed=EXCLUDED.slack_url_sealed, teams_url_sealed=EXCLUDED.teams_url_sealed, slack_enabled=EXCLUDED.slack_enabled, \
         teams_enabled=EXCLUDED.teams_enabled, notify_status_changes=EXCLUDED.notify_status_changes, \
         notify_new_issues=EXCLUDED.notify_new_issues, updated_at=now()",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&slack)
    .bind(&teams)
    .bind(v.slack_enabled)
    .bind(v.teams_enabled)
    .bind(v.notify_status_changes)
    .bind(v.notify_new_issues)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "chat_channels_updated", "project", project).await?;
    Ok(Json(ChatChannels {
        slack_configured: slack.is_some(),
        teams_configured: teams.is_some(),
        slack_enabled: v.slack_enabled,
        teams_enabled: v.teams_enabled,
        notify_status_changes: v.notify_status_changes,
        notify_new_issues: v.notify_new_issues,
    }))
}

/// Checks a webhook URL and seals it. An empty string clears the channel.
fn seal_url(cfg: &crate::config::Config, tenant: Uuid, project: Uuid, kind: &str, url: &str) -> ApiResult<Option<String>> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(None);
    }
    crate::safe_http::check_url(cfg, url).map_err(|m| bad(&format!("The webhook URL is refused: {m}")))?;
    Ok(Some(crate::secrets::seal(cfg, &aad(tenant, project, kind), url.as_bytes())))
}

/// Queues a chat message for a status change or a new issue. Runs inside the change's transaction, so a
/// message exists only if the change was saved. Nothing is queued unless the project has chat on.
pub(crate) async fn queue_change(
    db: &mut PgConnection,
    tenant: Uuid,
    issue: Uuid,
    from: Option<&str>,
    to: &str,
    actor: Uuid,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO jobs(tenant_id,kind,payload) \
         SELECT c.tenant_id, 'chat.notify', jsonb_build_object('tenant', c.tenant_id, 'project', c.project_id, 'issue', i.id, \
           'from', $3::text, 'to', $4::text, 'actor', $5::text) \
         FROM project_chat_channels c JOIN issues i ON i.tenant_id=c.tenant_id AND i.project_id=c.project_id \
         WHERE c.tenant_id=$1 AND i.id=$2 AND (c.slack_enabled OR c.teams_enabled) \
           AND (CASE WHEN $3::text IS NULL THEN c.notify_new_issues ELSE c.notify_status_changes END)",
    )
    .bind(tenant)
    .bind(issue)
    .bind(from)
    .bind(to)
    .bind(actor.to_string())
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(())
}

/// The name of a status of the project, or its key when the name is gone.
async fn status_name(db: &sqlx::PgPool, tenant: Uuid, project: Uuid, key: &str) -> String {
    sqlx::query_scalar::<_, String>("SELECT name FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 AND key=$3")
        .bind(tenant)
        .bind(project)
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| key.to_string())
}

/// The job worker's handler: builds one message and posts it to each enabled channel.
pub(crate) async fn deliver(db: &sqlx::PgPool, cfg: &crate::config::Config, payload: &serde_json::Value) -> Result<(), String> {
    let tenant = uuid_field(payload, "tenant")?;
    let project = uuid_field(payload, "project")?;
    let issue = uuid_field(payload, "issue")?;
    let actor = uuid_field(payload, "actor")?;
    let to = payload.get("to").and_then(|v| v.as_str()).ok_or("missing to")?.to_string();
    let from = payload.get("from").and_then(|v| v.as_str()).map(str::to_string);

    let channel: Option<ChannelRow> = sqlx::query_as(
        "SELECT slack_url_sealed, teams_url_sealed, slack_enabled, teams_enabled, notify_status_changes, notify_new_issues \
         FROM project_chat_channels WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(tenant)
    .bind(project)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;
    let Some(channel) = channel else { return Ok(()) };

    let sent_last_hour: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chat_deliveries WHERE tenant_id=$1 AND project_id=$2 AND sent_at > now() - interval '1 hour'",
    )
    .bind(tenant)
    .bind(project)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;
    if sent_last_hour >= HOURLY_QUOTA {
        tracing::warn!(%project, "chat quota reached; message dropped");
        return Ok(());
    }

    let (key, number, title): (String, i64, String) = sqlx::query_as(
        "SELECT p.key, i.number, i.title FROM issues i JOIN projects p ON p.tenant_id=i.tenant_id AND p.id=i.project_id \
         WHERE i.tenant_id=$1 AND i.id=$2",
    )
    .bind(tenant)
    .bind(issue)
    .fetch_one(db)
    .await
    .map_err(|e| e.to_string())?;
    let to_name = status_name(db, tenant, project, &to).await;
    let actor_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
        .bind(actor)
        .fetch_one(db)
        .await
        .map_err(|e| e.to_string())?;
    let change = match &from {
        Some(f) => format!("{} → {}", status_name(db, tenant, project, f).await, to_name),
        None => format!("created in {to_name}"),
    };
    let text = format!("{key}-{number} {title}: {change} (by {actor_name})");

    let http = crate::safe_http::client(cfg);
    let targets = [
        (channel.slack_enabled, channel.slack_url_sealed.as_deref(), "slack"),
        (channel.teams_enabled, channel.teams_url_sealed.as_deref(), "teams"),
    ];
    for (enabled, sealed, kind) in targets {
        if !enabled {
            continue;
        }
        let Some(sealed) = sealed else { continue };
        let Some(plain) = crate::secrets::open(cfg, &aad(tenant, project, kind), sealed) else {
            return Err(format!("the {kind} webhook could not be opened"));
        };
        let url = String::from_utf8(plain).map_err(|_| "the webhook is not text".to_string())?;
        crate::safe_http::check_url(cfg, &url)?;
        let response = http
            .post(&url)
            .json(&serde_json::json!({ "text": text }))
            .send()
            .await
            .map_err(|e| format!("{kind} delivery failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("{kind} answered {}", response.status()));
        }
        sqlx::query("INSERT INTO chat_deliveries(tenant_id,project_id) VALUES($1,$2)")
            .bind(tenant)
            .bind(project)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn uuid_field(payload: &serde_json::Value, key: &str) -> Result<Uuid, String> {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| format!("missing {key}"))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new().route(
        "/api/projects/{id}/chat-channels",
        get(get_channels).put(put_channels),
    )
}
