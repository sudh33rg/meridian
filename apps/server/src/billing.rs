//! Plans, entitlements, usage and the Stripe adapter.
//!
//! * Limits and feature flags live in `PLANS` and are enforced on the server (seat, project,
//!   webhook, storage limits; SSO and SCIM are Business features). The UI only displays them.
//! * Usage is counted live from the data, never trusted from the client.
//! * Stripe is optional: with `STRIPE_SECRET_KEY` set, upgrades go through Checkout and the plan
//!   follows verified webhooks (HMAC signature with timestamp tolerance, idempotent by event id).
//!   Without it, development builds expose a direct plan switch; production exposes none.
use crate::config::Config;
use crate::*;
use axum::body::Bytes;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Feature {
    Sso,
    Scim,
}
#[derive(Clone, Copy)]
pub(crate) enum Limit {
    Seats,
    Projects,
    Webhooks,
}

pub(crate) struct Plan {
    pub(crate) key: &'static str,
    pub(crate) name: &'static str,
    pub(crate) seats: Option<i64>,
    pub(crate) projects: Option<i64>,
    pub(crate) webhooks: Option<i64>,
    pub(crate) storage_mb: Option<i64>,
    pub(crate) sso: bool,
    pub(crate) scim: bool,
    /// Indicative list price (cents per seat per month); Stripe prices are authoritative.
    pub(crate) seat_price_cents: i64,
}

pub(crate) const PLANS: [Plan; 3] = [
    Plan {
        key: "free",
        name: "Free",
        seats: Some(5),
        projects: Some(3),
        webhooks: Some(1),
        storage_mb: Some(1024),
        sso: false,
        scim: false,
        seat_price_cents: 0,
    },
    Plan {
        key: "team",
        name: "Team",
        seats: Some(100),
        projects: None,
        webhooks: Some(10),
        storage_mb: Some(51_200),
        sso: false,
        scim: false,
        seat_price_cents: 800,
    },
    Plan {
        key: "business",
        name: "Business",
        seats: None,
        projects: None,
        webhooks: Some(50),
        storage_mb: Some(512_000),
        sso: true,
        scim: true,
        seat_price_cents: 1500,
    },
];

pub(crate) fn plan_by_key(key: &str) -> &'static Plan {
    PLANS.iter().find(|p| p.key == key).unwrap_or(&PLANS[0])
}

/// The plan whose limits apply right now (a canceled subscription falls back to Free).
pub(crate) async fn current_plan(db: &mut PgConnection, tenant: Uuid) -> ApiResult<&'static Plan> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT plan,status FROM subscriptions WHERE tenant_id=$1")
            .bind(tenant)
            .fetch_optional(&mut *db)
            .await
            .map_err(db_err)?;
    Ok(match row {
        Some((plan, status)) if status != "canceled" => plan_by_key(&plan),
        _ => &PLANS[0],
    })
}

pub(crate) async fn usage(db: &mut PgConnection, tenant: Uuid) -> ApiResult<(i64, i64, i64, i64)> {
    let seats: i64 = sqlx::query_scalar("SELECT count(*) FROM memberships WHERE tenant_id=$1 AND disabled_at IS NULL AND role<>'guest'")
        .bind(tenant).fetch_one(&mut *db).await.map_err(db_err)?;
    let projects: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM projects WHERE tenant_id=$1 AND archived_at IS NULL",
    )
    .bind(tenant)
    .fetch_one(&mut *db)
    .await
    .map_err(db_err)?;
    let webhooks: i64 = sqlx::query_scalar("SELECT count(*) FROM webhooks WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_one(&mut *db)
        .await
        .map_err(db_err)?;
    let storage_bytes: i64 = sqlx::query_scalar("SELECT COALESCE(sum(size_bytes),0)::bigint FROM attachments WHERE tenant_id=$1 AND deleted_at IS NULL")
        .bind(tenant).fetch_one(&mut *db).await.map_err(db_err)?;
    Ok((seats, projects, webhooks, storage_bytes))
}

