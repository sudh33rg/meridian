# Meridian Constitution

The governing document for Meridian: what it is, what it must never become, and how work on it is done. Product detail lives in `docs/`; this file is the short, binding layer above it. Where this file and any other doc disagree, this file wins.

## Article I — What Meridian is

Meridian ("Work, connected") is a multi-tenant SaaS for project delivery, knowledge and collaboration. It keeps work tracking and knowledge in one model: objective → project → issue → page → decision → evidence → release, all linked by typed relations.

**Current status: Meridian 0.2 development preview. Not GA. No production data.** The source covers the core and advanced feature areas (work management, knowledge base with real-time collaboration, agile planning & team velocity, service management & portal, portfolios, and mobile companion).

### What the repo contains

| Area | Path | Stack | Role |
|---|---|---|---|
| API | `apps/server` | Rust, Axum, Tokio, SQLx, Argon2id | REST API under `src/api/` (admin, collab, issues, knowledge, org, planning, work, agile, reports, roadmap, service), `auth.rs` (opaque bearer sessions), `error.rs` (typed `ApiError`), `openapi.rs` |
| Database | `apps/server/migrations` | PostgreSQL 17 | Composite `(tenant_id, id)` foreign keys, row level security, GIN full-text indexes; ordered migrations `0001` through `0061` |
| Web | `apps/web` | React 19, TypeScript, Vite, TanStack Query/Router | Feature folders: `auth`, `shell`, `work`, `knowledge`, `agile`, `advanced`, `workspace`; API client typed from `docs/openapi.json` |
| Mobile | `apps/mobile` | Flutter, Material 3 | Companion app: auth, home, issues, reader; secure token storage, local unsent drafts. Verified on the iOS simulator |
| Delivery | `infra/`, `Makefile`, `scripts/` | Docker, Compose, k8s, nginx | Local stack, reference manifests, demo seeding (`scripts/seed_demo.py`), local verification (`scripts/verify.sh`) |
| Docs | `docs/` | Markdown, OpenAPI | Architecture, security, operations, API guide, sync protocol, generated OpenAPI contract |

### Capabilities today

Workspace signup/login, invites, roles (owner/admin/member/viewer), teams; projects, issues (board/list, comments, links, labels, archive, custom fields, issue types, workflows, transitions, security levels); pages with versions, restore, templates, macros, and inline comments; collaborative real-time editing (Yjs over WebSocket); sprints, team velocity charts & predictability metrics, sprint capacity planning, sprint reports, burndown and burnup; releases, goals, RAID register (risks, assumptions, issues, dependencies), roadmaps, milestones, baselines, and critical path analysis; customer service desk, request queues, request types, customer portal, and incident management; approvals, inbox, safe automations, audit log; full-text search; typed entity relations; OpenTelemetry instrumentation and AI drafts; JSON export and idempotent CSV issue import; webhook registration (delivery disabled).

## Article II — Product principles

1. **Connected over siloed.** Work and knowledge reference each other through live links, not copied text.
2. **Simple by default, deep on demand.** The first run is fast; advanced controls exist but never block basic use.
3. **Provenance visible.** Owner, source, version and permission are shown where information is used.
4. **Honest status.** Docs and UI never claim parity, security or readiness that has not been demonstrated.

## Article III — Engineering invariants

These may not be broken without amending this Constitution.

1. **Tenant isolation is absolute.** `tenant_id` comes only from the authenticated session and active membership, never from request bodies or paths. Every tenant query binds it. Cross-entity references use composite `(tenant_id, id)` keys. A guessed UUID from another tenant must yield nothing.
2. **Authorization before data.** Role checks happen server-side on every mutation. Viewers cannot write. Search and listings never return what the caller cannot open.
3. **Secrets never stored in the clear.** Passwords: Argon2id. Session and invite tokens: stored hashed, shown once.
4. **Typed, consistent errors.** All failures go through `ApiError`; no leaking internals.
5. **The API contract is generated.** `docs/openapi.json` comes from the Rust handlers and web types from it (`make openapi`). Never hand-edit generated output.
6. **Migrations are forward-only and ordered.** Never edit an applied migration; add a new numbered one.
7. **Outward actions are off until safe.** Webhook delivery stays disabled until HTTPS, signing, SSRF protection, retries and quotas exist.
8. **Writes are atomic.** New code writes entity, audit and outbox in one transaction (known gap in older handlers; do not widen it).
9. **Docs match reality.** When behavior changes, update the reference documentation in `docs/` and `MANIFEST.json` (`make manifest`) in the same change.

## Article IV — Known gaps (the honest backlog)

Closed since the first preview: PostgreSQL row level security with a tenant-bound transaction per request; browser sessions in HttpOnly cookies with CSRF protection and refresh rotation (`sessionStorage` is gone); email verification, password reset and invitation email through a durable job queue; TOTP two-step verification with recovery codes and a workspace requirement; OpenID Connect single sign-on with verified email domains; SCIM 2.0 provisioning; guests, project grants, and page restrictions; signed webhook delivery with SSRF protection, retries, and auto-disable; attachments with type checks, quotas, and an optional malware scanner; a live change feed and collaborative page editing; team velocity chart with predictability metrics, sprint capacity planning, and sprint reports; RAID register, roadmaps, baselines, and critical path analysis; customer service desk, request queues, and customer portal; inline comments on knowledge pages; automated test suites across server and web; plan limits enforced on the server with a Stripe adapter; the Flutter app compiles, analyzes clean, and signs in on the iOS simulator.

Still open: CI has not yet run on GitHub; Flutter is verified on the iOS simulator only (no Android build, no device testing, mobile does not yet rotate tokens transparently for every screen); the Stripe, SCIM-against-a-real-directory, SSO-against-a-real-provider, and ClamAV paths are written but exercised only locally or not at all; there is no passkey or hardware-key support; rate limits are per process unless configured with shared limits; the `quick-xml` and `rsa` advisories from `cargo audit` remain (no fix is available yet); and no external security review or penetration test has been done.

## Article V — Rules of work

These bind every contributor, human or agent.

1. **Main branch only.** All work is committed directly to `main`. No feature branches, worktrees or PRs unless the owner asks.
2. **Automated tests.** Test suites (Rust unit and HTTP-level integration tests, React unit and component tests with Vitest/Testing Library, Playwright e2e, and smoke tests) are part of standard development and verification. All new features and bug fixes must be accompanied by passing automated tests.
3. **Verification.** Correctness is established through automated test suites alongside visual inspection (web in a browser, mobile in the simulator) and smoke testing (`./scripts/verify.sh` and `python3 tests/smoke.py`).
4. **Verify last.** Finish everything planned first. Verification happens once, after all planned work is done, not after each step. Fix what it reveals, then re-look only at what changed.
5. **Minimal questions.** Decide with sensible defaults and state the choice in the summary. Ask the owner only when blocked on something that is genuinely theirs to decide (money, credentials, irreversible or outward-facing actions, direction changes).
6. **Small, honest commits.** Commit to `main` with clear messages. Report plainly what was verified and what was not.
7. **Stay in scope.** Do what the plan says; record spotted extras in `docs/` rather than silently expanding.

## Article VI — Amendment

Only the owner amends this Constitution. Changes are made by editing this file and committing to `main` with the reason in the message.
