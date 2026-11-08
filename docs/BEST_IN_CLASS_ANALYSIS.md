# Meridian — best-in-class analysis, comparison and implementation plan

> Status: analysis and plan dated 8 November 2026. Phases A, B and C are implemented. The follow-on plan in `REMAINING_PLAN.md` (D1 to D13) is implemented through D12, and D13 is the close-out; results and the gaps still open are in that file and in sections 7 and 8.

## 1. Method and evidence level

- **Field:** the 300 products already listed in `UX_BENCHMARK_AND_PLAN.md` (12 categories) and the 100-product inventory in `COMPETITIVE_LANDSCAPE.md`. Those lists are an inventory. Scoring 300 products hands-on was not feasible in one change, so the comparison below scores **capability patterns** against six representative leaders: Jira, Linear, Confluence, Notion, GitHub and Plane (open source).
- **Scores** are qualitative desk judgments from public documentation and the release notes below. They are a map for prioritisation, not a benchmark. Nothing here was measured against those products' live instances.
- **Meridian's side** was checked in code: routes in `docs/openapi.json` (142 operations), handlers in `apps/server/src/api/`, migrations `0001` to `0018`, the web client in `apps/web/src`, and the Flutter client in `apps/mobile/lib`.
- Current-state facts used: Jira's 2026 workflow editor transition (third-party summary; unconfirmed against Atlassian's own notes), Linear's 2026 agent, mobile-navigation and filtering releases, and Stripe's idempotency rules (sources in section 9).

Legend: ● strong and core · ◐ partial, add-on or uneven · ○ absent or deliberately out of scope · — not a target for that product.

## 2. Comparison by capability

| # | Capability | Jira | Linear | Confluence | Notion | GitHub | Plane | Meridian before | Meridian now |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Issue hierarchy (epics, sub-items) | ● | ● | — | ◐ | ● | ● | ◐ (`parent_id`, `epic` kind) | ◐ |
| 2 | Configurable workflow statuses | ● | ● | — | ◐ | ◐ | ● | ○ (four fixed statuses) | ◐ (per-project statuses with categories; no transition rules) |
| 3 | Custom fields with schemas | ● | ◐ | ◐ | ● | ● | ● | ◐ (free JSON only) | ◐ |
| 4 | Query language and saved filters | ● | ● | ● | ● | ● | ◐ | ◐ (client-side filters) | ◐ (saved views with status, priority and title; no query language) |
| 5 | Large lists: paged, no silent truncation | ● | ● | ● | ● | ● | ● | ○ (hard cap of 500, silent) | ● |
| 6 | Bulk operations | ● | ● | ◐ | ◐ | ◐ | ◐ | ○ | ◐ (status and priority in the UI; assignee in the API; up to 100 issues) |
| 7 | Lost-update protection on edits | ◐ | ● | ● | ● | ● | ◐ | ◐ (pages only, via version) | ● (issues, via `If-Match`) |
| 8 | Idempotent writes for retries | ○ | ● | ◐ | ◐ | ◐ | ○ | ○ | ● (issue create; keys pruned after 24 hours) |
| 9 | Live sync and change feed | ◐ | ● | ● | ● | ◐ | ◐ | ◐ (SSE feed) | ◐ |
| 10 | Collaborative rich editing | ◐ | ○ | ● | ● | ◐ | ◐ | ◐ (Yjs, two-user verified) | ◐ |
| 11 | Fine-grained permissions | ● | ● | ● | ● | ● | ◐ | ◐ (project grants, page restrictions) | ◐ (no issue-level ACL) |
| 12 | Audit trail | ● | ◐ | ● | ● | ● | ○ | ◐ (events and audit rows) | ◐ |
| 13 | Public API, OpenAPI, webhooks | ● | ● | ● | ● | ● | ● | ◐ (122 operations; many responses untyped) | ◐ (142 operations; the new work responses are typed, and the older `Value` responses are listed in `REMAINING_PLAN.md`) |
| 14 | Keyboard-first UX and palette | ◐ | ● | ◐ | ● | ● | ◐ | ◐ | ● (palette, shortcuts, `g` then key) |
| 15 | Themes, density, contrast | ◐ | ● | ◐ | ◐ | ● | ◐ | ○ | ◐ (themes and contrast; no audit yet) |
| 16 | Mobile companion | ● | ● | ● | ● | ● | ◐ | ◐ (Flutter source, never built) | ◐ (uses the new headers; analyzed, not built or run) |
| 17 | Notifications and preferences | ● | ● | ● | ● | ● | ◐ | ◐ (inbox, no preferences, no outbound) | ◐ (per-kind inbox preferences; no email) |
| 18 | Agile boards, sprints, releases | ● | ● | — | ◐ | ◐ | ● | ◐ (no burndown UI) | ◐ |
| 19 | Import from other tools | ● | ● | ● | ● | ◐ | ◐ | ◐ (JSON batch, no Jira or CSV) | ◐ |
| 20 | Security baseline (RLS, MFA, SSO, SCIM) | ● | ● | ● | ● | ● | ◐ | ● (in code; not externally tested) | ● (archive now checks project access) |
| 21 | Governed AI assistance | ● | ● | ● | ● | ◐ | ○ | ○ (deliberately deferred) | ○ |
| 22 | Self-hosting | ◐ | ○ | ○ | ○ | ◐ | ● | ● (Compose, Kubernetes reference) | ● |

