//! Shared guards, validators and event/outbox writers.
use crate::*;
use serde_json::Value;

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
pub(crate) async fn valid_project(db: &PgPool, i: &Identity, p: Uuid) -> ApiResult<()> {
    let found:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL)")
        .bind(i.tenant_id).bind(p).fetch_one(db).await.map_err(db_err)?;
    if found {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Project not found"))
    }
}
pub(crate) async fn valid_issue(db: &PgPool, i: &Identity, id: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar(
        "SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))
}
pub(crate) async fn valid_page(db: &PgPool, i: &Identity, id: Uuid) -> ApiResult<Uuid> {
    sqlx::query_scalar(
        "SELECT project_id FROM pages WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))
}
pub(crate) async fn log_event(
    db: &PgPool,
    i: &Identity,
    action: &str,
    kind: &str,
    id: Uuid,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4,$5)")
        .bind(i.tenant_id).bind(i.user_id).bind(action).bind(kind).bind(id).execute(db).await.map_err(db_err)?;
    Ok(())
}
pub(crate) async fn log_outbox(
    db: &PgPool,
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
    .execute(db)
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
