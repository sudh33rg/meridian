//! Issue query language. A query is a list of filters. Juxtaposed filters are ANDed; `OR` joins
//! neighbouring filters; parentheses group; `-` (or `-(` ... `)`) negates.
//!
//!   status:in_progress   priority:high   kind:bug   label:backend   number:42
//!   assignee:me          assignee:currentUser()   assignee:<user id>   title:login
//!   sprint:openSprints() sprint:none  sprint:<sprint id>   login (a bare word searches titles)
//!   cf.region:EU         custom fields: equality for numbers, dates, booleans and choices; text contains
//!   -status:done         a leading minus negates a term (issues without the value still match)
//!   status:todo OR status:done                  OR joins the filters on either side
//!   (status:todo OR status:done) priority:high  parentheses nest (up to 4 levels, up to 20 filters)
//!   -(label:legacy OR label:old)                a negated group
//!   order:rank | order:priority | order:updated | order:number   one ordering term (default number)
//!   "quoted phrase"      quotes keep spaces, parentheses and AND/OR words inside a value
//!
//! Precedence: `OR` binds tighter than juxtaposition, so `a b OR c` means `a AND (b OR c)`, the same
//! as before nesting existed. Use parentheses to say anything else.
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
use std::collections::HashMap;

const MAX_TERMS: usize = 20;
const MAX_DEPTH: usize = 4;
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
    Due,
    Created,
    /// An ordering term. It filters nothing; the value is one of rank, priority, updated or number.
    Order,
    Custom(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Term {
    pub(crate) negate: bool,
    pub(crate) field: Field,
    pub(crate) value: String,
}

/// A parsed filter expression. Leaves are filters; `And` and `Or` join their children.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Node {
    Leaf(Term),
    And(Vec<Node>),
    Or(Vec<Node>),
    /// A negated parenthesised group.
    Not(Box<Node>),
}

/// The result of parsing a query: the filter tree (none for an order-only query), the ordering and
/// every filter leaf (for checks that do not need the tree, such as saved-view staleness).
#[derive(Debug, Clone)]
pub(crate) struct ParsedQuery {
    pub(crate) tree: Option<Node>,
    pub(crate) order: &'static str,
    pub(crate) leaves: Vec<Term>,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub(crate) struct SearchQuery {
    /// The query, for example `status:in_progress priority:high -label:legacy`.
    pub(crate) query: String,
    /// Up to 200 matches, newest number first (default 100).
    pub(crate) limit: Option<i64>,
}

/// Splits on spaces outside double quotes. Unquoted parentheses are tokens of their own.
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
            '(' | ')' if !in_quote => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
                tokens.push(c.to_string());
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

struct Parser {
    toks: Vec<String>,
    pos: usize,
    order: Option<&'static str>,
    leaves: Vec<Term>,
}

impl Parser {
    fn peek(&self) -> Option<&str> {
        self.toks.get(self.pos).map(String::as_str)
    }

    fn next_tok(&mut self) -> Option<String> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    /// expr := or_expr ( [AND] or_expr )*   (juxtaposition is AND)
    fn parse_expr(&mut self, depth: usize) -> ApiResult<Option<Node>> {
        let mut parts: Vec<Node> = Vec::new();
        loop {
            match self.peek() {
                None => break,
                Some(")") => {
                    if depth == 0 {
                        return Err(bad("A closing parenthesis has no opening one"));
                    }
                    break;
                }
                Some("AND") => {
                    if parts.is_empty() {
                        return Err(bad("AND must follow a filter"));
                    }
                    self.pos += 1;
                    if matches!(self.peek(), None | Some(")")) {
                        return Err(bad("AND must be followed by a filter"));
                    }
                    continue;
                }
                _ => {}
            }
            if let Some(node) = self.parse_or(depth)? {
                parts.push(node);
            }
        }
        Ok(match parts.len() {
            0 => None,
            1 => parts.pop(),
            _ => Some(Node::And(parts)),
        })
    }

    /// or_expr := unary ( OR unary )*
    fn parse_or(&mut self, depth: usize) -> ApiResult<Option<Node>> {
        let mut alts: Vec<Node> = Vec::new();
        if let Some(n) = self.parse_unary(depth)? {
            alts.push(n);
        }
        while self.peek() == Some("OR") {
            self.pos += 1;
            if alts.is_empty() {
                return Err(bad("OR must sit between two filters"));
            }
            match self.parse_unary(depth)? {
                Some(n) => alts.push(n),
                None => return Err(bad("order: cannot be negated or joined with OR")),
            }
        }
        Ok(match alts.len() {
            0 => None,
            1 => alts.pop(),
            _ => Some(Node::Or(alts)),
        })
    }

