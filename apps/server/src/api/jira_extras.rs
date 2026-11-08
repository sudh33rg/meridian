//! Jira import, the parts the CSV path does not carry (Phase I6): sprints, fix versions and the status
//! history from the changelog. Run it after the issues themselves are imported: it finds each issue by
//! its Jira key (the same external reference the import stores), so repeating it changes nothing.
//!
//! A dry run is the default and writes nothing. Sprints are created planned or completed; a Jira sprint
//! that is active becomes planned, because a project has one active sprint and that is the team's choice.
//! Fix versions become releases, and the issues are added to them. Status changes are added to the
//! issue's history when both status names match a status of the project; a name that matches none is
//! counted and skipped.
use crate::api::common::*;
use crate::*;
use axum::body::Bytes;
use axum::extract::Query;
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::HashMap;

const MAX_ISSUES: usize = 500;
const MAX_BYTES: usize = 1_000_000;

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct JiraExtrasQuery {
    /// Default true: report only. Send false to write.
    pub(crate) dry_run: Option<bool>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct JiraExtrasReport {
    pub(crate) dry_run: bool,
    pub(crate) issues_found: usize,
    /// Issues in the file that are not imported yet (no matching key). They are skipped.
    pub(crate) issues_not_found: usize,
    pub(crate) sprints_to_create: usize,
    pub(crate) issues_in_sprints: usize,
    pub(crate) releases_to_create: usize,
    pub(crate) issues_in_releases: usize,
    pub(crate) status_changes_to_add: usize,
    /// Status changes whose status name matches no status of the project. They are skipped.
    pub(crate) status_changes_skipped: usize,
}

/// A sprint named on an issue. `closed` maps to completed; anything else maps to planned.
struct SprintRef {
    name: String,
    closed: bool,
}

fn sprints_of(fields: &Value) -> Vec<SprintRef> {
    let Some(map) = fields.as_object() else { return Vec::new() };
    // Jira's sprint field is a custom field whose values are objects with a name and a state or board.
    for value in map.values() {
        let Some(items) = value.as_array() else { continue };
        let parsed: Vec<SprintRef> = items
            .iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?.to_string();
                if item.get("state").is_none() && item.get("boardId").is_none() {
                    return None;
                }
                let closed = item.get("state").and_then(Value::as_str) == Some("closed");
                Some(SprintRef { name, closed })
            })
            .collect();
        if !parsed.is_empty() {
            return parsed;
        }
    }
    Vec::new()
}

