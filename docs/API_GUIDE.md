# Meridian REST API guide

All core routes are prefixed `/api`. Except authentication and health checks, a route needs `Authorization: Bearer <opaque-token>`. The tenant is resolved from session+membership; callers never supply a trusted `tenant_id`.

## Identity and platform

| Verb | Route | Description |
|---|---|---|
| POST | `/auth/signup` | Create new workspace and founding account |
| POST | `/auth/login`, `/auth/logout` | Session creation and revocation |
| POST | `/auth/accept-invite` | New user joins by invitation token |
| POST | `/auth/accept-invite-existing` | Existing authenticated user joins with token |
| GET | `/me`, `/workspaces`, `/members` | Identity and accessible workspace resources |
| POST | `/workspaces/switch` | Start a new session for another membership |
| GET / POST | `/invitations`, `/teams` | Admin invitations and team management |
| POST | `/teams/{id}/members` | Add an existing workspace member to a team |

### Sessions, recovery and access

| Verb | Route | Description |
|---|---|---|
| POST | `/auth/refresh` | Rotate the session. API clients send `{"refresh_token"}`; browsers rely on the cookie. A reused refresh token revokes its session family |
| POST | `/auth/forgot-password`, `/auth/reset-password` | Always 202 / reset by emailed one-time token (ends all sessions) |
| POST | `/auth/verify-email`, `/auth/resend-verification` | Confirm email / resend the confirmation |
| POST | `/auth/change-password` | Needs the current password; ends every other sign-in |
| GET | `/sessions` | Your active sign-ins in this workspace |
| DELETE | `/sessions/{id}` | Revoke one sign-in |
| POST | `/sessions/revoke-others` | End every sign-in but this one |
| GET / PUT | `/projects/{id}/access` | List / set grants (viewer, editor, admin) for a user or team. Project admins only |
| DELETE | `/projects/{id}/access/{subject_type}/{subject_id}` | Remove a grant |
| PATCH | `/projects/{id}` | Set `visibility` to `workspace` or `private` |

Browser clients send `X-Auth-Mode: cookie` on sign-in (tokens go into HttpOnly cookies and are blanked in the body) and `X-CSRF-Token` on unsafe requests. The authoritative contract is [`openapi.json`](openapi.json).

## Delivery and knowledge

| Verb | Route | Description |
|---|---|---|
| GET / POST | `/projects` | List and create projects |
| GET / POST | `/projects/{id}/issues` | List (paged and filterable) and create work items; see paging, concurrency and idempotency below |
| PATCH | `/issues/{id}` | Change status |
| GET | `/issues/{id}/details` | Full issue with extended fields |
| PATCH | `/issues/{id}/edit` | Edit optional title, description, status, type, priority, assignee, parent, sprint, labels, due date and story points |
| POST | `/issues/{id}/archive` | Soft archive |
| GET / POST | `/issues/{id}/comments` | Discussion, optional replies |
| GET / POST | `/issues/{id}/links` | Work item dependencies and relationships |
| GET / POST | `/projects/{id}/pages` | Project knowledge pages |
| PATCH | `/pages/{id}` | Optimistic document editing using `expected_version` |
| GET | `/pages/{id}/versions` | Previous revisions |
| POST | `/pages/{id}/restore` | Restore a historical revision while preserving current content |
| GET / POST | `/pages/{id}/comments` | Page discussions |
| GET / POST | `/relations` | Typed connections between pages, work, goals, risks, decisions and releases |

## Planning, analytics and collaboration

| Verb | Route | Description |
|---|---|---|
| GET / POST | `/projects/{id}/sprints`, `/projects/{id}/releases` | Iterations and releases |
| PATCH | `/sprints/{id}` | Controlled planned→active→completed transitions |
| GET / POST | `/projects/{id}/goals`, `/projects/{id}/risks`, `/projects/{id}/decisions` | Portfolio records |
| GET / POST | `/projects/{id}/approvals` | Approval requests |
| PATCH | `/approvals/{id}` | Assigned reviewer accepts or rejects pending request |
| GET | `/approvals/mine` | Assigned approvals |
| GET | `/projects/{id}/analytics`, `/projects/{id}/overview` | Project insights |
| GET | `/projects/{id}/activity`, `/audit` | Activity and administrative audit (where emitted) |
| GET | `/portfolio`, `/workload` | Organization planning |
| GET / POST | `/projects/{id}/automations` | Safe automation configurations |
| GET / POST | `/notifications`, `/notifications/{id}/read` | Inbox; mark-read uses POST |
| GET | `/search?q=keyword` | Tenant-scoped PostgreSQL full-text results |