    fn parse_unary(&mut self, depth: usize) -> ApiResult<Option<Node>> {
        let Some(tok) = self.next_tok() else {
            return Err(bad("A filter is missing here"));
        };
        match tok.as_str() {
            "(" => Ok(Some(self.parse_group(depth)?)),
            "-" if self.peek() == Some("(") => {
                self.pos += 1;
                let inner = self.parse_group(depth)?;
                Ok(Some(Node::Not(Box::new(inner))))
            }
            "OR" | "AND" | ")" => Err(bad("A filter is missing here")),
            _ => self.leaf(tok),
        }
    }

    /// Parses the inside of a parenthesised group; the opening parenthesis is already consumed.
    fn parse_group(&mut self, depth: usize) -> ApiResult<Node> {
        if depth + 1 > MAX_DEPTH {
            return Err(bad("Parentheses can be nested up to 4 levels"));
        }
        let inner = self.parse_expr(depth + 1)?;
        if self.peek() != Some(")") {
            return Err(bad("A parenthesis is not closed"));
        }
        self.pos += 1;
        inner.ok_or_else(|| bad("An empty group () has no filter"))
    }

    /// One filter token. Returns `None` for the ordering term, which filters nothing.
    fn leaf(&mut self, raw: String) -> ApiResult<Option<Node>> {
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
            "due" => Field::Due,
            "created" => Field::Created,
            "order" => Field::Order,
            other if other.starts_with("cf.") && other.len() > 3 => Field::Custom(other[3..].to_string()),
            other => {
                return Err(bad(&format!(
                    "Unknown field “{other}”. Use status, priority, kind, assignee, label, title, number, sprint, due, created, order or cf.<key>"
                )))
            }
        };
        match &field {
            Field::Order => {
                if negate {
                    return Err(bad("order: cannot be negated or joined with OR"));
                }
                let sql = match value.as_str() {
                    "rank" => "backlog_rank ASC, number ASC",
                    "priority" => "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, number DESC",
                    "updated" => "updated_at DESC, number DESC",
                    "number" => "number DESC",
                    _ => return Err(bad("Order must be rank, priority, updated or number")),
                };
                if self.order.is_some() {
                    return Err(bad("A query can have one order: term"));
                }
                self.order = Some(sql);
                return Ok(None);
            }
            Field::Sprint => {
                let valid =
                    value == "none" || value == "openSprints()" || Uuid::parse_str(&value).is_ok();
                if !valid {
                    return Err(bad("Sprint must be none, openSprints() or a sprint id"));
                }
            }
            _ => {}
        }
        let term = Term {
            negate,
            field,
            value,
        };
        self.leaves.push(term.clone());
        if self.leaves.len() > MAX_TERMS {
            return Err(bad("A query can have up to 20 terms"));
        }
        Ok(Some(Node::Leaf(term)))
    }
}

/// Parses a query into a filter tree, its ordering and its leaves. Field names are checked here;
/// values are checked against the project when the query is compiled.
pub(crate) fn parse_query(query: &str) -> ApiResult<ParsedQuery> {
    let toks = tokenize(query)?;
    if toks.is_empty() {
        return Err(bad("Enter a query, for example status:in_progress"));
    }
    if toks.len() > MAX_TERMS * 4 {
        return Err(bad("A query can have up to 20 terms"));
    }
    let mut p = Parser {
        toks,
        pos: 0,
        order: None,
        leaves: Vec::new(),
    };
    let tree = p.parse_expr(0)?;
    if p.pos < p.toks.len() {
        return Err(bad("A closing parenthesis has no opening one"));
    }
    Ok(ParsedQuery {
        tree,
        order: p.order.unwrap_or("number"),
        leaves: p.leaves,
    })
}

