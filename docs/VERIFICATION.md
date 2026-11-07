# Verification report — Meridian 0.2 preview

**Authoring environment:** 7 November 2026. Network dependency downloads and Rust/Flutter/Docker/PostgreSQL toolchains were not available in the runtime.

| Check | Result | Evidence / limitation |
|---|---|---|
| React TSX syntactic parsing | **Passed** | TypeScript parser reported zero syntax diagnostics for `main.tsx` and `AdvancedWorkspace.tsx` |
| Vite config TS parsing | **Passed** | TypeScript parser zero syntax diagnostics |
| Python helper scripts | **Passed** | `python3 -m py_compile` succeeded for `scripts/seed_demo.py` and `tests/smoke.py` |
| Rust lexed bracket/delimiter structure | **Passed — structural check only** | Rust Pygments tokenizer found matched braces, brackets and parentheses in `main.rs` and `advanced.rs`; **not a compiler test** |
| Docker Compose/Kubernetes YAML syntax | **Passed — parser only** | PyYAML parsed both Compose manifests and K8s references; this checkout has no GitHub Actions workflow |
| Rust `cargo check/test/clippy/fmt` | **Not run** | `cargo`/`rustc` unavailable, no dependency download |
| React production `npm run build` | **Not run** | React/Vite/npm project dependencies not installed and network unavailable; TypeScript module resolution therefore cannot be verified |
| PostgreSQL migrations and API integration tests | **Not run** | PostgreSQL server/CLI unavailable |
| Flutter analyzer and device builds | **Not run** | Flutter/Dart SDK unavailable |
| Docker Compose build/deployment | **Not run** | Docker unavailable |
| Load tests, DR, security penetration tests, user E2E | **Not run** | Requires deployed environment and test infrastructure |

**Do not interpret static parsing as successful compilation or runtime validation.** CI must execute on a connected environment and pass before this package is promoted to any staging environment with sensitive data.

## Required first checkouts

```sh
# From repository root
# 1. Install Rust stable, Docker Compose, Node 22+, Flutter stable.
# 2. Start disposable PostgreSQL and create a separate meridian_test database
make up
# Use psql or another Postgres admin client to create 'meridian_test'
# 3. Check Rust and database integration tests
cd apps/server
export DATABASE_URL_TEST='postgres://meridian:meridian_local_only@localhost:5432/meridian_test'
cargo fmt --all
cargo clippy --all-targets --all-features
cargo test
# 4. Web
cd ../web
npm install
npm run build
# 5. Flutter
cd ../mobile
flutter create --platforms android,ios .
flutter pub get
flutter analyze
# 6. Local API smoke and performance
cd ../..
python3 tests/smoke.py
```

The PostgreSQL-backed Rust test creates fixtures and should be executed on a **throwaway test database**, not a shared developer environment. A release candidate also requires verified migration reversibility/repair, object-level auth coverage, all CI checks, real device testing, performance baselines, signed artifacts, security review and backup restoration.

## Update — 7 November 2026 (Phase 0 executed locally)

Run on macOS with Rust stable, Node 24, Docker (throwaway Postgres 17 container). **Nothing below has run on GitHub Actions yet.**

| Check | Result |
|---|---|
| `cargo fmt --check`, `cargo clippy --all-targets -D warnings` | **Passed** |
| `cargo test` with `DATABASE_URL_TEST` (migrations 0001–0002 applied) | **Passed, 10 tests**: 3 HTTP-level tests through the real router (cross-tenant 404s on 6 GET routes + 2 PATCH routes, typed 401s, logout revocation, page-version 409), error/status mapping, role guards, token hashing, OpenAPI coverage (70 operations, public vs secured) |
| `tests/smoke.py` against the running API | **Passed** |
| OpenAPI: `docs/openapi.json` equals `meridian-api --openapi`; served at `/api/openapi.json` | **Passed** (51 paths, 70 operations) |
| Web: `format:check`, `eslint` (0 errors, 5 `exhaustive-deps` warnings), `vitest` (9 tests), `tsc -b` + `vite build` | **Passed** |
| Playwright e2e (Chromium) against real API + Postgres: signup → project → issue → board → knowledge page → reload; bad-login error | **Passed, 2 tests** |
| `.github/workflows/ci.yml` | YAML parses; **never executed** |
| Flutter (`apps/mobile`) | **Not run.** `main.dart` was split into 7 files (verified character-for-character equivalent), but never compiled; no Flutter SDK available |
| Docker images (`infra/docker-compose.full.yml`) build; full preview stack started; `tests/smoke.py` passed through nginx on :8088 | **Passed** |

