# Meridian

**Work, connected.** Multi-tenant project delivery, knowledge and collaboration software.

**Package designation: Meridian 0.2 expanded implementation — development preview, not production GA.** The repository provides substantial runnable source for M0–M10 feature areas, but **does not** provide full Jira/Confluence feature parity or pass all M0–M10 release gates. Read [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for the explicit milestone-by-milestone ledger.

## Stack

- **Backend:** Rust / Axum / Tokio / SQLx / Argon2id
- **Web:** React 19 / TypeScript / Vite / Lucide / responsive application UI
- **Database:** PostgreSQL 17, relational composite-tenant constraints, full-text GIN indexes
- **Mobile:** Flutter / Dart / Material 3, secure session and unsent draft storage
- **Delivery:** Docker Compose, Dockerfiles, local verification script, Kubernetes reference manifests

## What you can explore in this implementation

1. **Organizations:** workspace signup/login, opaque sessions, invite tokens, existing-account invite acceptance, team/membership lists, workspace switching, basic role control and login attempt throttling.
2. **Work:** projects, issues, issue board, priority/status/type, assignee, due date, estimates, labels/custom JSON, archive, comments/replies, links, sprint assignment and activity.
3. **Knowledge:** project pages, nesting support in API, rich history through optimistic snapshots, restore, page comments and unified full-text search.
4. **Agile/planning:** sprints, releases, goals, project analytics, portfolio overview, workload view, risk and decision records.
5. **Collaboration:** approval workflow, inbox, basic automation rules, admin audit log, notifications table, typed relationships connecting knowledge to work.
6. **Integrations:** bounded export, idempotent batch issue import, disabled-by-default webhook registrations, outbox storage primitives.
7. **Mobile:** login, work list, issue details/status/comments, knowledge reader, goals/sprints, inbox, search, and encrypted unsent issue drafts.

## Launch quickly (preview)

With Docker installed:

```sh
docker compose -f infra/docker-compose.full.yml up --build -d
```

Open **http://localhost:8088** and create a workspace. This preview stack contains a local PostgreSQL instance and **must not be exposed to the public Internet**.

Or develop each service separately:

```sh
# Terminal 1 — PostgreSQL
docker compose -f infra/docker-compose.yml up -d

# Terminal 2 — Rust API
cd apps/server
export DATABASE_URL='postgres://meridian:meridian_local_only@localhost:5432/meridian'
export CORS_ORIGIN='http://localhost:5173'
cargo run

# Terminal 3 — React
cd apps/web
npm install
npm run dev
```

Browse **http://localhost:5173**. Optionally populate a fresh demo workspace with `python3 scripts/seed_demo.py` against the local API.

### Flutter development

This source package has Dart app code and `pubspec.yaml`. Generate Android/iOS scaffolding using a Flutter SDK:

```sh
cd apps/mobile
flutter create --project-name meridian_mobile --platforms android,ios .
flutter pub get
flutter run --dart-define=MERIDIAN_API=http://10.0.2.2:8080
```

Android emulator reaches the host with `10.0.2.2`; use HTTPS for remote/real devices. iOS simulator typically uses `http://localhost:8080`. Native provisioning, push entitlements and production app signing are not included.

## Tests and API

```sh
./scripts/verify.sh                       # toolchain-aware local verification
python3 tests/smoke.py                    # requires running local API
cd apps/server && cargo test             # with DATABASE_URL_TEST for PG isolation tests
```

`API_GUIDE.md` enumerates the routes; the machine-readable contract is [`openapi.json`](openapi.json) (also served at `/api/openapi.json`). `SECURITY.md` lists security boundaries and blockers. `OPERATIONS.md` describes deployment and runbooks; `PRODUCT_PLAN.md` and `COMPETITIVE_LANDSCAPE.md` retain the long-range product specification and 100-solution research inventory.

## File structure

```text
apps/
  server/
    src/main.rs             Shared state, router assembly, startup (also `--openapi`)
    src/error.rs            ApiError: typed errors with stable `code`s
    src/auth.rs             Signup/login/logout and the `Identity` request extractor
    src/openapi.rs          OpenAPI document (utoipa) served at /api/openapi.json
    src/api/                Domain route modules: work, org, planning, issues, knowledge,
                            collab, admin (+ common guards and event writers)
    src/tests.rs            HTTP-level integration tests (need DATABASE_URL_TEST)
    migrations/             Ordered PostgreSQL schema migrations
  web/
    src/lib/                Typed API client, session storage, generated-type aliases
    src/api-schema.d.ts     GENERATED from docs/openapi.json (npm run gen:api)
    src/features/           auth, shell, work, workspace (state + routing), advanced
    src/router.tsx          TanStack Router (tab + project live in the URL)
    e2e/                    Playwright end-to-end tests (real API + database)
  mobile/
    lib/                    main, app, core (Api, consts), auth, home, reader, issue
infra/
  docker-compose.yml        PostgreSQL for source development
  docker-compose.full.yml   Three-service local preview
  Dockerfile.api/web        Container builds
  k8s/                      Illustrative orchestration files
scripts/                    Demo data and local verification
tests/                      Black-box smoke and k6 load harness
docs/                       Product, architecture, API, security and operations docs
                            (openapi.json is generated: `make openapi`)
.github/workflows/ci.yml    fmt/clippy/tests, web lint/test/build, smoke, e2e, mobile analyze
```

Keep all application source in `apps/`, documentation in `docs/`, and shared automation in `scripts/`. Deployment assets stay in `infra/`, with black-box checks in `tests/`. Add API route modules under `apps/server/src/api/` as domains grow, and keep migrations in deployment order.

## Engineering caveats

**Rust, web, PostgreSQL migrations, API smoke and browser e2e have now been executed (see `VERIFICATION.md`); Flutter has not.** See `VERIFICATION.md` for what has and has not been executed. Source and manifests need CI execution and fixes before being represented as production-ready.

**Tenant isolation is enforced by explicit authenticated SQL predicates, not yet by PostgreSQL RLS.** The web uses JavaScript-accessible bearer tokens; the live document editor is plain-text with optimistic concurrency, not a CRDT. Webhooks do not deliver automatically, and no real payment, SSO, email delivery, push or semantic AI provider is configured.

For these reasons, **do not place real enterprise/customer data into this preview** until the release gates documented in `IMPLEMENTATION_STATUS.md` have been completed.
