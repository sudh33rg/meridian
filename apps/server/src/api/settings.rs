//! Workspace settings: time zone, working days, week start and the default sprint length.
//! Members read them; admins change them.
use crate::api::common::*;
use crate::*;
use axum::routing::get;

#[derive(Serialize, FromRow, utoipa::ToSchema)]
pub(crate) struct WorkspaceSettings {
    /// An IANA name such as `Europe/London`, or `UTC`.
    pub(crate) timezone: String,
    /// Working days, 1 (Monday) to 7 (Sunday).
    pub(crate) working_days: Vec<i16>,
    /// First day of the week, 0 (Sunday) to 6 (Saturday).
    pub(crate) week_start: i16,
    pub(crate) default_sprint_days: i32,
    /// Interface language: `en` or `es`. Dates and numbers follow it.
    pub(crate) locale: String,
    /// Days a trashed issue waits before it is purged, 7 to 365. Audit records are kept.
    pub(crate) trash_retention_days: i32,
    /// Display name shown in place of the workspace name. Null when not set.
    pub(crate) brand_name: Option<String>,
    /// Accent colour as `#rrggbb`. Null when not set.
    pub(crate) brand_color: Option<String>,
    pub(crate) attachment_retention_days: Option<i32>,
    pub(crate) custom_domain: Option<String>,
    pub(crate) logo_url: Option<String>,
}

const DEFAULTS: (&str, &[i16], i16, i32) = ("UTC", &[1, 2, 3, 4, 5], 1, 14);
/// Languages the interface ships in. A second locale is added here and in the web catalogue.
pub(crate) const LOCALES: [&str; 2] = ["en", "es"];

