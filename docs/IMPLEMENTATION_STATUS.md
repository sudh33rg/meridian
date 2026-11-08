# Meridian — M0–M10 implementation ledger

**Release designation:** Meridian 0.2 — expanded development implementation. **NOT GA.**

This document explicitly distinguishes source code that exists from planned parity with Jira, Confluence and other enterprise tools. A milestone's presence in the source tree is **not** proof that its production release gate has passed.

| Milestone | Delivered in this package | Remaining before milestone can be called complete | Gate |
|---|---|---|---|
| M0 — Platform | Rust/Axum API in domain modules, typed `ApiError`, **PostgreSQL RLS on every tenant table with one tenant-bound transaction per request (commit on success / rollback on error)**, per-tenant gap-free event log (`events`, `sync_id`) written atomically with audit rows, **session families with rotating refresh tokens, HttpOnly cookies + CSRF for browsers, session list/revoke**, email verification / password reset / invitation emails (Mailpit in dev), **durable Postgres job queue**, project visibility + user/team grants, per-client rate limits, security headers, request ids, Prometheus metrics, OpenAPI + generated web types, CI workflow, Docker Compose | Secret rotation, MFA, SSO, shared (ingress) rate limits, OTLP tracing export, wider negative tests, first CI run on GitHub | **Not passed** |
| M1 — Project work | Project creation, issue CRUD/status and rich edit, searchable fields, assignees, priorities, labels, custom JSON, comments/replies, links, archive, board and list UI; cursor-paged issue lists with server-side status, priority, assignee and title filters (the web client loads every page, where it previously stopped silently at 500 rows); `If-Match` concurrency on issue edits (412 on a stale write); `Idempotency-Key` on issue create (migration 0014, tenant-isolated) | Attachments/object storage, workflow configuration, custom field schemas, project ACLs, bulk operations, subscriptions, history diff, saved filters and a query language | **Not passed** |
| M2 — Knowledge | Hierarchical project pages, optimistic update checks, version snapshots, restore, page comments, search, page web editor/reader | True collaborative CRDT rich-text editor, independent spaces/ACLs, templates, macros/embeds, page tree moves, inline comments, whiteboards | **Not passed** |
| M3 — Agile | Sprint planned→active→completed, one-active-sprint enforcement, releases, issue sprint assignment, story points, due dates, issue links, project analytics | Sprint backlog UI + burn charts, scope and capacity modeling, full roadmaps, version issue associations, forecasting | **Not passed** |
| M4 — Collaboration | Issue/page comments, notifications inbox/read state, approval requests, safe allowlisted automation and execution logs, activity records | Real-time presence, CRDT convergence, outbound notification delivery, configurable automation engine, guaranteed transactional outbox producer | **Not passed** |
| M5 — Enterprise | Multi-workspace membership, tokenized invitations (new/existing users), teams, roles, workspace switching, role checks, admin audit and webhook registration | OIDC/SAML, MFA, SCIM, billing/subscription provider, entitlement enforcement, granular ACLs/RLS, retention, SOC2 controls | **Not passed** |
| M6 — Intelligence | PostgreSQL full-text search with GIN indexes, ranked results, typed issue/page/goal/decision/release/risk relations | Semantic search, ACL-aware per-project indexing, AI grounding/evaluations/provider policies, backlinks UI and contextual Q&A | **Not passed** |
| M7 — Portfolio | Goals, RAID risk and decision records, approvals, project overview, cross-project portfolio, assignee workload and basic reporting | Gantt/critical-path, finance/budgets, cross-team capacity planning, sophisticated executive reports | **Not passed** |
| M8 — Ecosystem | Tenant-scoped JSON export (bounded), idempotent batch issue import using external refs, outbound outbox schema, webhook registration **disabled** by default, REST paths | Reliable webhook dispatcher, OAuth apps, Jira/Confluence migration fidelity, retries/DLQ, validated export checksums, full OpenAPI contract | **Not passed** |
| M9 — Mobile | Flutter iOS/Android application source, secure token storage, issue details/comments/status, docs, goals, sprints, inbox, search and locally stored unsent issue drafts | Generated platform folders, end-to-end offline sync and conflicts, push, camera attachment, deep links, accessibility/device matrix | **Not passed** |
| M10 — Delivery/scale | Multi-stage Dockerfiles, full preview Compose, Kubernetes reference manifests, liveness/readiness, local verification script, SQL indexes, smoke and k6 load scripts | Automated CI workflow and successful builds, benchmark results, production secrets, external security tests, disaster recovery drill, operational SLO telemetry | **Not passed** |

