//! CSV issue import (Jira-style exports). It is a dry run unless `dry_run=false` is sent. The report
//! lists every row's problem by line number. A real import needs no row problems; it then creates
//! all rows in one transaction. Rows are idempotent by issue key, so repeating an import skips rows
//! that were already imported.
use crate::api::common::*;
use crate::api::fields::validate_values;
use crate::api::statuses::{default_status, slug};
use crate::*;
use axum::body::Bytes;
use axum::extract::Query;
use serde_json::{json, Value};

const MAX_ROWS: usize = 500;
const MAX_BYTES: usize = 1_000_000;
const MAX_STATUSES_PER_PROJECT: i64 = 20;

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct CsvImportQuery {
    /// Default true: report only. Send false to create the issues.
    pub(crate) dry_run: Option<bool>,
    /// Create statuses that the file names but the project lacks. Default false.
    pub(crate) create_statuses: Option<bool>,
}

/// Parses RFC 4180 style CSV: quoted fields, doubled quotes, commas and line breaks inside quotes.
/// Returns each non-empty row with the line it starts on.
pub(crate) fn parse_csv(text: &str) -> ApiResult<Vec<(usize, Vec<String>)>> {
    let mut rows = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut line = 1usize;
    let mut row_line = 1usize;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                if c == '\n' {
                    line += 1;
                }
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => in_quotes = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push((row_line, std::mem::take(&mut row)));
                line += 1;
                row_line = line;
            }
            _ => field.push(c),
        }
    }
    if in_quotes {
        return Err(bad(
            "A quoted field is not closed. Check the file for an unmatched quote",
        ));
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push((row_line, row));
    }
    Ok(rows
        .into_iter()
        .filter(|(_, r)| !(r.len() == 1 && r[0].trim().is_empty()))
        .collect())
}

#[derive(Default)]
struct Columns {
    title: Option<usize>,
    key: Option<usize>,
    kind: Option<usize>,
    priority: Option<usize>,
    status: Option<usize>,
    description: Option<usize>,
}

fn columns(header: &[String]) -> Columns {
    let mut c = Columns::default();
    for (idx, name) in header.iter().enumerate() {
        match name.trim().to_ascii_lowercase().as_str() {
            "summary" | "title" => c.title = c.title.or(Some(idx)),
            "issue key" | "key" | "external key" => c.key = c.key.or(Some(idx)),
            "issue type" | "type" | "kind" => c.kind = c.kind.or(Some(idx)),
            "priority" => c.priority = c.priority.or(Some(idx)),
            "status" => c.status = c.status.or(Some(idx)),
            "description" => c.description = c.description.or(Some(idx)),
            _ => {}
        }
    }
    c
}

/// The issue type a file names, as a type key ("Sub-task" becomes "sub_task"). The project decides
/// later whether it defines that key; when it does not, the project's default type is used.
fn map_kind(raw: &str) -> String {
    let key: String = raw
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c == ' ' || c == '-' { '_' } else { c })
        .collect();
    if key.is_empty() {
        "task".into()
    } else {
        key
    }
}

fn map_priority(raw: &str) -> Result<&'static str, ()> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "medium" | "normal" => Ok("medium"),
        "urgent" | "highest" | "critical" | "blocker" => Ok("urgent"),
        "high" | "major" => Ok("high"),
        "low" | "minor" | "lowest" | "trivial" => Ok("low"),
        _ => Err(()),
    }
}

