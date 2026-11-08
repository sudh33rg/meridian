# Meridian — best-in-class analysis, comparison and implementation plan

> Status: analysis and plan dated 8 November 2026. Phase A below is implemented in this change and verified as described in section 7. Phases B and C are planned, not built.

## 1. Method and evidence level

- **Field:** the 300 products already listed in `UX_BENCHMARK_AND_PLAN.md` (12 categories) and the 100-product inventory in `COMPETITIVE_LANDSCAPE.md`. Those lists are an inventory. Scoring 300 products hands-on was not feasible in one change, so the comparison below scores **capability patterns** against six representative leaders: Jira, Linear, Confluence, Notion, GitHub and Plane (open source).
- **Scores** are qualitative desk judgments from public documentation and the release notes below. They are a map for prioritisation, not a benchmark. Nothing here was measured against those products' live instances.
- **Meridian's side** was checked in code: routes in `docs/openapi.json` (122 operations), handlers in `apps/server/src/api/`, migrations `0001` to `0014`, and the web client in `apps/web/src`.
- Current-state facts used: Jira's 2026 workflow editor transition (third-party summary; unconfirmed against Atlassian's own notes), Linear's 2026 agent, mobile-navigation and filtering releases, and Stripe's idempotency rules (sources in section 9).

Legend: ● strong and core · ◐ partial, add-on or uneven · ○ absent or deliberately out of scope · — not a target for that product.

## 2. Comparison by capability

| # | Capability | Jira | Linear | Confluence | Notion | GitHub | Plane | Meridian before | Meridian now |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Issue hierarchy (epics, sub-items) | ● | ● | — | ◐ | ● | ● | ◐ (`parent_id`, `epic` kind) | ◐ |
| 2 | Configurable workflow statuses | ● | ● | — | ◐ | ◐ | ● | ○ (four fixed statuses) | ○ (planned C1) |
| 3 | Custom fields with schemas | ● | ◐ | ◐ | ● | ● | ● | ◐ (free JSON only) | ◐ |
| 4 | Query language and saved filters | ● | ● | ● | ● | ● | ◐ | ◐ (client-side filters) | ◐ (server filters, no saved views) |
| 5 | Large lists: paged, no silent truncation | ● | ● | ● | ● | ● | ● | ○ (hard cap of 500, silent) | ● |
| 6 | Bulk operations | ● | ● | ◐ | ◐ | ◐ | ◐ | ○ | ○ (planned B5) |
| 7 | Lost-update protection on edits | ◐ | ● | ● | ● | ● | ◐ | ◐ (pages only, via version) | ● (issues, via `If-Match`) |
| 8 | Idempotent writes for retries | ○ | ● | ◐ | ◐ | ◐ | ○ | ○ | ◐ (issue create) |
| 9 | Live sync and change feed | ◐ | ● | ● | ● | ◐ | ◐ | ◐ (SSE feed) | ◐ |
| 10 | Collaborative rich editing | ◐ | ○ | ● | ● | ◐ | ◐ | ◐ (Yjs, two-user verified) | ◐ |
| 11 | Fine-grained permissions | ● | ● | ● | ● | ● | ◐ | ◐ (project grants, page restrictions) | ◐ (no issue-level ACL) |
| 12 | Audit trail | ● | ◐ | ● | ● | ● | ○ | ◐ (events and audit rows) | ◐ |
| 13 | Public API, OpenAPI, webhooks | ● | ● | ● | ● | ● | ● | ◐ (122 operations; many responses untyped) | ◐ |
| 14 | Keyboard-first UX and palette | ◐ | ● | ◐ | ● | ● | ◐ | ◐ | ● (palette, shortcuts, `g` then key) |
| 15 | Themes, density, contrast | ◐ | ● | ◐ | ◐ | ● | ◐ | ○ | ◐ (themes and contrast; no audit yet) |
| 16 | Mobile companion | ● | ● | ● | ● | ● | ◐ | ◐ (Flutter source, never built) | ◐ |
| 17 | Notifications and preferences | ● | ● | ● | ● | ● | ◐ | ◐ (inbox, no preferences, no outbound) | ◐ |
| 18 | Agile boards, sprints, releases | ● | ● | — | ◐ | ◐ | ● | ◐ (no burndown UI) | ◐ |
| 19 | Import from other tools | ● | ● | ● | ● | ◐ | ◐ | ◐ (JSON batch, no Jira or CSV) | ◐ |
| 20 | Security baseline (RLS, MFA, SSO, SCIM) | ● | ● | ● | ● | ● | ◐ | ● (in code; not externally tested) | ● |
| 21 | Governed AI assistance | ● | ● | ● | ● | ◐ | ○ | ○ (deliberately deferred) | ○ |
| 22 | Self-hosting | ◐ | ○ | ○ | ○ | ◐ | ● | ● (Compose, Kubernetes reference) | ● |