## Functional coverage by architecture layer

**Rust**: core API plus advanced domain API; SQLx queries use parameters, authenticated membership sessions, and explicit tenant predicates. There is no external delivery worker or fully custom domain policy engine yet.

**PostgreSQL**: fourteen ordered migrations (0001 to 0014); tenant-scoped relational constraints; indexes for issue status/search, page content search, timeline and notification retrieval; state-machine and uniqueness constraints.

**React**: responsive application shell, issue board, knowledge editor, issue details, planning and business modules, approvals, analytics, organization members, global search, inbox, audit, and export. The UI intentionally keeps advanced features separated from the four core work views. **UX modernization (see `UX_BENCHMARK_AND_PLAN.md`):** semantic design tokens with light, dark, system and high-contrast themes, six accent colors, comfortable/compact density and a reduced-motion setting (stored in the browser only; no server preference yet); a collapsible sectioned sidebar and mobile bottom navigation; a ⌘/Ctrl+K command palette and keyboard shortcuts; toasts with undo; drag-and-drop board (with an Alt+arrow keyboard alternative); issue list with filter, sort and group; skeleton loading and a getting-started checklist. Verified by eye in the browser in dark, light, orange-accent, compact and 390px-wide mobile; **not** verified: a formal accessibility audit or screen-reader pass, Safari/Firefox, touch drag-and-drop on a device, the Playwright e2e suite against this UI (selectors were read, not run), the high-contrast theme, and every legacy admin panel in every theme.

**Flutter**: source code for a Material 3 mobile companion with essential team workflows; not all native platform files, emulator tests or push infrastructure are included.

## Release risk inventory (must be addressed before customer data)

1. ~~No RLS~~ **Done (Phase 1)**: see `SECURITY.md`. Remaining: the system (owner) connection is still used for sign-in and cross-workspace flows, and RLS has been exercised only by the app role switch, not against an externally provisioned least-privilege role.
2. ~~Web authentication in `sessionStorage`~~ **Done (Phase 1)** for the browser (HttpOnly cookies, CSRF, rotation, revoke UI). The mobile app now stores the refresh token and rotates it transparently on a 401 (code written, **not compiled** — no Flutter SDK).
3. **Permissions**: project visibility and grants, guests, and page restrictions inherited down the page tree are implemented. Issue-level ACLs do not exist yet.
4. ~~Invite delivery / verification / reset~~ **Implemented** with a mail abstraction; unverified accounts are not blocked. Real SMTP delivery has only been exercised against Mailpit.
5. ~~Audit/outbox atomicity~~ **Done**: entity, audit, event and outbox writes share the request transaction. Automation rule runs also share it.
6. **Live editing**: pages are edited collaboratively (Yjs/CRDT over WebSocket, verified with two users). Concurrency has not been load-tested beyond that.
7. **Webhooks deliver**: signed, SSRF-protected, retried and auto-disabled after repeated failures. The failure, retry and auto-disable paths are implemented but not yet exercised.
8. **Payments and identity providers**: plan limits are enforced on the server; Stripe Checkout and the portal are written but untested here. SSO was verified against a local OIDC provider only; SCIM was verified through its API only.
9. **Partial toolchain validation**: Rust, web, PostgreSQL migrations, the API smoke test and browser e2e were executed locally on 7 Nov 2026; the CI workflow has not yet run on GitHub and Flutter has never been built.
10. **No security certification**: no external audit, pentest, verified backups, load run or accessibility certification has been completed.

## Next recommended engineering sequence

1. Push and confirm the first CI run is green (Flutter job in particular).
2. Phase 2 of `RESEARCH_AND_ROADMAP.md` (configurable workflows, custom fields, MQL, pagination, typed response schemas for endpoints that still return `Value`).
3. Run CI on GitHub (`act` is installed for a local dry run); fix what it finds, including the Flutter job.
4. Exercise what is written but untested: Stripe Checkout, the ClamAV scan, webhook failure and retry paths, DNS domain verification, SCIM against a real directory, and mobile two-step verification.
5. Passkeys (WebAuthn), Android builds, and an external security review.
6. Finish complete Agile/Confluence feature families, migration tools, real-time search and optional governed AI.
7. Run multi-device E2E, destructive failure testing, DR restore, load soak and accessibility audit before any enterprise GA declaration.