/// Category for a status the file introduces, from its name.
fn guess_category(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    if ["done", "closed", "resolved", "complete", "finished"]
        .iter()
        .any(|w| n.contains(w))
    {
        "done"
    } else if ["progress", "review", "doing", "testing", "qa", "active"]
        .iter()
        .any(|w| n.contains(w))
    {
        "in_progress"
    } else {
        "todo"
    }
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CsvRowReport {
    /// The file line the row starts on.
    pub(crate) line: usize,
    /// `create`, `skip` (already imported) or `error`.
    pub(crate) action: String,
    pub(crate) message: Option<String>,
}
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct CsvImportReport {
    pub(crate) dry_run: bool,
    /// False when nothing was written: a dry run, or a file with row problems.
    pub(crate) committed: bool,
    pub(crate) to_create: usize,
    pub(crate) to_skip: usize,
    pub(crate) errors: usize,
    /// Statuses the file names that the project lacks, created when `create_statuses` is set.
    pub(crate) new_statuses: Vec<String>,
    pub(crate) rows: Vec<CsvRowReport>,
}

struct Planned {
    title: String,
    description: String,
    kind: String,
    priority: &'static str,
    status: String,
    external_ref: String,
}

#[utoipa::path(post, path = "/api/projects/{id}/import/csv", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), CsvImportQuery), request_body(content = String, content_type = "text/csv", description = "CSV with a header row. Columns: Summary (required), Issue Key (required), Issue Type, Priority, Status, Description"), responses((status = 200, description = "Report. Check committed and errors", body = CsvImportReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_csv(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<CsvImportQuery>,
    body: Bytes,
) -> ApiResult<Json<CsvImportReport>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    ensure_access(&mut tx, project).await?;
    if body.len() > MAX_BYTES {
        return Err(bad("A CSV import is limited to 1 MB"));
    }
    let text = std::str::from_utf8(&body).map_err(|_| bad("The file must be UTF-8 text"))?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rows = parse_csv(text)?;
    let dry_run = q.dry_run.unwrap_or(true);
    let create_statuses = q.create_statuses.unwrap_or(false);
    let (_, header) = rows
        .first()
        .cloned()
        .ok_or_else(|| bad("The file is empty"))?;
    let cols = columns(&header);
    let (title_col, key_col) = match (cols.title, cols.key) {
        (Some(t), Some(k)) => (t, k),
        _ => {
            return Err(bad(
                "The header needs at least Summary and Issue Key columns",
            ))
        }
    };
    let data = &rows[1..];
    if data.len() > MAX_ROWS {
        return Err(bad("A CSV import takes up to 500 rows per file"));
    }

    // The project's statuses, for mapping names to keys.
    let existing: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, name FROM project_statuses WHERE tenant_id=$1 AND project_id=$2 ORDER BY position",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    let default = default_status(&mut tx, i.tenant_id, project).await?;
    let mut statuses: Vec<(String, String, String)> = existing
        .iter()
        .map(|(k, n)| (k.clone(), n.clone(), String::new()))
        .collect();
    let mut new_statuses: Vec<(String, String, &'static str)> = Vec::new();

    // Keys already imported in earlier runs.
    let keys: Vec<String> = data
        .iter()
        .filter_map(|(_, r)| r.get(key_col).map(|k| k.trim().to_string()))
        .filter(|k| !k.is_empty())
        .collect();
    let already: Vec<String> = sqlx::query_scalar(
        "SELECT external_ref FROM imported_issue_refs WHERE tenant_id=$1 AND project_id=$2 AND external_ref = ANY($3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&keys)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;

    let mut report_rows = Vec::new();
    let mut planned: Vec<Planned> = Vec::new();
    let mut seen_keys: Vec<String> = Vec::new();
    let mut to_skip = 0usize;
    let mut errors = 0usize;
    for (line, row) in data {
        let cell = |idx: Option<usize>| {
            idx.and_then(|i| row.get(i))
                .map(|s| s.trim().to_string())
                .unwrap_or_default()
        };
        let title = cell(Some(title_col));
        let external = cell(Some(key_col));
        let mut problem: Option<String> = None;
        if title.is_empty() || title.chars().count() > 200 {
            problem = Some("The summary must be 1 to 200 characters".into());
        } else if external.is_empty() || external.chars().count() > 200 {
            problem =
                Some("The issue key is required so that repeat imports stay idempotent".into());
        } else if seen_keys.contains(&external) {
            problem = Some(format!("Issue key {external} appears twice in this file"));
        }
        let priority = match map_priority(&cell(cols.priority)) {
            Ok(p) => p,
            Err(()) => {
                problem.get_or_insert_with(|| "Unknown priority".into());
                "medium"
            }
        };
        let status_name = cell(cols.status);
        let status = if status_name.is_empty() {
            default.clone()
        } else {
            let needle = status_name.to_ascii_lowercase();
            let found = statuses
                .iter()
                .find(|(k, n, _)| {
                    n.to_ascii_lowercase() == needle || *k == needle.replace(' ', "_")
                })
                .map(|(k, _, _)| k.clone());
            match found {
                Some(k) => k,
                None if create_statuses => match slug(&status_name) {
                    Ok(key) => {
                        if !new_statuses.iter().any(|(k, _, _)| *k == key) {
                            let category = guess_category(&status_name);
                            new_statuses.push((key.clone(), status_name.clone(), category));
                            statuses.push((key.clone(), status_name.clone(), category.into()));
                        }
                        key
                    }
                    Err(_) => {
                        problem.get_or_insert_with(|| {
                            format!("Status “{status_name}” cannot become a status key")
                        });
                        default.clone()
                    }
                },
                None => {
                    problem.get_or_insert_with(|| {
                        format!("Status “{status_name}” is not in this project. Add it, or allow new statuses")
                    });
                    default.clone()
                }
            }
        };
        let description = cell(cols.description);
        if description.chars().count() > 10_000 {
            problem
                .get_or_insert_with(|| "The description is longer than 10,000 characters".into());
        }
        seen_keys.push(external.clone());
        if let Some(message) = problem {
            errors += 1;
            report_rows.push(CsvRowReport {
                line: *line,
                action: "error".into(),
                message: Some(message),
            });
            continue;
        }
        if already.contains(&external) {
            to_skip += 1;
            report_rows.push(CsvRowReport {
                line: *line,
                action: "skip".into(),
                message: Some(format!("{external} was imported before")),
            });
            continue;
        }
        let kind = map_kind(&cell(cols.kind));
        report_rows.push(CsvRowReport {
            line: *line,
            action: "create".into(),
            message: None,
        });
        planned.push(Planned {
            title,
            description,
            kind,
            priority,
            status,
            external_ref: external,
        });
    }

    // Statuses: the project must stay within its limit.
    if !new_statuses.is_empty()
        && existing.len() + new_statuses.len() > MAX_STATUSES_PER_PROJECT as usize
    {
        errors += 1;
        report_rows.push(CsvRowReport {
            line: 0,
            action: "error".into(),
            message: Some("The new statuses would exceed the 20-status limit".into()),
        });
    }
    // Required custom fields cannot be filled by a CSV yet, so the import would break them.
    let required: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND required",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if required > 0 && !planned.is_empty() {
        errors += 1;
        report_rows.push(CsvRowReport {
            line: 0,
            action: "error".into(),
            message: Some(
                "This project has required custom fields, which a CSV import cannot fill yet"
                    .into(),
            ),
        });
    }

    let to_create = planned.len();
    let new_status_names: Vec<String> = new_statuses.iter().map(|(_, n, _)| n.clone()).collect();
    let mut report = CsvImportReport {
        dry_run,
        committed: false,
        to_create,
        to_skip,
        errors,
        new_statuses: new_status_names,
        rows: report_rows,
    };
    if dry_run || errors > 0 {
        // Nothing is written. The transaction ends with the request and is rolled back.
        return Ok(Json(report));
    }

    // Commit: statuses first, then issues and their import references, all in this transaction.
    let mut position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM project_statuses WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    for (key, name, category) in &new_statuses {
        sqlx::query("INSERT INTO project_statuses(tenant_id,project_id,key,name,category,position) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(i.tenant_id)
            .bind(project)
            .bind(key)
            .bind(name)
            .bind(category)
            .bind(position)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        position += 1;
    }
    // Same rule as the other writes: no required field may be left empty.
    validate_values(&mut tx, i.tenant_id, project, &json!({})).await?;
    let mut next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(number),0)+1 FROM issues WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    for p in &planned {
        let kind = crate::api::issue_types::type_or_default(&mut tx, i.tenant_id, project, &p.kind)
            .await?;
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO issues(tenant_id,project_id,number,title,description,kind,priority,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(next)
        .bind(&p.title)
        .bind(&p.description)
        .bind(kind)
        .bind(p.priority)
        .bind(&p.status)
        .bind(i.user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        crate::api::history::record_status(&mut tx, i.tenant_id, id, None, &p.status, i.user_id)
            .await?;
        sqlx::query("INSERT INTO imported_issue_refs(tenant_id,project_id,external_ref,issue_id) VALUES($1,$2,$3,$4)")
            .bind(i.tenant_id)
            .bind(project)
            .bind(&p.external_ref)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        next += 1;
    }
    log_event(&mut tx, &i, "imported_csv", "project", project).await?;
    report.committed = true;
    Ok(Json(report))
}

/// Text of a Jira field: a plain string, or Atlassian Document Format (its text, one block per line).
fn jira_text(v: Option<&Value>) -> String {
    fn collect(v: &Value, out: &mut String) {
        match v {
            Value::Object(o) => {
                if let Some(Value::String(t)) = o.get("text") {
                    out.push_str(t);
                }
                if let Some(Value::Array(children)) = o.get("content") {
                    for child in children {
                        collect(child, out);
                    }
                }
                let block = matches!(
                    o.get("type").and_then(Value::as_str),
                    Some("paragraph" | "heading" | "listItem" | "codeBlock" | "blockquote")
                );
                if block && !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            Value::Array(a) => {
                for n in a {
                    collect(n, out);
                }
            }
            Value::String(t) => out.push_str(t),
            _ => {}
        }
    }
    let mut out = String::new();
    if let Some(v) = v {
        collect(v, &mut out);
    }
    out.trim().to_string()
}

/// The `name` of a Jira object such as an issue type, priority or status.
fn jira_name(v: Option<&Value>) -> String {
    v.and_then(|x| x.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// One CSV cell, always quoted so commas, quotes and line breaks in the text stay in the cell.
fn quoted(cell: &str) -> String {
    format!("\"{}\"", cell.replace('"', "\"\""))
}

/// Jira issue export as JSON: `{"issues": [...]}` or a bare array of issues. It reads the key, the
/// summary, the description, and the issue type, priority and status names. Changelog, sprints and
/// versions are not read. The file is converted to the CSV importer's columns and then imported by
/// the same code, so the dry run, idempotency and row checks are the same. Report line numbers count
/// the converted rows, with the header on line 1.
#[utoipa::path(post, path = "/api/projects/{id}/import/jira", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), CsvImportQuery), request_body(content = String, content_type = "application/json", description = "Jira issues as JSON: {\"issues\": [...]} or an array. Reads key, fields.summary, fields.description, fields.issuetype.name, fields.priority.name and fields.status.name"), responses((status = 200, description = "Report. Check committed and errors", body = CsvImportReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_jira(
    tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<CsvImportQuery>,
    body: Bytes,
) -> ApiResult<Json<CsvImportReport>> {
    if body.len() > MAX_BYTES {
        return Err(bad("A Jira import is limited to 1 MB"));
    }
    let value: Value =
        serde_json::from_slice(&body).map_err(|_| bad("The file is not valid JSON"))?;
    let issues = match &value {
        Value::Array(a) => a,
        Value::Object(o) => match o.get("issues") {
            Some(Value::Array(a)) => a,
            _ => return Err(bad("Expected {\"issues\": [...]} or an array of issues")),
        },
        _ => return Err(bad("Expected {\"issues\": [...]} or an array of issues")),
    };
    if issues.len() > MAX_ROWS {
        return Err(bad("A Jira import takes up to 500 issues per file"));
    }
    let mut csv = String::from("Summary,Issue Key,Issue Type,Priority,Status,Description\n");
    for issue in issues {
        let fields = issue.get("fields").unwrap_or(&Value::Null);
        let cells = [
            jira_text(fields.get("summary")),
            jira_text(issue.get("key")),
            jira_name(fields.get("issuetype")),
            jira_name(fields.get("priority")),
            jira_name(fields.get("status")),
            jira_text(fields.get("description")),
        ];
        csv.push_str(&cells.iter().map(|c| quoted(c)).collect::<Vec<_>>().join(","));
        csv.push('\n');
    }
    import_csv(tx, Path(project), Query(q), Bytes::from(csv)).await
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route(
            "/api/projects/{id}/import/csv",
            axum::routing::post(import_csv),
        )
        .route(
            "/api/projects/{id}/import/jira",
            axum::routing::post(import_jira),
        )
}
