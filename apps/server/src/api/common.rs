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
/// Caller's effective level on a project: 0 none, 1 viewer, 2 editor, 3 admin (`None`: no such
/// project in this workspace). Delegates to the SQL function so lists and checks agree.
pub(crate) async fn project_level(
    db: &mut PgConnection,
    i: &Identity,
    project: Uuid,
) -> ApiResult<Option<i32>> {
    sqlx::query_scalar("SELECT project_access($1,$2,$3)")
        .bind(project)
        .bind(i.user_id)
        .bind(&i.role)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)
}
/// Require at least viewer access for safe methods and editor access for anything that changes
/// data. A project the caller cannot see is reported as not found, not as forbidden.
pub(crate) async fn ensure_access(tx: &mut Tx, project: Uuid) -> ApiResult<()> {
    let i = tx.identity.clone();
    let need = if matches!(
        tx.method,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        1
    } else {
        2
    };
    match project_level(tx, &i, project).await? {
        Some(l) if l >= need => Ok(()),
        Some(l) if l >= 1 => Err(forbidden()),
        _ => Err(err(StatusCode::NOT_FOUND, "Project not found")),
    }
}
/// Require project admin (grant management).
pub(crate) async fn ensure_project_admin(tx: &mut Tx, project: Uuid) -> ApiResult<()> {
    let i = tx.identity.clone();
    match project_level(tx, &i, project).await? {
        Some(3) => Ok(()),
        Some(l) if l >= 1 => Err(forbidden()),
        _ => Err(err(StatusCode::NOT_FOUND, "Project not found")),
    }
}
pub(crate) async fn valid_project(tx: &mut Tx, i: &Identity, p: Uuid) -> ApiResult<()> {
    let found:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL)")
        .bind(i.tenant_id).bind(p).fetch_one(&mut **tx).await.map_err(db_err)?;
    if !found {
        return Err(err(StatusCode::NOT_FOUND, "Project not found"));
    }
    ensure_access(tx, p).await
}
pub(crate) async fn valid_issue(tx: &mut Tx, i: &Identity, id: Uuid) -> ApiResult<Uuid> {
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM issues WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Issue not found"))?;
    ensure_access(tx, project).await?;
    Ok(project)
}
pub(crate) async fn valid_page(tx: &mut Tx, i: &Identity, id: Uuid) -> ApiResult<Uuid> {
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM pages WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL",
    )
    .bind(i.tenant_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Page not found"))?;
    ensure_page_access(tx, id).await?;
    Ok(project)
}
/// Page-level access (project access + page restrictions inherited down the tree): viewer for
/// safe methods, editor for writes. Hidden pages report as not found.
pub(crate) async fn ensure_page_access(tx: &mut Tx, page: Uuid) -> ApiResult<()> {
    let i = tx.identity.clone();
    let need = if matches!(
        tx.method,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        1
    } else {
        2
    };
    let level: Option<i32> = sqlx::query_scalar("SELECT page_access($1,$2,$3)")
        .bind(page)
        .bind(i.user_id)
        .bind(&i.role)
        .fetch_one(&mut **tx)
        .await
        .map_err(db_err)?;
    match level {
        Some(l) if l >= need => Ok(()),
        Some(l) if l >= 1 => Err(forbidden()),
        _ => Err(err(StatusCode::NOT_FOUND, "Page not found")),
    }
}
/// Page management (restrictions): editor or better on the page.
pub(crate) async fn ensure_page_editor(tx: &mut Tx, page: Uuid) -> ApiResult<()> {
    let i = tx.identity.clone();
    let level: Option<i32> = sqlx::query_scalar("SELECT page_access($1,$2,$3)")
        .bind(page)
        .bind(i.user_id)
        .bind(&i.role)
        .fetch_one(&mut **tx)
        .await
        .map_err(db_err)?;
    match level {
        Some(l) if l >= 2 => Ok(()),
        Some(l) if l >= 1 => Err(forbidden()),
        _ => Err(err(StatusCode::NOT_FOUND, "Page not found")),
    }
}
/// Access check for an entity addressed by id where archived rows are still addressable.
pub(crate) async fn ensure_entity_access(
    tx: &mut Tx,
    table: &'static str,
    id: Uuid,
) -> ApiResult<()> {
    let i = tx.identity.clone();
    let sql = format!("SELECT project_id FROM {table} WHERE tenant_id=$1 AND id=$2");
    let project: Uuid = sqlx::query_scalar(&sql)
        .bind(i.tenant_id)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_err)?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Not found"))?;
    ensure_access(tx, project).await
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
    // Queue webhook deliveries for every enabled endpoint subscribed to this event, in the same
    // transaction, so a delivery exists if and only if the change committed.
    let event_type = format!("{entity_type}.{op}");
    let body = json!({
        "type": event_type, "sync_id": sync_id, "tenant_id": tenant, "occurred_at": Utc::now(),
        "data": {"entity_type": entity_type, "entity_id": entity_id, "op": op, "actor_id": actor},
    });
    sqlx::query("INSERT INTO webhook_deliveries(tenant_id,webhook_id,event_sync_id,event_type,payload) SELECT $1,w.id,$2,$3,$4 FROM webhooks w WHERE w.tenant_id=$1 AND w.enabled AND (cardinality(w.events)=0 OR $3=ANY(w.events) OR (split_part($3,'.',1)||'.*')=ANY(w.events) OR '*'=ANY(w.events))")
        .bind(tenant).bind(sync_id).bind(&event_type).bind(body)
        .execute(&mut *db).await.map_err(db_err)?;
    Ok(sync_id)
}
/// Same as `log_event` for flows that run on the system connection (SSO, SCIM, billing): they have
/// no request transaction, so the caller passes the tenant and actor explicitly.
pub(crate) async fn log_event_system(
    db: &mut PgConnection,
    tenant: Uuid,
    actor: Uuid,
    action: &str,
    kind: &str,
    id: Uuid,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4,$5)")
        .bind(tenant).bind(actor).bind(action).bind(kind).bind(id).execute(&mut *db).await.map_err(db_err)?;
    emit_event(db, tenant, Some(actor), kind, id, action, json!({})).await?;
    Ok(())
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
