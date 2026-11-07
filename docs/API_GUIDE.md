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

## Delivery and knowledge

| Verb | Route | Description |
|---|---|---|
| GET / POST | `/projects` | List and create projects |
| GET / POST | `/projects/{id}/issues` | List and create work items |
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

Page edit with optimistic concurrency: `PATCH /api/pages/UUID` with `{"title":"...","content":"...","expected_version":1}`. A conflicting write returns HTTP 409.

This is a route guide, **not** a complete generated or audited OpenAPI schema. Formal OpenAPI + typed client generation is an M8/M10 release task.
