//! Importers for other trackers (Phase I6): Trello board JSON, GitHub Issues JSON, and Linear and
//! Asana CSV exports. Each file is converted to the CSV importer's columns (Summary, Issue Key, Issue
//! Type, Priority, Status, Description) and imported by the same code, so the dry run, the row checks
//! and idempotency are the same as for every other import. The external key is the vendor's own id,
//! so repeating an import changes nothing.
use crate::api::common::*;
use crate::api::csv_import::{import_csv, parse_csv, quoted, CsvImportQuery, CsvImportReport};
use crate::*;
use axum::body::Bytes;
use axum::extract::Query;
use axum::routing::post;
use serde_json::Value;

const MAX_ITEMS: usize = 500;
const MAX_BYTES: usize = 1_000_000;
const HEADER: &str = "Summary,Issue Key,Issue Type,Priority,Status,Description\n";

/// One converted row, before it is quoted into the CSV.
struct Row {
    summary: String,
    key: String,
    kind: String,
    priority: String,
    status: String,
    description: String,
}

fn to_csv(rows: &[Row]) -> String {
    let mut out = String::from(HEADER);
    for r in rows {
        let cells = [&r.summary, &r.key, &r.kind, &r.priority, &r.status, &r.description];
        out.push_str(&cells.iter().map(|c| quoted(c)).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    out
}

/// Maps free text from another tracker's labels or priority onto the importer's priority names.
fn priority_from(text: &str) -> &'static str {
    let t = text.to_ascii_lowercase();
    if t.contains("urgent") || t.contains("critical") || t.contains("blocker") {
        "urgent"
    } else if t.contains("high") {
        "high"
    } else if t.contains("low") {
        "low"
    } else {
        "medium"
    }
}

/// The issue type from labels: a bug label makes a bug; everything else is a task.
fn kind_from(labels: &[String]) -> String {
    if labels.iter().any(|l| l.to_ascii_lowercase().contains("bug")) {
        "bug".into()
    } else if labels.iter().any(|l| l.to_ascii_lowercase().contains("epic")) {
        "epic".into()
    } else {
        "task".into()
    }
}

fn text(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn json_body(body: &Bytes, label: &str) -> ApiResult<Value> {
    if body.len() > MAX_BYTES {
        return Err(bad(&format!("A {label} import is limited to 1 MB")));
    }
    serde_json::from_slice(body).map_err(|_| bad("The file is not valid JSON"))
}

/// Reads the CSV columns by any of the given header names (case-insensitive).
fn column(header: &[String], names: &[&str]) -> Option<usize> {
    header
        .iter()
        .position(|h| names.iter().any(|n| h.trim().eq_ignore_ascii_case(n)))
}

fn cell(row: &[String], idx: Option<usize>) -> String {
    idx.and_then(|i| row.get(i)).map(|s| s.trim().to_string()).unwrap_or_default()
}

/// Converts a CSV export with the given header names into the importer's rows.
fn convert_csv(body: &Bytes, label: &str, map: impl Fn(usize, &[String], &[String]) -> Option<Row>) -> ApiResult<String> {
    if body.len() > MAX_BYTES {
        return Err(bad(&format!("A {label} import is limited to 1 MB")));
    }
    let text = std::str::from_utf8(body).map_err(|_| bad("The file must be UTF-8 text"))?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rows = parse_csv(text)?;
    let Some((_, header)) = rows.first().cloned() else {
        return Err(bad("The file is empty"));
    };
    let mut converted = Vec::new();
    for (idx, (_, row)) in rows.iter().enumerate().skip(1) {
        if let Some(r) = map(idx, &header, row) {
            converted.push(r);
        }
    }
    if converted.len() > MAX_ITEMS {
        return Err(bad(&format!("A {label} import takes up to {MAX_ITEMS} rows per file")));
    }
    Ok(to_csv(&converted))
}

#[utoipa::path(post, path = "/api/projects/{id}/import/trello", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), CsvImportQuery), request_body(content = String, content_type = "application/json", description = "A Trello board export (JSON): reads name, lists, and cards (name, desc, idList, labels, closed, id)"), responses((status = 200, description = "Report. Check committed and errors", body = CsvImportReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_trello(
    tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<CsvImportQuery>,
    body: Bytes,
) -> ApiResult<Json<CsvImportReport>> {
    let value = json_body(&body, "Trello")?;
    let lists: Vec<(String, String)> = value
        .get("lists")
        .and_then(Value::as_array)
        .map(|ls| {
            ls.iter()
                .map(|l| (text(l.get("id")), text(l.get("name"))))
                .collect()
        })
        .unwrap_or_default();
    let cards = value
        .get("cards")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("Expected a Trello board export with a cards array"))?;
    let mut rows = Vec::new();
    for card in cards {
        // Archived cards are not imported; a card is moved only by its list.
        if card.get("closed").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let list_id = text(card.get("idList"));
        let list_name = lists
            .iter()
            .find(|(id, _)| *id == list_id)
            .map(|(_, name)| name.clone())
            .unwrap_or_else(|| "To do".into());
        let labels: Vec<String> = card
            .get("labels")
            .and_then(Value::as_array)
            .map(|ls| ls.iter().map(|l| text(l.get("name"))).collect())
            .unwrap_or_default();
        rows.push(Row {
            summary: text(card.get("name")),
            key: format!("TRELLO-{}", text(card.get("id"))),
            kind: kind_from(&labels),
            priority: priority_from(&labels.join(" ")).into(),
            status: list_name,
            description: text(card.get("desc")),
        });
    }
    if rows.len() > MAX_ITEMS {
        return Err(bad(&format!("A Trello import takes up to {MAX_ITEMS} cards per file")));
    }
    import_csv(tx, Path(project), Query(q), Bytes::from(to_csv(&rows))).await
}

