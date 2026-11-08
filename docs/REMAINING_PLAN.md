# Remaining work: plan, goals and completion tests

Status: plan dated 8 November 2026. It lists everything still open from `BEST_IN_CLASS_ANALYSIS.md`, plus the loose ends found while building Phases A to C. Each step has a goal and a "done when" test. Steps run in this order because later ones depend on earlier ones. Each step is committed to `main` when its own checks pass.

| Step | Goal | Done when |
|---|---|---|
| D1 | **Custom field schemas (C2).** Projects define typed custom fields (text, number, date, boolean, single select) that issues can carry, so teams can track their own data without free-form JSON. | Migration adds field definitions; create and edit validate `custom_fields` against them (type, required, options); the admin API lists, creates, updates and deletes definitions; the drawer shows and edits fields. API checks cover valid and invalid values. |
| D2 | **Query language (C3).** A small, permission-first query syntax (`status:in_progress priority:high assignee:me -label:x cf.region:"EU"`) compiles to parameterised SQL, so power users can filter issues precisely. | The parser rejects unknown fields and malformed input with 400; compiled SQL is parameterised; project access is applied before filtering; the issue list accepts `query=`; the web search box accepts the syntax; API checks cover each operator. |
| D3 | **Workflow transition rules (deferred from C1).** Projects can restrict which status changes are allowed, and a transition can require a field to be set, so "Done" can need a resolution. | Migration adds transition rules; a project with no rules still allows every change (backward compatible); moves that break a rule are refused on every write path (PATCH, edit, bulk, board) with a reason; the workflow editor manages rules; API and browser checks cover both paths. |
| D4 | **CSV importer (C4).** Teams can bring issues from a Jira CSV export, mapping status names onto the project's statuses. | `POST /projects/{id}/import/csv` accepts a bounded CSV, supports a dry run that reports what would change, creates missing statuses on request, and is idempotent through `external_ref`; the importer rejects bad rows with line numbers; API checks cover a dry run and a real import, and a repeat import creates nothing new. |
| D5 | **Accessibility audit (C5).** Find and fix keyboard, label, focus and contrast problems in the web app. | An automated DOM audit (names on controls, labelled fields, focus visibility, contrast of text tokens) reports no failures on the main views; fixes are committed; findings and remaining gaps are recorded. |
| D6 | **Mobile: paging, draft resend, offline view (B2 leftovers, C6).** The Flutter app reads every page, resends unsent drafts with their idempotency keys, and shows the last loaded issues offline. | The issue list reads all pages through `X-Next-Cursor`; drafts can be resent and keep their key; the last issue list is cached and shown when offline; `dart analyze` is clean. |
| D7 | **Typed responses (B3, rest).** Replace the remaining untyped handler outputs for the most-used reads with fixed schemas. | Issue comments, issue links, saved views and search results have typed responses; OpenAPI lists the schemas; the web still builds. |
| D8 | **Saved views and filters carry the new filters.** A saved view can store a query and a type filter, and deleted statuses do not break saved views. | `query` and `kind` are accepted in saved views; a view whose status was deleted is reported as stale rather than silently empty; API checks cover both. |
| D9 | **Permission checks with a second member.** Prove that non-admins cannot change statuses, fields, rules or bulk-manage others' data, and that viewers cannot write. | A second member is invited and accepts; their status, field and rule changes are refused (403); their reads and personal views still work. |
| D10 | **Layout fix for the issue table at 1024px.** The new checkbox and action columns no longer squeeze the title into a narrow column. | Title column keeps a readable width at 1024px and 390px, checked in the browser. |
| D11 | **Housekeeping.** Remove the stray `/tmp/placeholder` file; record the decisions. | The file is gone or the reason it stays is recorded. |
| D12 | **Mobile analysis and a simulator attempt.** Confirm the Flutter app compiles, and try a simulator run if the toolchain allows it. | `dart analyze` is clean; a simulator build is attempted and its result (pass or the exact blocker) is recorded. |
| D13 | **Verification and close-out.** Run every API, browser and static check again on the final build; update the status ledger, the analysis doc and the API guide; commit. | All checks in D1 to D12 are recorded with pass or fail counts; docs match the code; commit on `main`. |

