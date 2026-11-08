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

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new()
        .route("/api/projects/{id}/import/trello", post(import_trello))
        .route("/api/projects/{id}/import/github", post(import_github))
        .route("/api/projects/{id}/import/linear", post(import_linear))
        .route("/api/projects/{id}/import/asana", post(import_asana))
}
