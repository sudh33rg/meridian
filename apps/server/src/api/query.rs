//! Issue query language. A query is a list of terms separated by spaces; every term must match.
//!
//!   status:in_progress   priority:high   kind:bug   label:backend   number:42
//!   assignee:me          assignee:currentUser()   assignee:<user id>   title:login
//!   sprint:openSprints() sprint:none  sprint:<sprint id>   login (a bare word searches titles)
//!   cf.region:EU         custom fields: equality for numbers, dates, booleans and choices; text contains
//!   -status:done         a leading minus negates a term (issues without the value still match)
//!   status:todo OR status:done   OR joins the two terms on either side into one group (no nesting)
//!   order:rank | order:priority | order:updated | order:number   one ordering term (default number)
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
    Sprint,
    /// An ordering term. It filters nothing; the value is one of rank, priority, updated or number.
    Order,
    Custom(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Term {
    pub(crate) negate: bool,
    pub(crate) field: Field,
    pub(crate) value: String,
    /// Terms with the same group are joined by OR; groups are joined by AND.
    pub(crate) group: usize,
}

const ORDERS: [&str; 4] = ["rank", "priority", "updated", "number"];

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
    let mut terms: Vec<Term> = Vec::new();
    let mut group = 0usize;
    let mut pending_or = false;
    for raw in tokens {
        if raw == "OR" {
            if pending_or || !terms.iter().any(|t| t.field != Field::Order) {
                return Err(bad("OR must sit between two filters"));
            }
            pending_or = true;
            continue;
        }
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
            "sprint" => Field::Sprint,
            "order" => Field::Order,
            other if other.starts_with("cf.") && other.len() > 3 => Field::Custom(other[3..].to_string()),
            other => {
                return Err(bad(&format!(
                    "Unknown field “{other}”. Use status, priority, kind, assignee, label, title, number, sprint, order or cf.<key>"
                )))
            }
        };
        match &field {
            Field::Order => {
                if negate || pending_or {
                    return Err(bad("order: cannot be negated or joined with OR"));
                }
                if !ORDERS.contains(&value.as_str()) {
                    return Err(bad("Order must be rank, priority, updated or number"));
                }
                if terms.iter().any(|t| t.field == Field::Order) {
                    return Err(bad("A query can have one order: term"));
                }
            }
            Field::Sprint => {
                let valid = value == "none" || value == "openSprints()" || Uuid::parse_str(&value).is_ok();
                if !valid {
                    return Err(bad("Sprint must be none, openSprints() or a sprint id"));
                }
            }
            _ => {}
        }
        if matches!(field, Field::Order) {
            terms.push(Term { negate, field, value, group: 0 });
            continue;
        }
        if !terms.iter().any(|t| t.field != Field::Order) {
            group = 0;
        } else if !pending_or {
            group += 1;
        }
        pending_or = false;
        terms.push(Term {
            negate,
            field,
            value,
            group,
        });
    }
    if pending_or {
        return Err(bad("OR must be followed by a filter"));
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
    let mut current_group: Option<usize> = None;
    let mut order = "number";
    for t in &terms {
        if t.field == Field::Order {
            order = match t.value.as_str() {
                "rank" => "backlog_rank ASC, number ASC",
                "priority" => "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, number DESC",
                "updated" => "updated_at DESC, number DESC",
                _ => "number DESC",
            };
            continue;
        }
        // Each group is one AND-ed parenthesised list; its terms are OR-ed inside it.
        if current_group != Some(t.group) {
            if current_group.is_some() {
                qb.push(")");
            }
            qb.push(" AND (");
            current_group = Some(t.group);
        } else {
            qb.push(" OR ");
        }
        // A negated term keeps issues where the value is missing: NULL counts as "does not match".
        if t.negate {
            qb.push("NOT COALESCE((");
        } else {
            qb.push("(");
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
            Field::Sprint => match t.value.as_str() {
                "none" => {
                    qb.push("sprint_id IS NULL");
                }
                "openSprints()" => {
                    qb.push("sprint_id IN (SELECT id FROM sprints WHERE tenant_id=")
                        .push_bind(i.tenant_id)
                        .push(" AND project_id=")
                        .push_bind(project)
                        .push(" AND state<>'completed')");
                }
                id => {
                    let sprint = Uuid::parse_str(id).map_err(|_| bad("Sprint must be none, openSprints() or a sprint id"))?;
                    qb.push("sprint_id = ").push_bind(sprint);
                }
            },
            Field::Order => {}
            Field::Assignee => {
                let user = if t.value == "me" || t.value == "currentUser()" {
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
    if current_group.is_some() {
        qb.push(")");
    }
    qb.push(" ORDER BY ").push(order).push(" LIMIT ").push_bind(limit);
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
