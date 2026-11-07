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

API liveness: `GET /health`. Readiness (checks database): `GET /ready`. Neither requires a bearer token. The app sets and echoes `X-Request-ID` on every response and records it on the request's tracing span, so it appears on any log line emitted while a request is handled (including warnings such as refresh-token reuse) and Prometheus metrics (`meridian_http_requests_total`, `meridian_http_request_seconds{method,route}`, `meridian_http_in_flight`, `meridian_db_pool_size/idle`, job and rate-limit counters). There is no OTLP trace exporter or dashboard yet.

## Database and migrations

Migrations are applied on API startup through SQLx. Back up before applying migrations to any non-ephemeral database. `pg_dump -Fc -h HOST -U USER -d meridian > backup.dump` and `pg_restore` are standard starting points, not an audited DR plan. Before GA, version migrations with forward-only dry-runs, repair strategies, verified point-in-time recovery and rollback playbooks.

## Kubernetes references

`infra/k8s` provides API and web deployment/service/HPA examples using placeholder images and externally supplied secrets. The cluster, ingress, certificates, PostgreSQL service, backup system, log pipeline and deployment controller are intentionally not provisioned. These examples are *not* production infrastructure by themselves.

## Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Owner/migration connection. Request transactions `SET ROLE meridian_app` (created by migration 0003; the connecting user must be allowed to become it; superusers and role owners are) |
| `APP_ENV` | development | `production` forces Secure cookies and requires `APP_SECRET`; a missing `SMTP_URL` then fails email jobs instead of logging them |
| `APP_SECRET` | random per process | 32+ chars; key for emailed one-time tokens. Changing it invalidates unsent/unused links |
| `PUBLIC_URL` | `http://localhost:5173` | Base URL in emailed links |
| `SMTP_URL`, `MAIL_FROM` | unset (log mailer) | `smtp://host:1025` (no TLS), `smtps://` (implicit TLS) or `smtp://host:587?tls=required` |
| `COOKIE_SECURE`, `TRUST_PROXY` | false | Secure cookies + HSTS header; trust `X-Forwarded-For` for rate limiting |
| `SESSION_TTL_HOURS`, `REFRESH_TTL_DAYS` | 8, 30 | Access session and refresh token lifetime |
| `RATE_LIMIT_AUTH_PER_MIN`, `RATE_LIMIT_GLOBAL_PER_MIN` | 30, 1200 | Per-client, per-process limits (burst = quarter) |
| `METRICS_ADDR` | `127.0.0.1:9090` | Prometheus scrape address (`off` disables). Keep off the public network |
| `LOG_FORMAT` | text | `json` for structured logs |

Local email: `docker compose -f infra/docker-compose.yml up -d mailpit`, set `SMTP_URL=smtp://localhost:1025`, read mail at http://localhost:8025. The full preview stack includes Mailpit on :8025.

## Background jobs and the event log

* `jobs` is a Postgres queue (enqueue is part of the request transaction; the worker claims with `SKIP LOCKED`, retries with exponential backoff up to `max_attempts`, then marks the row `dead` with `last_error`). Inspect with `SELECT id,kind,state,attempts,last_error FROM jobs ORDER BY id DESC;`. Metrics: `meridian_jobs_queued`, `meridian_jobs_total{kind,outcome}`.
* `events` is the append-only per-tenant change log (`sync_id` is gap-free per tenant). Nothing consumes it yet; it is the basis for client sync, webhooks and indexing in later phases. `outbox_events` is still written for the future webhook dispatcher.
* Row level security: if you add a table with a `tenant_id` column, enable RLS and add the `tenant_isolation` policy in the same migration or the API will refuse to start.

## Observability requirements

Capture p50/p95/p99 HTTP latency by route, status/error counts, DB pool waits, SQL timings, queue lag/outbox depth, cache hit rate, memory/CPU, mobile crash-free sessions, tenant-index/search skew and background-job retries. Add request-level correlation IDs and privacy-safe log redaction. Derive SLOs from measured baseline rather than assuming the sample k6 threshold is a guarantee.

## Performance engineering decisions

- Rust API uses connection-pool reuse and static SQL; move long tasks to workers.
- GIN full-text indexes support ranked searches; keep all tenant ID filters in query plans and monitor database index selection.
- UI bundles should be split by route, not render all advanced modules at once; board lists require virtual scrolling above ~1000 issues.
- Add paginated APIs for issue, page, audit and export datasets; current bounded result sets are deliberately initial limits.
- Capacity models should use database connection budgets and automated load test baselines, especially in multi-instance deployments.