fn parse_jira_time(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f%z")
        .or_else(|_| DateTime::parse_from_rfc3339(raw))
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

#[utoipa::path(post, path = "/api/projects/{id}/import/jira/extras", tag = "admin", params(("id" = Uuid, Path, description = "Resource id"), JiraExtrasQuery), request_body(content = String, content_type = "application/json", description = "The same Jira issues JSON as the issue import"), responses((status = 200, description = "Report. Dry run unless dry_run=false", body = JiraExtrasReport), (status = 400, description = "The file cannot be read", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Workspace admins only", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn import_extras(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Query(q): Query<JiraExtrasQuery>,
    body: Bytes,
) -> ApiResult<Json<JiraExtrasReport>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    ensure_access(&mut tx, project).await?;
    if body.len() > MAX_BYTES {
        return Err(bad("A Jira import is limited to 1 MB"));
    }
    let value: Value = serde_json::from_slice(&body).map_err(|_| bad("The file is not valid JSON"))?;
    let issues: Vec<Value> = match &value {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("issues") {
            Some(Value::Array(a)) => a.clone(),
            _ => return Err(bad("Expected {\"issues\": [...]} or an array of issues")),
        },
        _ => return Err(bad("Expected {\"issues\": [...]} or an array of issues")),
    };
    if issues.len() > MAX_ISSUES {
        return Err(bad("A Jira import takes up to 500 issues per file"));
    }
    let dry_run = q.dry_run.unwrap_or(true);

    // Project statuses by lower-cased name, for the changelog.
    let statuses: Vec<(String, String)> = sqlx::query_as("SELECT key, name FROM project_statuses WHERE tenant_id=$1 AND project_id=$2")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
    let key_by_name: HashMap<String, String> = statuses.iter().map(|(k, n)| (n.to_lowercase(), k.clone())).collect();

    let mut report = JiraExtrasReport {
        dry_run,
        issues_found: issues.len(),
        issues_not_found: 0,
        sprints_to_create: 0,
        issues_in_sprints: 0,
        releases_to_create: 0,
        issues_in_releases: 0,
        status_changes_to_add: 0,
        status_changes_skipped: 0,
    };
    let mut sprint_names: HashMap<String, bool> = HashMap::new();
    let mut release_names: Vec<String> = Vec::new();

    for issue in &issues {
        let Some(key) = issue.get("key").and_then(Value::as_str) else {
            report.issues_not_found += 1;
            continue;
        };
        let issue_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT issue_id FROM imported_issue_refs WHERE tenant_id=$1 AND project_id=$2 AND external_ref=$3",
        )
        .bind(i.tenant_id)
        .bind(project)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let Some(issue_id) = issue_id else {
            report.issues_not_found += 1;
            continue;
        };
        let fields = issue.get("fields").cloned().unwrap_or(Value::Null);

        // Sprints: the last one named is the issue's sprint.
        let sprints = sprints_of(&fields);
        if let Some(last) = sprints.last() {
            report.issues_in_sprints += 1;
            if !sprint_names.contains_key(&last.name) {
                let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND name=$3)")
                    .bind(i.tenant_id)
                    .bind(project)
                    .bind(&last.name)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db_err)?;
                if !exists {
                    report.sprints_to_create += 1;
                }
                sprint_names.insert(last.name.clone(), last.closed);
            }
        }

        // Fix versions become releases.
        if let Some(versions) = fields.get("fixVersions").and_then(Value::as_array) {
            for v in versions {
                if let Some(name) = v.get("name").and_then(Value::as_str) {
                    report.issues_in_releases += 1;
                    if !release_names.iter().any(|n| n == name) {
                        release_names.push(name.to_string());
                    }
                }
            }
        }

        // Status changes from the changelog.
        let histories = issue.get("changelog").and_then(|c| c.get("histories")).and_then(Value::as_array).cloned().unwrap_or_default();
        for h in histories {
            let Some(when) = h.get("created").and_then(Value::as_str).and_then(parse_jira_time) else { continue };
            for item in h.get("items").and_then(Value::as_array).cloned().unwrap_or_default() {
                if item.get("field").and_then(Value::as_str) != Some("status") {
                    continue;
                }
                let from = item.get("fromString").and_then(Value::as_str).and_then(|n| key_by_name.get(&n.to_lowercase()));
                let to = item.get("toString").and_then(Value::as_str).and_then(|n| key_by_name.get(&n.to_lowercase()));
                // The target status must be known; an unknown origin is recorded as no origin.
                let Some(to) = to else {
                    report.status_changes_skipped += 1;
                    continue;
                };
                let exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM issue_status_history WHERE tenant_id=$1 AND issue_id=$2 AND to_status=$3 AND changed_at=$4)",
                )
                .bind(i.tenant_id)
                .bind(issue_id)
                .bind(to)
                .bind(when)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
                if exists {
                    continue;
                }
                report.status_changes_to_add += 1;
                if !dry_run {
                    sqlx::query(
                        "INSERT INTO issue_status_history(tenant_id,issue_id,from_status,to_status,actor_id,changed_at) VALUES($1,$2,$3,$4,$5,$6)",
                    )
                    .bind(i.tenant_id)
                    .bind(issue_id)
                    .bind(from.map(String::as_str))
                    .bind(to)
                    .bind(i.user_id)
                    .bind(when)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
                }
            }
        }
    }
    // Known names are counted in the sprints and releases loops; the writes happen once per name below.
    report.releases_to_create = {
        let mut n = 0;
        for name in &release_names {
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM releases WHERE tenant_id=$1 AND project_id=$2 AND name=$3)")
                .bind(i.tenant_id)
                .bind(project)
                .bind(name)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
            if !exists {
                n += 1;
            }
        }
        n
    };
    if !dry_run {
        for (name, closed) in &sprint_names {
            let state = if *closed { "completed" } else { "planned" };
            sqlx::query("INSERT INTO sprints(tenant_id,project_id,name,state) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND name=$3)")
                .bind(i.tenant_id)
                .bind(project)
                .bind(name)
                .bind(state)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        for name in &release_names {
            sqlx::query("INSERT INTO releases(tenant_id,project_id,name) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM releases WHERE tenant_id=$1 AND project_id=$2 AND name=$3)")
                .bind(i.tenant_id)
                .bind(project)
                .bind(name)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        // Assign sprints and release memberships now that the rows exist.
        for issue in &issues {
            let Some(key) = issue.get("key").and_then(Value::as_str) else { continue };
            let issue_id: Option<Uuid> = sqlx::query_scalar(
                "SELECT issue_id FROM imported_issue_refs WHERE tenant_id=$1 AND project_id=$2 AND external_ref=$3",
            )
            .bind(i.tenant_id)
            .bind(project)
            .bind(key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?;
            let Some(issue_id) = issue_id else { continue };
            let fields = issue.get("fields").cloned().unwrap_or(Value::Null);
            if let Some(last) = sprints_of(&fields).last() {
                sqlx::query("UPDATE issues SET sprint_id=(SELECT id FROM sprints WHERE tenant_id=$1 AND project_id=$2 AND name=$3 LIMIT 1) WHERE tenant_id=$1 AND id=$4 AND sprint_id IS NULL")
                    .bind(i.tenant_id)
                    .bind(project)
                    .bind(&last.name)
                    .bind(issue_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            if let Some(versions) = fields.get("fixVersions").and_then(Value::as_array) {
                for v in versions {
                    let Some(name) = v.get("name").and_then(Value::as_str) else { continue };
                    sqlx::query(
                        "INSERT INTO release_issues(tenant_id,release_id,issue_id,added_by) \
                         SELECT $1, r.id, $3, $4 FROM releases r WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.name=$5 \
                         AND NOT EXISTS (SELECT 1 FROM release_issues ri WHERE ri.tenant_id=$1 AND ri.release_id=r.id AND ri.issue_id=$3 AND ri.removed_at IS NULL)",
                    )
                    .bind(i.tenant_id)
                    .bind(project)
                    .bind(issue_id)
                    .bind(i.user_id)
                    .bind(name)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
                }
            }
        }
        log_event(&mut tx, &i, "jira_import_extras", "project", project).await?;
    }
    Ok(Json(report))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new().route("/api/projects/{id}/import/jira/extras", axum::routing::post(import_extras))
}