**Reading the table.** Meridian is already at or ahead of most of the field on tenant isolation (row level security plus composite tenant keys), on the typed relation graph that links objectives, issues, pages, decisions and releases, and on honest status documentation. Its clear gaps are the ones that show up in daily use at scale: silent list truncation (fixed now), lost updates (fixed for issues now), unsafe retries (fixed for issue create now), and the absence of configurable workflows, custom field schemas and a query language, which Jira and Linear treat as core.

## 3. What Meridian already does that the leaders do not

- **Typed cross-entity relations** (`/api/relations`) that connect objectives, issues, pages, goals, risks, decisions and releases in one graph. Jira links issues and Confluence links pages; neither ties decisions and releases into the same typed graph. This is the strongest product differentiator in the repository.
- **Tenant isolation enforced in the database.** Row level security with a tenant-bound transaction per request, composite `(tenant_id, id)` keys, and a startup check (`assert_isolation`). Most open-source wikis and trackers rely on application code alone.
- **Webhook delivery with SSRF protection, signatures, retries and auto-disable.**
- **Honest status ledger.** `IMPLEMENTATION_STATUS.md` names what is not proven. Few products publish this.

## 4. Gaps, ranked

| Rank | Gap | Who sets the bar | User impact | Effort | Decision |
|---|---|---|---|---|---|
| G1 | Lists stop silently at 500 rows | All | High: data looks complete when it is not | Small | **Fixed now** (A1, A4) |
| G2 | Edits overwrite newer changes | Linear, Notion, GitHub REST | High: silent data loss between two editors | Small | **Fixed now** for issues (A2, A4) |
| G3 | Retries create duplicates; offline drafts unsafe | Stripe, Linear sync | High for mobile offline drafts | Small | **Fixed now** for issue create (A3, A4) |
| G4 | Fixed workflow statuses | Jira, Linear, Plane | High for teams with their own process | Large | Planned C1 |
| G5 | Untyped responses (`Value`) in many handlers | Stripe, GitHub | Medium: client code has to guess | Medium | Planned B3 |
| G6 | No saved views or query language | Jira JQL, Linear views | High for power users | Large | Planned C3 (saved views in B4) |
| G7 | No bulk edit | Jira, Linear | Medium | Medium | Planned B5 |
| G8 | Notification preferences and outbound delivery | All | Medium | Medium | Planned B6 |
| G9 | Mobile does not yet use paging, ETags or idempotency | Linear mobile | Medium until the app is built | Medium | Planned B2 |
| G10 | Idempotency keys are never pruned | Stripe keeps keys for at least 24 hours, then prunes | Low now, growing table | Small | Planned B1 |
| G11 | No unarchive or archived view | Jira, Linear | Low to medium | Small | Planned B7 |
| G12 | No Jira or CSV importer | Jira, Linear, Asana | High for migrations | Large | Planned C4 |
| G13 | No accessibility audit | GOV.UK, GitHub, Atlassian | Medium, and a release gate | Medium | Planned C5 |

## 5. Implementation plan

### Phase A — implemented in this change

