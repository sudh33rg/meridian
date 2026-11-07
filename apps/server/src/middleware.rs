//! Cross-cutting HTTP concerns: per-client rate limits, security headers and request metrics.
use crate::*;
use axum::{
    extract::{ConnectInfo, MatchedPath, Request, State},
    http::HeaderValue,
    middleware::Next,
    response::{IntoResponse, Response},
};
use governor::{clock::DefaultClock, state::keyed::DefaultKeyedStateStore, Quota, RateLimiter};
use std::{num::NonZeroU32, time::Instant};

type Keyed = RateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>;

/// In-memory, per-process limiters keyed by client address. They bound abuse of one instance;
/// a shared limit across replicas belongs at the ingress (see docs/OPERATIONS.md).
pub(crate) struct Limits {
    global: Keyed,
    auth: Keyed,
}

impl Limits {
    pub(crate) fn new(cfg: &crate::config::Config) -> Limits {
        let per_min = |n: u32| {
            Quota::per_minute(NonZeroU32::new(n.max(1)).expect("non-zero"))
                .allow_burst(NonZeroU32::new((n / 4).max(10)).expect("non-zero"))
        };
        Limits {
            global: RateLimiter::keyed(per_min(cfg.global_per_min)),
            auth: RateLimiter::keyed(per_min(cfg.auth_per_min)),
        }
    }
    /// Forget idle keys so the maps do not grow without bound.
    pub(crate) fn gc(&self) {
        self.global.retain_recent();
        self.auth.retain_recent();
        self.global.shrink_to_fit();
        self.auth.shrink_to_fit();
    }
}

fn client_key(req: &Request, trust_proxy: bool) -> String {
    if trust_proxy {
        if let Some(ip) = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
        {
            return ip.trim().to_string();
        }
    }
    req.extensions()
        .get::<ConnectInfo<std::net::SocketAddr>>()
        .map(|c| c.0.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
}

pub(crate) async fn rate_limit(State(app): State<App>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if path == "/health" || path == "/ready" {
        return next.run(req).await;
    }
    let key = client_key(&req, app.cfg.trust_proxy);
    let limited = app.limits.global.check_key(&key).is_err()
        || (path.starts_with("/api/auth/") && app.limits.auth.check_key(&key).is_err());
    if limited {
        metrics::counter!("meridian_rate_limited_total").increment(1);
        let mut res =
            ApiError::TooManyRequests("Too many requests; slow down and retry shortly".into())
                .into_response();
        res.headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("15"));
        return res;
    }
    next.run(req).await
}

pub(crate) async fn security_headers(State(app): State<App>, req: Request, next: Next) -> Response {
    let api = req.uri().path().starts_with("/api/");
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    for (k, v) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        ("cross-origin-resource-policy", "same-origin"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=()",
        ),
    ] {
        h.entry(k).or_insert(HeaderValue::from_static(v));
    }
    if api {
        h.entry(header::CACHE_CONTROL)
            .or_insert(HeaderValue::from_static("no-store"));
    }
    if app.cfg.cookie_secure {
        h.entry(header::STRICT_TRANSPORT_SECURITY)
            .or_insert(HeaderValue::from_static(
                "max-age=31536000; includeSubDomains",
            ));
    }
    res
}

pub(crate) async fn track(req: Request, next: Next) -> Response {
    let method = req.method().to_string();
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "unmatched".into());
    let started = Instant::now();
    metrics::gauge!("meridian_http_in_flight").increment(1.0);
    let res = next.run(req).await;
    metrics::gauge!("meridian_http_in_flight").decrement(1.0);
    let status = res.status().as_u16().to_string();
    metrics::histogram!("meridian_http_request_seconds", "method" => method.clone(), "route" => route.clone())
        .record(started.elapsed().as_secs_f64());
    metrics::counter!("meridian_http_requests_total", "method" => method, "route" => route, "status" => status)
        .increment(1);
    res
}