### Known gaps after Phase 0
- `tests` for the ~45 other routes are still only covered by `smoke.py`; response bodies for most list endpoints are untyped (`Value`) in the OpenAPI spec.
- No Dart client is generated; the web client types are generated, mobile still uses its hand-written `Api` class.
- Request handlers still take the pool directly (no transaction-per-request), so PostgreSQL RLS is not yet possible (Phase 1).
- 5 `react-hooks/exhaustive-deps` warnings remain in code moved verbatim from the original; fixing them changes fetch behaviour and deserves its own change.


## Update — 7 November 2026 (Phase 1, visual verification)

Per the repository rules (`CONSTITUTION.md` Article V) no new automated tests were written; verification was done once, at the end, by running the stack (Postgres 17, API, Vite dev server, Mailpit) and using the web app in a browser, plus direct requests and SQL against the running system. Nothing here has run on GitHub Actions.

| Area | What was exercised | Result |
|---|---|---|
| Browser auth | Signup with `X-Auth-Mode: cookie`; page JS sees only `meridian_csrf`; sessionStorage holds no token; new tab restores the session from the cookie; session survives an API restart | **Passed** |
| Email | Verification email delivered by the job queue over SMTP (Mailpit), link confirms, banner disappears; invitation email; forgot-password always 202; reset link single-use; reset ends the user's existing browser session; old password rejected, new accepted | **Passed** |
| Token lifecycle (API) | Refresh rotates both tokens, old access token dies, reuse of a rotated refresh token revokes the whole family; cookie login blanks the body, flags are HttpOnly/readable as designed; cookie POST without/with wrong CSRF header or with a foreign Origin is 403, correct request reaches the handler | **Passed** |
| Sessions UI | Two sign-ins listed with device labels, revoke removes one | **Passed** (after fixing an iOS user-agent mislabel) |
| Project access | Private project created with lock icon; invisible to a member (404 on every project route); viewer grant gives read (200) but not write (403); search and portfolio hide private content until granted and again after revoke; Access panel lists/edits grants | **Passed** |
| RLS in PostgreSQL | As `meridian_app`: no tenant context sees zero rows; tenant context sees only its own rows, `sync_id`s gap-free; foreign-tenant insert rejected by policy; `users.password_hash` unreadable; `audit_events`/`events` not deletable or updatable | **Passed** |
| Core product under RLS | Create project/issue, move on board, comment, create/edit page with version history, global search, audit trail (includes access events) | **Passed** |
| Hardening | 10 rapid bad logins then 429 with `Retry-After`, `/health` unaffected; Prometheus metrics (request, job, rate-limit, pool) on :9090; security headers on API and nginx; CSP did not break the UI | **Passed** |
| Full Compose stack | Images build with the new dependencies; fresh database migrated 0001–0005; signup, resend-verification (202) and project creation through nginx on :8088 | **Passed** |
| Existing suites (informational, unmodified except the two constants below) | `cargo test` with Postgres: 10 passed; `npm test`: 9 passed; `clippy -D warnings`, `rustfmt`, `eslint` (0 errors), `prettier`, `tsc`/`vite build` clean | **Passed** |

Defects found and fixed during this pass: the CSRF Origin check failed behind Vite's proxy (Vite rewrote `Host`; the check now also accepts the configured public origins and the proxy keeps `Host`); the web client choked on empty `202` bodies; iOS user agents were labelled macOS; stale "email not configured" invitation copy; unstyled selects; empty-state flash in the grants table.

Not verified: SMTP with TLS/auth against a real provider; Flutter (still never built, and the mobile app has not adopted refresh rotation); the Playwright e2e suite was not re-run against the new auth flow; multi-instance behaviour (per-process rate limits); load behaviour of the per-tenant `sync_id` counter row under concurrent writers.

Maintenance note: `openapi.rs` contains an existing test that asserts the operation count (now 82) and the list of public endpoints; both literals were updated because the API gained 12 endpoints. No other test file was modified.