## Ground rules for this plan

- Every step keeps the constitution: tenant isolation from the session, server-side role checks, forward-only migrations, generated OpenAPI, and no automated tests added.
- Where a step needs a choice, the default chosen is written into the step's commit message and into `BEST_IN_CLASS_ANALYSIS.md`.
- Anything a step cannot verify is recorded as not verified, not left implied.

## Results

Recorded at close-out on 8 November 2026. API checks ran against a disposable PostgreSQL 17 database with all 18 migrations applied, on the final build.

| Step | Result | Evidence |
|---|---|---|
| D1 custom fields | Done | `verify_d1` 33/33 |
| D2 query language | Done, with one deviation: the query is served by `GET /projects/{id}/issues/search?query=`, not by a `query=` parameter on the issue list. The web search box uses the search route. | `verify_d2` 38/38 |
| D3 transition rules | Done. Refused on PATCH, edit, bulk and board moves. | `verify_d3` 24/24 |
| D4 CSV importer | Done. Dry run by default; idempotent by `Issue Key`. | `verify_d4` 22/22 |
| D5 accessibility | Partly done. Contrast of text tokens fixed (priority and status labels were 3.1 to 4.3:1). Not done: screen-reader pass and a full keyboard walk. | Browser checks, before commit |
| D6 mobile | Code done: paging through `X-Next-Cursor`, draft resend with the saved key, offline cache. `dart analyze lib` is clean. Not verified on a device. | `dart analyze` |
| D7 typed responses | Done for comments, links, saved views, search, notifications and approvals. The remaining `Value` endpoints are still untyped. | `d7` 3 checks |
| D8 saved views | Done. `query` and `kind` are stored; a view that names a removed status is reported with `stale: true`. | `d8` 14/14 |
| D9 permissions | Done. A second member is refused (403) on status, field and rule changes, and their reads still work. | `d9` 22/22 |
| D10 table layout | Done, with a follow-up fix in `4176fad`. A global `td:first-child` rule gave the checkbox column a 240px minimum, which pushed Status off-screen at 1024px. At 1024px all columns now fit. At 375px the table scrolls inside its container and the page does not. | Browser measurements on the final build |
| D11 housekeeping | Done. Stray `/tmp/placeholder` removed. | File no longer present |
| D12 mobile simulator | Build succeeds for the iOS simulator. The app stayed on a spinner because the keychain read at startup was not guarded; it now starts signed out if that read fails. The sign-in screen renders on iPhone 17 Pro. Signing in on the simulator was not exercised. | Simulator screenshot after the fix |
| D13 close-out | API checks below. Browser checks on the final build: D2 (valid query returns 2 of 2; unknown field shows its error) and D10 (both widths). D1, D3 and D8 were checked in the browser during their steps and by API scripts, not again on the final build. | See counts |

API checks on the final build: `verify_api` 33/33, `verify_phase_b` 41/41, `verify_phase_c` 34/34, `verify_d1` 33/33, `verify_d2` 38/38, `verify_d3` 24/24, `verify_d4` 22/22, `d7` 3/3, `d8` 14/14, `d9` 22/22. Total 264 checks, all passing.

One Phase B check changed. "Unknown filter key → 400" used `kind` as the unknown key. D8 made `kind` a valid saved-view filter, so the check now uses `bogus`. The behaviour is correct; the check was out of date.

Not verified: a browser re-check of D1, D3 and D8 on the final build; behaviour on a physical device or in the simulator beyond the sign-in screen; offline and draft-resend paths on a device; a screen-reader pass; a full keyboard walk; non-admin edge cases beyond D9.

