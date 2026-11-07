//! Meridian API entry point: shared state, router assembly and process startup.
#![allow(unused_imports)]
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{DefaultBodyLimit, FromRequestParts, Path, State},
    http::{header, request::Parts, HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection, PgPool, Postgres, Transaction};
use std::{env, net::SocketAddr};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

mod api;
mod auth;
mod db;
mod error;
mod openapi;
#[cfg(test)]
mod tests;

pub(crate) use auth::*;
pub(crate) use db::*;
pub(crate) use error::*;

#[derive(Clone)]
pub(crate) struct App {
    pub(crate) db: PgPool,
}

async fn health() -> &'static str {
    "ok"
}
async fn readiness(State(app): State<App>) -> ApiResult<Json<serde_json::Value>> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&app.db)
        .await
        .map_err(db_err)?;
    Ok(Json(serde_json::json!({"status":"ready","database":"ok"})))
}

/// Assemble every route with the shared middleware. Used by `main` and by tests.
pub(crate) fn build_router(db: PgPool, cors: CorsLayer) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(readiness))
        .route("/api/openapi.json", get(openapi::openapi_json))
        .merge(auth::routes())
        .merge(api::work::routes())
        .merge(api::org::routes())
        .merge(api::planning::routes())
        .merge(api::issues::routes())
        .merge(api::knowledge::routes())
        .merge(api::collab::routes())
        .merge(api::admin::routes())
        .layer(axum::middleware::from_fn(db::tx_layer))
        .layer(DefaultBodyLimit::max(1_048_576))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(App { db })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if env::args().any(|a| a == "--openapi") {
        use utoipa::OpenApi;
        println!("{}", openapi::ApiDoc::openapi().to_pretty_json()?);
        return Ok(());
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let db = PgPool::connect(&env::var("DATABASE_URL")?).await?;
    sqlx::migrate!().run(&db).await?;
    db::assert_isolation(&db).await?;
    let origin = env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".into());
    let cors = CorsLayer::new()
        .allow_origin(origin.parse::<axum::http::HeaderValue>()?)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    let app = build_router(db, cors);
    let bind = env::var("BIND_ADDRESS")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse::<SocketAddr>()?;
    tracing::info!(address=%bind,"Meridian API ready");
    axum::serve(tokio::net::TcpListener::bind(bind).await?, app).await?;
    Ok(())
}
