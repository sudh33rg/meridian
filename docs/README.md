# Meridian documentation

Meridian is a multi-tenant project delivery, knowledge and collaboration system. Its binding rules are in
[`../CONSTITUTION.md`](../CONSTITUTION.md). This folder holds the reference documentation.

**Status: Meridian 0.2 development preview. Not production-ready; do not put real customer data into it.**
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) is the ledger of what exists, what is verified and
what is still open.

## Documents

| Document | Contents |
|---|---|
| [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | Milestone ledger, verification status, open risks |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Design principles, module boundaries, tenancy model, planned components |
| [`API_GUIDE.md`](API_GUIDE.md) | Route guide for the REST API |
| [`openapi.json`](openapi.json) | Generated API contract (`make openapi`); also served at `/api/openapi.json` |
| [`SECURITY.md`](SECURITY.md) | Security boundaries, remaining blockers, existing tests |
| [`OPERATIONS.md`](OPERATIONS.md) | Local development, container preview, configuration, background jobs, verification |
| [`SYNC_PROTOCOL.md`](SYNC_PROTOCOL.md) | How the mobile app reads, drafts and changes issues offline |

## Stack

- **API:** Rust, Axum, Tokio, SQLx, Argon2id
- **Web:** React 19, TypeScript, Vite, TanStack Query and Router
- **Database:** PostgreSQL 17 with composite tenant keys, row level security and full-text GIN indexes
- **Mobile:** Flutter, Material 3, secure session storage and encrypted unsent drafts
- **Delivery:** Docker Compose, Dockerfiles, Kubernetes reference manifests

## Feature areas

1. **Workspaces:** sign-up and sign-in, opaque sessions, invitations, teams, roles, workspace switching, login throttling.
2. **Work:** projects, issues, board and list views, priorities, labels, comments, links, archive, custom fields, workflow statuses and transitions.
3. **Knowledge:** project pages with versions and restore, page comments, collaborative editing, full-text search.
4. **Planning:** sprints, releases, goals, risks, decisions, roadmaps, capacity and portfolio views.
5. **Collaboration:** approvals, inbox, safe automation rules, audit log, typed relations between records.
6. **Integrations:** bounded export, CSV import, webhook registration (delivery disabled), chat posts, optional AI drafts.
7. **Mobile:** sign-in, issue list and details, status and comments, knowledge reader, inbox, search, offline drafts.

## Run it locally

With Docker installed, start the full preview stack:

```sh
docker compose -f infra/docker-compose.full.yml up --build -d
```

Open **http://localhost:9991**. The stack runs PostgreSQL with development-only credentials; do not expose it
to the public Internet.

To develop each service separately:

```sh
# Terminal 1 — PostgreSQL
docker compose -f infra/docker-compose.yml up -d

# Terminal 2 — API
cd apps/server
export DATABASE_URL='postgres://meridian:meridian_local_only@localhost:5432/meridian'
export CORS_ORIGIN='http://localhost:9991'
cargo run

# Terminal 3 — web
cd apps/web
npm install
npm run dev
```

Optionally populate a demo workspace with `python3 scripts/seed_demo.py` against the local API.

### Flutter

The mobile app source is in `apps/mobile`. Generate the platform folders with a Flutter SDK, then run:

```sh
cd apps/mobile
flutter create --project-name meridian_mobile --platforms android,ios .
flutter pub get
flutter run --dart-define=MERIDIAN_API=http://10.0.2.2:9990
```

The Android emulator reaches the host at `10.0.2.2`; the iOS simulator uses `http://localhost:9990`. Real devices
need HTTPS to a reachable API host. Push entitlements and production signing are not included.

## Checks

```sh
make fmt && make lint        # formatting and lint
make openapi                 # regenerate docs/openapi.json and web API types after changing handlers
make manifest                # regenerate MANIFEST.json after adding or removing files
```

See [`OPERATIONS.md`](OPERATIONS.md#verification) for the smoke test and the database-backed Rust tests.

## Repository layout

```text
apps/
  server/
    src/main.rs             Router assembly and startup (also `--openapi`)
    src/error.rs            ApiError: typed errors with stable codes
    src/auth.rs             Sign-up, sign-in, refresh, cookies and CSRF, reset and verification
    src/db.rs               Tenant-bound transaction per request (row level security)
    src/jobs.rs, mail.rs    Durable Postgres job queue and mailer
    src/middleware.rs       Rate limits, security headers, request metrics
    src/config.rs           Environment configuration
    src/openapi.rs          OpenAPI document, generated from handler annotations
    src/api/                Domain route modules (work, org, planning, knowledge, collaboration, admin, security, access)
    src/tests.rs            HTTP-level integration tests (need DATABASE_URL_TEST)
    migrations/             Ordered, forward-only SQL migrations
  web/
    src/lib/                Typed API client and helpers
    src/api-schema.d.ts     GENERATED from docs/openapi.json (npm run gen:api)
    src/features/           auth, shell, work, knowledge, agile, workspace, advanced
    src/router.tsx          Routes (tab and project are kept in the URL)
    e2e/                    Playwright end-to-end tests
  mobile/
    lib/                    Flutter app: main, app, core, auth, home, issue, reader
infra/                      Compose files, Dockerfiles, Kubernetes reference manifests
scripts/                    Demo seeding, local verification, manifest generation
tests/                      Black-box smoke test and k6 load sample
docs/                       Reference documentation (openapi.json is generated)
.github/workflows/ci.yml    CI workflow (has not yet run on GitHub)
```

Keep application source in `apps/`, documentation in `docs/`, shared automation in `scripts/` and deployment
assets in `infra/`. Keep migrations in deployment order and never edit one that has been applied.
