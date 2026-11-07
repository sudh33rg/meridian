//! Workspaces, members, invitations and teams.
use crate::api::common::*;
use crate::*;
use axum::response::Response;
use axum::routing::{delete, patch};
use serde_json::{json, Value};

#[utoipa::path(get, path = "/api/me", tag = "org", responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn me(mut tx: Tx) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    let u:Value=sqlx::query_scalar("SELECT jsonb_build_object('user_id',u.id,'email',u.email,'name',u.display_name,'tenant_id',t.id,'tenant',t.name,'slug',t.slug,'role',m.role,'email_verified',u.email_verified_at IS NOT NULL) FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.disabled_at IS NULL")
        .bind(i.tenant_id).bind(i.user_id).fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok(Json(u))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct WorkspaceInput {
    pub(crate) name: String,
    pub(crate) slug: String,
}
#[utoipa::path(post, path = "/api/workspaces", tag = "org", request_body = WorkspaceInput, responses((status = 201, description = "Success", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn create_workspace(
    State(app): State<App>,
    headers: HeaderMap,
    i: Identity,
    Json(v): Json<WorkspaceInput>,
) -> ApiResult<Response> {
    if v.name.trim().is_empty()
        || v.name.len() > 160
        || v.slug.len() < 3
        || v.slug.len() > 40
        || !v
            .slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || v.slug.starts_with('-')
        || v.slug.ends_with('-')
    {
        return Err(bad("Invalid workspace name or slug"));
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let tenant: Uuid =
        sqlx::query_scalar("INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id")
            .bind(v.name.trim())
            .bind(&v.slug)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| bad("Workspace slug may already be taken"))?;
    sqlx::query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant)
        .bind(i.user_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let issued = start_session(
        &mut tx,
        &app.cfg,
        tenant,
        i.user_id,
        &user_agent(&headers),
        None,
    )
    .await?;
    let name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
        .bind(i.user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(auth_reply(
        &headers,
        &app.cfg,
        StatusCode::CREATED,
        AuthResponse {
            token: String::new(),
            refresh_token: None,
            mfa_required: None,
            challenge: None,
            tenant_id: tenant,
            user_id: i.user_id,
            organization: v.name,
            name,
        },
        issued,
    ))
}
#[utoipa::path(get, path = "/api/workspaces", tag = "org", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn workspaces(State(app): State<App>, i: Identity) -> ApiResult<Json<Vec<Value>>> {
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'role',m.role) FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.disabled_at IS NULL ORDER BY t.name LIMIT 100")
        .bind(i.user_id).fetch_all(&app.db).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct SwitchTenant {
    pub(crate) tenant_id: Uuid,
}
#[utoipa::path(post, path = "/api/workspaces/switch", tag = "org", request_body = SwitchTenant, responses((status = 200, description = "Success", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn switch_workspace(
    State(app): State<App>,
    headers: HeaderMap,
    i: Identity,
    Json(v): Json<SwitchTenant>,
) -> ApiResult<Response> {
    let org:Option<(String,String)>=sqlx::query_as("SELECT t.name,u.display_name FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.disabled_at IS NULL")
        .bind(v.tenant_id).bind(i.user_id).fetch_optional(&app.db).await.map_err(db_err)?;
    let (organization, name) = org.ok_or_else(forbidden)?;
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let issued = start_session(
        &mut tx,
        &app.cfg,
        v.tenant_id,
        i.user_id,
        &user_agent(&headers),
        None,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(auth_reply(
        &headers,
        &app.cfg,
        StatusCode::OK,
        AuthResponse {
            token: String::new(),
            refresh_token: None,
            mfa_required: None,
            challenge: None,
            tenant_id: v.tenant_id,
            user_id: i.user_id,
            organization,
            name,
        },
        issued,
    ))
}
#[utoipa::path(get, path = "/api/members", tag = "org", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn members(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    if i.role == "guest" {
        return Err(forbidden());
    }
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'role',m.role) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.disabled_at IS NULL ORDER BY u.display_name LIMIT 2000")
        .bind(i.tenant_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct MemberRoleInput {
    pub(crate) role: String,
}
#[utoipa::path(patch, path = "/api/members/{id}", tag = "org", params(("id" = Uuid, Path, description = "Resource id")), request_body = MemberRoleInput, responses((status = 200, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn change_member_role(
    mut tx: Tx,
    Path(user): Path<Uuid>,
    Json(v): Json<MemberRoleInput>,
) -> ApiResult<Json<Value>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    if !["admin", "member", "viewer", "guest"].contains(&v.role.as_str()) {
        return Err(bad("Only admin/member/viewer roles are assignable"));
    }
    let row:Option<Value>=sqlx::query_scalar("UPDATE memberships SET role=$1 WHERE tenant_id=$2 AND user_id=$3 AND role<>'owner' AND disabled_at IS NULL RETURNING jsonb_build_object('user_id',user_id,'role',role)")
     .bind(v.role).bind(i.tenant_id).bind(user).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let changed =
        row.ok_or_else(|| err(StatusCode::NOT_FOUND, "Member absent or protected owner"))?;
    log_event(&mut tx, &i, "role_changed", "member", user).await?;
    Ok(Json(changed))
}
#[utoipa::path(delete, path = "/api/members/{id}", tag = "org", params(("id" = Uuid, Path, description = "Resource id")), responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn remove_member(mut tx: Tx, Path(user): Path<Uuid>) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let result=sqlx::query("UPDATE memberships SET disabled_at=now() WHERE tenant_id=$1 AND user_id=$2 AND role<>'owner' AND disabled_at IS NULL")
     .bind(i.tenant_id).bind(user).execute(&mut *tx).await.map_err(db_err)?;
    if result.rows_affected() == 0 {
        return Err(err(
            StatusCode::NOT_FOUND,
            "Member absent or protected owner",
        ));
    }
    sqlx::query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2")
        .bind(i.tenant_id)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    log_event(&mut tx, &i, "disabled", "member", user).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct InviteInput {
    pub(crate) email: String,
    pub(crate) role: String,
}
#[utoipa::path(get, path = "/api/invitations", tag = "org", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn invitations(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'email',email,'role',role,'expires_at',expires_at,'accepted_at',accepted_at) FROM invitations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100")
        .bind(i.tenant_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(post, path = "/api/invitations", tag = "org", request_body = InviteInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn invite(
    mut tx: Tx,
    Json(v): Json<InviteInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let email = v.email.trim().to_ascii_lowercase();
    if !email.contains('@')
        || email.len() > 320
        || !["admin", "member", "viewer", "guest"].contains(&v.role.as_str())
    {
        return Err(bad("Valid email and role required"));
    }
    if v.role != "guest" {
        crate::billing::enforce_limit(&mut tx, i.tenant_id, crate::billing::Limit::Seats).await?;
    }
    let id = Uuid::new_v4();
    let token = derive_token(&tx.cfg.secret, "invite", id);
    let id:Uuid=sqlx::query_scalar("INSERT INTO invitations(id,tenant_id,email,role,token_hash,invited_by,expires_at) VALUES($6,$1,$2,$3,$4,$5,now()+interval '3 days') RETURNING id")
        .bind(i.tenant_id).bind(email).bind(v.role).bind(token_hash(&token)).bind(i.user_id).bind(id).fetch_one(&mut *tx).await.map_err(db_err)?;
    log_event(&mut tx, &i, "created", "invitation", id).await?;
    // The invitation email is enqueued in the same transaction (it exists iff the invitation does).
    // The token is also shown once to the inviter, so sharing by hand works without SMTP.
    crate::jobs::enqueue(
        &mut tx,
        Some(i.tenant_id),
        "email.invite",
        crate::jobs::payload("invitation_id", id),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id,"invite_token":token,"expires_in_hours":72})),
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct AcceptInvitation {
    pub(crate) token: String,
    pub(crate) name: Option<String>,
    pub(crate) password: Option<String>,
}
#[utoipa::path(post, path = "/api/auth/accept-invite", tag = "org", request_body = AcceptInvitation, responses((status = 200, description = "Success", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)))]
pub(crate) async fn accept_invite(
    State(app): State<App>,
    headers: HeaderMap,
    Json(v): Json<AcceptInvitation>,
) -> ApiResult<Response> {
    if v.token.len() != 64 {
        return Err(bad("Invalid invitation token"));
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let entry:Option<(Uuid,Uuid,String,String)>=sqlx::query_as("SELECT id,tenant_id,email,role FROM invitations WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL FOR UPDATE")
        .bind(token_hash(&v.token)).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let (invite_id, tenant, email, role) =
        entry.ok_or_else(|| err(StatusCode::GONE, "Invitation expired or already accepted"))?;
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    let user = if let Some(id) = existing {
        id
    } else {
        let name = v.name.as_deref().unwrap_or("");
        let password = v.password.as_deref().unwrap_or("");
        if name.trim().is_empty() || password.len() < 12 {
            return Err(bad(
                "A new account requires a name and 12-character password",
            ));
        }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|_| bad("Password hashing failed"))?
            .to_string();
        sqlx::query_scalar(
            "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind(name)
        .bind(hash)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?
    };
    // An existing user's account must authenticate before accepting. An invite link alone
    // must not grant access to an existing account, even if it was forwarded.
    if existing.is_some() {
        return Err(err(
            StatusCode::CONFLICT,
            "Existing account: sign in and accept using the authenticated invitation endpoint",
        ));
    }
    if role != "guest" {
        crate::billing::enforce_limit(&mut tx, tenant, crate::billing::Limit::Seats).await?;
    }
    sqlx::query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)")
        .bind(tenant)
        .bind(user)
        .bind(role)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE invitations SET accepted_at=now() WHERE id=$1")
        .bind(invite_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let issued =
        start_session(&mut tx, &app.cfg, tenant, user, &user_agent(&headers), None).await?;
    let org: String = sqlx::query_scalar("SELECT name FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(auth_reply(
        &headers,
        &app.cfg,
        StatusCode::OK,
        AuthResponse {
            token: String::new(),
            refresh_token: None,
            mfa_required: None,
            challenge: None,
            tenant_id: tenant,
            user_id: user,
            organization: org,
            name,
        },
        issued,
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct TeamInput {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
}
#[utoipa::path(get, path = "/api/teams", tag = "org", responses((status = 200, description = "Success", body = Vec<Object>), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn teams(mut tx: Tx) -> ApiResult<Json<Vec<Value>>> {
    let i = tx.identity.clone();
    if i.role == "guest" {
        return Err(forbidden());
    }
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('id',t.id,'name',t.name,'description',t.description,'members',(SELECT count(*) FROM team_members m WHERE m.tenant_id=t.tenant_id AND m.team_id=t.id)) FROM teams t WHERE tenant_id=$1 ORDER BY name LIMIT 250")
        .bind(i.tenant_id).fetch_all(&mut *tx).await.map_err(db_err)?;
    Ok(Json(rows))
}
#[utoipa::path(post, path = "/api/teams", tag = "org", request_body = TeamInput, responses((status = 201, description = "Success", body = Object), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn new_team(
    mut tx: Tx,
    Json(v): Json<TeamInput>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    validate_title(&v.name)?;
    let row:Value=sqlx::query_scalar("INSERT INTO teams(tenant_id,name,description) VALUES($1,$2,$3) RETURNING jsonb_build_object('id',id,'name',name,'description',description)")
        .bind(i.tenant_id).bind(v.name.trim()).bind(v.description.unwrap_or_default()).fetch_one(&mut *tx).await.map_err(db_err)?;
    Ok((StatusCode::CREATED, Json(row)))
}
#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct JoinTeamInput {
    pub(crate) user_id: Uuid,
}
#[utoipa::path(post, path = "/api/teams/{id}/members", tag = "org", params(("id" = Uuid, Path, description = "Resource id")), request_body = JoinTeamInput, responses((status = 204, description = "Success"), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn join_team(
    mut tx: Tx,
    Path(team): Path<Uuid>,
    Json(v): Json<JoinTeamInput>,
) -> ApiResult<StatusCode> {
    let i = tx.identity.clone();
    require_admin(&i)?;
    let result=sqlx::query("INSERT INTO team_members(tenant_id,team_id,user_id) SELECT $1,$2,$3 FROM teams t JOIN memberships m ON m.tenant_id=t.tenant_id AND m.user_id=$3 WHERE t.tenant_id=$1 AND t.id=$2 ON CONFLICT DO NOTHING")
        .bind(i.tenant_id).bind(team).bind(v.user_id).execute(&mut *tx).await.map_err(db_err)?;
    if result.rows_affected() == 0 {
        return Err(err(
            StatusCode::NOT_FOUND,
            "Team/member missing or already assigned",
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub(crate) struct ExistingInvite {
    pub(crate) token: String,
}
#[utoipa::path(post, path = "/api/auth/accept-invite-existing", tag = "org", request_body = ExistingInvite, responses((status = 200, description = "Success", body = AuthResponse), (status = 400, description = "Validation or domain error", body = ErrorBody), (status = 401, description = "Missing or invalid session", body = ErrorBody), (status = 403, description = "Insufficient permissions", body = ErrorBody), (status = 404, description = "Not found in this workspace", body = ErrorBody)), security(("bearer" = [])))]
pub(crate) async fn accept_invite_existing(
    State(app): State<App>,
    headers: HeaderMap,
    i: Identity,
    Json(v): Json<ExistingInvite>,
) -> ApiResult<Response> {
    if v.token.len() != 64 {
        return Err(bad("Invalid invitation"));
    }
    let mut tx = app.db.begin().await.map_err(db_err)?;
    let inv:Option<(Uuid,Uuid,String,String)>=sqlx::query_as("SELECT id,tenant_id,email,role FROM invitations WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL FOR UPDATE")
        .bind(token_hash(&v.token)).fetch_optional(&mut *tx).await.map_err(db_err)?;
    let (inv_id, tenant, email, role) =
        inv.ok_or_else(|| err(StatusCode::GONE, "Invitation expired or already accepted"))?;
    let identity_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id=$1")
        .bind(i.user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    if email != identity_email {
        return Err(forbidden());
    }
    if role != "guest" {
        crate::billing::enforce_limit(&mut tx, tenant, crate::billing::Limit::Seats).await?;
    }
    sqlx::query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET disabled_at=NULL,role=EXCLUDED.role")
        .bind(tenant).bind(i.user_id).bind(role).execute(&mut *tx).await.map_err(db_err)?;
    sqlx::query("UPDATE invitations SET accepted_at=now() WHERE id=$1")
        .bind(inv_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let issued = start_session(
        &mut tx,
        &app.cfg,
        tenant,
        i.user_id,
        &user_agent(&headers),
        None,
    )
    .await?;
    let org: String = sqlx::query_scalar("SELECT name FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
        .bind(i.user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(auth_reply(
        &headers,
        &app.cfg,
        StatusCode::OK,
        AuthResponse {
            token: String::new(),
            refresh_token: None,
            mfa_required: None,
            challenge: None,
            tenant_id: tenant,
            user_id: i.user_id,
            organization: org,
            name,
        },
        issued,
    ))
}

pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/workspaces", get(workspaces).post(create_workspace))
        .route("/api/workspaces/switch", post(switch_workspace))
        .route("/api/members", get(members))
        .route(
            "/api/members/{id}",
            patch(change_member_role).delete(remove_member),
        )
        .route("/api/invitations", get(invitations).post(invite))
        .route("/api/auth/accept-invite", post(accept_invite))
        .route(
            "/api/auth/accept-invite-existing",
            post(accept_invite_existing),
        )
        .route("/api/teams", get(teams).post(new_team))
        .route("/api/teams/{id}/members", post(join_team))
}
