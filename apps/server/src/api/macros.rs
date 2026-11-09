//! Macros in pages. A page's text can hold a few macros that the reader renders from their
//! definitions: an issue list, a table of issues, or a bar chart of issue counts. Each one is a search
//! over the project's issues, so it honours the same visibility rules as every other read.
//!
//! The grammar is `{{name key="value" key=value}}` with three names: `issues`, `table` and `chart`.
//! Keys: `query` (issue search text, up to 200 characters), `limit` (1 to 50, for lists and tables) and
//! `by` (`status`, `priority` or `kind`, for charts). Anything else is refused when a page is saved.
use crate::api::common::*;
use crate::*;

pub(crate) const MAX_MACROS_PER_PAGE: usize = 20;

/// Refuses a page text that holds a malformed or unknown macro, or too many of them.
pub(crate) fn validate_macros(content: &str) -> ApiResult<()> {
    let mut count = 0usize;
    let mut rest = content;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| bad("A macro is not closed with }}"))?;
        validate_one(after[..end].trim())?;
        count += 1;
        rest = &after[end + 2..];
    }
    if count > MAX_MACROS_PER_PAGE {
        return Err(bad("A page can hold up to 20 macros"));
    }
    Ok(())
}

/// Splits one macro body into its name and its key/value pairs. Values may be quoted with `"`.
pub(crate) fn parse_macro(body: &str) -> Result<(String, Vec<(String, String)>), String> {
    let body = body.trim();
    let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
    let name = body[..name_end].to_string();
    if name.is_empty() {
        return Err("A macro needs a name".into());
    }
    let mut args = Vec::new();
    let mut rest = body[name_end..].trim_start();
    while !rest.is_empty() {
        let eq = rest
            .find('=')
            .ok_or_else(|| format!("“{rest}” is not a key=value pair"))?;
        let key = rest[..eq].trim().to_string();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            return Err(format!("“{key}” is not a valid argument name"));
        }
        let after = rest[eq + 1..].trim_start();
        let (value, remainder) = if let Some(quoted) = after.strip_prefix('"') {
            let close = quoted.find('"').ok_or_else(|| format!("The value of {key} is not closed"))?;
            (quoted[..close].to_string(), &quoted[close + 1..])
        } else {
            let end = after.find(char::is_whitespace).unwrap_or(after.len());
            (after[..end].to_string(), &after[end..])
        };
        args.push((key, value));
        rest = remainder.trim_start();
    }
    Ok((name, args))
}

fn validate_one(body: &str) -> ApiResult<()> {
    let (name, args) = parse_macro(body).map_err(|m| bad(&m))?;
    let allowed: &[&str] = match name.as_str() {
        "issues" | "table" => &["query", "limit"],
        "chart" => &["by", "query"],
        "toc" => &["max_level"],
        "status" => &["text", "color"],
        "callout" => &["type", "title", "text"],
        "properties" => &["name", "value"],
        other => return Err(bad(&format!("“{other}” is not a macro. Use issues, table, chart, toc, status, callout or properties"))),
    };
    for (key, value) in &args {
        if !allowed.contains(&key.as_str()) {
            return Err(bad(&format!("{name} does not take “{key}”")));
        }
        match key.as_str() {
            "query" if value.chars().count() > 200 => {
                return Err(bad("A macro query is limited to 200 characters"))
            }
            "limit" => {
                let n: i64 = value.parse().map_err(|_| bad("limit must be a number"))?;
                if !(1..=50).contains(&n) {
                    return Err(bad("limit must be between 1 and 50"));
                }
            }
            "by" if !matches!(value.as_str(), "status" | "priority" | "kind") => {
                return Err(bad("chart by must be status, priority or kind"))
            }
            "color" if !matches!(value.as_str(), "gray" | "blue" | "green" | "yellow" | "red" | "purple") => {
                return Err(bad("status color must be gray, blue, green, yellow, red or purple"))
            }
            "type" if !matches!(value.as_str(), "info" | "warning" | "tip" | "caution") => {
                return Err(bad("callout type must be info, warning, tip or caution"))
            }
            _ => {}
        }
    }
    Ok(())
}