---

## Follow-on plan: parity phases E to P (dated 8 November 2026)

Source: `PARITY_GAP_REGISTER.md`. The owner asked for every feature a Jira-class product needs, in phases, without pausing between them. Each phase is committed to `main` when its own build checks pass. Visual verification runs once, after all planned phases are built (Constitution V.4). Anything that needs an owner decision is marked as such and is not guessed. No automated tests are added (Constitution V.2).

| Phase | Step | Goal | Done when |
|---|---|---|---|
| **E** | E1 | **Ranked product backlog.** Every issue has a fractional rank per project. The backlog lists unsprinted, unarchived, not-done work in rank order. Items move to top, bottom, before or after another item. New issues take the bottom rank. | `GET /projects/{id}/backlog` returns rank order with a typed row; `POST /issues/{id}/rank` moves an item and refuses cross-project anchors; a trigger assigns ranks on every insert path; rank changes do not change `updated_at`. |
| E | E2 | **Team backlogs and team sprints.** Issues and sprints can belong to a team. A team has its own active sprint, and the project allows one active sprint per team (and one for unassigned work). | Migration adds `issues.team_id` and `sprints.team_id`; `PUT /issues/{id}/team` sets the team and refuses a change that would strand the issue in another team's sprint; the backlog filters by team; sprint creation takes a team. |
| E | E3 | **Sprint execution.** Bulk add and remove issues to and from a sprint. Sprint detail shows its issues and goal. Completing a sprint carries unfinished work to the backlog or to a named sprint, and records a closing summary. | `POST /sprints/{id}/issues`, `DELETE /sprints/{id}/issues/{issue}`, `GET /sprints/{id}`; `PATCH /sprints/{id}` accepts `carry_over_to`; completed sprints refuse further membership changes; activation records the committed scope. |
| E | E4 | **Release scope.** A release has scope (issues), a scope freeze, a history of additions and removals, a release action that moves unfinished work, and generated release notes. | Migration adds `release_issues` and release freeze and release dates; `GET/POST/DELETE /releases/{id}/issues`, `GET /releases/{id}`, `GET /releases/{id}/history`, `GET /releases/{id}/notes`; `PATCH /releases/{id}` takes `status` and `freeze`; additions after freeze are flagged. |
| E | E5 | **Burndown, burnup, velocity and scope creep.** A snapshot of each active sprint is stored every hour and at start and close. Velocity uses the closing summaries of the last completed sprints for a team. | `sprint_daily_snapshots` table written by the maintenance loop; `GET /sprints/{id}/burndown` returns stored days plus a live point for today; `GET /projects/{id}/velocity?team_id=&sprints=` returns the rolling average and per-sprint committed and completed points. |
| E | E6 | **Web: backlog, sprint planning, release scope.** A Backlog tab with a team filter and drag-to-rank; a sprint panel with burndown and carryover on close; a release panel with scope, freeze, release action and notes. Team picker in the create dialog and the drawer. | Backlog reorders by drag and by keyboard; sprint and release panels load the new endpoints; the web builds with `tsc -b` and `vite build`. |
| E | E7 | **Contract and docs.** OpenAPI regenerated, manifest regenerated, status ledger and gap register updated. | `make openapi` and `make manifest` run; `IMPLEMENTATION_STATUS.md` names E1 to E7 with their evidence. |
| **F** | F1 | **Components.** Project components with an optional default assignee, filters and roll-ups. | Components CRUD; issues carry components; default assignee applies on create. |
| F | F2 | **Epic and subtask depth.** Epic progress from child issues; child issue views; subtask creation from the drawer. | Epic summary endpoint returns child counts and points; drawer lists children. |
| F | F3 | **Issue type schemes.** Configurable issue types per project (name, icon, hierarchy level, default workflow), with field contexts per type. | Migration replaces the fixed `kind` check with a per-project type table; existing issues migrate to the default types; create and edit validate against it. |
| F | F4 | **Estimates, worklogs, watchers, votes.** Original estimate, remaining estimate, time logged; watchers receive notifications; votes counted. | Worklog CRUD; estimate fields on issues; watcher and vote endpoints; time reports read the worklog table. |
| F | F5 | **Issue content.** Rich text description and comments (markdown subset), comment edit and delete with history, checklists, mentions that notify, dependency view, reminders. | Description stored as markdown with a server-side sanitiser; checklist items CRUD; mention notifications create inbox rows; reminders run from the maintenance loop. |
| F | F6 | **Issue lifecycle.** Clone, move between projects with field mapping, trash with a recovery window, duplicate suggestions when creating. | Clone and move endpoints; trash table with restore; duplicate suggestion query on title trigram-free search. |
| F | F7 | **Transition validators and post-functions, screens.** Validators (fields required, permission), post-functions (set field, notify, create subtask), and per-transition screens. | Post-functions run inside the transition transaction; screens list fields shown per action. |
| F | F8 | **Query language and filters.** Functions (`currentUser()`, `openSprints()`), OR and grouping, ORDER BY; shared saved filters; favourites and recent items. | Parser extended with tests-free fixtures checked by the verification scripts; filters have an owner and a share scope. |
| F | F9 | **Boards.** Swimlanes by assignee, epic or query; WIP limits per column; quick filters; sprint board filter. | Board API returns swimlanes; WIP limit blocks a move with a reason; quick filters persist as saved views. |
| **G** | G1 | **Status history.** Every status change (any write path) appends a row with from, to, actor and time, in the same transaction. | `issue_status_history` table written by one helper used by PATCH, edit, bulk, board, import and transitions; backfill records the creation status. |
| G | G2 | **Flow reports.** Cumulative flow, cycle and lead time, throughput, control chart, created versus resolved, time reports. | Report endpoints compute from status history and worklogs with explicit date ranges. |
| G | G3 | **Change history.** Field-level changelog per issue with actor and time. | `issue_changes` rows written from the edit path and the bulk path; shown in the drawer. |
| G | G4 | **Dashboards.** Dashboards with widgets (filter results, pie and bar charts, sprint and flow gadgets); shareable. | Dashboard and widget tables with validated widget config; read endpoints scoped by project access. |
| G | G5 | **CSV export.** Issues and sprints exported as CSV with formula-injection protection. | Export endpoint streams bounded CSV; cells beginning with `=`, `+`, `-`, `@` are quoted. |
| **H** | H1 | **Timeline and milestones.** Roadmap view of epics, releases and milestones by date. | Milestone table; timeline endpoint returns items with dates and parent links. |
| H | H2 | **Initiatives and portfolio.** Initiative level above epics; cross-project portfolio. | Initiative table linked to epics via relations; portfolio endpoint covers projects the caller can see. |
| H | H3 | **Goals and updates.** Goal progress rolled up from linked work; project updates with health; RAID linked to initiatives. | Progress computed from linked issues; update records with health enumeration. |
| H | H4 | **Capacity.** Capacity per person per week, allocation across projects, overload warnings. | Capacity table and allocation endpoints; workload reads them. |
| H | H5 | **Dependencies and critical path.** Dependency lines from issue links; critical path over dated items. | Critical path endpoint over blocks links with a cycle check. |
| H | H6 | **Baselines.** Save a baseline of dates; compare current to baseline. | Baseline snapshots table; comparison endpoint. |
| **I** | I1 | **Automation engine.** Rules with triggers, conditions, branches, actions and schedules, with a run log and a dry-run. | Rule schema validated; runs logged; scheduled rules run from the maintenance loop; the two fixed rules become presets. |
| I | I2 | **Email and digests.** Outbound email through the job queue, with preferences, unsubscribe and digest schedule. Waits on the Constitution III.7 gates; the gates already exist for webhooks and are reused. | Email jobs send through the queue; digests run on a schedule; unsubscribe link signed. |
| I | I3 | **Chat notifications.** Slack and Teams incoming webhooks through the safe HTTP client. | Per-project channel config; signed or secret-bearing URLs stored sealed. |
| I | I4 | **Git linking.** Issue keys in branch names, commits and pull requests create links. | Inbound webhook with signature check maps keys to issues; links shown in the drawer. |
| I | I5 | **Personal API tokens and OAuth apps.** Scoped tokens stored hashed, shown once; OAuth client registration with consent. | Token table with scopes; OAuth authorize and token endpoints. |
| I | I6 | **Importers.** Jira JSON or Cloud API with changelog, sprints and versions; Confluence space export; Linear, GitHub and Trello. | Each importer runs as a resumable job with a dry run and a count reconciliation. |
| I | I7 | **Marketplace.** Owner decision required (see below). | Not started. |
| **J** | J1 | **Permission schemes and groups.** Per-project schemes mapping actions to roles and groups; custom roles; user groups. | Scheme tables; checks read the scheme; the existing four roles map to default schemes. |
| J | J2 | **Issue security and field security.** Security levels on issues; restricted fields. | Level tables; search and list filters apply levels before results. |
| J | J3 | **Audit log.** Search, filter and export of audit events. | Filtered and paged audit endpoint; CSV export; UI tab. |
| J | J4 | **Retention.** Configurable retention for audit and attachments, with deletion jobs. | Retention settings; job deletes expired rows in batches. |
| J | J5 | **Workspace settings.** Time zone, working days, language, default sprint length, branding. | Settings table and endpoints; dates render in the workspace time zone. |
| **K** | K1 | **Project types and templates.** Scrum, Kanban, bug tracking and service project templates seed statuses, types, fields and boards. | Template catalogue; project creation takes a template. |
| K | K2 | **Service management.** Request types with forms, queues, assignment rules, SLAs with timers, incident and change flows. | Request type and queue tables; SLA timers computed from status history. |
| K | K3 | **Knowledge parity.** Page tree UI, page templates, blog posts, space home. | Templates table; tree UI. |
| K | K4 | **Macros and embeds.** Embedded issue lists, charts and tables in pages. | Macro blocks rendered from stored definitions. |
| K | K5 | **Localisation.** Message catalogues and locale-aware dates and numbers. | Strings extracted; a second locale ships as a proof. |
| **L** | L1 | **Mobile parity.** Backlog, sprint and release views; Android build; a device run. | `dart analyze` clean; Android and iOS builds attempted and recorded. |
| L | L2 | **Offline sync.** Conflict review and background sync for issues and comments. | Sync protocol documented; conflicts shown to the user. |
| L | L3 | **Push.** Push notifications through the job queue. Waits on the owner's choice of push provider. | Not started until the provider is chosen. |
| **M** | M1 | **AI assistance.** Summaries, triage, drafting. Blocked on the owner's data-policy and provider decisions (Constitution V.5). | Not started. |
| **N** | N1 | **Owner-run gates.** First CI run on GitHub, SSO and Stripe exercised against real providers, shared rate limits, tracing export, external security review. | Recorded in `IMPLEMENTATION_STATUS.md` as owner actions. |
| **P** | P1 | **Accessibility.** Screen-reader pass, full keyboard walk, WCAG 2.2 AA checks across the new phases. | Findings and remaining gaps recorded. |

### Owner decisions needed (not guessed)

1. **Marketplace (I7):** whether Meridian should host third-party apps at all.
2. **AI (M1):** data policy and model provider.
3. **Push provider (L3):** which provider and which data may leave the workspace.
4. **Email sender domain (I2):** which domain sends mail for workspaces.

### Results

Recorded per phase as each one lands. Phase E results are in `IMPLEMENTATION_STATUS.md`.