**Reading the table.** Meridian is already at or ahead of most of the field on tenant isolation (row level security plus composite tenant keys), on the typed relation graph that links objectives, issues, pages, decisions and releases, and on honest status documentation. Phases A and B closed the gaps that show up in daily use at scale: silent list truncation, lost updates on issues, unsafe retries, bulk changes, archive and restore, saved views and per-kind notification preferences. The clear remaining gaps are configurable workflows, custom field schemas and a query language, which Jira and Linear treat as core.

## 3. What Meridian already does that the leaders do not

- **Typed cross-entity relations** (`/api/relations`) that connect objectives, issues, pages, goals, risks, decisions and releases in one graph. Jira links issues and Confluence links pages; neither ties decisions and releases into the same typed graph. This is the strongest product differentiator in the repository.
- **Tenant isolation enforced in the database.** Row level security with a tenant-bound transaction per request, composite `(tenant_id, id)` keys, and a startup check (`assert_isolation`). Most open-source wikis and trackers rely on application code alone.
- **Webhook delivery with SSRF protection, signatures, retries and auto-disable.**
- **Honest status ledger.** `IMPLEMENTATION_STATUS.md` names what is not proven. Few products publish this.

## 4. Gaps, ranked

| Rank | Gap | Who sets the bar | User impact | Effort | Decision |
|---|---|---|---|---|---|
| G1 | Lists stop silently at 500 rows | All | High: data looks complete when it is not | Small | **Fixed** (A1, A4) |
| G2 | Edits overwrite newer changes | Linear, Notion, GitHub REST | High: silent data loss between two editors | Small | **Fixed** for issues (A2, A4) |
| G3 | Retries create duplicates; offline drafts unsafe | Stripe, Linear sync | High for mobile offline drafts | Small | **Fixed** for issue create, web and mobile (A3, A4, B2) |
| G4 | Fixed workflow statuses | Jira, Linear, Plane | High for teams with their own process | Large | **Partly fixed** (C1): per-project statuses with categories, reordering and deletion rules; transition rules and validators still open |
| G5 | Untyped responses (`Value`) in many handlers | Stripe, GitHub | Medium: client code has to guess | Medium | **Partly fixed** (B3: three existing responses typed, new ones typed; the rest remain) |
| G6 | No saved views or query language | Jira JQL, Linear views | High for power users | Large | **Partly fixed**: saved views (B4); the query language is planned C3 |
| G7 | No bulk edit | Jira, Linear | Medium | Medium | **Fixed** for status, priority and assignee (B5) |
| G8 | Notification preferences and outbound delivery | All | Medium | Medium | **Partly fixed**: per-kind inbox preferences (B6); outbound delivery still off |
| G9 | Mobile does not yet use paging, ETags or idempotency | Linear mobile | Medium until the app is built | Medium | **Partly fixed** (B2): headers, ETag and idempotent create; paging not adopted |
| G10 | Idempotency keys are never pruned | Stripe keeps keys for at least 24 hours, then prunes | Low now, growing table | Small | **Fixed** (B1) |
| G11 | No unarchive or archived view | Jira, Linear | Low to medium | Small | **Fixed** (B7) |
| G12 | No Jira or CSV importer | Jira, Linear, Asana | High for migrations | Large | Planned C4 |
| G13 | No accessibility audit | GOV.UK, GitHub, Atlassian | Medium, and a release gate | Medium | Planned C5 |
| G14 | Archive ignored project access; archived issues could not be read | Constitution Article III.2 | High (access) and medium (usability) | Small | **Fixed** in B7 (found during review and in the browser check) |