/// Refuse the action if it would exceed the plan's limit (HTTP 402 `plan_limit`).
pub(crate) async fn enforce_limit(
    db: &mut PgConnection,
    tenant: Uuid,
    limit: Limit,
) -> ApiResult<()> {
    let plan = current_plan(db, tenant).await?;
    let (seats, projects, webhooks, _) = usage(db, tenant).await?;
    let (used, max, what) = match limit {
        Limit::Seats => (seats, plan.seats, "members"),
        Limit::Projects => (projects, plan.projects, "projects"),
        Limit::Webhooks => (webhooks, plan.webhooks, "webhooks"),
    };
    match max {
        Some(m) if used >= m => Err(ApiError::PlanLimit(format!(
            "The {} plan allows {m} {what}. Upgrade the plan to add more",
            plan.name
        ))),
        _ => Ok(()),
    }
}

pub(crate) async fn enforce_storage(
    db: &mut PgConnection,
    tenant: Uuid,
    adding: i64,
) -> ApiResult<()> {
    let plan = current_plan(db, tenant).await?;
    let (_, _, _, used) = usage(db, tenant).await?;
    match plan.storage_mb {
        Some(mb) if used + adding > mb * 1024 * 1024 => Err(ApiError::PlanLimit(format!(
            "The {} plan includes {mb} MB of attachment storage. Upgrade the plan or delete files",
            plan.name
        ))),
        _ => Ok(()),
    }
}

pub(crate) async fn require_feature(app: &App, tenant: Uuid, feature: Feature) -> ApiResult<()> {
    let mut conn = app.db.acquire().await.map_err(db_err)?;
    let plan = current_plan(&mut conn, tenant).await?;
    let ok = match feature {
        Feature::Sso => plan.sso,
        Feature::Scim => plan.scim,
    };
    if ok {
        Ok(())
    } else {
        Err(ApiError::PlanLimit(format!(
            "{} is available on the Business plan; this workspace is on {}",
            match feature {
                Feature::Sso => "Single sign-on",
                Feature::Scim => "SCIM provisioning",
            },
            plan.name
        )))
    }
}

fn require_admin(i: &Identity) -> ApiResult<()> {
    if i.role == "owner" || i.role == "admin" {
        Ok(())
    } else {
        Err(forbidden())
    }
}

fn stripe_enabled(cfg: &Config) -> bool {
    cfg.stripe_secret_key.is_some()
}