/// The filter leaves of a query, for checks that do not need the tree (saved-view staleness).
pub(crate) fn parse(query: &str) -> ApiResult<Vec<Term>> {
    Ok(parse_query(query)?.leaves)
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

/// What the compiler needs to know about a custom field: its type and its choices.
pub(crate) struct CustomDef {
    field_type: String,
    options: Vec<String>,
}

/// Checks every leaf against the project before any SQL is built: statuses, issue types and custom
/// fields must exist. Returns the custom field definitions the compiler needs.
pub(crate) async fn check_leaves(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    leaves: &[Term],
) -> ApiResult<HashMap<String, CustomDef>> {
    let mut defs = HashMap::new();
    for t in leaves {
        match &t.field {
            Field::Status => {
                if !status_defined(db, tenant, project, &t.value).await? {
                    return Err(bad(&format!(
                        "“{}” is not a status in this project",
                        t.value
                    )));
                }
            }
            Field::Kind => {
                if crate::api::issue_types::type_level(db, tenant, project, &t.value)
                    .await?
                    .is_none()
                {
                    return Err(bad(&format!(
                        "“{}” is not an issue type in this project",
                        t.value
                    )));
                }
            }
            Field::Custom(key) => {
                if defs.contains_key(key) {
                    continue;
                }
                let row: Option<(String, Vec<String>)> = sqlx::query_as(
                    "SELECT field_type, options FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
                )
                .bind(tenant)
                .bind(project)
                .bind(key)
                .fetch_optional(&mut *db)
                .await
                .map_err(db_err)?;
                let (field_type, options) =
                    row.ok_or_else(|| bad(&format!("Unknown custom field “{key}”")))?;
                defs.insert(
                    key.clone(),
                    CustomDef {
                        field_type,
                        options,
                    },
                );
            }
            _ => {}
        }
    }
    Ok(defs)
}

/// Emits the SQL for one filter leaf. Values were checked by `check_leaves` where they need the database.
fn push_leaf(
    qb: &mut QueryBuilder<Postgres>,
    tenant: Uuid,
    user: Uuid,
    project: Uuid,
    t: &Term,
    defs: &HashMap<String, CustomDef>,
) -> ApiResult<()> {
    match &t.field {
        Field::Status => {
            qb.push("status = ").push_bind(t.value.clone());
        }
        Field::Priority => {
            if !ISSUE_PRIORITIES.contains(&t.value.as_str()) {
                return Err(bad("Priority must be low, medium, high or urgent"));
            }
            qb.push("priority = ").push_bind(t.value.clone());
        }
        Field::Kind => {
            qb.push("kind = ").push_bind(t.value.clone());
        }
        Field::Sprint => match t.value.as_str() {
            "none" | "empty" => {
                qb.push("sprint_id IS NULL");
            }
            "openSprints()" | "currentSprint()" => {
                qb.push("sprint_id IN (SELECT id FROM sprints WHERE tenant_id=")
                    .push_bind(tenant)
                    .push(" AND project_id=")
                    .push_bind(project)
                    .push(" AND state<>'completed')");
            }
            id => {
                let sprint = Uuid::parse_str(id).map_err(|_| {
                    bad("Sprint must be none, openSprints(), currentSprint() or a sprint id")
                })?;
                qb.push("sprint_id = ").push_bind(sprint);
            }
        },
        Field::Due => {
            match t.value.as_str() {
                "empty" | "none" => {
                    qb.push("due_at IS NULL");
                }
                "notEmpty" => {
                    qb.push("due_at IS NOT NULL");
                }
                "now()" | "today" => {
                    qb.push("due_at::date = CURRENT_DATE");
                }
                "startOfWeek()" => {
                    qb.push("due_at::date = date_trunc('week', CURRENT_DATE)::date");
                }
                "endOfWeek()" => {
                    qb.push("due_at::date = (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::date");
                }
                "startOfMonth()" => {
                    qb.push("due_at::date = date_trunc('month', CURRENT_DATE)::date");
                }
                "endOfMonth()" => {
                    qb.push("due_at::date = (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date");
                }
                "lastWeek()" => {
                    qb.push("due_at::date = (CURRENT_DATE - INTERVAL '7 days')::date");
                }
                val => {
                    if !is_date(val) {
                        return Err(bad("due takes a date (YYYY-MM-DD), today, now(), startOfWeek(), endOfWeek(), startOfMonth(), endOfMonth(), lastWeek(), empty or notEmpty"));
                    }
                    qb.push("due_at::date = ")
                        .push_bind(val.to_string())
                        .push("::date");
                }
            }
        }
        Field::Created => match t.value.as_str() {
            "now()" | "today" => {
                qb.push("created_at::date = CURRENT_DATE");
            }
            "startOfWeek()" => {
                qb.push("created_at::date >= date_trunc('week', CURRENT_DATE)::date");
            }
            "startOfMonth()" => {
                qb.push("created_at::date >= date_trunc('month', CURRENT_DATE)::date");
            }
            "lastWeek()" => {
                qb.push("created_at::date >= (CURRENT_DATE - INTERVAL '7 days')::date");
            }
            val => {
                if !is_date(val) {
                    return Err(bad("created takes a date (YYYY-MM-DD), today, now(), startOfWeek(), startOfMonth() or lastWeek()"));
                }
                qb.push("created_at::date = ")
                    .push_bind(val.to_string())
                    .push("::date");
            }
        },
        Field::Order => {}
        Field::Assignee => {
            if t.value == "empty" || t.value == "none" || t.value == "unassigned" {
                qb.push("assignee_id IS NULL");
            } else {
                let who = if t.value == "me" || t.value == "currentUser()" {
                    user
                } else {
                    Uuid::parse_str(&t.value).map_err(|_| {
                        bad("Assignee must be a user id, me, currentUser(), none or empty")
                    })?
                };
                qb.push("assignee_id = ").push_bind(who);
            }
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
            let def = defs
                .get(key)
                .ok_or_else(|| bad(&format!("Unknown custom field “{key}”")))?;
            match def.field_type.as_str() {
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
                    if t.value == "empty" || t.value == "none" {
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text) IS NULL");
                    } else if t.value == "notEmpty" {
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text) IS NOT NULL");
                    } else if t.value == "now()" || t.value == "today" {
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text)::date = CURRENT_DATE");
                    } else if t.value == "startOfWeek()" {
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text)::date = date_trunc('week', CURRENT_DATE)::date");
                    } else if t.value == "endOfWeek()" {
                        qb.push("(custom_fields->>").push_bind(key.clone()).push("::text)::date = (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::date");
                    } else if t.value == "startOfMonth()" {
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text)::date = date_trunc('month', CURRENT_DATE)::date");
                    } else if t.value == "endOfMonth()" {
                        qb.push("(custom_fields->>").push_bind(key.clone()).push("::text)::date = (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date");
                    } else if t.value == "lastWeek()" {
                        qb.push("(custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text)::date = (CURRENT_DATE - INTERVAL '7 days')::date");
                    } else if is_date(&t.value) {
                        qb.push("custom_fields->>")
                            .push_bind(key.clone())
                            .push("::text = ")
                            .push_bind(t.value.clone());
                    } else {
                        return Err(bad("This field takes a date (YYYY-MM-DD), today, now(), startOfWeek(), endOfWeek(), startOfMonth(), endOfMonth(), lastWeek(), empty or notEmpty"));
                    }
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
                    if !def.options.iter().any(|o| o == &t.value) {
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
    Ok(())
}