## 5. Implementation plan

### Phase A — implemented (commit `e0c133f`)

| Step | Work | Where | Status |
|---|---|---|---|
| A1 | Cursor paging for `GET /projects/{id}/issues`: `limit` 1 to 500 (default 500, the old size), `X-Next-Cursor` header, exact `status`, `priority` and `assignee_id` filters, `q` title search with LIKE wildcards escaped. | `apps/server/src/api/work.rs` | done |
| A2 | Optimistic concurrency on `PATCH /issues/{id}/edit`: `ETag` on details and edit responses (`updated_at`, microseconds); optional `If-Match` checked inside the UPDATE; `412 precondition_failed` with no write. | `apps/server/src/api/issues.rs`, `error.rs` | done |
| A3 | Idempotent issue create: optional `Idempotency-Key` (8 to 255 visible ASCII). Response stored in `idempotency_keys` in the same transaction as the issue. Replay returns the original 201 with `Idempotent-Replayed: true`; same key with a different body returns 409. | `apps/server/src/api/work.rs`, `migrations/0014_idempotency_keys.sql` | done |
| A4 | Web client: loads all issue pages (up to 50 pages, 10,000 issues, with a console warning beyond that); the drawer sends `If-Match` and reloads on 412; board create sends a stable idempotency key. | `apps/web/src/...` | done |
| A5 | CORS: allow `If-Match` and `Idempotency-Key`; expose `ETag`, `X-Next-Cursor`, `Idempotent-Replayed`. | `apps/server/src/main.rs` | done |
| A6 | Contract and docs. | `docs/` | done |

### Phase B — implemented (this commit)

