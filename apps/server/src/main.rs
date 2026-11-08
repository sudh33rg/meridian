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
mod attachments;
mod auth;
mod billing;
mod collab;
mod config;
mod db;
mod error;
mod jobs;
mod mail;
mod mfa;
mod middleware;
mod openapi;
mod realtime;
mod safe_http;
mod scan;
mod scim;
mod secrets;
mod sso;
mod storage;
#[cfg(test)]
mod tests;
mod webhooks;

pub(crate) use auth::*;
pub(crate) use db::*;
pub(crate) use error::*;

#[derive(Clone)]
pub(crate) struct App {
    pub(crate) db: PgPool,
    pub(crate) cfg: std::sync::Arc<config::Config>,
    pub(crate) limits: std::sync::Arc<middleware::Limits>,
    pub(crate) store: storage::Store,
    pub(crate) live: std::sync::Arc<realtime::Live>,
    pub(crate) rooms: std::sync::Arc<collab::Rooms>,
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
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn build_router(db: PgPool, cors: CorsLayer) -> Router {
    let cfg = std::sync::Arc::new(config::Config::from_env());
    let store = storage::from_config(&cfg).expect("object storage configuration is valid");
    build_router_with(db, cors, cfg, store)
}

pub(crate) fn build_router_with(
    db: PgPool,
    cors: CorsLayer,
    cfg: std::sync::Arc<config::Config>,
    store: storage::Store,
) -> Router {
    let limits = std::sync::Arc::new(middleware::Limits::new(&cfg));
    if tokio::runtime::Handle::try_current().is_ok() {
        let weak = std::sync::Arc::downgrade(&limits);
        tokio::spawn(async move {
            while let Some(l) = weak.upgrade() {
                l.gc();
                drop(l);
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            }
        });
    }
    let live = std::sync::Arc::new(realtime::Live::new());
    if tokio::runtime::Handle::try_current().is_ok() {
        realtime::spawn_listener(db.clone(), live.clone());
    }
    let state = App {
        db,
        cfg,
        limits,
        store,
        live,
        rooms: std::sync::Arc::new(collab::Rooms::default()),
    };
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(readiness))
        .route("/api/openapi.json", get(openapi::openapi_json))
        .merge(auth::routes())
        .merge(api::work::routes())
        .merge(api::org::routes())
        .merge(api::planning::routes())
        .merge(api::agile::routes())
        .merge(api::issue_depth::routes())
        .merge(api::history::routes())
        .merge(api::reports::routes())
        .merge(api::roadmap::routes())
        .merge(api::integrations::routes())
        .merge(api::settings::routes())
        .merge(api::releases::routes())
        .merge(api::issues::routes())
        .merge(api::personal::routes())
        .merge(api::statuses::routes())
        .merge(api::fields::routes())
        .merge(api::query::routes())
        .merge(api::transitions::routes())
        .merge(api::csv_import::routes())
        .merge(api::knowledge::routes())
        .merge(api::collab::routes())
        .merge(api::admin::routes())
        .merge(api::security::routes())
        .merge(api::access::routes())
        .merge(mfa::routes())
        .merge(billing::routes())
        .merge(sso::routes())
        .merge(scim::routes())
        .merge(webhooks::routes())
        .merge(attachments::routes())
        .merge(realtime::routes())
        .merge(collab::routes())
        .layer(axum::middleware::from_fn(db::tx_layer))
        .layer(DefaultBodyLimit::max(1_048_576))
        .layer(cors)
        .layer(axum::middleware::from_fn(middleware::track))
        .layer(axum::middleware::from_fn_with_state(state.clone(), middleware::rate_limit))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::security_headers,
        ))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_secs(30),
        ))
        .layer(
            TraceLayer::new_for_http().make_span_with(|req: &axum::http::Request<_>| {
                let id = req
                    .headers()
                    .get("x-request-id")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("-");
                tracing::info_span!("http", method=%req.method(), path=%req.uri().path(), request_id=%id)
            }),
        )
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
        .layer(tower_http::request_id::SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if env::args().any(|a| a == "--openapi") {
        use utoipa::OpenApi;
        println!("{}", openapi::ApiDoc::openapi().to_pretty_json()?);
        return Ok(());
    }
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    if env::var("LOG_FORMAT").as_deref() == Ok("json") {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
    // Prometheus scrape endpoint on a separate, loopback-by-default port (not part of the public API).
    match env::var("METRICS_ADDR").as_deref() {
        Ok("off") => {}
        other => {
            let addr: SocketAddr = other.unwrap_or("127.0.0.1:9090").parse()?;
            if let Err(e) = metrics_exporter_prometheus::PrometheusBuilder::new()
                .with_http_listener(addr)
                .install()
            {
                tracing::warn!(error=%e, "metrics endpoint disabled");
            }
        }
    }
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
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-csrf-token"),
            axum::http::HeaderName::from_static("x-auth-mode"),
            header::IF_MATCH,
            axum::http::HeaderName::from_static("idempotency-key"),
        ])
        .expose_headers([
            header::ETAG,
            axum::http::HeaderName::from_static("x-next-cursor"),
            axum::http::HeaderName::from_static("idempotent-replayed"),
        ])
        .allow_credentials(true);
    let cfg = std::sync::Arc::new(config::Config::from_env());
    let mailer = std::sync::Arc::new(mail::Mailer::from_config(&cfg));
    let store = storage::from_config(&cfg)?;
    jobs::spawn_worker(db.clone(), cfg.clone(), mailer, store.clone());
    jobs::spawn_maintenance(db.clone());
    webhooks::spawn_dispatcher(db.clone(), cfg.clone());
    let sampler = db.clone();
    tokio::spawn(async move {
        loop {
            metrics::gauge!("meridian_db_pool_size").set(sampler.size() as f64);
            metrics::gauge!("meridian_db_pool_idle").set(sampler.num_idle() as f64);
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
    });
    let app = build_router_with(db, cors, cfg, store);
    let bind = env::var("BIND_ADDRESS")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse::<SocketAddr>()?;
    tracing::info!(address=%bind,"Meridian API ready");
    axum::serve(
        tokio::net::TcpListener::bind(bind).await?,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
