# Meridian Constitution

The governing document for Meridian: what it is, what it must never become, and how work on it is done. Product detail lives in `docs/`; this file is the short, binding layer above it. Where this file and any other doc disagree, this file wins.

## Article I — What Meridian is

Meridian ("Work, connected") is a multi-tenant SaaS for project delivery, knowledge and collaboration. It aims to join what Jira (work) and Confluence (docs) keep apart: objective → project → issue → page → decision → evidence → release, all linked by typed relations.

**Current status: Meridian 0.2 development preview. Not GA. No production data.** The source covers M0–M10 feature areas in starter form; no release gate has passed (see `docs/IMPLEMENTATION_STATUS.md`, the source of truth for what exists).

### What the repo contains

| Area | Path | Stack | Role |
|---|---|---|---|
| API | `apps/server` | Rust, Axum, Tokio, SQLx, Argon2id | REST API under `src/api/` (admin, collab, issues, knowledge, org, planning, work), `auth.rs` (opaque bearer sessions), `error.rs` (typed `ApiError`), `openapi.rs` |
| Database | `apps/server/migrations` | PostgreSQL 17 | Composite `(tenant_id, id)` foreign keys, GIN full-text indexes; migrations `0001` (core), `0002` (workspace capabilities) |
| Web | `apps/web` | React 19, TypeScript, Vite, TanStack Query/Router | Feature folders: `auth`, `shell`, `work` (overview, board, issues, knowledge), `advanced`, `workspace`; API client typed from `docs/openapi.json` |
| Mobile | `apps/mobile` | Flutter, Material 3 | Companion app: auth, home, issues, reader; secure token storage, local unsent drafts. Never built yet |
| Delivery | `infra/`, `Makefile`, `scripts/` | Docker, Compose, k8s, nginx | Local stack, reference manifests, demo seeding (`scripts/seed_demo.py`) |
| Docs | `docs/` | Markdown, OpenAPI | Product plan, architecture, security, operations, API guide, roadmap |

### Capabilities today

Workspace signup/login, invites, roles (owner/admin/member/viewer), teams; projects, issues (board/list, comments, links, labels, archive); pages with versions and restore; sprints, releases, goals, risks, decisions; approvals, inbox, safe automations, audit log; full-text search; typed entity relations; JSON export and idempotent issue import; webhook registration (delivery disabled).

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
9. **Docs match reality.** When behavior changes, update `docs/IMPLEMENTATION_STATUS.md` and `MANIFEST.json` (`make manifest`) in the same change.

## Article IV — Known gaps (the honest backlog)

No database RLS; browser session in `sessionStorage`; only four workspace-wide roles (no project/page ACLs); no email delivery, verification, reset, MFA or SSO; no attachments; no real-time or CRDT editing; no functioning webhook dispatcher; no billing; Flutter never built; CI never run on GitHub. Work proceeds along the sequence in `docs/IMPLEMENTATION_STATUS.md`.

## Article V — Rules of work

These bind every contributor, human or agent.

1. **Main branch only.** All work is committed directly to `main`. No feature branches, worktrees or PRs unless the owner asks.
2. **No tests.** Do not write, add or extend automated tests (unit, integration, e2e, load). Existing test files and CI are left as they are, neither expanded nor deleted unless the owner says so.
3. **Visual verification only.** Correctness is established by running the app and looking at it: web in a browser, mobile in the simulator, using the available browser and computer-use tooling. Permission for this is standing; never ask for it.
4. **Verify last.** Finish everything planned first. Verification happens once, after all planned work is done, not after each step. Fix what it reveals, then re-look only at what changed.
5. **Minimal questions.** Decide with sensible defaults and state the choice in the summary. Ask the owner only when blocked on something that is genuinely theirs to decide (money, credentials, irreversible or outward-facing actions, direction changes).
6. **Small, honest commits.** Commit to `main` with clear messages. Report plainly what was verified and what was not.
7. **Stay in scope.** Do what the plan says; record spotted extras in `docs/` rather than silently expanding.

## Article VI — Amendment

Only the owner amends this Constitution. Changes are made by editing this file and committing to `main` with the reason in the message.