| Step | Work | Where | Status |
|---|---|---|---|
| B1 | Pruning of `idempotency_keys` older than 24 hours. A maintenance loop on the system connection runs at start and hourly, deleting in batches of 5,000. It is a loop, not a queued job: each run is idempotent, so a restart or a second instance does no harm. | `apps/server/src/jobs.rs` (`spawn_maintenance`), `main.rs` | done |
| B3 | Typed responses for issue details (`IssueDetail`, every column), the notification inbox (`Notification`) and my approvals (`Approval`). New endpoints are typed from the start (`SavedView`, `NotificationPreference`, `BulkResult`). **Not done:** the other endpoints the plan named (of ten, three existing ones are typed). | `issues.rs`, `collab.rs`, `personal.rs` | partly done |
| B7 | `POST /issues/{id}/unarchive`; `GET /projects/{id}/issues?archived=true` lists archived issues; the drawer shows an archived banner with Restore and Archive buttons; the issue list has a Show archived toggle. Archive now checks project access (it did not before). Reading comments, links and attachments of an archived issue is allowed, as reading details already was; posting and editing still need an active issue. | `issues.rs`, `work.rs`, `attachments.rs`, web `IssuesTab.tsx`, `IssueDrawer.tsx` | done |
| B5 | `POST /projects/{id}/issues/bulk` with `set_status`, `set_priority` or `set_assignee` (assignee must be a workspace member; `null` clears). Up to 100 distinct issues. One transaction; each item is checked and reported, and archived or foreign issues are skipped with a reason. Each change writes an audit row and an outbox event; status changes run automations. The web has checkboxes and a bulk bar for status and priority. | `issues.rs`, web `IssuesTab.tsx` | done |
| B4 | Saved views: per user and project, up to 50, names unique, filters limited to `status`, `priority`, `assignee_id` and `q`. Views are private to their owner. Web: a view dropdown, Save view and Delete view. **Not saved:** the type filter, which the server does not know yet. | `api/personal.rs`, migration `0015`, web `IssuesTab.tsx` | done |
| B6 | Per-user notification preferences for `approval` and `automation` kinds. Switching a kind off stops new inbox rows for that member. The inbox has a Notify me about panel. **Not done:** email or any outbound delivery. | `api/personal.rs`, `collab.rs` (both inserts), migration `0015`, web `NotificationPreferences.tsx` | done (inbox only) |
| B2 | Flutter client: `Api.request` takes headers; issue status changes send `If-Match` from the loaded ETag and reload after a refused change; issue create sends an `Idempotency-Key` (kept with the offline draft, for a future resend). **Not done:** paging (the app still reads the first 500 rows, which is what it did before), a simulator build and run. | `apps/mobile/lib/core.dart`, `issue.dart`, `home.dart` | partly done (analyzed only) |

### Phase C — implemented (C1 to C6)

| Step | Work | Notes |
|---|---|---|
| C1 | **Implemented:** per-project status catalogue (migration `0016`, `project_statuses`). Each status has an immutable key, a name, a category (`todo`, `in_progress`, `done`) and a board position. Issues reference the catalogue with a composite foreign key. Endpoints: list, create, update (name, category, position) and delete. The board, filters, bulk changes, saved views, the drawer, the overview counts, overdue and the mobile screen all read the project's statuses. **Not done:** allowed transitions and validators, which the notes below explain. |
| C2 | **Implemented in D1.** Custom field schemas (type, options, required, visibility) on top of the JSON `custom_fields`. | Needed before query filters can use custom fields. |
| C3 | **Implemented in D2.** A small query language with a parser that compiles to SQL, enforcing project access before filtering. | Permission-first, per Constitution Article III.2. Saved views (B4) take its filter contract as their starting point. |
| C4 | **CSV implemented in D4.** Jira CSV importers that keep original keys and history where available. | Migration fidelity is a product feature (`COMPETITIVE_LANDSCAPE.md`). |
| C5 | **Implemented in D5 (contrast, labels, focus); remaining gaps recorded in REMAINING_PLAN.md.** Accessibility audit (keyboard, focus order, contrast, screen reader) with fixes. | A release gate, not a nice-to-have. |
| C6 | **Implemented in D6 (paging, draft resend, offline cache); not verified on a device.** Mobile offline sync and conflict review, using the ETag and idempotency contract from Phase A. | Depends on the rest of B2. |

### Design notes for Phase B

- **Authorization.** `archive_issue` previously checked only the workspace, not the project, so an editor could archive an issue in a project they could not see. It now calls the same project-access check as every other issue write. Reads of archived issues use the read-level check, so the drawer can open them.
- **Bulk changes are one transaction.** A single failing item cannot leave a half-applied batch; invalid input (bad action, bad value, empty or over 100) is rejected before any write.
- **Preferences are opt-out.** An absent row means enabled, so existing members keep receiving every notification they received before.
- **Saved views are personal data.** Rows are tenant-scoped by row level security and additionally filtered by user id in every query.

### Design notes for Phase C

