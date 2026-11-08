# Meridian — M0–M10 implementation ledger

**Release designation:** Meridian 0.2 — expanded development implementation. **NOT GA.**

This document explicitly distinguishes source code that exists from planned parity with Jira, Confluence and other enterprise tools. A milestone's presence in the source tree is **not** proof that its production release gate has passed.

| Milestone | Delivered in this package | Remaining before milestone can be called complete | Gate |
|---|---|---|---|
| M0 — Platform | Rust/Axum API in domain modules, typed `ApiError`, **PostgreSQL RLS on every tenant table with one tenant-bound transaction per request (commit on success / rollback on error)**, per-tenant gap-free event log (`events`, `sync_id`) written atomically with audit rows, **session families with rotating refresh tokens, HttpOnly cookies + CSRF for browsers, session list/revoke**, email verification / password reset / invitation emails (Mailpit in dev), **durable Postgres job queue**, project visibility + user/team grants, per-client rate limits, security headers, request ids, Prometheus metrics, OpenAPI + generated web types, CI workflow, Docker Compose | Secret rotation, MFA, SSO, shared (ingress) rate limits, OTLP tracing export, wider negative tests, first CI run on GitHub | **Not passed** |
| M1 — Project work | Project creation, issue CRUD/status and rich edit, searchable fields, assignees, priorities, labels, custom JSON, comments/replies, links, archive, board and list UI; cursor-paged issue lists with server-side status, priority, assignee and title filters (the web client loads every page, where it previously stopped silently at 500 rows); `If-Match` concurrency on issue edits (412 on a stale write); `Idempotency-Key` on issue create (migration 0014, tenant-isolated, pruned after 24 hours); archive and unarchive with project-access checks; an archived view; bulk status, priority and assignee changes with per-item results; personal saved views (migration 0015); per-project workflow statuses with categories, reordering and deletion rules (migration 0016) | Attachments/object storage, workflow transition rules and validators, custom field schemas, project ACLs, subscriptions, history diff and a query language | **Not passed** |
| M2 — Knowledge | Hierarchical project pages, optimistic update checks, version snapshots, restore, page comments, search, page web editor/reader | True collaborative CRDT rich-text editor, independent spaces/ACLs, templates, macros/embeds, page tree moves, inline comments, whiteboards | **Not passed** |
| M3 — Agile | Sprint planned→active→completed, one-active-sprint enforcement, releases, issue sprint assignment, story points, due dates, issue links, project analytics | Sprint backlog UI + burn charts, scope and capacity modeling, full roadmaps, version issue associations, forecasting | **Not passed** |
| M4 — Collaboration | Issue/page comments, notifications inbox/read state, approval requests, safe allowlisted automation and execution logs, activity records, per-kind inbox preferences for approval and automation notifications (migration 0015) | Real-time presence, CRDT convergence, outbound notification delivery, configurable automation engine, guaranteed transactional outbox producer | **Not passed** |
| M5 — Enterprise | Multi-workspace membership, tokenized invitations (new/existing users), teams, roles, workspace switching, role checks, admin audit and webhook registration | OIDC/SAML, MFA, SCIM, billing/subscription provider, entitlement enforcement, granular ACLs/RLS, retention, SOC2 controls | **Not passed** |
| M6 — Intelligence | PostgreSQL full-text search with GIN indexes, ranked results, typed issue/page/goal/decision/release/risk relations | Semantic search, ACL-aware per-project indexing, AI grounding/evaluations/provider policies, backlinks UI and contextual Q&A | **Not passed** |
| M7 — Portfolio | Goals, RAID risk and decision records, approvals, project overview, cross-project portfolio, assignee workload and basic reporting | Gantt/critical-path, finance/budgets, cross-team capacity planning, sophisticated executive reports | **Not passed** |
| M8 — Ecosystem | Tenant-scoped JSON export (bounded), idempotent batch issue import using external refs, outbound outbox schema, webhook registration **disabled** by default, REST paths | Reliable webhook dispatcher, OAuth apps, Jira/Confluence migration fidelity, retries/DLQ, validated export checksums, full OpenAPI contract | **Not passed** |
| M9 — Mobile | Flutter iOS/Android application source, secure token storage, issue details/comments/status, docs, goals, sprints, inbox, search and locally stored unsent issue drafts | Generated platform folders, end-to-end offline sync and conflicts, push, camera attachment, deep links, accessibility/device matrix | **Not passed** |
| M10 — Delivery/scale | Multi-stage Dockerfiles, full preview Compose, Kubernetes reference manifests, liveness/readiness, local verification script, SQL indexes, smoke and k6 load scripts | Automated CI workflow and successful builds, benchmark results, production secrets, external security tests, disaster recovery drill, operational SLO telemetry | **Not passed** |