#[utoipa::path(get, path = "/api/billing", tag = "billing", responses((status = 200, description = "Plan, usage against limits and available actions", body = Object), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn overview(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let mut db = app.db.acquire().await.map_err(db_err)?;
    let plan = current_plan(&mut db, i.tenant_id).await?;
    let (seats, projects, webhooks, storage) = usage(&mut db, i.tenant_id).await?;
    let sub: Option<(String, Option<chrono::DateTime<Utc>>, Option<String>)> = sqlx::query_as(
        "SELECT status,current_period_end,stripe_customer_id FROM subscriptions WHERE tenant_id=$1",
    )
    .bind(i.tenant_id)
    .fetch_optional(&mut *db)
    .await
    .map_err(db_err)?;
    let lim = |v: Option<i64>| v.map(Value::from).unwrap_or(Value::Null);
    Ok(Json(json!({
        "plan": plan.key,
        "plan_name": plan.name,
        "status": sub.as_ref().map(|s| s.0.clone()).unwrap_or_else(|| "active".into()),
        "current_period_end": sub.as_ref().and_then(|s| s.1),
        "has_customer": sub.as_ref().and_then(|s| s.2.as_ref()).is_some(),
        "stripe_enabled": stripe_enabled(&app.cfg),
        "dev_plan_switch": !stripe_enabled(&app.cfg) && !app.cfg.production,
        "usage": {
            "seats": {"used": seats, "limit": lim(plan.seats)},
            "projects": {"used": projects, "limit": lim(plan.projects)},
            "webhooks": {"used": webhooks, "limit": lim(plan.webhooks)},
            "storage_mb": {"used": storage / (1024 * 1024), "limit": lim(plan.storage_mb)},
        },
        "features": {"sso": plan.sso, "scim": plan.scim},
        "plans": PLANS.iter().map(|p| json!({
            "key": p.key, "name": p.name, "seat_price_cents": p.seat_price_cents,
            "seats": lim(p.seats), "projects": lim(p.projects), "webhooks": lim(p.webhooks),
            "storage_mb": lim(p.storage_mb), "sso": p.sso, "scim": p.scim,
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct PlanInput {
    /// `free`, `team` or `business`.
    pub(crate) plan: String,
}

#[utoipa::path(post, path = "/api/billing/plan", tag = "billing", request_body = PlanInput, responses((status = 204, description = "Plan switched (development builds without Stripe only)"), (status = 403, description = "Not available", body = ErrorBody), (status = 400, description = "Unknown plan or usage exceeds the target plan", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn switch_plan(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<PlanInput>,
) -> ApiResult<StatusCode> {
    require_admin(&i)?;
    if stripe_enabled(&app.cfg) || app.cfg.production {
        return Err(forbidden_msg("Plans change through billing only"));
    }
    let target = PLANS
        .iter()
        .find(|p| p.key == v.plan)
        .ok_or_else(|| bad("Unknown plan"))?;
    let mut db = app.db.acquire().await.map_err(db_err)?;
    let (seats, projects, webhooks, _) = usage(&mut db, i.tenant_id).await?;
    for (used, max, what) in [
        (seats, target.seats, "members"),
        (projects, target.projects, "projects"),
        (webhooks, target.webhooks, "webhooks"),
    ] {
        if max.is_some_and(|m| used > m) {
            return Err(bad(&format!(
                "Reduce {what} below the {} limit first",
                target.name
            )));
        }
    }
    sqlx::query("INSERT INTO subscriptions(tenant_id,plan,status) VALUES($1,$2,'active') ON CONFLICT (tenant_id) DO UPDATE SET plan=EXCLUDED.plan,status='active',updated_at=now()")
        .bind(i.tenant_id).bind(target.key).execute(&mut *db).await.map_err(db_err)?;
    crate::api::common::log_event_system(
        &mut db,
        i.tenant_id,
        i.user_id,
        "plan_changed",
        "workspace",
        i.tenant_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn stripe_post(cfg: &Config, path: &str, form: &[(String, String)]) -> ApiResult<Value> {
    let key = cfg
        .stripe_secret_key
        .as_ref()
        .ok_or_else(|| bad("Billing is not configured"))?;
    let res = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .post(format!("https://api.stripe.com/v1/{path}"))
        .basic_auth(key, Some(""))
        .form(form)
        .send()
        .await
        .map_err(|e| ApiError::Internal(format!("Stripe unreachable: {e}")))?;
    let ok = res.status().is_success();
    let body: Value = res
        .json()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if !ok {
        tracing::warn!(error=%body["error"]["message"], "Stripe rejected a request");
        return Err(bad("The payment provider rejected the request"));
    }
    Ok(body)
}

#[utoipa::path(post, path = "/api/billing/checkout", tag = "billing", request_body = PlanInput, responses((status = 200, description = "Stripe Checkout URL", body = Object), (status = 400, description = "Billing not configured or unknown plan", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn checkout(
    State(app): State<App>,
    i: Identity,
    Json(v): Json<PlanInput>,
) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let price = match v.plan.as_str() {
        "team" => app.cfg.stripe_price_team.clone(),
        "business" => app.cfg.stripe_price_business.clone(),
        _ => None,
    }
    .ok_or_else(|| bad("That plan is not available for purchase"))?;
    let mut db = app.db.acquire().await.map_err(db_err)?;
    let (seats, ..) = usage(&mut db, i.tenant_id).await?;
    let customer: Option<String> =
        sqlx::query_scalar("SELECT stripe_customer_id FROM subscriptions WHERE tenant_id=$1")
            .bind(i.tenant_id)
            .fetch_optional(&mut *db)
            .await
            .map_err(db_err)?
            .flatten();
    let tenant = i.tenant_id.to_string();
    let mut form: Vec<(String, String)> = vec![
        ("mode".into(), "subscription".into()),
        (
            "success_url".into(),
            format!("{}/billing?checkout=success", app.cfg.public_url),
        ),
        (
            "cancel_url".into(),
            format!("{}/billing?checkout=cancelled", app.cfg.public_url),
        ),
        ("client_reference_id".into(), tenant.clone()),
        ("line_items[0][price]".into(), price),
        ("line_items[0][quantity]".into(), seats.max(1).to_string()),
        ("metadata[tenant_id]".into(), tenant.clone()),
        ("metadata[plan]".into(), v.plan.clone()),
        ("subscription_data[metadata][tenant_id]".into(), tenant),
        ("subscription_data[metadata][plan]".into(), v.plan.clone()),
    ];
    if let Some(c) = customer {
        form.push(("customer".into(), c));
    }
    let session = stripe_post(&app.cfg, "checkout/sessions", &form).await?;
    Ok(Json(json!({ "url": session["url"] })))
}

#[utoipa::path(post, path = "/api/billing/portal", tag = "billing", responses((status = 200, description = "Stripe customer portal URL", body = Object), (status = 400, description = "No billing account yet", body = ErrorBody), (status = 403, description = "Admin required", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn portal(State(app): State<App>, i: Identity) -> ApiResult<Json<Value>> {
    require_admin(&i)?;
    let customer: Option<String> =
        sqlx::query_scalar("SELECT stripe_customer_id FROM subscriptions WHERE tenant_id=$1")
            .bind(i.tenant_id)
            .fetch_optional(&app.db)
            .await
            .map_err(db_err)?
            .flatten();
    let customer =
        customer.ok_or_else(|| bad("There is no billing account yet. Subscribe first"))?;
    let session = stripe_post(
        &app.cfg,
        "billing_portal/sessions",
        &[
            ("customer".into(), customer),
            (
                "return_url".into(),
                format!("{}/billing", app.cfg.public_url),
            ),
        ],
    )
    .await?;
    Ok(Json(json!({ "url": session["url"] })))
}

/// Verify `Stripe-Signature: t=<ts>,v1=<hex>` over the raw body (5 minute tolerance).
fn verify_stripe_signature(secret: &str, header_value: &str, body: &[u8], now: i64) -> bool {
    let mut ts: Option<i64> = None;
    let mut sigs: Vec<&str> = vec![];
    for part in header_value.split(',') {
        match part.trim().split_once('=') {
            Some(("t", v)) => ts = v.parse().ok(),
            Some(("v1", v)) => sigs.push(v),
            _ => {}
        }
    }
    let Some(ts) = ts else { return false };
    if (now - ts).abs() > 300 {
        return false;
    }
    let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(format!("{ts}.").as_bytes());
    mac.update(body);
    let expected = hex::encode(mac.finalize().into_bytes());
    sigs.iter()
        .any(|s| crate::auth::constant_time_eq(s, &expected))
}

fn plan_for_price(cfg: &Config, price: &str) -> Option<&'static str> {
    if cfg.stripe_price_team.as_deref() == Some(price) {
        Some("team")
    } else if cfg.stripe_price_business.as_deref() == Some(price) {
        Some("business")
    } else {
        None
    }
}

#[utoipa::path(post, path = "/api/billing/stripe-webhook", tag = "billing", responses((status = 204, description = "Event accepted (or already processed)"), (status = 400, description = "Bad signature or payload", body = ErrorBody)))]
pub(crate) async fn stripe_webhook(
    State(app): State<App>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let secret = app
        .cfg
        .stripe_webhook_secret
        .as_deref()
        .ok_or_else(|| bad("Billing webhooks are not configured"))?;
    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if !verify_stripe_signature(secret, sig, &body, now) {
        return Err(bad("Invalid signature"));
    }
    let event: Value = serde_json::from_slice(&body).map_err(|_| bad("Invalid payload"))?;
    let id = event["id"]
        .as_str()
        .ok_or_else(|| bad("Missing event id"))?;
    let kind = event["type"].as_str().unwrap_or("");
    let obj = &event["data"]["object"];
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let fresh = sqlx::query("INSERT INTO billing_events(stripe_event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(id).bind(kind).execute(&mut *tx).await.map_err(db_err)?;
    if fresh.rows_affected() == 0 {
        return Ok(StatusCode::NO_CONTENT); // replay: already handled
    }
    let tenant = |o: &Value| -> Option<Uuid> {
        o["client_reference_id"]
            .as_str()
            .or_else(|| o["metadata"]["tenant_id"].as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
    };
    match kind {
        "checkout.session.completed" => {
            if let (Some(t), Some(plan)) = (
                tenant(obj),
                obj["metadata"]["plan"]
                    .as_str()
                    .filter(|p| PLANS.iter().any(|x| x.key == *p)),
            ) {
                sqlx::query("INSERT INTO subscriptions(tenant_id,plan,status,stripe_customer_id,stripe_subscription_id) VALUES($1,$2,'active',$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET plan=EXCLUDED.plan,status='active',stripe_customer_id=EXCLUDED.stripe_customer_id,stripe_subscription_id=EXCLUDED.stripe_subscription_id,updated_at=now()")
                    .bind(t).bind(plan).bind(obj["customer"].as_str()).bind(obj["subscription"].as_str())
                    .execute(&mut *tx).await.map_err(db_err)?;
            }
        }
        "customer.subscription.updated" | "customer.subscription.deleted" => {
            let sub_id = obj["id"].as_str().unwrap_or_default();
            let status = match (kind, obj["status"].as_str().unwrap_or("")) {
                ("customer.subscription.deleted", _) | (_, "canceled") => "canceled",
                (_, "past_due") | (_, "unpaid") => "past_due",
                _ => "active",
            };
            let price = obj["items"]["data"][0]["price"]["id"]
                .as_str()
                .and_then(|p| plan_for_price(&app.cfg, p));
            let plan = price.or_else(|| {
                obj["metadata"]["plan"]
                    .as_str()
                    .and_then(|p| PLANS.iter().find(|x| x.key == p).map(|x| x.key))
            });
            let period_end = obj["current_period_end"]
                .as_i64()
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0));
            sqlx::query("UPDATE subscriptions SET status=$2, plan=COALESCE($3,plan), current_period_end=COALESCE($4,current_period_end), updated_at=now() WHERE stripe_subscription_id=$1")
                .bind(sub_id).bind(status).bind(plan).bind(period_end)
                .execute(&mut *tx).await.map_err(db_err)?;
        }
        "invoice.payment_failed" => {
            if let Some(sub) = obj["subscription"].as_str() {
                sqlx::query("UPDATE subscriptions SET status='past_due', updated_at=now() WHERE stripe_subscription_id=$1")
                    .bind(sub).execute(&mut *tx).await.map_err(db_err)?;
            }
        }
        _ => {}
    }
    tx.commit().await.map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/billing", get(overview))
        .route("/api/billing/plan", post(switch_plan))
        .route("/api/billing/checkout", post(checkout))
        .route("/api/billing/portal", post(portal))
        .route("/api/billing/stripe-webhook", post(stripe_webhook))
}