#[utoipa::path(get, path = "/api/workspace/settings", tag = "org", responses((status = 200, description = "Success", body = WorkspaceSettings), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_settings(mut tx: Tx) -> ApiResult<Json<WorkspaceSettings>> {
    let i = tx.identity.clone();
    let row: Option<WorkspaceSettings> = sqlx::query_as(
        "SELECT timezone, working_days, week_start, default_sprint_days, locale, trash_retention_days, brand_name, brand_color, attachment_retention_days, custom_domain, logo_url FROM workspace_settings WHERE tenant_id=$1",
    )
    .bind(i.tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    Ok(Json(row.unwrap_or_else(|| WorkspaceSettings {
        timezone: DEFAULTS.0.into(),
        working_days: DEFAULTS.1.to_vec(),
        week_start: DEFAULTS.2,
        default_sprint_days: DEFAULTS.3,
        locale: "en".into(),
        trash_retention_days: 30,
        brand_name: None,
        brand_color: None,
        attachment_retention_days: Some(0),
        custom_domain: None,
        logo_url: None,
    })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WorkspaceSettingsInput {
    pub(crate) timezone: String,
    pub(crate) working_days: Vec<i16>,
    pub(crate) week_start: i16,
    pub(crate) default_sprint_days: i32,
    /// `en` or `es`. Omit to keep the current language.
    pub(crate) locale: Option<String>,
    /// Days a trashed issue waits before purge, 7 to 365. Omit to keep the current setting.
    pub(crate) trash_retention_days: Option<i32>,
    /// Display name; an empty string clears it. Omit to keep it.
    pub(crate) brand_name: Option<String>,
    /// Accent colour as `#rrggbb`; an empty string clears it. Omit to keep it.
    pub(crate) brand_color: Option<String>,
    pub(crate) attachment_retention_days: Option<i32>,
    pub(crate) custom_domain: Option<String>,
    pub(crate) logo_url: Option<String>,
}

#[utoipa::path(put, path = "/api/workspace/settings", tag = "org", request_body = WorkspaceSettingsInput, responses((status = 200, description = "Success", body = WorkspaceSettings), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn put_settings(mut tx: Tx, Json(v): Json<WorkspaceSettingsInput>) -> ApiResult<Json<WorkspaceSettings>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let tz = v.timezone.trim().to_string();
    let tz_ok = !tz.is_empty()
        && tz.len() <= 64
        && tz.split('/').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || "_+-".contains(c)))
        && tz.chars().next().is_some_and(|c| c.is_ascii_alphabetic());
    if !tz_ok {
        return Err(bad("Time zone must look like Europe/London or UTC"));
    }
    let mut days = v.working_days.clone();
    days.sort_unstable();
    days.dedup();
    if days.is_empty() || days.iter().any(|d| !(1..=7).contains(d)) {
        return Err(bad("Working days are numbers from 1 (Monday) to 7 (Sunday)"));
    }
    if !(0..=6).contains(&v.week_start) {
        return Err(bad("week_start is 0 (Sunday) to 6 (Saturday)"));
    }
    if !(1..=60).contains(&v.default_sprint_days) {
        return Err(bad("default_sprint_days must be between 1 and 60"));
    }
    if let Some(days) = v.trash_retention_days {
        if !(7..=365).contains(&days) {
            return Err(bad("trash_retention_days must be between 7 and 365"));
        }
    }
    if let Some(name) = v.brand_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        if name.chars().count() > 60 {
            return Err(bad("The brand name is at most 60 characters"));
        }
    }
    if let Some(color) = v.brand_color.as_deref().filter(|c| !c.is_empty()) {
        let hex = color.len() == 7
            && color.starts_with('#')
            && color[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !hex {
            return Err(bad("The brand colour is #rrggbb"));
        }
    }
    if let Some(l) = &v.locale {
        if !LOCALES.contains(&l.as_str()) {
            return Err(bad("locale must be en or es"));
        }
    }
    let row: WorkspaceSettings = sqlx::query_as(
        "INSERT INTO workspace_settings(tenant_id,timezone,working_days,week_start,default_sprint_days,locale,trash_retention_days,brand_name,brand_color,attachment_retention_days,custom_domain,logo_url) \
         VALUES($1,$2,$3,$4,$5,COALESCE($6,'en'),COALESCE($7,30),NULLIF($8,''),NULLIF($9,''),COALESCE($10, 0),NULLIF($11,''),NULLIF($12,'')) \
         ON CONFLICT (tenant_id) DO UPDATE SET timezone=EXCLUDED.timezone, working_days=EXCLUDED.working_days, \
         week_start=EXCLUDED.week_start, default_sprint_days=EXCLUDED.default_sprint_days, \
         locale=COALESCE($6, workspace_settings.locale), trash_retention_days=COALESCE($7, workspace_settings.trash_retention_days), \
         brand_name=CASE WHEN $8::text IS NULL THEN workspace_settings.brand_name ELSE NULLIF($8,'') END, \
         brand_color=CASE WHEN $9::text IS NULL THEN workspace_settings.brand_color ELSE NULLIF($9,'') END, \
         attachment_retention_days=COALESCE($10, workspace_settings.attachment_retention_days), \
         custom_domain=CASE WHEN $11::text IS NULL THEN workspace_settings.custom_domain ELSE NULLIF($11,'') END, \
         logo_url=CASE WHEN $12::text IS NULL THEN workspace_settings.logo_url ELSE NULLIF($12,'') END, \
         updated_at=now() \
         RETURNING timezone, working_days, week_start, default_sprint_days, locale, trash_retention_days, brand_name, brand_color, attachment_retention_days, custom_domain, logo_url",
    )
    .bind(i.tenant_id)
    .bind(tz)
    .bind(days)
    .bind(v.week_start)
    .bind(v.default_sprint_days)
    .bind(v.locale.clone())
    .bind(v.trash_retention_days)
    .bind(v.brand_name.clone())
    .bind(v.brand_color.clone())
    .bind(v.attachment_retention_days)
    .bind(v.custom_domain.clone())
    .bind(v.logo_url.clone())
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "updated", "workspace", i.tenant_id).await?;
    Ok(Json(row))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new().route("/api/workspace/settings", get(get_settings).put(put_settings))
}