## Integration and administrative endpoints

| Verb | Route | Description |
|---|---|---|
| GET | `/projects/{id}/export` | Bounded JSON project export, collections capped at 10,000 rows |
| POST | `/projects/{id}/import/issues` | Batch issue import with idempotent `external_ref`, max 100 items |
| GET / POST | `/admin/webhooks` | Register inert/disabled webhooks (no dispatcher) |
| DELETE | `/admin/webhooks/{id}` | Remove webhook registration |
| GET | `/entitlements` | Development plan metadata; no payment gateway |

Example issue creation:

```sh
curl -X POST "$MERIDIAN_API/api/projects/$PROJECT_ID/issues" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Create design review","kind":"task","priority":"high"}'
```

### Paging, concurrency and idempotency for work items

- **Paging.** `GET /projects/{id}/issues` lists newest issue number first. `limit` is 1 to 500 (default 500, the size clients received before paging existed). When another page exists the response carries an `X-Next-Cursor` header; send its value back as `cursor` to continue. The header is absent on the last page. Archived issues are not listed.
- **Filters.** Exact `status` (todo, in_progress, in_review, done), exact `priority` (low, medium, high, urgent), `assignee_id`, and `q`, a case-insensitive title search of up to 200 characters with LIKE wildcards matched literally.
- **Optimistic concurrency.** Issue details responses carry an `ETag` (the issue's `updated_at` at microsecond precision). Send it back as `If-Match` on `PATCH /issues/{id}/edit`. If the issue changed since, the server returns `412` with code `precondition_failed` and writes nothing. Without `If-Match` the edit applies as before (last writer wins), so existing clients keep working.
- **Idempotent create.** `POST /projects/{id}/issues` accepts an `Idempotency-Key` header of 8 to 255 visible ASCII characters. A retry with the same key and the same body returns the original `201` response with `Idempotent-Replayed: true` and creates nothing. The same key with a different body returns `409`. Requests that fail are not stored, so a failed create can be retried with the same key. Stored keys are pruned after 24 hours by hourly maintenance, so a key reused after that creates a new issue.
- **Cross-origin browsers.** `ETag`, `X-Next-Cursor` and `Idempotent-Replayed` are exposed to browser clients through CORS, and `If-Match` and `Idempotency-Key` are allowed request headers.

### Workflow statuses

Each project defines the statuses its issues can be in. A status has a key (fixed once created; issues store it), a name, a category (`todo`, `in_progress` or `done`) and a position (its board column). Every new project starts with To do, In progress, In review and Done.

| Verb | Route | Description |
|---|---|---|
| GET | `/projects/{id}/statuses` | The statuses in column order. Any member who can see the project |
| POST | `/projects/{id}/statuses` | Add a status at the end: `{"name","category","key"?}`. The key is derived from the name when omitted. Project admins only; up to 20 per project |
| PATCH | `/projects/{id}/statuses/{key}` | Rename, recategorise or move (`position` is the new column index; the others shift). Project admins only |
| DELETE | `/projects/{id}/statuses/{key}` | Delete a status. Refused (409) while any issue uses it, or when it is the project's last To do status |

Issues, filters, bulk changes and saved views accept only statuses the project defines (400 otherwise). Completion (overview, overdue, open counts) follows the category, so a custom status in the `done` category counts as completed.

### Archive, bulk changes, saved views and notification preferences

| Verb | Route | Description |
|---|---|---|
| POST | `/issues/{id}/archive`, `/issues/{id}/unarchive` | Archive or restore an issue. Editors only; 409 when the issue is already in that state. Archiving needs access to the issue's project |
| GET | `/projects/{id}/issues?archived=true` | List archived issues instead of active ones (same paging and filters) |
| POST | `/projects/{id}/issues/bulk` | Set `status`, `priority` or `assignee` on 1 to 100 distinct issues in one transaction. Body: `{"ids":[...],"action":"set_status","value":"done"}`. `set_assignee` takes a workspace member's user id; `null` clears it. Response: `{"updated":n,"results":[{"id","ok","error"}]}`; a skipped item reports why |
| GET / POST | `/projects/{id}/views` | Your saved views for a project. Filters: `status`, `priority`, `assignee_id`, `q`, `kind` and `query` (see Query language). Names are unique per project; up to 50 views per project. Other members cannot see them |
| DELETE | `/views/{id}` | Delete one of your views |
| GET / PUT | `/me/notification-preferences` | Turn inbox notifications for `approval` or `automation` on or off. Both are on by default; `PUT` takes `{"kind","enabled"}` and returns every kind |

Issue reads (`/details`, `/comments`, `/links`, and attachment lists) also work on archived issues, so a restored or archived issue stays readable. Writes such as edits, comments and status changes need an active issue.

Page edit with optimistic concurrency: `PATCH /api/pages/UUID` with `{"title":"...","content":"...","expected_version":1}`. A conflicting write returns HTTP 409.

### Custom fields

Projects define typed fields that issues carry in `custom_fields`. Types are `text`, `number`, `date` (`YYYY-MM-DD`), `boolean`, and `select` (1 to 50 `options`; options are refused on other types). A definition is `{"label","field_type","options"?,"required"?,"key"?}`. The key is derived from the label when omitted and cannot change afterwards. Every issue write validates `custom_fields` against these definitions and returns 400 naming the field when a value is wrong or a required field is missing.

| Verb | Route | Description |
|---|---|---|
| GET | `/projects/{id}/fields` | Definitions in position order. Any member who can see the project |
| POST | `/projects/{id}/fields` | Create a definition. Project admins only |
| PATCH | `/projects/{id}/fields/{key}` | Change `label`, `required` or `options`. An option removed while an issue still uses it is refused. Project admins only |
| DELETE | `/projects/{id}/fields/{key}` | Delete a definition and remove its value from every issue. Project admins only |

### Query language

`GET /projects/{id}/issues/search?query=…&limit=…` returns the matching issues, newest number first (`limit` 1 to 200, default 100). The issue list itself does not take a `query` parameter; use this route.

A query is space-separated `field:value` terms, with quotes around a value that contains spaces:

- `status:` (a status the project defines), `priority:`, `assignee:` (a user id, `me` or `currentUser()`), `label:`, `kind:` (or `type:`, an issue type the project defines), `title:`, `number:` (the issue number, such as `number:12`), `sprint:` (`openSprints()`, `none` or a sprint id), and `cf.<key>:` for a custom field.
- A leading `-` negates a term. A negated term keeps issues where the value is missing.
- `OR` between two filters puts them in one group, so `status:todo OR status:done priority:high` means (todo or done) and high. Groups cannot nest and there are no parentheses.
- One `order:` term sorts the results: `rank` (backlog order), `priority` (urgent first), `updated` (most recent first) or `number` (the default, newest first).
- An unknown field, an unknown value or a malformed query returns 400. Project access is applied before any filter, and the SQL is parameterised.

Example: `status:in_progress priority:high -label:legacy cf.region:"EU" order:priority`.

### Workflow transition rules

| Verb | Route | Description |
|---|---|---|
| GET | `/projects/{id}/transitions` | The rules. Any member who can see the project |
| POST | `/projects/{id}/transitions` | Add a rule: `{"from","to","requires_field"?}`. Project admins only |
| DELETE | `/projects/{id}/transitions/{from}/{to}` | Remove a rule. Project admins only |
| GET / POST | `/projects/{id}/transitions/{from}/{to}/actions` | The rule's post-functions, or add one: `{"action":"set_field","field","value"}` or `{"action":"notify_admins"}`. Up to five per rule. Project admins only |
| DELETE | `/projects/{id}/transitions/{from}/{to}/actions/{action_id}` | Remove a post-function. Project admins only |

A project with no rules allows every status change. A status that is the starting point of at least one rule allows only the moves its rules list, and other statuses stay unrestricted. `requires_field` names a custom field that must hold a value after the change. `requires_admin` (`true` on create) lets only a workspace admin or owner make the change; automations never pass it. Every status change is checked against the rules, and against the target column's WIP limit: PATCH, edit, bulk, the board and automations.

Post-functions run in the same transaction as the change. `set_field` writes the value into the custom field; `notify_admins` notifies the workspace admins and owners. A field a post-function writes cannot be deleted while the rule exists.

### Issue types

Each project defines its issue types. A type has a key (fixed once created; issues store it), a name, an icon (`task`, `bug`, `story`, `epic`, `feature`, `improvement`, `incident` or `request`) and a hierarchy level (0 for standard work, 1 for epic level). New projects start with task, bug, story and epic, as before.

| Verb | Route | Description |
|---|---|---|
| GET | `/projects/{id}/issue-types` | The types in menu order. Any member who can see the project |
| POST | `/projects/{id}/issue-types` | Add a type: `{"name","icon"?,"hierarchy_level"?,"key"?}`. Project admins only; up to 12 per project |
| PATCH | `/projects/{id}/issue-types/{key}` | Rename or change the icon. Project admins only |
| DELETE | `/projects/{id}/issue-types/{key}` | Delete a type. Refused (409) while any issue uses it, or when it is the last standard type |

Creating, editing, moving, importing and subtasks check the type against the project. A subtask must use a standard (level 0) type. Not built: a default workflow per type and field contexts per type.

### Comments: edit, delete and history

The author can edit a comment (`PATCH /issues/{id}/comments/{comment}` with `{"body"}`). The author or a workspace admin can delete it (`DELETE`). A deleted comment leaves the thread. Every earlier text is kept: `GET /issues/{id}/comments/{comment}/history` returns the current text and the earlier versions, and is readable only by the author and admins. Editing does not notify mentions again.

### Trash

`POST /issues/{id}/trash` archives the issue and records a restore date 30 days ahead. `POST /issues/{id}/restore` brings back an archived or trashed issue. `GET /projects/{id}/trash` lists the trashed issues (editors only). `unarchive` refuses a trashed issue. Nothing is purged automatically yet: the restore date is shown, but trashed issues stay until a purge job is built.

### WIP limits

`PUT /projects/{id}/statuses/{key}/wip-limit` with `{"limit": 3}` (1 to 1000) or `{"limit": null}` sets or removes a column's limit. Project admins only. A move into a full column is refused (400) with the count. Creating an issue in a full column is not refused.

### CSV import

`POST /projects/{id}/import/csv` takes the CSV as the request body (`text/csv`, at most 1 MB and 500 rows). It needs a workspace admin and project access. The header row must include `Summary` and `Issue Key`. `Issue Type`, `Priority`, `Status` and `Description` are optional. Query parameters:

- `dry_run` (default `true`): report what would change and commit nothing.
- `create_statuses` (default `false`): create the statuses the file names that the project lacks, up to the 20-per-project limit.

Rows are idempotent by `Issue Key`, so a repeat import skips rows already imported. Imports from other trackers are not supported; export the data to CSV first. The report gives each row's action and any error with its line number. A real import commits only when no row has an error.

### Typed responses

Issue comments and links, saved views, search results, notifications and approvals return fixed schemas, listed in the OpenAPI document. Saved views also report `stale: true` when a status, field or query term they use no longer exists in the project, instead of silently returning nothing.

This guide lists the main routes. The complete, generated contract is [`openapi.json`](openapi.json); some responses in it are still untyped (`Value`).

## Additional routes

- Bulk issue actions: `set_team`, `set_sprint`, `set_release`, `add_label`, `remove_label`, `add_watcher` on `POST /api/projects/{id}/issues/bulk`.
- Exports: `GET /api/sprints/{id}/export.csv`, `GET /api/releases/{id}/export.csv`, `GET /api/projects/{id}/history.csv`.
- Query: parentheses and nested `OR`/`AND`, and `-(...)` for a negated group, on `GET /api/projects/{id}/issues/search?query=`.
- Automation rules: `trigger_event: scheduled` with `schedule` (`hourly`, `daily`, `weekly`); `PATCH` and `DELETE /api/automations/{id}`; `GET /api/automations/{id}/runs`; `POST /api/projects/{id}/automations/preview`.
- Saved-view subscriptions: `GET` and `PUT /api/views/{id}/subscription` with `cadence` `daily`, `weekly` or `off`.
- Permission scheme: `actions` map on `GET` and `PUT /api/projects/{id}/permission-scheme` (`manage_sprints`, `manage_releases`, `delete_issues`; level 2 or 3).
- Workspace settings: `brand_name` and `brand_color` (`#rrggbb`; an empty string clears) on `PUT /api/workspace/settings`.