| Step | Work | Where | Status |
|---|---|---|---|
| A1 | Cursor paging for `GET /projects/{id}/issues`: `limit` 1 to 500 (default 500, the old size), `X-Next-Cursor` header, exact `status`, `priority` and `assignee_id` filters, `q` title search with LIKE wildcards escaped. Archived issues excluded. | `apps/server/src/api/work.rs` | done |
| A2 | Optimistic concurrency on `PATCH /issues/{id}/edit`: `ETag` on details and edit responses (`updated_at`, microseconds); optional `If-Match` checked inside the UPDATE; `412 precondition_failed` with no write. Requests without `If-Match` behave as before. | `apps/server/src/api/issues.rs`, `error.rs` | done |
| A3 | Idempotent issue create: optional `Idempotency-Key` (8 to 255 visible ASCII). Response stored in `idempotency_keys` in the same transaction as the issue. Replay returns the original 201 with `Idempotent-Replayed: true`; same key with a different body returns 409. Project row lock serialises concurrent retries. Only successful creates are stored. | `apps/server/src/api/work.rs`, `migrations/0014_idempotency_keys.sql` | done |
| A4 | Web client: loads all issue pages (up to 50 pages, 10,000 issues, with a console warning beyond that); the drawer sends `If-Match` and reloads on 412; board create sends a stable idempotency key and resets it only after a definitive rejection. | `apps/web/src/lib/api.ts`, `features/workspace/useWorkspace.tsx`, `features/advanced/IssueDrawer.tsx` | done |
| A5 | CORS: allow `If-Match` and `Idempotency-Key`; expose `ETag`, `X-Next-Cursor`, `Idempotent-Replayed`. | `apps/server/src/main.rs` | done |
| A6 | Contract and docs: OpenAPI and web types regenerated; `API_GUIDE.md`, `IMPLEMENTATION_STATUS.md` (M1 row and the stale migration count), `docs/README.md`; `MANIFEST.json` regenerated. | `docs/`, `apps/web/src/api-schema.d.ts` | done |

**Design notes for Phase A.** Cursors are the issue number, which is unique per project and ordered descending, so paging is stable under concurrent inserts and needs no offset scan. The response body stays a bare array so existing web and Flutter clients keep working; paging information lives in a header. The idempotency row is written inside the request transaction, so a stored key can never point at a rolled-back issue. The If-Match value is the timestamp itself rather than an opaque hash, so the server compares exact stored values in SQL.

### Phase B — next, small to medium, no new product concepts

| Step | Work | Notes |
|---|---|---|
| B1 | Prune `idempotency_keys` older than 24 hours through the existing durable job queue. | Stripe's rule is at least 24 hours before pruning; a reused, pruned key creates a new issue, which is documented behaviour. |
| B2 | Adopt paging, `If-Match` and `Idempotency-Key` in the Flutter app; rebuild it on a machine with the Flutter SDK. | Blocked on toolchain. Until then the app reads the 500-row first page, as it did before. |
| B3 | Replace `Value` responses with typed schemas for the ten most-used endpoints. | Improves the generated client; no behaviour change. |
| B4 | Saved views per user (name, filter JSON, sort, group) with a small table and CRUD routes. | Filters stay server-side, so permissions apply before filtering. |
| B5 | Bulk status or assignee change with per-item results and one audit entry per item. | Reuses the `If-Match` check per item. |
| B6 | Notification preferences per user and channel; keep outbound delivery off until email rules are reviewed. | Constitution Article III.7 applies to outbound actions. |
| B7 | Unarchive endpoint and an archived view. | Archive is currently one-way. |

### Phase C — larger, each needs its own design and migration

| Step | Work | Notes |
|---|---|---|
| C1 | Configurable workflows: per-project status catalogue, allowed transitions and validators. | Replaces the fixed status enum. Forward-only migration with a backfill. |
| C2 | Custom field schemas (type, options, required, visibility) on top of the JSON `custom_fields`. | Needed before query filters can use custom fields. |
| C3 | A small query language with a parser that compiles to SQL, enforcing project access before filtering. | Permission-first, per Constitution Article III.2. |
| C4 | Jira CSV and Jira JSON importers that keep original keys and history where available. | Migration fidelity is a product feature (`COMPETITIVE_LANDSCAPE.md`). |
| C5 | Accessibility audit (keyboard, focus order, contrast, screen reader) with fixes. | A release gate, not a nice-to-have. |
| C6 | Mobile offline sync and conflict review, using the ETag and idempotency contract from Phase A. | Depends on B2. |

## 6. Deliberately not taken now

