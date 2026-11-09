# Security design and production blockers

## Threat boundaries

- **Tenant isolation is enforced twice.** Each `tenant_id` comes from a hashed, non-expired session and an active membership, never from request bodies or paths, and handlers still bind it in their SQL. Underneath, every authenticated request runs in a single transaction as the `meridian_app` role with `app.tenant_id` set, and PostgreSQL row level security (policies on every table that has a `tenant_id`) confines that transaction to the caller's tenant even if a handler forgets a predicate. `meridian_app` cannot read `users.password_hash`, `login_attempts` or the credential tables, and cannot update or delete `audit_events` or `events`. The API refuses to start if a tenant table lacks RLS or the role switch fails. Cross-workspace flows (sign-in, workspace switch/create, invitation acceptance, the job worker) deliberately use the owner connection and scope each query by hand; they are the only code allowed to see more than one tenant.
- Most cross-entity database references use composite `(tenant_id, id)` foreign keys. `entity_relations` is a polymorphic exception: writes validate both endpoints at the service layer, and an endpoint in a project the caller cannot open counts as non-existent (so relations and approvals never confirm a private item's existence); listing relations drops any whose other end the caller cannot see.
- **Roles and project access.** Workspace roles (owner/admin/member/viewer) set the ceiling: viewers can never write. On top of that, a project can be `private`, and users or teams can be granted viewer/editor/admin on it (relation tuples + the `project_access()` SQL function, shared by guards, lists, search and the portfolio). An approval's item must belong to the approval's project and the reviewer must be able to open that project. Notification rows carry only ids and generic titles. `/workload` counts only what the caller can see. Page-level and issue-level ACLs do not exist.
- **Sessions.** Bearer tokens (API/mobile) and browser cookies share one session store. Browsers use HttpOnly `meridian_session` (Path `/api`, SameSite=Lax) and a rotating HttpOnly `meridian_refresh` (Path `/api/auth`, SameSite=Strict); the JSON body is blanked so page scripts never see either. Cookie-authenticated unsafe requests need `X-CSRF-Token` equal to the readable `meridian_csrf` cookie and a matching `Origin`. Access sessions last 8 h, refresh tokens 30 days and are single-use: presenting a used one revokes the whole session family. Users can list and revoke their sign-ins; a password reset revokes all of them. Set `COOKIE_SECURE=true` (implied by `APP_ENV=production`) behind HTTPS.
- **Email tokens** (verify, reset, invitation) are never stored: the database keeps the SHA-256 of an HMAC derived from `APP_SECRET`, a purpose and a row id; the mailer re-derives the raw token when sending. Jobs carry only ids. In development without `SMTP_URL` the API logs the message (including the link) instead of sending; in production a missing SMTP configuration fails the job and never logs a usable link.
- Passwords use Argon2id. Account+workspace login failures are throttled in the database; per-client rate limits (global and stricter for `/api/auth/*`) protect each instance in memory. Forgot-password always answers 202.
- REST requests accept a 1 MiB body and are cut off after 30 s. Responses carry `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy` and `Cache-Control: no-store` on `/api`. nginx adds a self-only CSP (fonts are bundled, the web app makes no third-party requests); add HSTS at the TLS terminator.
- Outbound webhooks are still disabled (Constitution III.7). Before enabling a dispatcher, use HTTPS, HMAC signing with an independently stored secret, DNS/IP resolution checks, private-range restrictions, redirects disabled, retries, exponential backoff, DLQ and tenant-level quotas. Outward channels are email (only when `SMTP_URL` is configured) and chat posts to a project's configured incoming-webhook URLs, which are stored sealed and never returned by the API.
- **Second factor and single sign-on.** Two-step verification (TOTP with recovery codes; a workspace can require it), OpenID Connect single sign-on with verified email domains, and SCIM 2.0 provisioning are implemented. They have been exercised only against local test providers. The attachment malware scanner is optional and has only been exercised locally.

## Remaining blockers before production

- Identity and payment integrations have not been run against real providers: SSO, SCIM against a real directory, the payment provider in test mode, and the malware scanner.
- No passkeys or hardware keys.
- Rate limits are per process unless `RATE_LIMIT_SHARED=true`; use ingress limits for a shared budget. `X-Forwarded-For` is trusted only with `TRUST_PROXY=true`.
- Access control: project-level grants, project visibility, guest access and page restrictions inherited down the page tree. There are no issue-level ACLs.
- The owner-role connection is used for system flows. Run the API with a least-privilege owner and keep migrations on a separate role in production.
- Outbound webhook delivery is off (Constitution III.7).
- No external security review, penetration test, or backup and restore drill has been completed.

## Tests in package

- `apps/server/src/tests.rs`: HTTP-level tests through the real router, run when `DATABASE_URL_TEST` is set.
- `apps/server/src/api/common.rs`, `error.rs`, `openapi.rs`: unit tests (role guards, error mapping, OpenAPI coverage).
- `tests/smoke.py`: API-level tenant boundary, search, mutation and workflow checks against a local API.
- `tests/load.js`: k6 sample with p95 and error-rate thresholds; no benchmark result is claimed.
