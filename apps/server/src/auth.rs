//! Sessions, signup/login/logout and the `Identity` request extractor.
use crate::*;

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct Signup {
    pub(crate) organization: String,
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) email: String,
    pub(crate) password: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct Login {
    pub(crate) slug: String,
    pub(crate) email: String,
    pub(crate) password: String,
}
#[derive(Serialize, utoipa::ToSchema)]
pub(crate) struct AuthResponse {
    pub(crate) token: String,
    pub(crate) tenant_id: Uuid,
    pub(crate) user_id: Uuid,
    pub(crate) organization: String,
    pub(crate) name: String,
}
#[derive(FromRow, Clone)]
pub(crate) struct Identity {
    pub(crate) tenant_id: Uuid,
    pub(crate) user_id: Uuid,
    pub(crate) role: String,
}
pub(crate) fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
pub(crate) fn mint_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub(crate) async fn store_session(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: Uuid,
    user_id: Uuid,
    token: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO sessions(token_hash,tenant_id,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '7 days')")
 .bind(token_hash(token)).bind(tenant_id).bind(user_id).execute(&mut **tx).await.map_err(db_err)?;
    Ok(())
}
#[utoipa::path(post, path = "/api/auth/signup", tag = "auth", request_body = Signup, responses((status = 201, description = "Success", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)))]
pub(crate) async fn signup(
    State(app): State<App>,
    Json(v): Json<Signup>,
) -> ApiResult<(StatusCode, Json<AuthResponse>)> {
    let email = v.email.trim().to_lowercase();
    if v.password.len() < 12
        || !email.contains('@')
        || v.organization.trim().is_empty()
        || v.name.trim().is_empty()
        || v.slug.len() < 3
        || v.slug.len() > 40
        || !v
            .slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || v.slug.starts_with('-')
    {
        return Err(bad(
            "Check organization, slug, email and password (at least 12 characters)",
        ));
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(v.password.as_bytes(), &salt)
        .map_err(|_| bad("Password hashing failed"))?
        .to_string();
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let tenant =
        sqlx::query_scalar::<_, Uuid>("INSERT INTO tenants(slug,name) VALUES($1,$2) RETURNING id")
            .bind(&v.slug)
            .bind(&v.organization)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| bad("Organization slug is unavailable"))?;
    let user = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
    )
    .bind(&email)
    .bind(&v.name)
    .bind(hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| bad("Email is already registered; login to your existing organization"))?;
    sqlx::query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let token = mint_token();
    store_session(&mut tx, tenant, user, &token).await?;
    tx.commit().await.map_err(db_err)?;
    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            token,
            tenant_id: tenant,
            user_id: user,
            organization: v.organization,
            name: v.name,
        }),
    ))
}
pub(crate) async fn is_login_blocked(db: &PgPool, slug: &str, email: &str) -> ApiResult<bool> {
    let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM login_attempts WHERE tenant_slug=$1 AND email=$2 AND blocked_until>now())")
 .bind(slug).bind(email).fetch_one(db).await.map_err(db_err)?;
    Ok(blocked)
}
pub(crate) async fn login_failed(db: &PgPool, slug: &str, email: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO login_attempts(tenant_slug,email,failures,last_attempt,blocked_until) VALUES($1,$2,1,now(),NULL) ON CONFLICT(tenant_slug,email) DO UPDATE SET failures=CASE WHEN login_attempts.last_attempt<now()-interval '15 minutes' THEN 1 ELSE login_attempts.failures+1 END,last_attempt=now(),blocked_until=CASE WHEN login_attempts.last_attempt>=now()-interval '15 minutes' AND login_attempts.failures>=9 THEN now()+interval '15 minutes' ELSE NULL END")
 .bind(slug).bind(email).execute(db).await.map_err(db_err)?;
    Ok(())
}
#[utoipa::path(post, path = "/api/auth/login", tag = "auth", request_body = Login, responses((status = 200, description = "Success", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)))]
pub(crate) async fn login(
    State(app): State<App>,
    Json(v): Json<Login>,
) -> ApiResult<Json<AuthResponse>> {
    let slug = v.slug.trim();
    let email = v.email.trim().to_lowercase();
    if is_login_blocked(&app.db, slug, &email).await? {
        return Err(err(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many failed attempts; retry later",
        ));
    }

    let rec:Option<(Uuid,Uuid,String,String,String)>=sqlx::query_as("SELECT t.id,u.id,u.password_hash,t.name,u.display_name FROM tenants t JOIN memberships m ON m.tenant_id=t.id JOIN users u ON u.id=m.user_id WHERE t.slug=$1 AND u.email=$2 AND m.disabled_at IS NULL")
 .bind(slug).bind(&email).fetch_optional(&app.db).await.map_err(db_err)?;
    let (tenant, user, hash, organization, name) = if let Some(rec) = rec {
        rec
    } else {
        login_failed(&app.db, slug, &email).await?;
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid credentials"));
    };
    let parsed = PasswordHash::new(&hash)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Authentication failure"))?;
    if Argon2::default()
        .verify_password(v.password.as_bytes(), &parsed)
        .is_err()
    {
        login_failed(&app.db, slug, &email).await?;
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid credentials"));
    }
    sqlx::query("DELETE FROM login_attempts WHERE tenant_slug=$1 AND email=$2")
        .bind(slug)
        .bind(&email)
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    let token = mint_token();
    let mut tx = app.db.begin().await.map_err(db_err)?;
    store_session(&mut tx, tenant, user, &token).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(AuthResponse {
        token,
        tenant_id: tenant,
        user_id: user,
        organization,
        name,
    }))
}
pub(crate) async fn identity(parts: &Parts, db: &PgPool) -> ApiResult<Identity> {
    let value = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|x| x.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Authentication required"))?;
    if value.len() != 64 {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid session"));
    }
    sqlx::query_as::<_,Identity>("SELECT s.tenant_id,s.user_id,m.role FROM sessions s JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND m.disabled_at IS NULL")
        .bind(token_hash(value)).fetch_optional(db).await.map_err(db_err)?.ok_or_else(||err(StatusCode::UNAUTHORIZED,"Session expired"))
}

/// Authenticated caller. Declaring `i: Identity` in a handler resolves the bearer session
/// (tenant + role) before the handler body runs; handlers never read a tenant from the request.
impl FromRequestParts<App> for Identity {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self, Self::Rejection> {
        identity(parts, &state.db).await
    }
}
pub(crate) fn can_edit(i: &Identity) -> bool {
    i.role != "viewer"
}
#[utoipa::path(post, path = "/api/auth/logout", tag = "auth", responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn logout(
    State(app): State<App>,
    _i: Identity,
    h: HeaderMap,
) -> ApiResult<StatusCode> {
    let token = h
        .get(header::AUTHORIZATION)
        .and_then(|x| x.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Authentication required"))?;
    sqlx::query("DELETE FROM sessions WHERE token_hash=$1")
        .bind(token_hash(token))
        .execute(&app.db)
        .await
        .map_err(db_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
}