/// Emits the SQL for a filter tree. Every node is wrapped in parentheses, so precedence is explicit.
fn push_node(
    qb: &mut QueryBuilder<Postgres>,
    tenant: Uuid,
    user: Uuid,
    project: Uuid,
    node: &Node,
    defs: &HashMap<String, CustomDef>,
) -> ApiResult<()> {
    match node {
        Node::Leaf(t) => {
            // A negated term keeps issues where the value is missing: NULL counts as "does not match".
            if t.negate {
                qb.push("NOT COALESCE((");
            } else {
                qb.push("(");
            }
            push_leaf(qb, tenant, user, project, t, defs)?;
            if t.negate {
                qb.push("), false)");
            } else {
                qb.push(")");
            }
        }
        Node::And(children) | Node::Or(children) => {
            let sep = if matches!(node, Node::And(_)) {
                " AND "
            } else {
                " OR "
            };
            qb.push("(");
            for (idx, child) in children.iter().enumerate() {
                if idx > 0 {
                    qb.push(sep);
                }
                push_node(qb, tenant, user, project, child, defs)?;
            }
            qb.push(")");
        }
        Node::Not(inner) => {
            qb.push("NOT COALESCE((");
            push_node(qb, tenant, user, project, inner, defs)?;
            qb.push("), false)");
        }
    }
    Ok(())
}

/// Compiles a query for one caller in one project into `SELECT ... WHERE ...` (no ordering or limit),
/// with the visibility and restricted-field rules applied. Shared by the issue search and by background
/// jobs that run saved views for their owners. Returns the builder and the ordering to append.
pub(crate) async fn build_search(
    db: &mut PgConnection,
    i: &Identity,
    project: Uuid,
    query: &str,
) -> ApiResult<(QueryBuilder<'static, Postgres>, &'static str)> {
    let parsed = parse_query(query)?;
    // Members cannot search on a restricted field: its values would be learned from the matches.
    if project_level(db, i, project).await?.unwrap_or(0) < 3 {
        let hidden = crate::api::fields::restricted_keys(db, i.tenant_id, project).await?;
        if let Some(term) = parsed
            .leaves
            .iter()
            .find(|t| matches!(&t.field, Field::Custom(k) if hidden.contains(k)))
        {
            if let Field::Custom(k) = &term.field {
                return Err(bad(&format!("cf.{k} is restricted to project admins")));
            }
        }
    }
    let defs = check_leaves(db, i.tenant_id, project, &parsed.leaves).await?;
    let mut qb = QueryBuilder::<Postgres>::new(
        "SELECT id,project_id,number,title,description,kind,status,priority,created_at,updated_at FROM issues WHERE tenant_id=",
    );
    qb.push_bind(i.tenant_id)
        .push(" AND project_id=")
        .push_bind(project)
        .push(" AND archived_at IS NULL");
    if let Some(tree) = &parsed.tree {
        qb.push(" AND ");
        push_node(&mut qb, i.tenant_id, i.user_id, project, tree, &defs)?;
    }
    Ok((qb, parsed.order))
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
    let (mut qb, order) = build_search(&mut tx, &i, project, &p.query).await?;
    qb.push(" ORDER BY ")
        .push(order)
        .push(" LIMIT ")
        .push_bind(limit);
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
