//! Request-scoped, tenant-bound database transactions.
//!
//! Two kinds of database access exist, on purpose:
//! * **System** (`App.db`, the owner role): sign-in, session lookup, cross-workspace flows and
//!   background jobs. These are the only places allowed to see more than one tenant, and each
//!   query there is scoped explicitly.
//! * **Request** (`Tx`): one transaction per authenticated request, running as `meridian_app`
//!   with `app.tenant_id` set, so PostgreSQL row level security confines it to the caller's
//!   tenant. A middleware commits it when the response is a success and rolls it back otherwise,
//!   which also makes entity + audit + event + outbox writes atomic.
use crate::*;
use axum::{
    extract::Request,
    middleware::Next,
    response::{IntoResponse, Response},
};
use sqlx::PgConnection;
use std::{
    ops::{Deref, DerefMut},
    sync::Arc,
};
use tokio::sync::{Mutex, OwnedMutexGuard};

type Inner = Option<Transaction<'static, Postgres>>;

#[derive(Clone, Default)]
pub(crate) struct TxSlot(Arc<Mutex<Inner>>);

/// The caller's identity plus their tenant-bound transaction. Declaring `mut tx: Tx` in a handler
/// authenticates the request and starts the transaction; use `&mut *tx` as the executor.
pub(crate) struct Tx {
    guard: OwnedMutexGuard<Inner>,
    pub(crate) identity: Identity,
    pub(crate) method: axum::http::Method,
    /// SHA-256 of the session token that authenticated this request.
    pub(crate) token_hash: String,
    pub(crate) cfg: Arc<crate::config::Config>,
    pub(crate) store: crate::storage::Store,
}

impl Deref for Tx {
    type Target = PgConnection;
    fn deref(&self) -> &PgConnection {
        self.guard.as_ref().expect("transaction is open")
    }
}
impl DerefMut for Tx {
    fn deref_mut(&mut self) -> &mut PgConnection {
        self.guard.as_mut().expect("transaction is open")
    }
}

impl FromRequestParts<App> for Tx {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self, ApiError> {
        let (identity, token_hash) = authenticate(parts, state).await?;
        let slot = parts
            .extensions
            .get::<TxSlot>()
            .cloned()
            .ok_or_else(|| ApiError::Internal("Transaction layer missing".into()))?;
        let mut guard = slot.0.lock_owned().await;
        if guard.is_none() {
            let mut t = state.db.begin().await.map_err(db_err)?;
            sqlx::query("SET LOCAL ROLE meridian_app")
                .execute(&mut *t)
                .await
                .map_err(db_err)?;
            sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
                .bind(identity.tenant_id.to_string())
                .execute(&mut *t)
                .await
                .map_err(db_err)?;
            // The caller's id and role feed the issue security policy (migration 0037).
            sqlx::query("SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true)")
                .bind(identity.user_id.to_string())
                .bind(identity.role.as_str())
                .execute(&mut *t)
                .await
                .map_err(db_err)?;
            *guard = Some(t);
        }
        Ok(Tx {
            guard,
            identity,
            method: parts.method.clone(),
            token_hash,
            cfg: state.cfg.clone(),
            store: state.store.clone(),
        })
    }
}

/// Commit the request transaction on success, roll it back on any error response.
pub(crate) async fn tx_layer(mut req: Request, next: Next) -> Response {
    let slot = TxSlot::default();
    req.extensions_mut().insert(slot.clone());
    let res = next.run(req).await;
    let tx = slot.0.lock().await.take();
    match tx {
        Some(t) if res.status().is_success() => match t.commit().await {
            Ok(()) => res,
            Err(e) => db_err(e).into_response(),
        },
        Some(t) => {
            let _ = t.rollback().await;
            res
        }
        None => res,
    }
}

/// Refuse to start unless isolation is actually in force: every table with a `tenant_id` column
/// must have row level security enabled, and the connecting role must be able to become
/// `meridian_app`.
pub(crate) async fn assert_isolation(db: &PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let missing: Vec<String> = sqlx::query_scalar(
        "SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace \
         JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped \
         WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity",
    )
    .fetch_all(db)
    .await?;
    if !missing.is_empty() {
        return Err(format!(
            "row level security is not enabled on tenant tables: {}",
            missing.join(", ")
        )
        .into());
    }
    let mut t = db.begin().await?;
    sqlx::query("SET LOCAL ROLE meridian_app")
        .execute(&mut *t)
        .await
        .map_err(|e| {
            format!("cannot SET ROLE meridian_app (grant it to the API's database user): {e}")
        })?;
    let seen: i64 = sqlx::query_scalar("SELECT count(*) FROM projects")
        .fetch_one(&mut *t)
        .await?;
    t.rollback().await?;
    if seen != 0 {
        return Err(
            "isolation check failed: a request transaction without a tenant saw rows".into(),
        );
    }
    Ok(())
}

/// A short transaction bound to one tenant and the restricted role, for background readers that
/// have an identity but no request (the change feed). The caller must roll it back or commit it.
pub(crate) async fn tenant_tx(
    db: &PgPool,
    tenant: Uuid,
) -> ApiResult<Transaction<'static, Postgres>> {
    let mut t = db.begin().await.map_err(db_err)?;
    sqlx::query("SET LOCAL ROLE meridian_app")
        .execute(&mut *t)
        .await
        .map_err(db_err)?;
    sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
        .bind(tenant.to_string())
        .execute(&mut *t)
        .await
        .map_err(db_err)?;
    Ok(t)
}
