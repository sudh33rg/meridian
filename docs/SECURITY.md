# Security design and production blockers

## Threat boundaries

- Each `tenant_id` is taken from a hashed, non-expired session token and active membership, not from request bodies or URL paths. Tenant entity queries bind the authenticated tenant ID.
- Most cross-entity database references use composite `(tenant_id, id)` foreign keys. `entity_relations` is a polymorphic exception: writes validate both endpoints at the service layer; DB triggers/typed reference tables are recommended for stronger guarantees.
- Mutation roles: owner/admin/member may work on normal content; viewers cannot create/modify; admins handle invitations, automations, import, teams, audit and integrations. These are **workspace-wide**, not project ACLs.
- Invitation secrets are 256-bit random tokens stored as SHA-256 hashes; the token is only displayed once to an admin. Existing users must authenticate first and their email must match the invitation before accepting it.
- Passwords use Argon2id encoded password hashes. Account+workspace failures are throttled in the database; this is not a substitute for edge IP/reputation throttling or MFA.
- REST requests accept a 1 MiB maximum body through Axum; rate, query complexity, media, and export limits need further hardening.
- Outbound webhooks are disabled. Before enabling a dispatcher, use HTTPS, HMAC signing with independently stored secret, DNS/IP resolution checks, private-range restrictions, redirects disabled, retries, exponential backoff, DLQ and tenant-level quotas.

## High-priority changes before production

- Replace JavaScript-readable bearer session storage with a hardened browser authentication strategy (or short-lived tokens + refresh token rotation); enforce CSRF protection if cookies are adopted.
- Introduce authorization capabilities for project, page, issue, guest and service users; add policy-aware search and cache invalidation.
- Enforce PostgreSQL row-level security in addition to explicit tenant predicates. The existing pool does **not** set the session variable needed for RLS; do not simply enable RLS without a transaction-scoped context.
- Configure CSP, HTTPS/HSTS at ingress, CORS allowlist, trusted proxy configuration, secure cookies, correlation IDs and redaction.
- Add per-IP/account limits at reverse proxy; email verification, password reset, MFA and SSO; session management and revocation UI.
- Validate file uploads (type, size, malware scan, object ACL, signed downloads) before shipping attachment functionality.
- Security review: IDOR, SQL injection, XSS, SSRF, CSRF, mass assignment, race conditions, broken object authorization, tenant leakage and supply chain vulnerabilities.
- Test availability, backup retention, restore drills, network egress filtering and log retention against a documented policy.

## Tests in package

- `apps/server/src/main.rs`: PostgreSQL-backed cross-tenant negative endpoint test, conditional on `DATABASE_URL_TEST`.
- `apps/server/src/api/advanced.rs`: role and validation unit tests.
- `tests/smoke.py`: API-level tenant boundary, search, mutation and workflow checks against local API.
- `tests/load.js`: k6 sample with p95 and error-rate thresholds; no benchmark result is claimed.
