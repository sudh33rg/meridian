//! OpenAPI 3.1 description of the REST API, generated from the handler annotations.
//! `meridian-api --openapi` prints it and `GET /api/openapi.json` serves it.
//! `docs/openapi.json` is the checked-in copy the web client types are generated from; CI checks it is current.
use crate::api::{
    access::*, admin::*, collab::*, issues::*, knowledge::*, org::*, planning::*, security::*,
    work::*,
};
use crate::*;
use utoipa::{
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
    Modify, OpenApi,
};

struct BearerAuth;
impl Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .description(Some("Opaque session token from /api/auth/login or /signup"))
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Meridian API", version = "0.2.0", description = "Multi-tenant work and knowledge API. The tenant is always resolved from the session, never from the request."),
    paths(
        auth::refresh,
        auth::change_password,
        crate::mfa::status,
        crate::mfa::enroll,
        crate::mfa::confirm,
        crate::mfa::disable,
        crate::mfa::regenerate_recovery_codes,
        crate::mfa::verify_challenge,
        crate::mfa::workspace_security,
        crate::mfa::set_workspace_security,
        auth::forgot_password,
        auth::reset_password,
        auth::verify_email,
        auth::resend_verification,
        api::security::list_sessions,
        api::security::revoke_session,
        api::security::revoke_other_sessions,
        api::access::list_access,
        api::access::grant_access,
        api::access::revoke_access,
        api::access::set_visibility,
        api::admin::audit_log,
        api::admin::entitlements,
        api::admin::export_project,
        api::admin::import_issues,
        api::collab::activity,
        api::collab::analytics,
        api::collab::approvals,
        api::collab::automations,
        api::collab::decide_approval,
        api::collab::inbox,
        api::collab::mark_read,
        api::collab::my_approvals,
        api::collab::new_approval,
        api::collab::new_automation,
        api::issues::archive_issue,
        api::issues::edit_issue,
        api::issues::issue_comments,
        api::issues::issue_details,
        api::issues::issue_links,
        api::issues::new_issue_comment,
        api::issues::new_issue_link,
        api::knowledge::new_page_comment,
        api::knowledge::new_relation,
        api::knowledge::page_comments,
        api::knowledge::page_versions,
        api::knowledge::relations,
        api::knowledge::restore_page,
        api::knowledge::search,
        api::org::accept_invite,
        api::org::accept_invite_existing,
        api::org::change_member_role,
        api::org::create_workspace,
        api::org::invitations,
        api::org::invite,
        api::org::join_team,
        api::org::me,
        api::org::members,
        api::org::new_team,
        api::org::remove_member,
        api::org::switch_workspace,
        api::org::teams,
        api::org::workspaces,
        api::planning::decisions,
        api::planning::goals,
        api::planning::new_decision,
        api::planning::new_goal,
        api::planning::new_release,
        api::planning::new_risk,
        api::planning::new_sprint,
        api::planning::portfolio,
        api::planning::project_overview,
        api::planning::releases,
        api::planning::risks,
        api::planning::sprints,
        api::planning::update_sprint,
        api::planning::workload,
        api::work::create_issue,
        api::work::create_page,
        api::work::create_project,
        api::work::issues,
        api::work::pages,
        api::work::patch_issue,
        api::work::patch_page,
        api::work::projects,
        auth::login,
        auth::logout,
        auth::signup
    ),
    components(schemas(ErrorBody, crate::mfa::CodeInput, crate::mfa::DisableInput, crate::mfa::VerifyChallengeInput, crate::mfa::SecurityPolicyInput, ChangePasswordInput, RefreshInput, ForgotInput, ResetInput, VerifyInput, GrantInput, VisibilityInput, AcceptInvitation, ApprovalDecision, ApprovalInput, AuthResponse, AutomationInput, CommentInput, DecisionInput, ExistingInvite, GoalInput, ImportInput, ImportItem, InviteInput, Issue, IssueEdit, JoinTeamInput, LinkInput, Login, MemberRoleInput, NewIssue, NewPage, NewProject, Page, PatchIssue, PatchPage, Project, RelationInput, ReleaseInput, RestoreInput, RiskInput, Signup, SprintInput, SprintUpdate, SwitchTenant, TeamInput, WorkspaceInput)),
    modifiers(&BearerAuth)
)]
pub struct ApiDoc;

pub(crate) async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_operation_is_documented_and_secured_consistently() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let paths = doc["paths"].as_object().unwrap();
        let ops: usize = paths.values().map(|p| p.as_object().unwrap().len()).sum();
        assert_eq!(
            ops, 83,
            "documented operation count changed; update routes and docs together"
        );
        // Only the public auth endpoints may omit the bearer requirement.
        for (path, item) in paths {
            for (method, op) in item.as_object().unwrap() {
                let public = [
                    "/api/auth/signup",
                    "/api/auth/login",
                    "/api/auth/accept-invite",
                    "/api/auth/refresh",
                    "/api/auth/forgot-password",
                    "/api/auth/reset-password",
                    "/api/auth/verify-email",
                ]
                .contains(&path.as_str());
                assert_eq!(op.get("security").is_none(), public, "{method} {path}");
            }
        }
        assert!(doc["components"]["securitySchemes"]["bearer"].is_object());
    }
}