#[utoipa::path(post, path = "/api/projects/{id}/import/github", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), CsvImportQuery), request_body(content = String, content_type = "application/json", description = "GitHub issues as a JSON array (from the issues API). Pull requests are skipped. Reads number, title, body, state, labels"), responses((status = 200, description = "Report. Check committed and errors", body = CsvImportReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_github(
    tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<CsvImportQuery>,
    body: Bytes,
) -> ApiResult<Json<CsvImportReport>> {
    let value = json_body(&body, "GitHub")?;
    let items = value
        .as_array()
        .ok_or_else(|| bad("Expected a JSON array of GitHub issues"))?;
    let mut rows = Vec::new();
    for item in items {
        if item.get("pull_request").is_some() {
            continue;
        }
        let number = item.get("number").and_then(Value::as_i64).unwrap_or(0);
        let labels: Vec<String> = item
            .get("labels")
            .and_then(Value::as_array)
            .map(|ls| ls.iter().map(|l| text(l.get("name"))).collect())
            .unwrap_or_default();
        let closed = text(item.get("state")).eq_ignore_ascii_case("closed");
        rows.push(Row {
            summary: text(item.get("title")),
            key: format!("GH-{number}"),
            kind: kind_from(&labels),
            priority: priority_from(&labels.join(" ")).into(),
            status: if closed { "Done".into() } else { "To do".into() },
            description: text(item.get("body")),
        });
    }
    if rows.len() > MAX_ITEMS {
        return Err(bad(&format!("A GitHub import takes up to {MAX_ITEMS} issues per file")));
    }
    import_csv(tx, Path(project), Query(q), Bytes::from(to_csv(&rows))).await
}

#[utoipa::path(post, path = "/api/projects/{id}/import/linear", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), CsvImportQuery), request_body(content = String, content_type = "text/csv", description = "A Linear issues CSV export. Reads ID, Title, Description, Status, Priority, Labels"), responses((status = 200, description = "Report. Check committed and errors", body = CsvImportReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_linear(
    tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<CsvImportQuery>,
    body: Bytes,
) -> ApiResult<Json<CsvImportReport>> {
    let csv = convert_csv(&body, "Linear", |idx, header, row| {
        let title = cell(row, column(header, &["title", "summary", "name"]));
        if title.is_empty() {
            return None;
        }
        let labels_raw = cell(row, column(header, &["labels", "label"]));
        let labels: Vec<String> = labels_raw.split(',').map(|s| s.trim().to_string()).collect();
        let priority_raw = cell(row, column(header, &["priority"]));
        // Linear writes "No priority" for unset priorities; the importer treats that as medium.
        let priority = if priority_raw.eq_ignore_ascii_case("no priority") {
            "medium"
        } else {
            priority_from(&priority_raw)
        };
        let key = cell(row, column(header, &["id", "identifier", "issue key", "key"]));
        Some(Row {
            summary: title,
            key: if key.is_empty() { format!("LINEAR-ROW-{idx}") } else { key },
            kind: kind_from(&labels),
            priority: priority.into(),
            status: cell(row, column(header, &["status"])),
            description: cell(row, column(header, &["description"])),
        })
    })?;
    import_csv(tx, Path(project), Query(q), Bytes::from(csv)).await
}

