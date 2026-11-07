# Security design and production blockers

## Threat boundaries

- **Tenant isolation is enforced twice.** Each `tenant_id` comes from a hashed, non-expired session and an active membership, never from request bodies or paths, and handlers still bind it in their SQL. Underneath, every authenticated request runs in a single transaction as the `meridian_app` role with `app.tenant_id` set, and PostgreSQL row level security (policies on every table that has a `tenant_id`) confines that transaction to the caller's tenant even if a handler forgets a predicate. `meridian_app` cannot read `users.password_hash`, `login_attempts` or the credential tables, and cannot update or delete `audit_events` or `events`. The API refuses to start if a tenant table lacks RLS or the role switch fails. Cross-workspace flows (sign-in, workspace switch/create, invitation acceptance, the job worker) deliberately use the owner connection and scope each query by hand; they are the only code allowed to see more than one tenant.
- Most cross-entity database references use composite `(tenant_id, id)` foreign keys. `entity_relations` is a polymorphic exception: writes validate both endpoints at the service layer. It checks the tenant, **not** project access, so an editor could create a relation that confirms the existence of an entity in a private project they cannot open (known gap).
- **Roles and project access.** Workspace roles (owner/admin/member/viewer) set the ceiling: viewers can never write. On top of that, a project can be `private`, and users or teams can be granted viewer/editor/admin on it (relation tuples + the `project_access()` SQL function, shared by guards, lists, search and the portfolio). Not yet enforced for private projects: approvals/relations/notifications that merely reference an item, and `/workload` counts (restricted to what the caller can see). Page-level and issue-level ACLs do not exist.
- **Sessions.** Bearer tokens (API/mobile) and browser cookies share one session store. Browsers use HttpOnly `meridian_session` (Path `/api`, SameSite=Lax) and a rotating HttpOnly `meridian_refresh` (Path `/api/auth`, SameSite=Strict); the JSON body is blanked so page scripts never see either. Cookie-authenticated unsafe requests need `X-CSRF-Token` equal to the readable `meridian_csrf` cookie and a matching `Origin`. Access sessions last 8 h, refresh tokens 30 days and are single-use: presenting a used one revokes the whole session family. Users can list and revoke their sign-ins; a password reset revokes all of them. Set `COOKIE_SECURE=true` (implied by `APP_ENV=production`) behind HTTPS.
- **Email tokens** (verify, reset, invitation) are never stored: the database keeps the SHA-256 of an HMAC derived from `APP_SECRET`, a purpose and a row id; the mailer re-derives the raw token when sending. Jobs carry only ids. In development without `SMTP_URL` the API logs the message (including the link) instead of sending; in production a missing SMTP configuration fails the job and never logs a usable link.
- Passwords use Argon2id. Account+workspace login failures are throttled in the database; per-client rate limits (global and stricter for `/api/auth/*`) protect each instance in memory. Forgot-password always answers 202.
- REST requests accept a 1 MiB body and are cut off after 30 s. Responses carry `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy` and `Cache-Control: no-store` on `/api`. nginx adds a CSP (self + Google Fonts); add HSTS at the TLS terminator.
- Outbound webhooks are still disabled (Constitution III.7). Before enabling a dispatcher, use HTTPS, HMAC signing with an independently stored secret, DNS/IP resolution checks, private-range restrictions, redirects disabled, retries, exponential backoff, DLQ and tenant-level quotas. Email is the only outward channel, and only when `SMTP_URL` is configured.

## Remaining blockers before production

- No MFA, SSO/SAML/SCIM, account change-password endpoint, or email-verification enforcement (unverified users can use the product; a banner nags them).
- Rate limits are per process; use ingress limits for a shared budget. `X-Forwarded-For` is trusted only with `TRUST_PROXY=true`.
- Project-level ACLs only (no page/issue/guest ACLs); the ACL gap on `entity_relations`/`approvals` above.
- Owner-role connection is used for system flows; run the API with a least-privilege owner and keep migrations on a separate role in production.
- Google Fonts is a third-party request from the web UI (self-host before regulated use).
- Validate file uploads (type, size, malware scan, object ACL, signed downloads) before shipping attachments.
- Security review: IDOR, SQL injection, XSS, SSRF, CSRF, mass assignment, race conditions, broken object authorization and supply chain; external pentest; backup/restore drills.

## Tests in package

- `apps/server/src/tests.rs`: HTTP-level tests through the real router, conditional on `DATABASE_URL_TEST` (written before the project's no-new-tests rule; left as is).
- `apps/server/src/api/common.rs`, `error.rs`, `openapi.rs`: unit tests (role guards, error mapping, OpenAPI coverage).
- `tests/smoke.py`: API-level tenant boundary, search, mutation and workflow checks against a local API.
- `tests/load.js`: k6 sample with p95 and error-rate thresholds; no benchmark result is claimed.
