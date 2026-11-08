//! Issue query language. A query is a list of terms separated by spaces; every term must match.
//!
//!   status:in_progress   priority:high   kind:bug   label:backend   number:42
//!   assignee:me          assignee:<user id>   title:login   login (a bare word searches titles)
//!   cf.region:EU         custom fields: equality for numbers, dates, booleans and choices; text contains
//!   -status:done         a leading minus negates a term (issues without the value still match)
//!   "quoted phrase"      quotes keep spaces inside a value
//!
//! The query compiles to parameterised SQL inside the caller's tenant and project, so access is
//! applied before any filter runs. Unknown fields, values the project does not define and malformed
//! input are refused with 400.
use crate::api::common::*;
use crate::api::statuses::status_defined;
use crate::api::work::{Issue, ISSUE_PRIORITIES};
use crate::*;
use axum::extract::Query;
use sqlx::{Postgres, QueryBuilder};

const MAX_TERMS: usize = 20;
const MAX_VALUE_CHARS: usize = 200;
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Field {
    Status,
    Priority,
    Kind,
    Assignee,
    Label,
    Title,
    Number,
    Custom(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Term {
    pub(crate) negate: bool,
    pub(crate) field: Field,
    pub(crate) value: String,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct SearchQuery {
    /// The query, for example `status:in_progress priority:high -label:legacy`.
    pub(crate) query: String,
    /// Up to 200 matches, newest number first (default 100).
    pub(crate) limit: Option<i64>,
}

/// Splits on spaces outside double quotes.
pub(crate) fn tokenize(query: &str) -> ApiResult<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    for c in query.chars() {
        match c {
            '"' => {
                in_quote = !in_quote;
                current.push(c);
            }
            c if c.is_whitespace() && !in_quote => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if in_quote {
        return Err(bad("A quote is missing its closing quote"));
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

/// Parses a query into terms. Field names are checked here; values are checked against the
/// project when the query is compiled.
pub(crate) fn parse(query: &str) -> ApiResult<Vec<Term>> {
    let tokens = tokenize(query)?;
    if tokens.is_empty() {
        return Err(bad("Enter a query, for example status:in_progress"));
    }
    if tokens.len() > MAX_TERMS {
        return Err(bad("A query can have up to 20 terms"));
    }
    let mut terms = Vec::new();
    for raw in tokens {
        let (negate, body) = match raw.strip_prefix('-') {
            Some(rest) if !rest.is_empty() => (true, rest.to_string()),
            _ => (false, raw.clone()),
        };
        let (name, value) = match body.split_once(':') {
            Some((name, value)) if !name.is_empty() => (name.to_string(), value.to_string()),
            _ => ("title".to_string(), body.clone()),
        };
        let value = value.trim_matches('"').to_string();
        if value.is_empty() {
            return Err(bad(&format!("“{raw}” needs a value after the colon")));
        }
        if value.chars().count() > MAX_VALUE_CHARS {
            return Err(bad("A value can be up to 200 characters"));
        }
        let field = match name.as_str() {
            "status" => Field::Status,
            "priority" => Field::Priority,
            "kind" | "type" => Field::Kind,
            "assignee" => Field::Assignee,
            "label" => Field::Label,
            "title" => Field::Title,
            "number" => Field::Number,
            other if other.starts_with("cf.") && other.len() > 3 => Field::Custom(other[3..].to_string()),
            other => {
                return Err(bad(&format!(
                    "Unknown field “{other}”. Use status, priority, kind, assignee, label, title, number or cf.<key>"
                )))
            }
        };
        terms.push(Term {
            negate,
            field,
            value,
        });
    }
    Ok(terms)
}

fn escape_like(s: &str) -> String {
    format!(
        "%{}%",
        s.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}

fn is_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

#[utoipa::path(get, path = "/api/projects/{id}/issues/search", tag = "issues", params(("id" = Uuid, Path, description = "Resource id"), SearchQuery), responses((status = 200, description = "Matching issues, newest number first", body = Vec<Issue>), (status = 400, description = "Unknown field or value, or malformed query", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn search_issues(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Query(p): Query<SearchQuery>,
) -> ApiResult<Json<Vec<Issue>>> {
    let i = tx.identity.clone();
    ensure_access(&mut tx, project).await?;
    let limit = p.limit.unwrap_or(100);
    if !(1..=200).contains(&limit) {
        return Err(bad("limit must be between 1 and 200"));
    }
    let terms = parse(&p.query)?;

    let mut qb = QueryBuilder::<Postgres>::new(
        "SELECT id,project_id,number,title,description,kind,status,priority,created_at,updated_at FROM issues WHERE tenant_id=",
    );
    qb.push_bind(i.tenant_id)
        .push(" AND project_id=")
        .push_bind(project)
        .push(" AND archived_at IS NULL");
    for t in &terms {
        // A negated term keeps issues where the value is missing: NULL counts as "does not match".
        if t.negate {
            qb.push(" AND NOT COALESCE((");
        } else {
            qb.push(" AND (");
        }
        match &t.field {
            Field::Status => {
                if !status_defined(&mut tx, i.tenant_id, project, &t.value).await? {
                    return Err(bad(&format!(
                        "“{}” is not a status in this project",
                        t.value
                    )));
                }
                qb.push("status = ").push_bind(t.value.clone());
            }
            Field::Priority => {
                if !ISSUE_PRIORITIES.contains(&t.value.as_str()) {
                    return Err(bad("Priority must be low, medium, high or urgent"));
                }
                qb.push("priority = ").push_bind(t.value.clone());
            }
            Field::Kind => {
                if crate::api::issue_types::type_level(&mut tx, i.tenant_id, project, &t.value)
                    .await?
                    .is_none()
                {
                    return Err(bad(&format!(
                        "“{}” is not an issue type in this project",
                        t.value
                    )));
                }
                qb.push("kind = ").push_bind(t.value.clone());
            }
            Field::Assignee => {
                let user = if t.value == "me" {
                    i.user_id
                } else {
                    Uuid::parse_str(&t.value)
                        .map_err(|_| bad("Assignee must be a user id or me"))?
                };
                qb.push("assignee_id = ").push_bind(user);
            }
            Field::Label => {
                qb.push_bind(t.value.clone()).push(" = ANY(labels)");
            }
            Field::Title => {
                qb.push("title ILIKE ")
                    .push_bind(escape_like(&t.value))
                    .push(" ESCAPE '\\'");
            }
            Field::Number => {
                let n: i64 = t
                    .value
                    .parse()
                    .map_err(|_| bad("Number must be a whole number"))?;
                qb.push("number = ").push_bind(n);
            }
            Field::Custom(key) => {
                let field_type: Option<String> = sqlx::query_scalar(
                    "SELECT field_type FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
                )
                .bind(i.tenant_id)
                .bind(project)
                .bind(key)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_err)?;
                let field_type =
                    field_type.ok_or_else(|| bad(&format!("Unknown custom field “{key}”")))?;
                match field_type.as_str() {
                    "number" => {
                        let n: f64 = t
                            .value
                            .parse()
                            .map_err(|_| bad("This field takes a number"))?;
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text)::numeric = ")
                            .push_bind(n);
                    }
                    "date" => {
                        if !is_date(&t.value) {
                            return Err(bad("This field takes a date (YYYY-MM-DD)"));
                        }
                        qb.push("custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text = ")
                            .push_bind(t.value.clone());
                    }
                    "boolean" => {
                        if t.value != "true" && t.value != "false" {
                            return Err(bad("This field takes true or false"));
                        }
                        qb.push("custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text = ")
                            .push_bind(t.value.clone());
                    }
                    "select" => {
                        let options: Vec<String> = sqlx::query_scalar(
                            "SELECT unnest(options) FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
                        )
                        .bind(i.tenant_id)
                        .bind(project)
                        .bind(key)
                        .fetch_all(&mut *tx)
                        .await
                        .map_err(db_err)?;
                        if !options.iter().any(|o| o == &t.value) {
                            return Err(bad(&format!(
                                "“{}” is not one of this field's choices",
                                t.value
                            )));
                        }
                        qb.push("custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text = ")
                            .push_bind(t.value.clone());
                    }
                    _ => {
                        // Text fields match a part of the value, like titles.
                        qb.push("custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text ILIKE ")
                            .push_bind(escape_like(&t.value))
                            .push(" ESCAPE '\\'");
                    }
                }
            }
        }
        if t.negate {
            qb.push("), false)");
        } else {
            qb.push(")");
        }
    }
    qb.push(" ORDER BY number DESC LIMIT ").push_bind(limit);
    let rows: Vec<Issue> = qb
        .build_query_as::<Issue>()
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;
    Ok(Json(rows))
}

pub(crate) fn routes() -> Router<App> {
    Router::new().route(
        "/api/projects/{id}/issues/search",
        axum::routing::get(search_issues),
    )
}