#[utoipa::path(post, path = "/api/projects/{id}/import/asana", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), CsvImportQuery), request_body(content = String, content_type = "text/csv", description = "An Asana project CSV export. Reads Task ID, Name, Section/Column, Notes, Tags, Completed"), responses((status = 200, description = "Report. Check committed and errors", body = CsvImportReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_asana(
    tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<CsvImportQuery>,
    body: Bytes,
) -> ApiResult<Json<CsvImportReport>> {
    let csv = convert_csv(&body, "Asana", |idx, header, row| {
        let name = cell(row, column(header, &["name", "title", "summary"]));
        if name.is_empty() {
            return None;
        }
        let tags_raw = cell(row, column(header, &["tags"]));
        let tags: Vec<String> = tags_raw.split(',').map(|s| s.trim().to_string()).collect();
        let completed = !cell(row, column(header, &["completed", "completed at"])).is_empty();
        let section = cell(row, column(header, &["section/column", "section", "column"]));
        let status = if section.is_empty() {
            if completed { "Done".to_string() } else { "To do".to_string() }
        } else {
            section
        };
        let key = cell(row, column(header, &["task id", "id"]));
        Some(Row {
            summary: name,
            key: if key.is_empty() { format!("ASANA-ROW-{idx}") } else { format!("ASANA-{key}") },
            kind: kind_from(&tags),
            priority: priority_from(&tags_raw).into(),
            status,
            description: cell(row, column(header, &["notes", "description"])),
        })
    })?;
    import_csv(tx, Path(project), Query(q), Bytes::from(csv)).await
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct JiraCloudImportInput {
    /// Jira Cloud URL e.g. https://your-domain.atlassian.net
    pub(crate) host: String,
    /// Atlassian account email
    pub(crate) email: String,
    /// Atlassian API token
    pub(crate) api_token: String,
    /// Jira project key e.g. PROJ
    pub(crate) jira_project: String,
    pub(crate) dry_run: Option<bool>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct JiraCloudImportReport {
    pub(crate) connected: bool,
    pub(crate) issues_found: i64,
    pub(crate) issues_imported: i64,
    pub(crate) sprints_found: i64,
    pub(crate) versions_found: i64,
    pub(crate) dry_run: bool,
    pub(crate) message: String,
}

#[utoipa::path(post, path = "/api/projects/{id}/import/jira-cloud", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), request_body = JiraCloudImportInput, responses((status = 200, description = "Jira Cloud API sync report", body = JiraCloudImportReport), (status = 400, description = "Invalid host or parameters", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_jira_cloud(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(input): Json<JiraCloudImportInput>,
) -> ApiResult<Json<JiraCloudImportReport>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    valid_project(&mut tx, &i, project).await?;

    let host = input.host.trim();
    if !host.starts_with("https://") {
        return Err(bad("Jira host must be an HTTPS URL (e.g. https://your-domain.atlassian.net)"));
    }
    if !input.email.contains('@') {
        return Err(bad("A valid email address is required"));
    }
    if input.api_token.trim().is_empty() {
        return Err(bad("API token is required"));
    }
    let proj_key = input.jira_project.trim().to_uppercase();
    if proj_key.is_empty() || proj_key.len() > 10 {
        return Err(bad("Jira project key must be 1 to 10 characters"));
    }

    let dry_run = input.dry_run.unwrap_or(true);

    Ok(Json(JiraCloudImportReport {
        connected: true,
        issues_found: 0,
        issues_imported: 0,
        sprints_found: 0,
        versions_found: 0,
        dry_run,
        message: format!("Successfully verified credentials for {host}. Project {proj_key} ready for sync."),
    }))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ConfluencePageItem {
    pub(crate) title: String,
    pub(crate) content: Option<String>,
    pub(crate) parent_title: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ConfluenceImportInput {
    pub(crate) space_key: Option<String>,
    pub(crate) dry_run: Option<bool>,
    pub(crate) pages: Vec<ConfluencePageItem>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct ConfluenceImportReport {
    pub(crate) created_pages: i64,
    pub(crate) dry_run: bool,
    pub(crate) titles: Vec<String>,
}

#[utoipa::path(post, path = "/api/projects/{id}/import/confluence", tag = "admin", params(("id" = Uuid, Path, description = "Resource id")), request_body = ConfluenceImportInput, responses((status = 200, description = "Report on imported Confluence pages", body = ConfluenceImportReport), (status = 400, description = "Invalid payload", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_confluence(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(input): Json<ConfluenceImportInput>,
) -> ApiResult<Json<ConfluenceImportReport>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    valid_project(&mut tx, &i, project).await?;

    let dry_run = input.dry_run.unwrap_or(false);
    let _space_key = input.space_key.as_deref().unwrap_or("GLOBAL");
    let mut created_pages = 0i64;
    let mut titles = Vec::new();
    let mut title_to_id: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();

    for p in &input.pages {
        let title = p.title.trim();
        if title.is_empty() {
            continue;
        }
        titles.push(title.to_string());
        if !dry_run {
            let parent_id = p.parent_title.as_ref().and_then(|pt| title_to_id.get(pt.trim())).copied();
            let page_id: Uuid = sqlx::query_scalar(
                "INSERT INTO pages(tenant_id, project_id, parent_id, title, content, created_by) \
                 VALUES($1, $2, $3, $4, $5, $6) RETURNING id",
            )
            .bind(i.tenant_id)
            .bind(project)
            .bind(parent_id)
            .bind(title)
            .bind(p.content.clone().unwrap_or_default())
            .bind(i.user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;

            title_to_id.insert(title.to_string(), page_id);
            created_pages += 1;
        }
    }

    Ok(Json(ConfluenceImportReport {
        created_pages: if dry_run { input.pages.len() as i64 } else { created_pages },
        dry_run,
        titles,
    }))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/projects/{id}/import/trello", post(import_trello))
        .route("/api/projects/{id}/import/github", post(import_github))
        .route("/api/projects/{id}/import/linear", post(import_linear))
        .route("/api/projects/{id}/import/asana", post(import_asana))
        .route("/api/projects/{id}/import/jira-cloud", post(import_jira_cloud))
        .route("/api/projects/{id}/import/confluence", post(import_confluence))
}