- **Keys are fixed, names are not.** Issues store the key, so a key cannot change. Renaming a status changes only its label. A status is deleted only when no issue (archived ones included) uses it, and a project always keeps one To do status, which is where new issues start.
- **Categories drive behaviour, keys do not.** A `done` category status counts as completed and closes an issue for overdue and open counts. A custom status in the `done` category behaves like Done. Overview's "In progress" now counts the `in_progress` category, so an In review issue counts there too.
- **Existing projects keep their statuses.** The migration backfills the four original statuses into every project, in their original order, before it replaces the old fixed check with the foreign key.
- **Transition rules are deliberately deferred.** Any defined status can move to any other, as before. Restricting transitions needs a rule model (who may move what, and when), which should be designed with the query language (C3) rather than bolted onto the board.

## 6. Deliberately not taken now

- **AI assistants** (Linear Agent and Atlassian's AI features are now mainstream). Recorded in `UX_BENCHMARK_AND_PLAN.md` as needing an owner decision on data policy and provider choice (Constitution Article V.5). Not started.
- **Issue-level ACLs.** Needed for regulated tenants, but they multiply every query. Scheduled after C3, so the query compiler carries the permission filter from the start.
- **Full block editor.** Notion's model is powerful, but it competes with the Yjs page editor that already exists. Extending that editor is a separate workstream.
- **Email delivery of notifications.** Outbound delivery stays off until the email rules in Constitution Article III.7 are in place. The preference UI therefore covers the inbox only.

## 7. Verification

Phase A (run in its own change): `cargo check`, `make openapi`, the web build and eslint passed.

Phase B (this change, after all planned edits):

- `cargo check` and `cargo build` for the API: pass.
- `make openapi`: regenerated, 129 operations; the new paths and schemas are present.
- Web: `npm run build` (type-check plus Vite build) and eslint over all of `src`: pass.
- Flutter: `dart analyze lib` (the SDK's own analyzer, run with a scratch `HOME` because the sandbox blocks the analysis server's state directory): no issues. `flutter analyze` and a simulator build were **not** run: the Flutter tool writes to its own cache, which the sandbox blocks.
- No automated tests were added or changed (Constitution Article V.2).

## 8. Visual and behavioural check results

Run against disposable PostgreSQL 17 containers and API instances started from the same build, on localhost ports separate from the developer's own services. The developer's other services were not touched.

### Phase A

**API checks: 33 of 33 passed.** Migrations 1 to 14 applied cleanly.

- Paging: 230 issues returned as 200 then 31; `X-Next-Cursor` set on page 1 and absent on the last page; results unique and descending.
- Validation: `limit` 0 and 501, a garbage cursor and an unknown status all return 400.
- Search: `q=%` and `q=_off` match literally, so wildcards are escaped.
- Idempotent create: a repeat with the same key returns the same issue with `Idempotent-Replayed: true`, and only one row exists. The same key with a different body returns 409. A failed create is not stored.
- Concurrency: an edit with a current `If-Match` returns 200 with a new `ETag`; a stale one returns 412 and writes nothing; an edit without `If-Match` still applies.

**Browser checks:** the board and overview render through the paged loader; a UI create makes exactly one issue; a drawer save persists; a stale save shows the conflict banner, reloads and writes nothing; with 214 live issues the overview counts all of them.

### Phase B

Run after the final build (the same server code as this commit):

- **Phase A regression: 33 of 33 passed** on the Phase B build.
- **Phase B API checks:** 41 of 41 passed in the first run, covering archive, unarchive, the archived list, details of archived issues, bulk changes (duplicates ignored, unknown and archived items reported, invalid input rejected), saved views (create, duplicate, invalid filters, the 50-view limit, delete), notification preferences (defaults, toggle, unknown kind, and the enforcement that stops inbox rows while off), and the typed inbox, approvals and issue details.
- **Pruning (B1):** an expired key and a fresh key were inserted, then the API restarted. Exactly one row was pruned; the fresh keys survived.
- **Browser checks:** the issue list renders the bulk bar, the saved view dropdown and the archived toggle. A bulk status change moved two issues to Done and cleared the selection. A view saved once (a repeated submit did not duplicate it). Archive from the drawer and Restore both worked: the archived list showed the issue with Restore, and the drawer showed the archived banner with Save disabled. Opening an archived issue loads its comments (this was broken until fixed in the review above). The Notify me about switches show and change the stored preference.

**Not verified:** the mobile layout of the new toolbar at 390px (the issue table is cramped at 1024px as well, since the checkbox column was added), the Flutter app on a simulator, Safari and Firefox, screen readers, the view-by-another-member privacy rule (only one member existed in the test workspace), email delivery (not built), and paging in the Flutter app.

**Test-environment note:** the per-client rate limit (HTTP 429) stopped one run of the scripts partway through, because they send many requests in a burst. The limit is working as designed; the checks were rerun after the window cleared.

### Phase C

Run against a disposable PostgreSQL 17 database that was first brought to migration 15 with its original data (a legacy project with one issue in each of the four original statuses), then started on the new build so that migration `0016` ran against that data.

- **Migration backfill:** the legacy project gained the four original statuses in their original order; its four issues kept their statuses; the old fixed check was replaced by the composite foreign key.
- **Database integrity:** inserting an issue with an undefined status is rejected by `issues_status_in_project_fk`.
- **API checks: 34 of 34 passed:** defaults, creation and validation (duplicate keys, bad categories, blank names, letter-first keys), custom statuses on issues (create, PATCH, edit, bulk, filters, saved views), completion counts following the category, reordering (contiguous positions), renaming (key kept), deletion (refused while in use or when it is the last To do status; allowed otherwise; 404 when repeated), and the 20-status limit.
- **Regression:** Phase A 33 of 33 and Phase B 41 of 41, both on the Phase C build.
- **Browser checks:** the board columns come from the catalogue; the Workflow editor added QA, moved it, and refused its deletion while an issue used it (the message named the count); an issue moved into QA with Alt+Right; every status dropdown (board, drawer, filters) lists QA in order. The board's move toast showed the raw key ("qa") until it was changed to the status name.

**Not verified:** a non-admin member being refused (only the owner existed in the test workspace), the Flutter screen on a simulator, the overview's breakdown colours for custom statuses beyond the category colours, and transition rules (not built).

## 9. Sources

- Jira 2026 workflow editor transition, third-party summary: [Appfire JSU release notes, June 2026](https://appfire.atlassian.net/wiki/spaces/JSUCLOUD/pages/3281617218/Release+notes+June+2026)
- Jira platform changes, developer changelog: [Atlassian Developer changelog](https://developer.atlassian.com/cloud/jira/platform/changelog/?frame=0)
- Jira 2026 Spring Release, community post: [Atlassian Community](https://community.atlassian.com/forums/Jira-articles/Introducing-the-Jira-2026-Spring-Release/bc-p/3249329)
- Linear 2026 changelog entries: [Linear agent, 24 March 2026](https://linear-web.pages.dev/changelog/2026-03-24-introducing-linear-agent), [code intelligence, 14 May 2026](https://linear-web.pages.dev/changelog/2026-05-14-code-intelligence), [advanced filters, 13 February 2026](https://linear-web.pages.dev/changelog/2026-02-13-advanced-filters-and-share-issues-in-private-teams), [customisable mobile navigation, 22 January 2026](https://linear-web.pages.dev/changelog/2026-01-22-customize-your-navigation-in-linear-mobile). Mirror of [linear.app/changelog](https://linear.app/changelog/timeline).
- Stripe idempotent requests (key retention, retry behaviour, scope): [Stripe API docs](https://docs.stripe.com/api/idempotent_requests)
- Repository references: `COMPETITIVE_LANDSCAPE.md`, `UX_BENCHMARK_AND_PLAN.md`, `RESEARCH_AND_ROADMAP.md`, `IMPLEMENTATION_STATUS.md`.
