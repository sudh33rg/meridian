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
| D10 table layout | Changed as planned. Re-check at 1024px and 390px is in the close-out visual pass. | Pending the visual pass |
| D11 housekeeping | Done. Stray `/tmp/placeholder` removed. | File no longer present |
| D12 mobile simulator | Build succeeds for the iOS simulator. The app stayed on a spinner because the keychain read at startup was not guarded; it now starts signed out if that read fails. The sign-in screen renders on iPhone 17 Pro. Signing in on the simulator was not exercised. | Simulator screenshot after the fix |
| D13 close-out | API checks below. Visual pass is the last step. | See counts |

API checks on the final build: `verify_api` 33/33, `verify_phase_b` 41/41, `verify_phase_c` 34/34, `verify_d1` 33/33, `verify_d2` 38/38, `verify_d3` 24/24, `verify_d4` 22/22, `d7` 3/3, `d8` 14/14, `d9` 22/22. Total 264 checks, all passing.

One Phase B check changed. "Unknown filter key → 400" used `kind` as the unknown key. D8 made `kind` a valid saved-view filter, so the check now uses `bogus`. The behaviour is correct; the check was out of date.

Not verified: behaviour on a physical device or in the simulator beyond the sign-in screen; offline and draft-resend paths on a device; a screen-reader pass; a full keyboard walk; non-admin edge cases beyond D9.
