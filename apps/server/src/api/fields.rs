//! Custom fields: each project defines typed fields, and issues carry values for them in
//! `custom_fields`. Writes are checked here, so a value always matches its definition.
use crate::api::common::*;
use crate::api::statuses::{slug, valid_key};
use crate::*;
use axum::routing::{get, patch};
use serde_json::{json, Map, Value};

/// Keeps issue forms short enough to use.
const MAX_FIELDS_PER_PROJECT: i64 = 30;
const FIELD_TYPES: [&str; 5] = ["text", "number", "date", "boolean", "select"];

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct FieldDefinition {
    pub(crate) key: String,
    pub(crate) label: String,
    /// `text`, `number`, `date`, `boolean` or `select`.
    pub(crate) field_type: String,
    /// Allowed values for a `select` field; empty otherwise.
    pub(crate) options: Vec<String>,
    pub(crate) required: bool,
    pub(crate) position: i32,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct NewField {
    /// 1 to 60 characters.
    pub(crate) label: String,
    pub(crate) field_type: String,
    /// Required for `select` (1 to 50 values); not allowed otherwise.
    pub(crate) options: Option<Vec<String>>,
    pub(crate) required: Option<bool>,
    /// Optional. Derived from the label when absent.
    pub(crate) key: Option<String>,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct FieldPatch {
    pub(crate) label: Option<String>,
    /// Replaces the select options. Refused while an issue holds a value they would remove.
    pub(crate) options: Option<Vec<String>>,
    pub(crate) required: Option<bool>,
}

fn validate_label(label: &str) -> ApiResult<String> {
    let l = label.trim();
    if l.is_empty() || l.chars().count() > 60 {
        return Err(bad("A field label must be 1 to 60 characters"));
    }
    Ok(l.to_string())
}

fn validate_options(options: &[String]) -> ApiResult<Vec<String>> {
    let cleaned: Vec<String> = options.iter().map(|o| o.trim().to_string()).collect();
    if cleaned.is_empty() || cleaned.len() > 50 || cleaned.iter().any(|o| o.is_empty() || o.chars().count() > 60) {
        return Err(bad("A select field needs 1 to 50 options of up to 60 characters"));
    }
    let mut unique = cleaned.clone();
    unique.sort();
    unique.dedup();
    if unique.len() != cleaned.len() {
        return Err(bad("Select options must be unique"));
    }
    Ok(cleaned)
}

fn check_value(def: &FieldDefinition, v: &Value) -> ApiResult<Value> {
    let fail = |what: &str| bad(&format!("{} must be {what}", def.label));
    match def.field_type.as_str() {
        "text" => v
            .as_str()
            .filter(|s| s.chars().count() <= 2000)
            .map(|s| json!(s))
            .ok_or_else(|| fail("text of up to 2000 characters")),
        "number" => v
            .as_f64()
            .filter(|n| n.is_finite())
            .map(|_| v.clone())
            .ok_or_else(|| fail("a number")),
        "date" => v
            .as_str()
            .filter(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok())
            .map(|s| json!(s))
            .ok_or_else(|| fail("a date (YYYY-MM-DD)")),
        "boolean" => v.as_bool().map(|b| json!(b)).ok_or_else(|| fail("true or false")),
        "select" => v
            .as_str()
            .filter(|s| def.options.iter().any(|o| o == s))
            .map(|s| json!(s))
            .ok_or_else(|| fail("one of the listed options")),
        _ => Err(fail("a supported type")),
    }
}

/// Checks a full set of custom field values against the project's definitions. Unknown keys and
/// wrong types are refused; required fields must be present; null clears a field.
pub(crate) async fn validate_values(
    db: &mut PgConnection,
    tenant: Uuid,
    project: Uuid,
    values: &Value,
) -> ApiResult<Value> {
    let defs: Vec<FieldDefinition> = sqlx::query_as(
        "SELECT key,label,field_type,options,required,position FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 ORDER BY position, key",
    )
    .bind(tenant)
    .bind(project)
    .fetch_all(&mut *db)
    .await
    .map_err(db_err)?;
    let obj = values.as_object().ok_or_else(|| bad("Custom fields must be an object"))?;
    let mut out = Map::new();
    for (key, value) in obj {
        let def = defs
            .iter()
            .find(|d| &d.key == key)
            .ok_or_else(|| bad(&format!("Unknown custom field: {key}")))?;
        if value.is_null() {
            continue;
        }
        out.insert(key.clone(), check_value(def, value)?);
    }
    for def in &defs {
        if def.required && !out.contains_key(&def.key) {
            return Err(bad(&format!("{} is required", def.label)));
        }
    }
    Ok(Value::Object(out))
}

#[utoipa::path(get, path = "/api/projects/{id}/fields", tag = "fields", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 200, description = "The project's custom fields in form order", body = Vec<FieldDefinition>), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn list_fields(mut tx: Tx, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<FieldDefinition>>> {
    ensure_access(&mut tx, project).await?;
    let rows: Vec<FieldDefinition> = sqlx::query_as(
        "SELECT key,label,field_type,options,required,position FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 ORDER BY position, key",
    )
    .bind(tx.identity.tenant_id)
    .bind(project)
    .fetch_all(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(rows))
}

#[utoipa::path(post, path = "/api/projects/{id}/fields", tag = "fields", params(("id" = Uuid, Path, description = "Resource id")), request_body = NewField, responses((status = 201, description = "Created at the end of the form", body = FieldDefinition), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 409, description = "The key already exists", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_field(
    mut tx: Tx,
    Path(project): Path<Uuid>,
    Json(v): Json<NewField>,
) -> ApiResult<(StatusCode, Json<FieldDefinition>)> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let label = validate_label(&v.label)?;
    if !FIELD_TYPES.contains(&v.field_type.as_str()) {
        return Err(bad("Field type must be text, number, date, boolean or select"));
    }
    let options = match (v.field_type.as_str(), &v.options) {
        ("select", Some(o)) => validate_options(o)?,
        ("select", None) => return Err(bad("A select field needs its options")),
        (_, Some(_)) => return Err(bad("Only select fields take options")),
        _ => Vec::new(),
    };
    let key = match v.key {
        Some(k) if valid_key(&k) => k,
        Some(_) => return Err(bad("A field key uses lowercase letters, digits and underscores, starting with a letter")),
        None => slug(&label)?,
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM field_definitions WHERE tenant_id=$1 AND project_id=$2")
        .bind(i.tenant_id)
        .bind(project)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if count >= MAX_FIELDS_PER_PROJECT {
        return Err(bad("A project can have up to 30 custom fields"));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3)",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if taken {
        return Err(err(StatusCode::CONFLICT, "A field with this key already exists"));
    }
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM field_definitions WHERE tenant_id=$1 AND project_id=$2",
    )
    .bind(i.tenant_id)
    .bind(project)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let row: FieldDefinition = sqlx::query_as(
        "INSERT INTO field_definitions(tenant_id,project_id,key,label,field_type,options,required,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING key,label,field_type,options,required,position",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .bind(&label)
    .bind(&v.field_type)
    .bind(&options)
    .bind(v.required.unwrap_or(false))
    .bind(position)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "field_created", "project", project).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

