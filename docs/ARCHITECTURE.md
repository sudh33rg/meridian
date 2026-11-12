# Architecture

## Principles

1. **One domain model.** Projects, work items, pages, decisions, approvals, people and goals link through typed relations. A page or issue is never a detached copy.
2. **Modular monolith.** One Rust API binary with domain modules under `apps/server/src/api/` and background work in the same process, run by a Postgres-backed job queue. Services are split out only when measurements require it.
3. **Tenant boundary from identity.** The tenant comes from the authenticated session and active membership, never from a request body or path. Every query binds it, and row level security confines each request's transaction to its tenant.
4. **PostgreSQL is the source of record.** Composite `(tenant_id, id)` keys for cross-entity references, forward-only migrations, and audit, event and outbox rows written in the same transaction as the change.
5. **Secure by default.** Argon2id password hashing, hashed opaque session and email tokens, HttpOnly cookies with CSRF protection for browsers, rotating refresh tokens, security headers, and a typed error model.
6. **Outward actions are off until safe.** Webhook delivery stays disabled until it has HTTPS, signing, SSRF protection, retries and quotas.

## Components

| Component | Location | Role |
|---|---|---|
| API | `apps/server` | Axum router, domain route modules, typed `ApiError`, OpenAPI generation |
| Auth and sessions | `auth.rs`, `mfa.rs`, `sso.rs`, `scim.rs` | Sign-in, cookies and CSRF, two-step verification, OpenID Connect, SCIM provisioning |
| Tenancy and access | `db.rs`, `api/access.rs`, `api/common.rs` | Tenant-bound transactions, project grants and visibility, role guards |
| Jobs and mail | `jobs.rs`, `mail.rs` | Durable Postgres job queue with retries; SMTP or log mailer |
| Realtime | `realtime.rs`, `collab.rs` | Live change feed and collaborative page editing (Yjs over WebSocket) |
| Attachments | `attachments.rs`, `storage.rs`, `scan.rs` | Type checks, quotas, optional malware scanning; S3-compatible storage or local disk |
| Webhooks | `webhooks.rs`, `safe_http.rs` | Registration and SSRF-safe HTTP helpers; delivery disabled |
| Billing | `billing.rs` | Plan limits enforced on the server; payment provider adapter |
| Web | `apps/web` | React single-page app; typed client generated from `docs/openapi.json` |
| Mobile | `apps/mobile` | Flutter companion app with secure token storage and offline drafts ([`SYNC_PROTOCOL.md`](SYNC_PROTOCOL.md)) |

Domain modules: work and issues, workflow statuses and transitions, custom fields, sprints, team velocity & predictability analytics, releases, roadmaps & RAID registers,
knowledge pages and inline comments, collaboration (comments, approvals, inbox, automations), administration (audit, permission
schemes, roles, security levels), service management (customer portal, queues, incidents), and OpenTelemetry telemetry.

## Data model

Tenant → memberships and users; tenant → teams; tenant → projects → issues, sprints, releases, statuses, issue types,
custom field definitions and pages. Typed relations (`entity_relations`) connect pages, issues, goals, risks,
decisions and releases. Each relation endpoint is checked against the caller's access at the service layer.

## Multi-tenancy

- Pooled PostgreSQL schema: shared tables with `tenant_id`, composite foreign keys, explicit tenant predicates in SQL,
  and row level security as a second layer. The API refuses to start if a tenant table lacks its policy.
- Cross-tenant flows (sign-in, workspace switch, invitation acceptance, the job worker) use the owner connection and
  scope each query by hand. They are the only code that sees more than one tenant.
- Dedicated databases per tenant, regional pinning and tenant moves are not implemented.

## Collaboration and consistency

- Issue edits use `ETag` / `If-Match` concurrency; page edits use `expected_version`.
- Page collaboration uses Yjs documents synchronised over WebSocket. Presence is informational and never grants write access.
- Clients treat realtime messages as hints and reload state after reconnecting.

## Search

PostgreSQL full-text search with GIN indexes, filtered by the caller's project access before ranking. No separate
search service exists. Semantic (vector) search is not implemented.

## Not implemented

- A shared cache layer (Redis or similar).
- A separate worker process or outbox dispatcher; webhook and outbox delivery.
- Dedicated search service, semantic search, and AI grounding beyond the optional draft and summary features.
- Issue-level access control lists.
- Per-tenant cost budgets and noisy-neighbour controls beyond the rate limits in [`OPERATIONS.md`](OPERATIONS.md).

## Performance targets

These are design targets, not measured results: API reads p95 under 150 ms and writes p95 under 300 ms at warm
steady state; board views virtualised above about 1,000 issues; no full-text reindexing, report generation or AI
calls inside request handlers. Measure before claiming any of them.

## Release gates

The provided foundation is not production software until these pass: tenant-isolation tests in CI, role and access
regression tests, an independent security review, dependency and supply-chain checks, a backup restore drill, and
audit-log verification. See [`SECURITY.md`](SECURITY.md).
