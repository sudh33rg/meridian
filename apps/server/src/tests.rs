//! HTTP-level integration tests. They drive the real router (including the `Identity`
//! extractor and error mapping). Set `DATABASE_URL_TEST` to a disposable PostgreSQL database;
//! when `CI` is set a missing database is a hard failure rather than a silent skip.
use super::*;
use axum::{
    body::{to_bytes, Body},
    http::{Method, Request},
};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn test_router() -> Option<Router> {
    let url = match env::var("DATABASE_URL_TEST") {
        Ok(u) => u,
        Err(_) => {
            assert!(
                env::var("CI").is_err(),
                "DATABASE_URL_TEST must be set in CI"
            );
            eprintln!("skipping: DATABASE_URL_TEST not set");
            return None;
        }
    };
    let db = PgPool::connect(&url).await.expect("test postgres");
    sqlx::migrate!().run(&db).await.expect("schema migrations");
    Some(build_router(db, CorsLayer::new()))
}

async fn call(
    app: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let body = match body {
        Some(v) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(v.to_string())
        }
        None => Body::empty(),
    };
    let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn signup(app: &Router, tag: &str) -> String {
    let u = Uuid::new_v4().simple().to_string();
    let (s, v) = call(
        app,
        Method::POST,
        "/api/auth/signup",
        None,
        Some(json!({
            "organization": format!("Org {tag}"), "slug": format!("{tag}{}", &u[..12]),
            "name": format!("Owner {tag}"), "email": format!("{tag}{u}@test.example"),
            "password": "correct horse battery staple"
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn unauthenticated_and_invalid_tokens_get_typed_401() {
    let Some(app) = test_router().await else {
        return;
    };
    for token in [None, Some("short"), Some(&"0".repeat(64)[..])] {
        let (s, v) = call(&app, Method::GET, "/api/projects", token, None).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
        assert_eq!(v["code"], "unauthorized");
        assert!(v["error"].is_string());
    }
}

#[tokio::test]
async fn tenant_boundary_is_enforced_over_http() {
    let Some(app) = test_router().await else {
        return;
    };
    let a = signup(&app, "ta").await;
    let b = signup(&app, "tb").await;
    let (s, project) = call(
        &app,
        Method::POST,
        "/api/projects",
        Some(&b),
        Some(json!({"name": "Private", "key": "PRIV"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let pid = project["id"].as_str().unwrap();
    let (_, issue) = call(
        &app,
        Method::POST,
        &format!("/api/projects/{pid}/issues"),
        Some(&b),
        Some(json!({"title": "Secret issue"})),
    )
    .await;
    let iid = issue["id"].as_str().unwrap();
    let (_, page) = call(
        &app,
        Method::POST,
        &format!("/api/projects/{pid}/pages"),
        Some(&b),
        Some(json!({"title": "Secret page", "content": "Private body"})),
    )
    .await;
    let gid = page["id"].as_str().unwrap();

    // Tenant A must see none of tenant B's data, by any route.
    let (_, mine) = call(&app, Method::GET, "/api/projects", Some(&a), None).await;
    assert!(mine.as_array().unwrap().iter().all(|p| p["id"] != pid));
    for path in [
        format!("/api/projects/{pid}/issues"),
        format!("/api/projects/{pid}/pages"),
        format!("/api/issues/{iid}/details"),
        format!("/api/issues/{iid}/comments"),
        format!("/api/pages/{gid}/versions"),
        format!("/api/projects/{pid}/overview"),
    ] {
        let (s, v) = call(&app, Method::GET, &path, Some(&a), None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "GET {path}");
        assert_eq!(v["code"], "not_found");
    }
    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/issues/{iid}"),
        Some(&a),
        Some(json!({"status": "done"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/pages/{gid}"),
        Some(&a),
        Some(json!({"title": "Stolen", "content": "x", "expected_version": 1})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // B's data is untouched and still readable by B.
    let (_, issues) = call(
        &app,
        Method::GET,
        &format!("/api/projects/{pid}/issues"),
        Some(&b),
        None,
    )
    .await;
    assert_eq!(issues[0]["status"], "todo");
}

#[tokio::test]
async fn logout_revokes_the_session_and_page_conflicts_are_409() {
    let Some(app) = test_router().await else {
        return;
    };
    let t = signup(&app, "lo").await;
    let (_, project) = call(
        &app,
        Method::POST,
        "/api/projects",
        Some(&t),
        Some(json!({"name": "P", "key": "PRJ"})),
    )
    .await;
    let pid = project["id"].as_str().unwrap();
    let (_, page) = call(
        &app,
        Method::POST,
        &format!("/api/projects/{pid}/pages"),
        Some(&t),
        Some(json!({"title": "Doc", "content": "v1"})),
    )
    .await;
    let gid = page["id"].as_str().unwrap();
    let edit = |v: i64| json!({"title": "Doc", "content": "next", "expected_version": v});
    let (s, _) = call(
        &app,
        Method::PATCH,
        &format!("/api/pages/{gid}"),
        Some(&t),
        Some(edit(1)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = call(
        &app,
        Method::PATCH,
        &format!("/api/pages/{gid}"),
        Some(&t),
        Some(edit(1)),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(v["code"], "conflict");

    let (s, _) = call(&app, Method::POST, "/api/auth/logout", Some(&t), None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = call(&app, Method::GET, "/api/projects", Some(&t), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[test]
fn tokens_are_sha256_only_in_storage() {
    let t = mint_token();
    assert_eq!(t.len(), 64);
    assert_ne!(token_hash(&t), t);
    assert_eq!(token_hash(&t), token_hash(&t));
}
