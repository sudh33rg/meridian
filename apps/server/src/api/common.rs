//! Shared guards, validators and event/outbox writers.
use crate::*;
use serde_json::{json, Value};

pub(crate) fn require_editor(i: &Identity) -> ApiResult<()> {
    if can_edit(i) {
        Ok(())
    } else {
        Err(forbidden())
    }
}
pub(crate) fn require_admin(i: &Identity) -> ApiResult<()> {
    if i.role == "admin" || i.role == "owner" {
        Ok(())
    } else {
        Err(forbidden())
    }
}
pub(crate) fn validate_title(s: &str) -> ApiResult<()> {
    if s.trim().is_empty() || s.len() > 250 {
        Err(bad("Title must be between 1 and 250 characters"))
    } else {
        Ok(())
    }
}
pub(crate) fn validate_body(s: &str) -> ApiResult<()> {
    if s.trim().is_empty() || s.len() > 100_000 {
        Err(bad("Text must be between 1 and 100000 characters"))
    } else {
        Ok(())
    }
}
pub(crate) async fn valid_project(db: &mut PgConnection, i: &Identity, p: Uuid) -> ApiResult<()> {
    let found:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL)")
        .bind(i.tenant_id).bind(p).fetch_one(&mut *db).await.map_err(db_err)?;
    if found {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Project not found"))
    }
}
pub(crate) async fn valid_issue(db: &mut PgConnection, i: &Identity, id: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar(
        "SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))
}
pub(crate) async fn valid_page(db: &mut PgConnection, i: &Identity, id: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar(
        "SELECT project_id FROM pages WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))
}
/// Append a change to the tenant's event log and return its `sync_id`. The id comes from a
/// per-tenant counter row, so ids are gap-free and ordered by commit within a tenant (the row
/// lock is held until the surrounding request transaction ends).
pub(crate) async fn emit_event(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Option<Uuid>,
    entity_type: &str,
    entity_id: Uuid,
    op: &str,
    payload: Value,
) -> ApiResult<i64> {
    let sync_id: i64 = sqlx::query_scalar(
        "INSERT INTO tenant_counters(tenant_id,last_sync_id) VALUES($1,1) \
         ON CONFLICT (tenant_id) DO UPDATE SET last_sync_id=tenant_counters.last_sync_id+1 \
         RETURNING last_sync_id",
    )
    .bind(tenant)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    sqlx::query("INSERT INTO events(tenant_id,sync_id,entity_type,entity_id,op,actor_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(tenant).bind(sync_id).bind(entity_type).bind(entity_id).bind(op).bind(actor).bind(payload)
        .execute(&mut *db).await.map_err(db_err)?;
    Ok(sync_id)
}
/// Audit row + event-log row, written inside the caller's transaction (so atomic with the change).
pub(crate) async fn log_event(
    db: &mut PgConnection,
    i: &Identity,
    action: &str,
    kind: &str,
    id: Uuid,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4,$5)")
        .bind(i.tenant_id).bind(i.user_id).bind(action).bind(kind).bind(id).execute(&mut *db).await.map_err(db_err)?;
    emit_event(
        db,
        i.tenant_id,
        Some(i.user_id),
        kind,
        id,
        action,
        json!({}),
    )
    .await?;
    Ok(())
}
pub(crate) async fn log_outbox(
    db: &mut PgConnection,
    tenant: Uuid,
    event: &str,
    id: Uuid,
    payload: Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO outbox_events(tenant_id,event_type,entity_id,payload) VALUES($1,$2,$3,$4)",
    )
    .bind(tenant)
    .bind(event)
    .bind(id)
    .bind(payload)
    .execute(&mut *db)
    .await
    .map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_blank_titles() {
        assert!(validate_title("").is_err());
        assert!(validate_title(" A ").is_ok());
    }
    #[test]
    fn rejects_empty_comments() {
        assert!(validate_body("  ").is_err());
    }
    #[test]
    fn role_permissions() {
        let make = |role: &str| Identity {
            tenant_id: Uuid::nil(),
            user_id: Uuid::nil(),
            role: role.into(),
        };
        assert!(require_admin(&make("viewer")).is_err());
        assert!(require_admin(&make("admin")).is_ok());
        assert!(require_editor(&make("member")).is_ok());
        assert!(require_editor(&make("viewer")).is_err());
    }
}