- **AI assistants** (Linear Agent and Atlassian's AI features are now mainstream). Recorded in `UX_BENCHMARK_AND_PLAN.md` as needing an owner decision on data policy and provider choice (Constitution Article V.5). Not started.
- **Issue-level ACLs.** Needed for regulated tenants, but they multiply every query. Scheduled after C3, so the query compiler carries the permission filter from the start.
- **Full block editor.** Notion's model is powerful, but it competes with the Yjs page editor that already exists. Extending that editor is a separate workstream.

## 7. Verification

Run in this change, after all planned edits:

- `cargo check` for the API: passes.
- `make openapi`: regenerated `docs/openapi.json` and `apps/web/src/api-schema.d.ts`; the new header parameters and the 412 response are present.
- `npm run build` (type-check plus Vite build): passes.
- `eslint` on the three changed web files: passes.
- Visual and behavioural checks: recorded in section 8.

Per Constitution Article V.2 no automated tests were added or changed.

## 8. Visual and behavioural check results

Run against a disposable PostgreSQL 17 container and an API instance started from the same build, on localhost ports separate from the developer's own services. The database was empty at start.

**API checks: 33 of 33 passed.** Migrations 1 to 14 applied cleanly, including `0014`.

- Paging: 230 issues returned as 200 then 31; `X-Next-Cursor` set on page 1 and absent on the last page; results unique and descending; default size returns all 231 with no cursor.
- Validation: `limit` 0 and 501, a garbage cursor and an unknown status all return 400.
- Search: `q=%` and `q=_off` match literally (one row each), so wildcards are escaped.
- Idempotent create: a repeat with the same key returns the same issue with `Idempotent-Replayed: true`, and only one row exists. The same key with a different body returns 409. A key shorter than 8 characters returns 400. A failed create is not stored, so the same key can then create the issue.
- Concurrency: details return an `ETag`. An edit with a current `If-Match` returns 200 with a new `ETag`. A stale `If-Match` returns 412 with `precondition_failed` and the title is unchanged. An edit without `If-Match` still applies. A malformed `If-Match` returns 400.
- Archive: an archived issue disappears from the list.

**Browser checks (web at localhost, proxied to the verification API):**

- Sign-in, the overview (8 demo issues) and the board render with the paged loader.
- Creating an issue from the New issue dialog creates exactly one row, and it appears in To do.
- Saving a drawer edit persists the new title.
- A stale save shows the conflict banner ("This issue changed while you were editing…"), reloads the latest title, and writes nothing (priority stayed at the server's value).
- With 214 live issues in the project (more than one page of 200), the overview counts all 214 (209 to do, 2 in progress, 1 in review, 2 done). That proves the second page is fetched. It does not show a change from the old 500 cap at this size.

**Not verified:** the 390px mobile layout after this change, Safari and Firefox, screen-reader behaviour, and the Flutter app. The old 500-row cap was not reproduced above 500 issues.

## 9. Sources

- Jira 2026 workflow editor transition, third-party summary: [Appfire JSU release notes, June 2026](https://appfire.atlassian.net/wiki/spaces/JSUCLOUD/pages/3281617218/Release+notes+June+2026)
- Jira platform changes, developer changelog: [Atlassian Developer changelog](https://developer.atlassian.com/cloud/jira/platform/changelog/?frame=0)
- Jira 2026 Spring Release, community post: [Atlassian Community](https://community.atlassian.com/forums/Jira-articles/Introducing-the-Jira-2026-Spring-Release/bc-p/3249329)
- Linear 2026 changelog entries: [Linear agent, 24 March 2026](https://linear-web.pages.dev/changelog/2026-03-24-introducing-linear-agent), [code intelligence, 14 May 2026](https://linear-web.pages.dev/changelog/2026-05-14-code-intelligence), [advanced filters, 13 February 2026](https://linear-web.pages.dev/changelog/2026-02-13-advanced-filters-and-share-issues-in-private-teams), [customisable mobile navigation, 22 January 2026](https://linear-web.pages.dev/changelog/2026-01-22-customize-your-navigation-in-linear-mobile). Mirror of [linear.app/changelog](https://linear.app/changelog/timeline).
- Stripe idempotent requests (key retention, retry behaviour, scope): [Stripe API docs](https://docs.stripe.com/api/idempotent_requests)
- Repository references: `COMPETITIVE_LANDSCAPE.md`, `UX_BENCHMARK_AND_PLAN.md`, `RESEARCH_AND_ROADMAP.md`, `IMPLEMENTATION_STATUS.md`.
