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

### Sessions, recovery and access (Phase 1)

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
| PATCH | `/issues/{id}` | Change status (foundation endpoint) |
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

### Archive, bulk changes, saved views and notification preferences

| Verb | Route | Description |
|---|---|---|
| POST | `/issues/{id}/archive`, `/issues/{id}/unarchive` | Archive or restore an issue. Editors only; 409 when the issue is already in that state. Archiving needs access to the issue's project |
| GET | `/projects/{id}/issues?archived=true` | List archived issues instead of active ones (same paging and filters) |
| POST | `/projects/{id}/issues/bulk` | Set `status`, `priority` or `assignee` on 1 to 100 distinct issues in one transaction. Body: `{"ids":[...],"action":"set_status","value":"done"}`. `set_assignee` takes a workspace member's user id; `null` clears it. Response: `{"updated":n,"results":[{"id","ok","error"}]}`; a skipped item reports why |
| GET / POST | `/projects/{id}/views` | Your saved views for a project. Filters: `status`, `priority`, `assignee_id`, `q`. Names are unique per project; up to 50 views per project. Other members cannot see them |
| DELETE | `/views/{id}` | Delete one of your views |
| GET / PUT | `/me/notification-preferences` | Turn inbox notifications for `approval` or `automation` on or off. Both are on by default; `PUT` takes `{"kind","enabled"}` and returns every kind |

Issue reads (`/details`, `/comments`, `/links`, and attachment lists) also work on archived issues, so a restored or archived issue stays readable. Writes such as edits, comments and status changes need an active issue.

Page edit with optimistic concurrency: `PATCH /api/pages/UUID` with `{"title":"...","content":"...","expected_version":1}`. A conflicting write returns HTTP 409.

This is a route guide, **not** a complete generated or audited OpenAPI schema. Formal OpenAPI + typed client generation is an M8/M10 release task.
