//! Workspace settings (Phase J5): time zone, working days, week start and the default sprint length.
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
    /// Interface language: `en` or `es` (Phase K5). Dates and numbers follow it.
    pub(crate) locale: String,
}

const DEFAULTS: (&str, &[i16], i16, i32) = ("UTC", &[1, 2, 3, 4, 5], 1, 14);
/// Languages the interface ships in. A second locale is added here and in the web catalogue.
pub(crate) const LOCALES: [&str; 2] = ["en", "es"];

#[utoipa::path(get, path = "/api/workspace/settings", tag = "org", responses((status = 200, description = "Success", body = WorkspaceSettings), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn get_settings(mut tx: Tx) -> ApiResult<Json<WorkspaceSettings>> {
    let i = tx.identity.clone();
    let row: Option<WorkspaceSettings> = sqlx::query_as(
        "SELECT timezone, working_days, week_start, default_sprint_days, locale FROM workspace_settings WHERE tenant_id=$1",
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
    if let Some(l) = &v.locale {
        if !LOCALES.contains(&l.as_str()) {
            return Err(bad("locale must be en or es"));
        }
    }
    let row: WorkspaceSettings = sqlx::query_as(
        "INSERT INTO workspace_settings(tenant_id,timezone,working_days,week_start,default_sprint_days,locale) VALUES($1,$2,$3,$4,$5,COALESCE($6,'en')) \
         ON CONFLICT (tenant_id) DO UPDATE SET timezone=EXCLUDED.timezone, working_days=EXCLUDED.working_days, \
         week_start=EXCLUDED.week_start, default_sprint_days=EXCLUDED.default_sprint_days, \
         locale=COALESCE($6, workspace_settings.locale), updated_at=now() \
         RETURNING timezone, working_days, week_start, default_sprint_days, locale",
    )
    .bind(i.tenant_id)
    .bind(tz)
    .bind(days)
    .bind(v.week_start)
    .bind(v.default_sprint_days)
    .bind(v.locale.clone())
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    log_event(&mut tx, &i, "updated", "workspace", i.tenant_id).await?;
    Ok(Json(row))
}

pub(crate) fn routes() -> axum::Router<App> {
    axum::Router::new().route("/api/workspace/settings", get(get_settings).put(put_settings))
}
