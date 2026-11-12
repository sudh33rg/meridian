# Meridian

> **Work, connected.** A high-performance, multi-tenant SaaS platform unifying work tracking, agile delivery, knowledge management, and customer service into a single connected graph.

Meridian connects objectives, projects, issues, documentation, decisions, evidence, and releases through typed relationships. Every entity is linked, auditable, and isolated under strict multi-tenant boundaries.

---

## Highlights

- **Work Tracking & Custom Workflows:** Customizable Kanban/Scrum boards and list views, custom fields, issue types, transition validators, issue security levels, saved views, and bulk actions.
- **Agile Delivery & Analytics:** Sprints, team velocity charts, predictability metrics, sprint capacity planning, sprint reports, burndown and burnup charts, and backlog ranking.
- **Real-Time Knowledge Base:** Hierarchical pages with live collaborative editing (Yjs over WebSocket), inline comments on highlighted text, version snapshots and restore, page templates, and dynamic macros.
- **Portfolio & RAID Management:** Full RAID register (risks, assumptions, issues, dependencies), goals, roadmaps, milestones, schedule baselines, and critical path analysis.
- **Service Management & Customer Portal:** Service queues, request types, branded customer portal, external customer request submission, SLAs, and incident management workflows.
- **Enterprise Security & Tenancy:** Double-enforced PostgreSQL Row Level Security (RLS) with tenant-bound transactions, opaque bearer tokens, HttpOnly rotating refresh sessions with CSRF protection, TOTP two-factor authentication, OpenID Connect SSO, and SCIM 2.0 provisioning.
- **Mobile Companion:** Cross-platform Flutter companion app with secure storage, offline drafting, and conflict detection.

---

## Technology Stack

| Layer | Technology | Key Capabilities |
|---|---|---|
| **API Backend** | Rust, Axum, Tokio, SQLx | Async runtime, domain modularity, typed `ApiError`, auto-generated OpenAPI contract |
| **Database** | PostgreSQL 17 | Composite `(tenant_id, id)` foreign keys, Row Level Security (RLS), full-text GIN indexes |
| **Web Frontend** | React 19, TypeScript, Vite | TanStack Router & Query, TipTap / Yjs collaborative rich-text editor, zero runtime CSS overhead |
| **Mobile App** | Flutter, Material 3 | Secure token storage, background sync, encrypted local drafts |
| **Infrastructure** | Docker, Compose, Kubernetes, Nginx | Multi-stage production containers, local preview stack, reference Kubernetes manifests |

---

## Getting Started

### Prerequisites

- **Docker** and **Docker Compose**
- *(Optional for bare-metal dev)*: **Rust** (nightly/stable toolchain), **Node.js** 20+, **Python** 3.10+, and **Flutter SDK**

### Single-Command Preview

Launch the complete local preview stack (PostgreSQL, Axum API, Vite Web, and Mailpit):

```sh
docker compose -f infra/docker-compose.full.yml up --build -d
```

Open your browser to:
- **Web Application:** [http://localhost:9991](http://localhost:9991)
- **Mailpit (Email Inbox):** [http://localhost:8025](http://localhost:8025)
- **API Health:** [http://localhost:9990/health](http://localhost:9990/health)

*(The stack runs with development credentials; do not expose this preview to public networks).*

### Local Development

To run each service independently during development:

```sh
# 1. Start PostgreSQL & Mailpit
docker compose -f infra/docker-compose.yml up -d

# 2. Run API Server (Terminal 1)
cd apps/server
export DATABASE_URL='postgres://meridian:meridian_local_only@localhost:5432/meridian'
export CORS_ORIGIN='http://localhost:9991'
cargo run

# 3. Run Web Client (Terminal 2)
cd apps/web
npm install
npm run dev
```

Optionally populate a sample demo workspace:
```sh
python3 scripts/seed_demo.py
```

---

## Testing & Verification

Meridian enforces automated testing and verification across the backend and frontend:

```sh
# Run all automated tests (Rust + Web Vitest)
make test

# Run Rust API tests only (needs DATABASE_URL_TEST pointing to disposable DB)
make test-api

# Run Web client tests and production build
make test-web

# Format all codebases
make fmt

# Run linters (clippy with -D warnings & eslint)
make lint

# Run end-to-end Playwright tests
make e2e

# Run the local verification runner
./scripts/verify.sh
```

### Black-Box Smoke Test

When running a local API instance, execute the end-to-end tenant boundary and feature smoke suite:

```sh
MERIDIAN_API=http://localhost:9990 python3 tests/smoke.py
```

---

## Repository Structure

```text
meridian/
├── apps/
│   ├── server/             # Rust Axum backend (API handlers, auth, RLS transactions, migrations)
│   ├── web/                # React 19 single-page app (work, knowledge, agile, admin)
│   └── mobile/             # Flutter mobile companion application
├── docs/                   # Technical documentation and OpenAPI specifications
│   ├── ARCHITECTURE.md     # System design, tenancy model, and boundaries
│   ├── API_GUIDE.md        # REST API endpoint reference and query guide
│   ├── SECURITY.md         # Threat model, RLS guarantees, and security policies
│   ├── OPERATIONS.md       # Operational configuration, background jobs, and deployment
│   ├── SYNC_PROTOCOL.md    # Mobile offline synchronization protocol
│   └── openapi.json        # Auto-generated OpenAPI v3 contract
├── infra/                  # Docker Compose, Dockerfiles, and Kubernetes manifests
├── scripts/                # Verification runner, demo seeding, and manifest generation
├── tests/                  # Black-box smoke tests and k6 load test scripts
├── CONSTITUTION.md         # Governing principles and engineering invariants
└── Makefile                # Common build, test, format, and verification commands
```

---

## Documentation

Detailed documentation is available in the [`docs/`](docs/) directory:
- [Architecture & Domain Model](docs/ARCHITECTURE.md)
- [REST API Guide](docs/API_GUIDE.md)
- [Security & Isolation Design](docs/SECURITY.md)
- [Operations & Configuration](docs/OPERATIONS.md)
- [Mobile Sync Protocol](docs/SYNC_PROTOCOL.md)
- [OpenAPI Specification](docs/openapi.json)
