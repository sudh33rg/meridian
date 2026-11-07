# Meridian local operations and deployment reference

## Local source development

1. `docker compose -f infra/docker-compose.yml up -d` (PostgreSQL only).
2. In `apps/server`, set `DATABASE_URL=postgres://meridian:meridian_local_only@localhost:5432/meridian`, `CORS_ORIGIN=http://localhost:5173`, then `cargo run`.
3. In `apps/web`, run `npm install && npm run dev`.
4. At http://localhost:5173 create a workspace and a project. Optional: `python3 scripts/seed_demo.py` populates a separate demo workspace at the local API.
5. For Flutter: `cd apps/mobile && flutter create --platforms=android,ios . && flutter pub get && flutter run --dart-define=MERIDIAN_API=http://10.0.2.2:8080`.

Use a physical phone only via HTTPS to a reachable API host. Disable development HTTP allowances in release builds.

## Single-command container preview

From repository root: `docker compose -f infra/docker-compose.full.yml up --build -d`; open `http://localhost:8088`. The compose file runs API, web and PostgreSQL with **development-only** credentials. Do not expose this stack publicly.

## Verification

Run `./scripts/verify.sh` for available local toolchains. With the backend serving locally, run `python3 tests/smoke.py`. To test tenant isolation in Rust, set `DATABASE_URL_TEST` to a disposable PostgreSQL database and run `cargo test`. This checkout does not currently include an automated CI workflow.

API liveness: `GET /health`. Readiness (checks database): `GET /ready`. Neither requires a bearer token. The app emits tracing logs, but has no complete telemetry exporter/dashboard yet.

## Database and migrations

Migrations are applied on API startup through SQLx. Back up before applying migrations to any non-ephemeral database. `pg_dump -Fc -h HOST -U USER -d meridian > backup.dump` and `pg_restore` are standard starting points, not an audited DR plan. Before GA, version migrations with forward-only dry-runs, repair strategies, verified point-in-time recovery and rollback playbooks.

## Kubernetes references

`infra/k8s` provides API and web deployment/service/HPA examples using placeholder images and externally supplied secrets. The cluster, ingress, certificates, PostgreSQL service, backup system, log pipeline and deployment controller are intentionally not provisioned. These examples are *not* production infrastructure by themselves.

## Observability requirements

Capture p50/p95/p99 HTTP latency by route, status/error counts, DB pool waits, SQL timings, queue lag/outbox depth, cache hit rate, memory/CPU, mobile crash-free sessions, tenant-index/search skew and background-job retries. Add request-level correlation IDs and privacy-safe log redaction. Derive SLOs from measured baseline rather than assuming the sample k6 threshold is a guarantee.

## Performance engineering decisions

- Rust API uses connection-pool reuse and static SQL; move long tasks to workers.
- GIN full-text indexes support ranked searches; keep all tenant ID filters in query plans and monitor database index selection.
- UI bundles should be split by route, not render all advanced modules at once; board lists require virtual scrolling above ~1000 issues.
- Add paginated APIs for issue, page, audit and export datasets; current bounded result sets are deliberately initial limits.
- Capacity models should use database connection budgets and automated load test baselines, especially in multi-instance deployments.