## Functional coverage by architecture layer

**Rust**: core API plus advanced domain API; SQLx queries use parameters, authenticated membership sessions, and explicit tenant predicates. There is no external delivery worker or fully custom domain policy engine yet.

**PostgreSQL**: eighteen ordered migrations (0001 to 0018); tenant-scoped relational constraints; indexes for issue status/search, page content search, timeline and notification retrieval; state-machine and uniqueness constraints.

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
2. Done since this list was written (see `REMAINING_PLAN.md` for results): configurable workflows, custom fields, the query language, transition rules, the CSV importer, cursor paging on mobile, and typed responses for the most-used reads. Still open: typed responses for the remaining `Value` endpoints.
3. Run CI on GitHub (`act` is installed for a local dry run); fix what it finds, including the Flutter job.
4. Exercise what is written but untested: Stripe Checkout, the ClamAV scan, webhook failure and retry paths, DNS domain verification, SCIM against a real directory, and mobile two-step verification.
5. Passkeys (WebAuthn), Android builds, and an external security review.
6. Finish complete Agile/Confluence feature families, migration tools, real-time search and optional governed AI.
7. Run multi-device E2E, destructive failure testing, DR restore, load soak and accessibility audit before any enterprise GA declaration.

## Phase E — backlogs, team scope, sprint execution, release scope (8 November 2026)

Source of the requirement: `PARITY_GAP_REGISTER.md` sections 1 and 2. Built as migration `0019_backlogs_and_release_scope.sql` plus `apps/server/src/api/agile.rs`, `apps/server/src/api/releases.rs`, and the web planning views in `apps/web/src/features/agile/`.

