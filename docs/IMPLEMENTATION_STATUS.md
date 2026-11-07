# Meridian — M0–M10 implementation ledger

**Release designation:** Meridian 0.2 — expanded development implementation. **NOT GA.**

This document explicitly distinguishes source code that exists from planned parity with Jira, Confluence and other enterprise tools. A milestone's presence in the source tree is **not** proof that its production release gate has passed.

| Milestone | Delivered in this package | Remaining before milestone can be called complete | Gate |
|---|---|---|---|
| M0 — Platform | Rust/Axum API split into domain modules, typed `ApiError`, `Identity` request extractor, SQLx migrations, Argon2id bearer sessions, tenants/memberships, explicit tenant-scoped queries, login-failure throttling by account, OpenAPI spec + generated web types, CI workflow (fmt, clippy, DB tests, web lint/test/build, smoke, Playwright e2e), Docker Compose, local verification script | DB-enforced RLS (needs transaction-per-request tenant context), robust permission model, wider negative tests, secret rotation, account recovery, trusted proxy rate limits, first CI run on GitHub | **Not passed** |
| M1 — Project work | Project creation, issue CRUD/status and rich edit, searchable fields, assignees, priorities, labels, custom JSON, comments/replies, links, archive, board and list UI | Attachments/object storage, workflow configuration, custom field schemas, project ACLs, bulk operations, subscriptions, history diff and pagination | **Not passed** |
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

**PostgreSQL**: two ordered migrations; tenant-scoped relational constraints; indexes for issue status/search, page content search, timeline and notification retrieval; state-machine and uniqueness constraints.

**React**: responsive application shell, issue board, knowledge editor, issue details, planning and business modules, approvals, analytics, organization members, global search, inbox, audit, and export. The UI intentionally keeps advanced features separated from the four core work views.

**Flutter**: source code for a Material 3 mobile companion with essential team workflows; not all native platform files, emulator tests or push infrastructure are included.

## Release risk inventory (must be addressed before customer data)

1. **No RLS**: the application primarily enforces tenants in query predicates; database policy is required as a second barrier. Introduce a tenant-scoped connection/transaction context before enabling RLS or existing routes will break.
2. **Web authentication**: bearer session in `sessionStorage` exposes sessions to JavaScript if XSS occurs. Implement hardened HttpOnly/SameSite cookie or scoped token/PKCE approach and a robust CSP, session rotation and revocation UI.
3. **Permissions**: only four workspace roles, not fine-grained document, project, issue and guest ACLs.
4. **Invite delivery**: tokens are returned to workspace admins once for manual sharing; no verified email delivery. No email verification or password reset.
5. **Audit/outbox atomicity**: several handlers write audit or outbox after primary commits; upgrade to one transaction with retries/idempotency before GA.
6. **No concurrency-tested live editor**: optimistic versions protect against accidental overwrites but don't provide Google Docs-like simultaneous editing.
7. **Webhook registration only**: URLs are not requested automatically, avoiding unreviewed SSRF risk, but delivery is not functional.
8. **No payment or SSO vendor integration**: entitlement response is development metadata and must not be treated as billing enforcement.
9. **Partial toolchain validation**: Rust, web, PostgreSQL migrations, the API smoke test and browser e2e were executed locally on 7 Nov 2026; the CI workflow has not yet run on GitHub and Flutter has never been built.
10. **No security certification**: no external audit, pentest, verified backups, load run or accessibility certification has been completed.

## Next recommended engineering sequence

1. Push and confirm the first CI run is green (Flutter job in particular).
2. Make all writes transactional with outbox/audit (single event log, see `RESEARCH_AND_ROADMAP.md` Phase 1); add pagination and typed response schemas for the endpoints that still return `Value`.
3. Implement DB RLS using `SET LOCAL app.tenant_id` on every tenant-bound transaction, prove negative cases from independent DB roles.
4. Add organization/project/content ACLs, identity integration and safe admin settings; harden web token lifecycle.
5. Add asset service, live collaborative editor, durable worker queue and webhook/notification dispatch.
6. Finish complete Agile/Confluence feature families, migration tools, real-time search and optional governed AI.
7. Run multi-device E2E, destructive failure testing, DR restore, load soak and accessibility audit before any enterprise GA declaration.