#[utoipa::path(patch, path = "/api/projects/{id}/fields/{key}", tag = "fields", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Field key")), request_body = FieldPatch, responses((status = 200, description = "Updated", body = FieldDefinition), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such field", body = ErrorBody), (status = 409, description = "Issues hold values the new options would remove", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn update_field(
    mut tx: Tx,
    Path((project, key)): Path<(Uuid, String)>,
    Json(v): Json<FieldPatch>,
) -> ApiResult<Json<FieldDefinition>> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let current: Option<FieldDefinition> = sqlx::query_as(
        "SELECT key,label,field_type,options,required,position FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let current = current.ok_or_else(|| err(StatusCode::NOT_FOUND, "Field not found"))?;
    let label = match v.label {
        Some(l) => validate_label(&l)?,
        None => current.label.clone(),
    };
    let options = match (current.field_type.as_str(), v.options) {
        ("select", Some(o)) => {
            let next = validate_options(&o)?;
            // Values that the new options would remove must be cleared first.
            let stranded: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM issues WHERE tenant_id=$1 AND project_id=$2 AND custom_fields ? $3::text AND NOT (custom_fields->>$3::text = ANY($4))",
            )
            .bind(i.tenant_id)
            .bind(project)
            .bind(&key)
            .bind(&next)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_err)?;
            if stranded > 0 {
                return Err(err(
                    StatusCode::CONFLICT,
                    &format!("{stranded} issue(s) hold a value these options would remove"),
                ));
            }
            next
        }
        (_, Some(_)) => return Err(bad("Only select fields take options")),
        (_, None) => current.options.clone(),
    };
    let required = v.required.unwrap_or(current.required);
    sqlx::query("UPDATE field_definitions SET label=$1, options=$2, required=$3 WHERE tenant_id=$4 AND project_id=$5 AND key=$6")
        .bind(&label)
        .bind(&options)
        .bind(required)
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let row: FieldDefinition = sqlx::query_as(
        "SELECT key,label,field_type,options,required,position FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3",
    )
    .bind(i.tenant_id)
    .bind(project)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "field_updated", "project", project).await?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/projects/{id}/fields/{key}", tag = "fields", params(("id" = Uuid, Path, description = "Resource id"), ("key" = String, Path, description = "Field key")), responses((status = 204, description = "Deleted; its values are removed from every issue"), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Project admins only", body = ErrorBody), (status = 404, description = "No such field", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn delete_field(mut tx: Tx, Path((project, key)): Path<(Uuid, String)>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    ensure_project_admin(&mut tx, project).await?;
    let r = sqlx::query("DELETE FROM field_definitions WHERE tenant_id=$1 AND project_id=$2 AND key=$3")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Field not found"));
    }
    // Remove the key from stored values so no issue keeps a value the project no longer defines.
    sqlx::query("UPDATE issues SET custom_fields = custom_fields - $3::text WHERE tenant_id=$1 AND project_id=$2 AND custom_fields ? $3::text")
        .bind(i.tenant_id)
        .bind(project)
        .bind(&key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "field_deleted", "project", project).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/projects/{id}/fields", get(list_fields).post(create_field))
        .route("/api/projects/{id}/fields/{key}", patch(update_field).delete(delete_field))
}