| Step | What exists in source | Still open or not verified |
|---|---|---|
| E1 product backlog | Fractional project-wide rank on every issue (trigger on every insert path, backfill for existing rows). `GET /projects/{id}/backlog` (rank order, team, assignee, search, paged with `X-Next-Cursor`). `POST /issues/{id}/rank` with top, bottom, before or after an anchor; one renumbering pass when float precision runs out. | Ranks are not rebalanced in the background. Board and list views do not yet sort by rank. |
| E2 team backlogs | `issues.team_id` and `sprints.team_id`, with composite foreign keys. `PUT /issues/{id}/team` (refused while the issue sits in another team's sprint). Team picker in create and in the issue drawer. One active sprint per team and per project scope (partial unique index). | Team-level permissions and team capacity are in phase H. |
| E3 sprint execution | `POST /sprints/{id}/issues` and `DELETE /sprints/{id}/issues/{issue}` report a reason for each refused item. `GET /sprints/{id}` returns the sprint, totals and issues. `PATCH /sprints/{id}` edits name, goal and dates, starts a sprint (recording committed scope) and completes it with `carry_over_to` (backlog or another open sprint for the same team). Completed sprints refuse membership changes. | Sprint capacity is not modelled. |
| E4 release scope | `release_issues` holds membership with add and remove times, so history is kept. Scope freeze (`freeze`, one-way); additions and removals after the freeze are flagged. `PATCH /releases/{id}` releases (moving unfinished work to the backlog or another planned release) or cancels. `GET /releases/{id}` totals; `GET /releases/{id}/issues`; `GET /releases/{id}/history`; `GET /releases/{id}/notes` (markdown: bugs fixed, changes, not shipped). | Releases are not yet linked to versions on issues or to deployments. |
| E5 burndown and velocity | `sprint_daily_snapshots`, written at start, at close and by the hourly maintenance loop (`capture_active_sprints`). `GET /sprints/{id}/burndown` returns stored days plus a live point for today. `GET /projects/{id}/velocity` averages completed points of the last N closed sprints for a team or the project. | Snapshots begin when this build runs; earlier days are not reconstructed. Scope-creep figures use the committed scope recorded at start. |
| E6 web | Backlog tab (team filter, search, drag to rank, Alt+↑/↓ to rank, “To sprint” menu, open sprint cards that accept drops). Sprints tab (create, start, close with carry-over, remove issues, burndown, velocity). Releases tab (create, scope, freeze, release, cancel, history, notes with copy). | Browser checks not yet run. Drag and drop has no touch fallback beyond the menu. |
| E7 contract | `make openapi` (157 operations), `make manifest`, `npm run build` (type-check and Vite build) and eslint on the changed files: all pass. | The API has not been run against PostgreSQL in this phase; migration 0019 and the new queries are checked at the visual-verification step. |

No automated tests were added or changed (Constitution Article V.2). Verification is recorded at the end of the parity plan (see `REMAINING_PLAN.md`).

## Phase F — issue model depth (8 November 2026, partial)

Migration `0020_issue_depth.sql`; API in `apps/server/src/api/issue_depth.rs`; web in `apps/web/src/features/agile/IssueDepth.tsx` and `SprintCard`/`CreateModal` changes.

| Step | What exists in source | Still open |
|---|---|---|
| F1 components | Project components with name, description, default assignee and issue count. `PUT /issues/{id}/components` (at most 20, same project). An unassigned issue takes the default assignee of its first component. | Default assignee is not applied on create (only when components are set). |
| F2 epics and subtasks | `GET /issues/{id}/children`, `GET /issues/{id}/rollup` (children done, points, estimates, remaining, logged), `POST /issues/{id}/subtasks` (one level deep). Drawer lists subtasks and creates them. | Epic-specific reports and a child board are in G and K. |
| F3 issue type schemes | Migration `0026_issue_types.sql`: each project owns its types (key, name, icon, hierarchy level 0 or 1, up to 12). Existing projects keep task, bug, story and epic; new projects are seeded in the create transaction. Issues reference the project's types with a composite foreign key, replacing the fixed CHECK. Create, edit, subtasks (standard types only), move, CSV and admin import, query `kind:` and the web create and filter menus use the project's types. `GET/POST /projects/{id}/issue-types`, `PATCH/DELETE /projects/{id}/issue-types/{key}`. | Per-type default workflow and field contexts. The web has no type editor yet (API only). Icons are a fixed set of eight names. |
| F4 time and people | Original and remaining estimates (minutes), worklogs with author and day, delete by author or admin, watchers (add and remove), votes (count and voted). Drawer shows all of it. | Time reports by person and project (G2). Estimates do not reduce automatically when time is logged. |
| F5 content | Checklists (add, tick, rename, delete). `@handle` mentions in comments notify the member (handle is the part of the email before `@`). Comments can be edited by their author and deleted by the author or an admin (migration `0027`); earlier texts are kept in `issue_comment_revisions` and shown in a history that only the author and admins can read. The drawer has Edit, History and Delete. | Rich text descriptions (markdown with a sanitiser), reminders from the maintenance loop, reactions. Editing does not re-notify mentions. |
| F6 lifecycle | Clone (copies content, classification, estimates, components; not assignee, sprint, parent or subtasks). Move to another project (keeps the status if the target has it, keeps the type if the target defines it and otherwise uses the target's default, keeps custom fields the target defines and names the rest, releases sprint, release scope and components, leaves a comment with the old key). Similar issues while creating (full-text on titles). Trash (migration `0028`): `POST /issues/{id}/trash` archives and records `trashed_at`, `trashed_by` and a restore date 30 days ahead; `POST /issues/{id}/restore` brings back either state; `GET /projects/{id}/trash` lists trashed issues for editors. The drawer has Move to trash and Restore from trash. | The automatic purge after 30 days is not built: several foreign keys to `issues` have no cascade (for example `issue_status_history` and `issues_parent_tenant_fk`), so a purge needs its own plan. No dedicated trash view in the web app; trashed issues appear under Show archived. Duplicate links. |
| F7 transitions | Migration `0029_transition_validators_actions.sql`. Validators: a required field (D3) and `requires_admin`, which lets only a workspace admin or owner make the change (automations never pass it). Post-functions, run in the same transaction as the status change from the shared history hook and from automations: `set_field` writes a value into a custom field (validated against its definition); `notify_admins` notifies owners and admins. Up to five per rule through `GET/POST /projects/{id}/transitions/{from}/{to}/actions` and `DELETE .../actions/{action_id}`. A field a post-function writes cannot be deleted. The workflow editor has an "Admins only" option. | Per-transition screens; a web editor for post-functions; further post-functions (create subtask, notify assignee). Post-functions do not write a change-history row for the field they set. |
| F8 query and filters | In the query language (no migration): `OR` joins two filters into one group; `assignee:currentUser()`; `sprint:openSprints()`, `sprint:none`, `sprint:<id>`; one `order:` term (rank, priority, updated, number). Covered by the query parser's rules, no new migration. | Nested groups and parentheses; functions beyond these; saved filters shared between members (scope and owner); favourites and recent items. |
| F9 boards | WIP limits (migration `0030`): a status column can have a limit (`PUT /projects/{id}/statuses/{key}/wip-limit`, project admins). A move into a full column is refused with the count, on every status write path and for automations. The board header shows `count / limit`. Swimlanes: `GET /projects/{id}/board?group_by=none\|assignee\|epic` returns lanes (at most 2,000 issues, archived and trashed excluded); the board groups by assignee or epic and shows the quick filters Mine, Unassigned and High priority. | Quick filters are kept in this browser per project (localStorage), not as saved views: saved views are issue-list filters that the server checks for staleness, and a board filter would not fit that check. Moving a card between lanes changes its status only, not its assignee or epic. A WIP check on creating issues (not refused on purpose). Browser checks not yet run. |

Checks: `cargo check` and `npm run build` (type-check and Vite build) pass. `make openapi` regenerated; `make manifest` regenerated. No tests added. Not yet run against PostgreSQL or in a browser (see the verification step at the end of the plan).

**Second build (F3, F5 to F9, same day).** Migrations `0026` to `0030`. New or changed routes are listed in `API_GUIDE.md` (issue types, comment edit, delete and history, trash and restore, post-function actions, WIP limit). `cargo build`, `make openapi` (the contract now has 238 operations), `make manifest` and `tsc -b` pass. Not run against PostgreSQL and not viewed in a browser; see the verification section below.

## Phase G — history and reports (8 November 2026)

Migrations `0021_history_and_reports.sql` and `0022_dashboards.sql`; API in `apps/server/src/api/history.rs` and `reports.rs`; web in `apps/web/src/features/agile/ReportsPanel.tsx` and the issue drawer's History section.

| Step | What exists in source | Still open |
|---|---|---|
| G1 status history | `issue_status_history` written in the same transaction as every status change: create (CSV import, admin import, API create, clone, subtask), PATCH, edit, bulk, board moves (through PATCH), and project moves. Existing issues start with one row at their creation state. | Moves made before migration 0021 are not reconstructed. |
| G2 reports | `GET /projects/{id}/reports/flow` (issues per status per day), `cycle-time` (lead and cycle time, median and average, control-chart points, throughput per ISO week), `created-resolved` (per day), `time` (logged time by person and issue). Date ranges are inclusive and capped at 366 days. Web Reports tab shows them. | Filters beyond date range (team, assignee, label) are not yet in the reports. |
| G3 change history | `issue_changes` rows for title, description, kind, priority, assignee, sprint, parent, story points, due date, team and project moves. `GET /issues/{id}/history` merges status and field changes. Drawer shows the timeline. | Labels, custom fields and estimates are not yet tracked in the change log. |
| G4 dashboards | Dashboards are per project, private unless shared, with widgets for status, priority, assignee counts, time by person, cycle summary and velocity. Widget data is computed on read. | Flow and time-series widgets are not drawn as charts on dashboards; drag-to-arrange is not built. |
| G5 CSV export | `GET /projects/{id}/export.csv` (active issues, at most 10,000 rows). Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are neutralised. Web Export CSV button. | Sprint and release exports, and an export of history. |

Checks: `cargo check`, `make openapi`, `make manifest`, `npm run build` pass. No tests added. Not yet run against PostgreSQL or in a browser.

## Phase H — roadmaps, portfolio, capacity (8 November 2026)

Migration `0023_roadmaps.sql`; API in `apps/server/src/api/roadmap.rs`; web in `apps/web/src/features/agile/RoadmapPanel.tsx`.

| Step | What exists in source | Still open |
|---|---|---|
| H1 timeline and milestones | Milestones (create, edit, mark reached, delete). `GET /projects/{id}/timeline` returns epics (with child progress), releases, open sprints and milestones with dates. `GET /projects/{id}/dependencies`. | No drag-to-reschedule; the timeline is read-only and dates are edited on their own objects. |
| H2 initiatives | Tenant-level initiatives with status and target date. Epics join with `PUT /initiatives/{id}/epics` (only epics in projects where the caller can edit). Progress counts only epics in projects the caller can open. | Initiative pages and owners' views; a portfolio roll-up across projects beyond epic counts. |
| H3 updates and goals | Project updates with health (on track, at risk, off track). Goals link to issues (`PUT /goals/{id}/issues`) and report progress from linked work (`GET /goals/{id}/progress`). | Goal check-in cadence and reminders. |
| H4 capacity | Member capacity in hours a week (admin sets it). `GET /capacity` compares remaining estimates of open work with capacity, limited to projects the caller can open. | Allocation across projects over time; capacity by week. |
| H5 critical path | `GET /projects/{id}/critical-path`: longest chain of open issues linked by blocking relations, weighted by remaining estimate (60 minutes when unset). Reports loops instead of guessing. | Float and slack per item; calendar-aware scheduling. |
| H6 baselines | Snapshot of open issues' due dates, and variance against it (`GET /baselines/{id}/variance`). | Scenario comparison and schedule re-baselining. |

Checks: `cargo check`, `make openapi`, `make manifest`, `npm run build` pass. No tests added. Not yet run against PostgreSQL or in a browser.

## Phase I — integrations and automation (8 November 2026, partial)

Migration `0024_integrations.sql`; API in `apps/server/src/api/integrations.rs` and `collab.rs` (automation); web in `apps/web/src/features/agile/IntegrationsPanels.tsx` and the drawer’s Development section.

| Step | What exists in source | Still open |
|---|---|---|
| I1 automation | Rules have conditions (priority, kind, status, label, team, assignee; eq or neq) and up to five actions (set priority, set status through the workflow, set assignee, add label, comment, notify admins). Triggers: created, status changed, updated, comment added. Actions never start other rules. Changes from actions are recorded in the history. Rules are created through the API. | No visual rule builder yet (the existing Automations page lists and creates preset rules only). Scheduled rules, branches and cross-project rules are not built. |
| I2 email and digests | Not built. Constitution III.7 keeps outbound delivery off until its gates are in place. | Email for notifications and digests, behind a server setting that defaults to off. |
| I3 chat | Not built. Sending issue content to Slack or Teams is data egress, which needs the owner’s decision on channels. | Incoming webhooks through the safe HTTP client, once approved. |
| I4 git linking | `PUT/GET /api/projects/{id}/git-secret` (admin; sealed at rest). `POST /api/integrations/git/{id}` takes push and pull request events signed with `X-Hub-Signature-256`; keys like `KEY-123` link commits and pull requests to issues. Drawer lists the links. | Other hosts’ event formats (GitLab, Bitbucket), branch names, and status updates from merges. |
| I5 tokens | Personal API tokens (`mtk_…`), shown once, stored as SHA-256, read or write scope, optional expiry, revocation, last-used time. Read tokens refuse changes. Tokens cannot create tokens. Panel on the Integrations page. | OAuth 2.0 apps with consent, and per-token project restriction. |
| I6 importers | Jira CSV (from D4) only. | Jira JSON or Cloud API with changelog, sprints and versions; Confluence space export; Linear, GitHub and Trello. |
| I7 marketplace | Not started. Owner decision: whether third-party apps are hosted at all. | — |

Checks: `cargo check`, `make openapi` (222 operations), `make manifest`, `npm run build` pass. No tests added. Token authentication has not been exercised against a running API.

## Phases J and K (partial, 8 November 2026)

Migration `0025_workspace_settings.sql`; `apps/server/src/api/settings.rs`; project templates in `statuses.rs`.

| Step | What exists in source | Still open |
|---|---|---|
| J1 permissions and groups | Teams already work as groups for project grants (from earlier phases). | Permission schemes that map actions to roles per project; custom roles. Not built: each handler checks the four fixed roles. |
| J2 issue security and field security | Not built. | Security levels on issues and restricted fields, filtered before results. Needs a design pass with the query language, per Constitution III.2. |
| J3 audit log | Admin audit page: `GET /api/audit/events` filters by action, entity type, member and UTC date range, pages with `X-Next-Cursor` (newest first, 50 per page, up to 200), and `GET /api/audit/export.csv` exports up to 10,000 matching events with formula-injection quoting. The Audit trail tab uses both. The older `GET /api/audit` (500 rows, no filters) remains. | Free-text search across event details is not built: events store only action, entity type and entity id. Not yet run in a browser. |
| J4 retention | Not built. Audit rows are immutable for the application role (Constitution, SECURITY.md), so retention needs an owner decision on what may be deleted and when. | Retention settings and deletion jobs, after that decision. |
| J5 workspace settings | Time zone (format-checked, not validated against the IANA database), working days, week start, default sprint length; admins edit them in Appearance. | Branding and custom domain. Dates are not yet rendered in the workspace time zone. |
| K1 templates | Project creation takes a template that seeds starting statuses: software (default), kanban, bug tracking, service requests. | Fields, boards and automation rules per template. |
| K2 service management | Not built. | Request types with forms, queues, assignment rules, SLA timers, incident and change flows. |
| K3 knowledge parity | Not built. | Page templates, blog posts, space home, page tree UI. |
| K4 macros | Not built. | Embedded issue lists and charts in pages. |
| K5 localisation | Not built (English only). | Message catalogues and locale-aware dates and numbers. |

Checks: `cargo check`, `make openapi`, `make manifest`, `npm run build` pass. No tests added.

## Verification status for Phases E to K (8 November 2026)

Migrations `0001` to `0025` apply in order to an in-process PostgreSQL-compatible database. The API has not been run against a database for these phases and no new endpoint has been exercised. The web app builds and the changed files lint clean; no page has been viewed in a browser. Phases L, M, N and P are not started, and phases I2, I3, I6, I7, J2, J4, K2 to K5 are open (see the phase sections above and `REMAINING_PLAN.md`). Visual verification waits until the planned work is complete, as the working rules require.

## Verification status for the F3 to F9 build (8 November 2026)

- **Built and compiled:** `cargo check` and `cargo build` for the server; `tsc -b` for the web app; `make openapi` and `make manifest` regenerated.
- **Not run against PostgreSQL.** Docker/Colima could not start from the build sandbox (the VM did not come up), and no local PostgreSQL or package registry was reachable, so migrations `0026` to `0030` have not been applied and no new endpoint has been called. The one risk to check first is migration `0026`: it drops the fixed `issues_kind_check` constraint by its default name and adds a composite foreign key to `issue_types`.
- **Not viewed in a browser.** No page of this build has been looked at.
- **Owner action to finish verification:** start Docker, run `make up`, then `make dev-api` and `make dev-web`. Confirm migrations `0026` to `0030` apply on a database that already has `0001` to `0025`; create a project and check Issue types (through the API), a comment edit and delete with history, Move to trash and Restore, a workflow rule with "Admins only", a WIP limit on a board column, and the query `status:todo OR status:done order:priority`.

## Verification run after the E to K build (8 November 2026)

Run against PostgreSQL 17.11 (container, migrations 0001 to 0025 applied by the API at startup) and the Vite dev server.

- **API: 78 of 78 checks passed.** Covered: signup, teams, projects and the kanban template; issue create with idempotency; ranking (top, before, after, refusal without anchor, 120 consecutive moves); team backlog; sprint membership with a cross-team refusal; start, complete and carry-over; velocity; release scope with freeze, after-freeze flag, removal history, notes and release; components, estimates, worklogs, watchers, votes, checklist, subtasks, roll-up, clone, move, similar, history; flow, cycle-time, created-resolved, time and CSV reports; dashboard with widgets; milestones, timeline, links, critical path, initiatives, updates, capacity, baselines and variance; read token (reads allowed, writes and token creation refused); signed push linking a commit, bad signature refused, dev links; custom automation (priority and label set); workspace settings.
- **Defect found and fixed:** the subtask roll-up reported logged time from subtasks only; it now includes the issue's own worklogs.
- **Browser (Chrome via the built-in pane):** Backlog (ranked rows, sprint lane, keyboard Alt+↑ re-ranks), Sprints, Releases (scope, freeze flag, progress), Reports (status, cycle time, created and resolved, time, dashboards), Roadmap (timeline, milestone, critical path, updates, initiatives), the issue drawer (team, components, estimates, worklog form), Integrations (tokens panel). Two layout problems were fixed (backlog row cramped; checkbox chips oversized). Status keys in the report now show status names.
- **Not checked in the browser:** choosing a sprint from the backlog's "To sprint" menu (native select did not take the keyboard choice in this pane; the same path was checked through the API), creating a project from the template picker, the workspace settings panel, the git link panel, the drawer's history and development sections (rendered by code, not looked at), dark theme, mobile widths, touch, and screen readers. Mobile (Flutter) was not built.
- **Still not built:** phases L, M, N, P and the open items listed above.
