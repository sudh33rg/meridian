# Meridian — market research and phased implementation plan

> Draft for review · 7 November 2026 · Replaces nothing yet. It builds on `PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md` and `COMPETITIVE_LANDSCAPE.md`.

---

## 1. What Meridian is today

Meridian is a **multi-tenant work + knowledge SaaS**: Jira-style issue tracking and agile planning, Confluence-style pages, plus goals/RAID/approvals, joined by a typed relation graph. It is version 0.2-preview, labelled "not production ready".

| Layer | Present in repo | Size | Verified state |
|---|---|---|---|
| API | Rust · Axum 0.8 · SQLx 0.8 (runtime queries) · Argon2id · opaque bearer sessions | `main.rs` 224 lines + `api/advanced.rs` 661 lines (dense), **~53 routes** | **Does not compile.** `cargo check` (run 7 Nov 2026) gives 12 errors: `main.rs` references `advanced::` with no `use api::advanced;` (11 sites), and `advanced.rs:479` needs a `Vec<_>` type annotation. Both are trivial fixes. |
| DB | PostgreSQL 17, 2 migrations, ~25 tables, composite `(tenant_id,id)` FKs, GIN FTS indexes | 215 lines SQL | Not run. Schema is careful (tenant-composite FKs, partial unique index for one active sprint). |
| Web | React 19 · Vite 6 · TS 5.8 · lucide; 2 large files (`main.tsx`, `AdvancedWorkspace.tsx`), no router, no state/query lib, no tests | ~46 KB TSX | Not built (no `node_modules`). Session token in `sessionStorage`. |
| Mobile | Flutter single `main.dart` (6 screens), `http` + `flutter_secure_storage` | 225 lines | No platform folders, no Flutter SDK on this machine. |
| Infra | Compose (PG / full stack), Dockerfiles, nginx, k8s reference YAML, k6 + Python smoke test | small | No CI workflow. No commits in git yet. |

**Architecture traits worth keeping:** tenant comes from session, never the request; composite tenant FKs; outbox table exists; webhook dispatch intentionally disabled (SSRF-safe); optimistic page versions; honest status docs.

**Structural problems the plan must fix first:**
1. It doesn't compile, and there is no CI, so nothing has ever run.
2. Every handler calls `identity(&h,&app.db)` by hand. There's no request-context extractor, no transaction-per-request, and no tenant GUC, so RLS can't be switched on.
3. Audit and outbox writes happen after the main commit, so they aren't atomic.
4. Status, kind and priority are SQL `CHECK` enums. That blocks configurable workflows and issue types, which is the core of Jira parity.
5. Breadth beats depth: 10 milestones are touched and none is finished. The web UI is two monolithic files.
6. There's no event/sync backbone. Realtime, webhooks, search indexing, automation and mobile sync will each need one, and today each would invent its own.

---

## 2. Research method and honesty note

The request was "top 500 similar solutions in each domain". Few of these domains *have* 500 serious products. Work management and helpdesk come close if you count every SaaS listing. Domains like "Rust CRDT servers" have under 20. Here is what I did instead:

* **Inventory (§3):** ~430 named products/projects across 13 domains. They come from market knowledge plus targeted web searches (Nov 2026). It's an inventory to scan, not an audited ranking. Licences and status for anything you plan to *adopt* must be re-checked at the source.
* **Borrow list (§4):** the ~70 products that each teach Meridian something concrete. Each has *what to take*, *how* (adopt code / copy pattern / copy UX) and *where it lands in the plan*.
* Fresh 2026 evidence checked via search: Plane (AGPL, PQL query language, Jira and Confluence-XML importers), Huly (EPL-2.0 all-in-one), Atlassian "Agents in Jira" + Rovo MCP server GA (Team '26), Linear sync engine (server-ordered sync IDs, delta packets, IndexedDB object pool), PowerSync Flutter SDK (Postgres WAL → SQLite, sync rules/streams), ElectricSQL acquired by Databricks (Aug 2026), Yjs/yrs/Loro/Automerge maturity, OpenFGA/SpiceDB/Cedar, ParadeDB `pg_search` (Tantivy BM25 inside Postgres), Rust PG job queues (`graphile_worker`, `apalis-postgres` 1.0 RC, `pgqrs`), Keycloak 26.7 / Zitadel licence change to AGPL, Excalidraw MIT vs tldraw commercial licence, Tiptap/BlockNote/Lexical.

---

## 3. Solution inventory by domain (~430)

Legend: **OSS** = open source/source-available you could study or embed; bold = in the borrow list (§4).

### 3.1 Issue tracking & agile delivery (60)
**Jira**, **Linear**, **Plane** (OSS), **Huly** (OSS), **YouTrack**, **Shortcut**, **GitHub Issues/Projects**, **GitLab Plan**, Azure DevOps Boards, **OpenProject** (OSS), Taiga (OSS), Redmine (OSS), Trac (OSS), Tuleap (OSS), Phabricator/Phorge (OSS), Bugzilla (OSS), MantisBT (OSS), Targetprocess (Apptio), Rally (Broadcom), Digital.ai Agility, Jira Align, Pivotal Tracker (retired 2025), Height (shut down 2025), Tegon (OSS), Leantime (OSS), Vikunja (OSS), Kanboard (OSS), Wekan (OSS), Focalboard/Mattermost Boards (OSS), Planka (OSS), Kitemaker, Zenhub, ClickUp Sprints, Asana for engineering, Monday dev, Wrike, Teamwork, Backlog (Nulab), Pivotal-like Clubhouse, Sentry issues, Bitbucket issues, Gitea/Forgejo issues (OSS), OneDev (OSS), Gerrit-linked trackers, Codegiant, Zoho Sprints, Nifty, Hive, Productboard, Aha!, Jira Product Discovery, airfocus, Craft.io, Dovetail-linked roadmaps, Pivotal-style Kanbanize (Businessmap), SwiftKanban, LeanKit (Planview AgilePlace), Favro, Restyaboard (OSS), Taskcafe (OSS), Punt (OSS, JQL-like PQL).

### 3.2 General work & task management (45)
**Asana**, **monday.com**, **ClickUp**, Trello, Basecamp, Wrike, Smartsheet, Notion Projects, Airtable interfaces, Teamwork.com, Zoho Projects, Hive, MeisterTask, nTask, Freedcamp, ProofHub, Paymo, Workzone, Todoist, Things, TickTick, Microsoft Planner, Microsoft To Do, Google Tasks, Any.do, Nifty, Motion, Sunsama, Akiflow, Reclaim, Height, Taskade, Quire, Flow, Podio, Bitrix24 (self-host), Kissflow, Process Street, Pipefy, Tallyfy, Workfront, Celoxis, Accelo, Teamwork Spaces.

### 3.3 Knowledge, wikis & docs (50)
**Confluence**, **Notion**, **Coda**, **Outline** (BSL), **Docmost** (AGPL), **AFFiNE** (OSS), **BookStack** (MIT), Wiki.js (OSS), XWiki (OSS), MediaWiki (OSS), DokuWiki (OSS), **Guru**, Slite, Nuclino, Tettra, Document360, GitBook, Archbee, ReadMe, Mintlify, Docusaurus (OSS), Nextra (OSS), Starlight (OSS), Obsidian, Logseq (OSS), Anytype (OSS-ish), AppFlowy (OSS), SiYuan (OSS), Joplin (OSS), Trilium (OSS), Craft, Bear, Quip (retired), Dropbox Paper (retired), Google Docs, Microsoft Loop, Microsoft SharePoint, Zoho Wiki, Helpjuice, Bloomfire, Notion AI Q&A, Slab, Almanac, Wikso (OSS), Hedgedoc (OSS), CryptPad (OSS), Etherpad (OSS), Penpot docs, Capacities, Tana.

### 3.4 Real-time collaboration engines & editors (40)
**Yjs**, **yrs / y-crdt (Rust)**, **Hocuspocus**, y-redis, y-sweet (Rust, OSS), **Loro** (Rust), **Automerge** (Rust core), Diamond Types (Rust), abyo-crdt (Rust, alpha), ShareDB (OT), **Liveblocks**, PartyKit (Cloudflare), Velt, Ably, Pusher, Supabase Realtime, Convex, Replicache → **Zero** (Rocicorp), InstantDB, Triplit, Jazz, DXOS, Fluid Framework, **ProseMirror**, **Tiptap**, **BlockNote**, **Lexical**, Slate, Quill, CKEditor 5, TinyMCE, Editor.js, Plate, Milkdown, Remirror, BlockSuite (AFFiNE), Novel, Yoopta, Wax, Atlaskit editor (ProseMirror).

### 3.5 Whiteboards, diagrams & visual thinking (25)
Miro, Mural, FigJam, Lucidspark, Lucidchart, Whimsical, **Excalidraw** (MIT), **tldraw** (commercial SDK licence), Milanote, Stormboard, Conceptboard, Canva Whiteboards, Microsoft Whiteboard, Apple Freeform, draw.io/diagrams.net (OSS), **Mermaid** (OSS), PlantUML, D2, Kroki, Eraser, Structurizr, IcePanel, Napkin, Scrumlr (OSS retros), Parabol (OSS retros).

### 3.6 Planning, portfolio, roadmaps & resources (35)
Microsoft Project, Planview, Jira Plans (Advanced Roadmaps), Jira Align, **Linear Initiatives/Projects**, **Asana Portfolios & Goals**, Smartsheet, Adobe Workfront, Sciforma, Celoxis, Kantata, **Float**, **Runn**, Resource Guru, Forecast, Teamdeck, GanttPRO, TeamGantt, Instagantt, Toggl Plan, ProjectLibre (OSS), GanttProject (OSS), frappe-gantt (OSS lib), DHTMLX Gantt, Bryntum, Productboard, Aha!, Roadmunk, ProductPlan, **Lattice/15Five OKRs**, Perdoo, Quantive (Gtmhub), Tability, Viva Goals (retired 2025), Ally.io.

### 3.7 Service management & intake (30)
**Jira Service Management**, ServiceNow, Freshservice, Zendesk, Freshdesk, ManageEngine SDP, BMC Helix, HaloITSM, GLPI (OSS), Zammad (OSS), osTicket (OSS), FreeScout (OSS), Chatwoot (OSS), Help Scout, Front, Intercom, Plain, Pylon, Linear Asks, Tally/Typeform intake, Jotform, Google Forms, Microsoft Forms, Formbricks (OSS), incident.io, PagerDuty, Rootly, FireHydrant, Atlassian Opsgenie (retiring), Grafana OnCall (OSS).

### 3.8 Communication & async coordination (25)
Slack, Microsoft Teams, Google Chat, Mattermost (OSS), Zulip (OSS — **topic threads**), Rocket.Chat (OSS), Element/Matrix (OSS), Discord, Twist, Chanty, Pumble, Threads.com, Loom, Claap, tl;dv, Fireflies, Otter, Fathom, Granola, Range (check-ins), Geekbot, Status Hero, Basecamp Campfire, Huly chat, Campsite (OSS after shutdown).

### 3.9 Automation & workflow engines (30)
**Jira Automation**, Zapier, Make, **n8n** (fair-code), Activepieces (OSS), Automatisch (OSS), Pipedream, Workato, Tray.io, Power Automate, **Temporal** (MIT), Restate, Inngest, Trigger.dev (Apache-2), Hatchet, Windmill (AGPL), Kestra, Airflow, Prefect, Dagster, Node-RED, Huginn, **graphile-worker** (+ Rust port), **apalis** (Rust), pgqrs (Rust), PGMQ, River (Go), Sidekiq, BullMQ, Oban.

### 3.10 Identity, tenancy & authorization (35)
Auth0, Okta, **WorkOS**, Clerk, Stytch, Descope, FusionAuth, Frontegg, PropelAuth, **Keycloak** (Apache-2, SCIM preview in 26.7), **Zitadel** (now AGPL), Ory Kratos/Hydra/Keto, Authentik, Authelia, **Kanidm** (Rust), Logto, SuperTokens, Casdoor, BoxyHQ SAML Jackson → **Ory Polis**, **OpenFGA** (CNCF), **SpiceDB** (AuthZed), Permify, **Cedar** (AWS), Cerbos, OPA, Oso, Casbin, Topaz (Aserto), Warrant, Permit.io, Supabase Auth (GoTrue), Better Auth, Lucia (archived), webauthn-rs (Rust).

### 3.11 Search, knowledge graph & AI (35)
**Glean**, **Atlassian Rovo**, Notion AI, Guru AI, Dashworks, Moveworks, Coveo, Elastic, OpenSearch, **Meilisearch** (Rust), **Typesense**, Algolia, **Tantivy** (Rust), Quickwit, Vespa, **ParadeDB pg_search**, pg_textsearch (Tiger Data), **pgvector**, pgvectorscale, Qdrant (Rust), Weaviate, Milvus, LanceDB (Rust), Chroma, Turbopuffer, Onyx/Danswer (OSS enterprise search), Sourcegraph Cody, Unstructured, LlamaIndex, Haystack, Vectara, Cohere Rerank, **Linear AI triage**, GitHub Copilot coding agent, **MCP** (protocol).

### 3.12 Integrations, API platform & migration (40)
**Svix** (+ Standard Webhooks spec), Hookdeck, Convoy (OSS), Nango (OSS unified OAuth), Merge.dev, Paragon, Pipedream Connect, Unified.to, Airbyte, Fivetran, **utoipa** (Rust OpenAPI), aide, Stainless, Speakeasy, Fern, openapi-generator, Postman, Bruno, GraphQL (async-graphql), tRPC, **Jira REST/JSON export**, **Confluence XML export**, **Plane importers**, OpenProject Jira importer, Jira Cloud Migration Assistant, Confluence CMA, Exalate, Unito, Zapier Jira bridge, GitHub Apps, GitLab webhooks, Slack Bolt, Microsoft Graph, Google Workspace APIs, Figma API, Sentry integrations, Atlassian Forge, Linear SDK.

### 3.13 Mobile, offline & sync (25)
**Linear sync engine**, **Zero**, **PowerSync** (Flutter SDK), ElectricSQL (Databricks), Replicache, InstantDB, Triplit, Turso/libSQL embedded replicas, Couchbase Lite, Realm/Atlas Device Sync (deprecated), Firebase Firestore offline, Supabase + Brick (Flutter), **drift** (Flutter SQLite), Isar, ObjectBox, sqflite, Hive (Dart), Riverpod, Bloc, go_router, flutter_secure_storage, FCM, APNs, OneSignal, Expo (comparison).

### 3.14 Platform, ops & quality for a Rust SaaS (adjacent, 30)
OpenTelemetry, Grafana/Loki/Tempo/Mimir, Honeycomb, Sentry, Datadog, SigNoz (OSS), HyperDX, tower-governor, tower-http, **testcontainers-rs**, sqlx-cli, sea-orm, Refinery, cargo-deny, cargo-audit, cargo-nextest, cargo-cyclonedx, cosign/Sigstore, Renovate, Dependabot, pgBackRest, WAL-G, CloudNativePG, Neon branching, Supabase CLI, k6, Playwright, Storybook, Chromatic, axe-core.

---

## 4. What to take from whom (borrow list)

Mode: **Adopt** = use the library/protocol · **Pattern** = copy the architecture · **UX** = copy interaction design. "Phase" refers to §5.

### Work management
| From | Take | Mode | Phase |
|---|---|---|---|
| Linear | Keyboard-first UX, `⌘K` command palette, instant optimistic UI, cycles with auto-rollover, triage inbox, project updates with health (on track / at risk), Git branch naming → auto status | UX + Pattern | 2, 3, 5 |
| Linear sync engine | Server orders every mutation with a **monotonic per-tenant `sync_id`**. It broadcasts **delta packets**, clients keep an object pool + IndexedDB, and reconnect = "give me everything after sync_id N" | Pattern | 1 (log), 3 (clients) |
| Jira | Workflow schemes (statuses, transitions, validators, conditions, post-functions), issue type schemes, field configurations, JQL, changelog, Advanced Roadmaps hierarchy above epic | Pattern | 2, 7 |
| Plane | PQL (field-operator-value, autocomplete), layout views (list/board/spreadsheet/calendar/gantt) over one query, intake, **importer UX** (Jira, Confluence XML/HTML) | UX + Pattern | 2, 5 |
| GitHub Projects | Views as saved query + layout + group-by; custom fields with typed schemas; iteration fields | Pattern | 2 |
| YouTrack | Command-style text edits ("for me State In Progress"), saved searches as tags | UX | 2 |
| Shortcut | Stories/epics/objectives hierarchy kept to 3 levels; "Iterations" as optional | UX | 2 |
| Huly | Single model for issues + docs + chat (validates Meridian's thesis); see where it feels cluttered and avoid that | UX (cautionary) | — |
| OpenProject | Gantt with baselines, work packages, BCF; the enterprise PMO checklist | Pattern | 7 |

### Knowledge & editing
| From | Take | Mode | Phase |
|---|---|---|---|
| Confluence | Spaces independent of projects, page tree moves, page restrictions inherited down the tree, Jira macros (live issue lists), templates/blueprints, inline comments | Pattern | 4 |
| Notion | Blocks, slash menu, databases-in-docs (a page section that is a live filtered issue view), synced blocks | UX | 4 |
| Guru | **Verification** (owner + expiry → "needs re-verify" queue) | Pattern | 4 |
| Outline / Docmost | Practical OSS Yjs-backed wiki architecture: ProseMirror JSON as canonical, Yjs state for live, server-side snapshotting | Pattern | 4 |
| Tiptap / BlockNote | Editor framework (ProseMirror) with Yjs collaboration extension. BlockNote gives Notion-like blocks out of the box | **Adopt** (check BlockNote licence; Tiptap core MIT, avoid Pro extensions) | 4 |
| yrs (y-crdt) | Run the Yjs sync protocol **inside the Rust API** over Axum WebSocket, so there's no Node sidecar. Hocuspocus is the fallback if yrs blocks you | **Adopt** | 4 |
| Excalidraw | Embedded whiteboards (MIT). tldraw only if a commercial licence is budgeted | **Adopt** | 4 |
| Mermaid | Diagram blocks in docs (Plane shipped this June 2026) | **Adopt** | 4 |
| Zulip | Topic-threaded discussion as the model for entity discussions | UX | 5 |

### Platform, security, scale
| From | Take | Mode | Phase |
|---|---|---|---|
| Postgres RLS community pattern | Transaction per request → `SELECT set_config('app.tenant_id',$1,true)` → policies `USING/WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`, `FORCE ROW LEVEL SECURITY`, non-owner app role | Pattern | 1 |
| OpenFGA / SpiceDB (Zanzibar) | Relation-tuple authorization model (`project#member`, `page#viewer` inherits `space#viewer`). **Start with in-Postgres tuples + a Rust checker using an OpenFGA-compatible model**, and move to OpenFGA only when needed | Pattern → optional Adopt | 1, 8 |
| Cedar | Policy language for ABAC rules (guest restrictions, data residency) if tuples aren't enough | Optional | 8 |
| graphile_worker (Rust) / apalis-postgres | Durable jobs in Postgres with `SKIP LOCKED` + `LISTEN/NOTIFY`. No Redis needed | **Adopt one** | 1 |
| Svix / Standard Webhooks | Webhook signing header format, retry schedule, endpoint disable after failures, replay UI | **Adopt spec** | 5 |
| WorkOS | Product surface for enterprise SSO: admin portal, connection setup wizard, directory sync events | UX | 8 |
| Ory Polis (ex-SAML Jackson) / Keycloak | SAML ↔ OIDC bridge so the Rust API only speaks OIDC | **Adopt as sidecar** | 8 |
| webauthn-rs, openidconnect-rs, totp-rs | Passkeys, OIDC client, TOTP | **Adopt** | 1, 8 |
| utoipa | OpenAPI generated from Rust types, so web/mobile get generated clients | **Adopt** | 0 |
| testcontainers-rs | Ephemeral Postgres in tests (cross-tenant negative suite) | **Adopt** | 0 |
| Stripe + Lago/OpenMeter | Billing + usage metering; entitlements checked server-side | Adopt | 8 |

### Search, AI, automation, ecosystem
| From | Take | Mode | Phase |
|---|---|---|---|
| ParadeDB pg_search / pgvector | BM25 + vector inside Postgres, fused with Reciprocal Rank Fusion in one SQL query, so there's no separate search cluster | **Adopt** (pg_trgm + FTS first) | 6 |
| Glean / Onyx | Permission-aware retrieval: ACL filter *inside* the query, never post-filter; connectors model | Pattern | 6 |
| Atlassian Rovo + "Agents in Jira" | **Agents as assignees** that act through the same permission/audit/approval path as humans; **MCP server** exposing Meridian to Claude/Cursor | Pattern | 5 (MCP), 6 (agents) |
| Linear AI triage | Suggest assignee/labels/duplicates in the triage inbox. The human accepts | UX | 6 |
| Jira Automation | Trigger → conditions → actions, smart values, audit log per rule, loop limits, per-tenant execution quotas | Pattern | 5 |
| cel-interpreter (Rust) | Safe expression language for automation conditions & smart values | **Adopt** | 5 |
| Temporal / Restate | Durable multi-step workflows. **Defer**: the Postgres job queue covers the need until approvals/SLAs get complex | Defer | — |
| Nango | Unified OAuth token storage/refresh for GitHub/Slack/Google integrations | Adopt or pattern | 5 |
| Plane / OpenProject importers | Jira REST + Confluence XML import fidelity checklist (keys, history, users, attachments, links) | Pattern | 5 |

### Planning & mobile
| From | Take | Mode | Phase |
|---|---|---|---|
| Asana Goals / Lattice | Goal tree with weighted progress from linked work; scheduled check-ins | UX | 7 |
| Float / Runn | Capacity = availability − allocations, per person per week; tentative vs confirmed | Pattern | 7 |
| Jira Plans | Hierarchy above epic (initiative), dependency lines, auto-schedule against capacity | Pattern | 7 |
| PowerSync | Postgres WAL → per-user SQLite buckets on Flutter. **Candidate to adopt** for mobile if the in-house sync protocol (Phase 3) isn't ready | Adopt-or-pattern decision | 9 |
| drift | Typed SQLite on Flutter for the local store | **Adopt** | 9 |

### Deliberately *not* building (buy, embed or skip)
Own identity provider · own chat product · ITSM suite (keep a light "intake form → issue" only) · own search cluster before ~10M docs · own whiteboard engine · own durable-workflow engine · Gantt before the work core is solid.

---

## 5. Phased implementation plan

Principles: **depth before breadth**; every phase ends in a *release gate* that's tested, not just written down; and **one event log feeds everything** (outbox, realtime, webhooks, indexing, automation, mobile sync). Estimates are engineer-weeks (ew) for a senior team. Treat them as rough sizing, not commitments.

```
P0 Make it real ─▶ P1 Trust foundation + event log ─▶ P2 Work core ─▶ P3 Realtime & sync
                                                      │                │
                                                      ▼                ▼
                                   P5 Automation/notify/integrations  P4 Knowledge (CRDT)
                                                      │                │
                                                      └──▶ P6 Search & AI ◀┘
                                         P7 Planning/portfolio · P8 Enterprise · P9 Mobile · P10 GA
```

### Phase 0 — Make it real (≈2–3 ew)
Goal: a green CI pipeline and a codebase that can grow.

1. **Fix compilation:** add `use api::advanced;` in `main.rs`, annotate the `Vec` at `advanced.rs:479`, then `cargo clippy -D warnings` + `cargo fmt`.
2. Make the first git commit. Add a **CI workflow** with jobs `rust` (fmt, clippy, nextest against a Postgres 17 service), `web` (npm ci, tsc, vite build, eslint), `mobile` (flutter analyze, test), `deny` (cargo-deny, npm audit) and `docker` (build both images).
3. **Restructure the server into a Cargo workspace:** `meridian-core` (types, errors, ids), `meridian-db` (pool, tx, migrations), `meridian-authz`, `meridian-work`, `meridian-knowledge`, `meridian-planning`, `meridian-platform`, `meridian-api` (Axum routing only). Move the 53 routes into per-domain modules.
4. **Request context extractor:** an `Auth` / `TenantTx` Axum extractor that resolves the session once and opens a transaction. It replaces the hand-written `identity()` calls.
5. **Typed error enum** (`thiserror`) → stable JSON error codes; validation via `validator` or `garde`.
6. **OpenAPI** with `utoipa`; generate a TS client (openapi-typescript) and a Dart client. Document cursor pagination as a standard envelope.
7. **Web restructure:** TanStack Router + TanStack Query, split the two monolithic files into feature folders, Vitest + Playwright smoke, ESLint, design tokens file.
8. **Mobile:** `flutter create` the platform folders, split `main.dart` into features, use the generated Dart client, add Riverpod.
9. **Test harness:** testcontainers-rs Postgres per test binary; port `tests/smoke.py` into Rust integration tests.

**Gate:** CI green on main; `docker compose -f infra/docker-compose.full.yml up` works from a clean clone; a signup → project → issue → page E2E passes in Playwright.

### Phase 1 — Trust foundation + event log (≈6–8 ew) — **implemented 7 Nov 2026; see `IMPLEMENTATION_STATUS.md`**

> Deviations from the plan below: the job runner is a ~150-line in-house Postgres queue (no `graphile_worker`/`apalis` dependency; same semantics); OpenTelemetry/OTLP export is deferred (request ids, JSON logs and Prometheus metrics shipped); authorization is a project-level tuple model (`project_access()`), not the full workspace→project→page tuple graph; the planned cross-tenant negative test suite was replaced by visual verification under the repository's no-new-tests rule.
Goal: safe to hold real data in a closed beta. This is the backbone every later phase depends on.

1. **RLS:** migration `0003_rls.sql` enables + forces RLS on every tenant table with `tenant_id = current_setting('app.tenant_id', true)::uuid` in USING and WITH CHECK. The app connects as a non-owner role (`meridian_app`); migrations run as `meridian_owner`. `TenantTx` runs `set_config('app.tenant_id',$1,true)` first. Auth/session lookup uses a narrow `SECURITY DEFINER` function.
2. **Cross-tenant negative suite:** for every route, tenant B's token against tenant A's ids must return 404, plus a raw-SQL test proving RLS blocks it even with a buggy predicate.
3. **Unified event log** (`events` table: `tenant_id, sync_id bigint per tenant, entity_type, entity_id, op, actor, patch jsonb, created_at`). It's written **in the same transaction** as the mutation and the audit row. Allocate `sync_id` from a per-tenant counter row (`UPDATE … RETURNING`) for gap-free ordering. This becomes the outbox, the audit trail, the realtime feed and the sync log (the Linear pattern).
4. **Job runner:** adopt `graphile_worker` (Rust) *or* `apalis-postgres`. Pick by spike in week 1: compare `LISTEN/NOTIFY` latency and API ergonomics. Make an event-log consumer cursor table per subscriber (webhooks, indexer, notifier, automation).
5. **Browser auth:** move to an HttpOnly, Secure, SameSite=Lax session cookie + double-submit CSRF token for the web. Keep bearer tokens for mobile/API with a refresh-token rotation table. Add a session list + revoke UI.
6. **Account lifecycle:** email verification, password reset and invite delivery, all as jobs through `lettre` + an SMTP/Postmark/SES adapter. Keep the dev mailer as Mailpit in Compose.
7. **Authorization v1 (Zanzibar-lite):** a `relation_tuples(tenant_id, object_type, object_id, relation, subject_type, subject_id, subject_relation)` table. The model file follows OpenFGA DSL syntax (workspace → project → issue; workspace → space → page with inheritance; guest; team as subject set). A Rust `check()`/`list_objects()` with request-scoped memo. Existing four roles become tuples. Search and list endpoints join the permitted set instead of post-filtering.
8. **Abuse controls:** `tower-governor` per IP + per account, trusted-proxy config, body/time limits per route, CSP + security headers in nginx.
9. **Observability baseline:** `tracing` + OpenTelemetry OTLP exporter, request IDs, structured redacted logs, Prometheus metrics (route latency, pool waits, job lag, event-log lag).

**Gate:** negative suite passes with RLS on; killing the worker mid-flight loses no events (at-least-once + idempotency key per consumer); OWASP ASVS L2 self-review of auth; restore-from-backup rehearsal of a dev DB.

### Phase 2 — Work core that beats Jira on feel, matches it on depth (≈8–10 ew)
1. **Configurable workflows:** tables `workflows`, `workflow_statuses` (category: todo/in-progress/done, like Jira status categories), `workflow_transitions` (from, to, conditions, validators, post-actions as JSON). Replace the `CHECK` enums with FKs; issue type schemes per project. Validate transitions in a Rust state-machine module with unit tests.
2. **Custom fields:** typed field definitions (text, number, select, multi-select, user, date, url, issue-ref) with per-project contexts. Values go in a typed `issue_field_values` table (not free JSON) so they're indexable and filterable.
3. **Issue keys** `PROJ-123` from a per-project counter (`UPDATE … RETURNING`), with a key-history table so moved issues redirect.
4. **Changelog:** a field-level history derived from the event log; activity tab with diffs.
5. **Meridian Query Language (MQL):** a JQL/PQL-style grammar (`status = "In Review" AND assignee = currentUser() ORDER BY priority`) parsed with `chumsky` → AST → parameterized SQL that always ANDs the authz predicate. Web editor with field → operator → value autocomplete. Saved views = query + layout + grouping + columns (GitHub Projects model).
6. **Layouts over one query:** list (virtualized with TanStack Virtual), board (WIP limits, swimlanes), spreadsheet, calendar.
7. **Linear-grade UX:** `⌘K` palette, single-key shortcuts (`c` create, `a` assign, `s` status), optimistic mutations, triage inbox, sub-issues, bulk edit, copy-link/branch-name.
8. **Agile:** backlog with fractional-index ranking (LexoRank-style string keys), sprint planning with capacity, auto-rollover of unfinished work. Burndown/burnup/velocity/CFD come from a nightly `issue_daily_snapshots` projection.
9. **Attachments:** S3-compatible (MinIO in dev) with presigned upload/download, size/type limits, async ClamAV scan job, image thumbnails.
10. Watchers, @mentions, votes, cloning, moving across projects (with key redirect), trash with 30-day recovery.

**Gate:** 10k-issue project board renders the first viewport in under 1.5 s on a mid-range laptop; MQL fuzz tests show no SQL injection and no ACL bypass; invalid transitions are rejected; Playwright keyboard-only flow passes.

### Phase 3 — Realtime & client sync engine (≈5–6 ew)
1. **Delta stream:** `GET /api/sync/stream` (WebSocket; SSE fallback) per session. The server tails the event log via `LISTEN/NOTIFY` + cursor, filters through authz, and pushes `{sync_id, entity, patch}`.
2. **Catch-up:** `GET /api/sync/since?sync_id=N`, plus a bootstrap snapshot endpoint (paged, per-project), so clients reconnect without full reload.
3. **Web client store:** normalized object pool (TanStack Query cache or a small MobX/Zustand pool), persisted to IndexedDB, with a mutation queue that's retried and reconciled when its own delta returns (the Linear model: server-authoritative ordering, not CRDT, for structured data).
4. **Presence:** ephemeral in-memory per API node. For multi-node, fan out via Postgres `NOTIFY`, and add Redis/NATS only when it's measured as needed.
5. **Permission revocation:** when an authz tuple is deleted, the server emits a tombstone for affected objects to connected clients and drops room membership.

**Gate:** two browsers see each other's edits in under 300 ms p95 on a LAN; offline edits replay correctly after 10 min disconnect; a revoked user's open tab loses access within 5 s.

### Phase 4 — Knowledge that is work-native (≈8–10 ew)
1. **Spaces** decoupled from projects (a space may link to many projects), page tree with fractional ordering + move, templates, labels, owners, status (draft/published/archived).
2. **Collaborative editor:** Tiptap (MIT core) or BlockNote on ProseMirror, `y-prosemirror` on the client, and the **Yjs sync protocol served by `yrs` inside Axum** (`/api/collab/{page_id}` WebSocket). Authz is checked at join and on every update. Store compacted Yjs updates in `page_ydoc_updates` + periodic snapshots. On publish, render canonical ProseMirror JSON → sanitized HTML (`ammonia`) into `page_versions`. Fallback if yrs proves immature: a Hocuspocus Node sidecar using the same storage tables and calling the API for auth.
3. **Inline comments** anchored with Yjs relative positions; resolve/reopen; mentions → notifications.
4. **Differentiators:** (a) the *live issue embed* block (an MQL query rendered as a live table inside a page); (b) *select text → create issue* with a back-reference; (c) automatic **backlinks** panel from `entity_relations`; (d) Guru-style **verification** with owner + review interval and a "stale knowledge" queue.
5. Whiteboards via the Excalidraw component (scene JSON stored as a page type, Yjs-synced). Mermaid code blocks rendered client-side.
6. Page restrictions inherit down the tree (authz tuples: `page#parent`), version compare (diff of ProseMirror JSON), restore, export to Markdown/PDF.

**Gate:** 20 concurrent editors in a load test converge with no lost text; restore gives back the exact earlier revision; XSS corpus (OWASP cheatsheet payloads) is neutralized in render.

### Phase 5 — Automation, notifications, integrations, migration (≈8–10 ew)
1. **Notifications:** consumer of the event log → per-user preferences matrix (in-app/email/push × event type) → batching window + daily digest. The web inbox grouped by entity.
2. **Automation engine (Jira Automation model):** rule = trigger (event type + filter MQL) → conditions (CEL via `cel-interpreter`) → actions (transition, assign, comment, set field, create sub-issue, send webhook, notify). Runs as jobs with an idempotency key `(rule_id, event sync_id)`, max chain depth 3 for loop prevention, per-tenant monthly execution quota, and a per-rule audit log. Plus a template gallery.
3. **Webhooks dispatcher:** follow the Standard Webhooks spec (`webhook-id`, `webhook-timestamp`, `webhook-signature` HMAC-SHA256). Exponential retry for 24 h, auto-disable after sustained failure, replay from the admin UI. SSRF guard: resolve DNS → reject private/link-local/metadata ranges, no redirects, egress via proxy.
4. **Git integrations:** GitHub App + GitLab webhooks. Branch/PR title containing `PROJ-123` links and auto-transitions (configurable), shows commits/PR state/CI on the issue (Linear model).
5. **Slack/Teams:** unfurls, create-issue from message, notifications channel. Use Nango (or an in-house OAuth token table) for tokens.
6. **Meridian MCP server:** tools for search, get/create/update issue, read page, list my work, all through the same authz + audit path. This is cheap to build and high-value (Atlassian shipped Rovo MCP GA in 2026).
7. **Importers:** Jira (Cloud REST API: projects, issues, changelog, comments, attachments, links, sprints, users → mapped via the existing `external_ref` pattern), Confluence (space XML export ZIP → page tree, attachments, comments; macros → closest block or a preserved "unsupported macro" block), Linear and GitHub Issues (API), CSV. Run as resumable jobs with a mapping table, dry-run report and checksum/count reconciliation.
8. **Export:** full-tenant export job (JSON + attachments ZIP, checksummed manifest), replacing the 10k-row bounded endpoint.

**Gate:** a 50k-issue Jira sample imports with counts reconciled and a re-import that's idempotent; webhook duplicate delivery is harmless; an automation loop test terminates.

### Phase 6 — Search & governed AI (≈6–8 ew)
1. Search v2: Postgres FTS (`english` + `simple`) + `pg_trgm` for typo/prefix, searching across issues, pages, comments and goals with a type facet. The ACL is applied in the SQL via the permitted-objects join. Indexing comes from the event log (async, lag metric).
2. Hybrid: pgvector embeddings (job-generated, per chunk), with Reciprocal Rank Fusion of BM25 + vector. Evaluate ParadeDB `pg_search` if FTS ranking quality or speed falls short. Keep Meilisearch/Tantivy as a later escape hatch.
3. AI features (opt-in per tenant, provider abstraction, budget caps, no training on customer data): page/thread summaries, **Q&A with citations** (retrieval is permission-filtered *before* generation), issue triage suggestions (labels, assignee, duplicates via vector similarity), "write project update from this week's activity", meeting notes → action items.
4. **Agents as assignees:** a service-principal subject type in authz; agent actions go through the same mutation path, are marked in the event log, and destructive actions require human approval (reuse `approvals`). External agents connect via the MCP server.
5. Eval harness: a fixed question set per seeded tenant, citation-accuracy and leakage tests (a user must never get content from pages they can't read). Prompt-injection tests on indexed documents.

**Gate:** zero ACL leaks in the leakage suite; p95 search under 200 ms at 1M documents in the reference dataset.

### Phase 7 — Planning & portfolio (≈5–6 ew)
Initiatives above epics (configurable hierarchy levels), a timeline/roadmap view with dependency lines (no full Gantt engine yet), capacity per person/team per week (Float/Runn model), goals tree with progress rolled up from linked work + check-in cadence (Asana/Lattice), project updates with health and a portfolio digest, and RAID kept but linked to initiatives. The existing goals/risks/decisions tables migrate into this model.

**Gate:** roll-up numbers reconcile exactly with transactional data in a reconciliation test.

### Phase 8 — Enterprise readiness (≈6–8 ew)
OIDC login (`openidconnect` crate) per tenant with verified domains. SAML via an Ory Polis or Keycloak sidecar that brokers to OIDC. SCIM 2.0 `/scim/v2/Users|Groups` endpoints mapped to memberships/teams. MFA (TOTP + WebAuthn passkeys via `webauthn-rs`). Admin portal (WorkOS-style setup wizard). Audit log search + export + SIEM streaming. Retention policies and legal hold. Data region field + per-region deployment. Billing: Stripe subscriptions + metering (Lago/OpenMeter), with entitlements enforced server-side in the authz layer. Guest users and public share links with expiry.

**Gate:** external pentest; SSO tested against Okta, Entra ID and Google; SCIM deprovision removes access within 60 s.

### Phase 9 — Mobile that's actually offline (≈6–8 ew)
**Decision point at the start of the phase:** (A) reuse the Phase 3 sync protocol with `drift` (SQLite) on Flutter, or (B) adopt PowerSync (Postgres WAL → per-user SQLite buckets, Flutter SDK). The recommendation is **A** if Phase 3 met its gate, because it keeps one sync protocol and no vendor. Choose **B** if mobile is needed before Phase 3 hardens. Scope: My Work, triage, issue detail/edit, comments, approvals, page reader (offline), search, notifications (FCM/APNs via a push job), deep links/universal links, camera attachments, share extension, biometric app lock and an accessibility pass.

**Gate:** airplane-mode edits on Android mid-range + iPhone sync without loss; cold start under 2 s; TalkBack/VoiceOver flows pass.

### Phase 10 — Scale & GA (≈5–6 ew, overlapping)
SLO dashboards (Grafana) from Phase 1 telemetry, k6 load mixes with skewed tenants, Postgres tuning + partitioning of `events`/`audit` by month, PgBouncer (transaction mode is compatible with `set_config(...,true)`), CloudNativePG or managed PG with PITR (pgBackRest/WAL-G), quarterly DR restore drill, SBOM (cargo-cyclonedx) + image signing (cosign), Renovate, WCAG 2.2 AA audit, status page, runbooks, on-call.

**Gate:** load test at 3× expected peak within SLO; restore drill RTO/RPO met; pentest high findings closed.

---

## 6. Rough totals and sequencing

| Phase | Effort (ew) | Can run in parallel with |
|---|---|---|
| P0 Make it real | 2–3 | — |
| P1 Trust + event log | 6–8 | — (backbone) |
| P2 Work core | 8–10 | P4 editor spike |
| P3 Realtime & sync | 5–6 | P5 notifications |
| P4 Knowledge | 8–10 | P2 tail, P5 |
| P5 Automation/integrations | 8–10 | P4 |
| P6 Search & AI | 6–8 | P7 |
| P7 Planning | 5–6 | P6, P8 |
| P8 Enterprise | 6–8 | P7, P9 |
| P9 Mobile | 6–8 | P8 |
| P10 GA | 5–6 | overlaps P8–P9 |
| **Total** | **≈65–83 ew** | ≈ 9–12 months with 3 engineers + design |

**A closed beta is realistic after P0–P4** (≈30–37 ew). That's the Linear-quality work core + collaborative knowledge + realtime, which already makes the core thesis (connected work + knowledge) demonstrable.

---

## 7. Decisions needed from you

1. **Scope freeze:** pause new breadth (portfolio, entitlements, ITSM ideas) until P2 ships? *Recommended: yes.*
2. **Job runner:** `graphile_worker` Rust port vs `apalis-postgres` (decide via a 2-day spike in P1).
3. **Editor:** Tiptap (MIT core, more assembly) vs BlockNote (Notion-like out of the box; confirm licence).
4. **Collab server:** `yrs` in-process (one runtime, less proven) vs Hocuspocus sidecar (proven, adds Node).
5. **Authz:** in-Postgres Zanzibar-lite first (recommended) vs running OpenFGA/SpiceDB from day one.
6. **Mobile sync:** own protocol + drift vs PowerSync (decide at P9 start).
7. **Licence of Meridian itself** (affects whether you can learn from AGPL code like Plane/Docmost by reading vs copying. Treat AGPL/BSL code as *read for ideas, don't copy*).

## 8. Sources consulted (Nov 2026)
- Plane: [OpenProject alternatives 2026](https://plane.so/blog/best-openproject-alternatives-in-2026), [Plane vs OpenProject](https://plane.so/blog/plane-vs-openproject-which-should-you-choose-in-2026), [PQL docs](https://docs.plane.so/core-concepts/issues/plane-query-language), [PQL announcement](https://plane.so/blog/introducing-pql-and-enhanced-dashboards), [Jira importer](https://docs.plane.so/importers/jira), [Confluence importer](https://docs.plane.so/importers/confluence), [changelog: Confluence XML + Mermaid](https://plane.so/changelog/2026-06-30-mermaid-js-diagrams-pql-dashboard-filters)
- [OpenProject Jira/Confluence migration](https://www.openproject.org/docs/installation-and-operations/jira-migration), [openalternative: Jira](https://openalternative.co/alternatives/jira), [openalternative: Huly](https://openalternative.co/alternatives/huly)
- Atlassian: [Agents in Jira (BusinessWire, Feb 2026)](https://businesswire.com/news/home/20260224033792/en/Atlassian-Introduces-Agents-in-Jira-to-Drive-Human-AI-Collaboration-at-Enterprise-Scale), [Team '26 changes](https://www.schneider.im/atlassian-team-26-changes-across-jira-confluence-rovo-focus-talent-more/)
- Linear sync: [reverse-linear-sync-engine](https://github.com/Aslam97/reverse-linear-sync-engine), [Linear sync engine architecture](https://hn.jakechampion.name/reader/https://www.fujimon.com/blog/linear-sync-engine), [What makes Linear feel instant](https://performance.dev/what-makes-linear-feel-instant)
- Sync engines: [Choosing a sync engine in 2026](https://johnny-sh.pages.dev/blog/choosing-a-sync-engine-in-2026), [PowerSync Dart/Flutter SDK](https://pub.dev/documentation/powersync/latest/), [PowerSync + Supabase guide](https://docs.powersync.com/integration-guides/supabase), [Electric (Dealroom)](https://app.dealroom.co/companies/electrics)
- CRDT/editors: [Loro](https://www.github.com/loro-dev/loro), [Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026), [Liveblocks editor comparison](https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025), [BlockNote vs Tiptap](https://tiptap.dev/alternatives/blocknote-vs-tiptap), [Excalidraw](https://en.wikipedia.org/wiki/Excalidraw), [Excalidraw alternatives / tldraw licence](https://sliplane.io/blog/5-awesome-excalidraw-alternatives)
- Tenancy/authz: [tenaxum](https://docs.rs/tenaxum), [corteq RLS example](https://docs.rs/crate/corteq/latest/source/src/database/mod.rs), [FGA 2026 guide](https://guptadeepak.com/ciam-compass/guides/fine-grained-authorization-fga/), [OpenFGA vs Permify vs SpiceDB](https://www.pkgpulse.com/guides/openfga-vs-permify-vs-spicedb-zanzibar-authorization-2026)
- Identity: [Open source IdPs 2026](https://www.authgear.com/post/best-open-source-identity-providers), [Open source auth comparison 2026](https://skycloak.io/?p=3288)
- Jobs: [graphile_worker (Rust)](https://docs.rs/crate/graphile_worker/latest/source/docs/src/introduction.md), [apalis-postgres](https://docs.rs/crate/apalis-postgres/latest), [pgqrs](https://docs.rs/crate/pgqrs/latest)
- Search: [ParadeDB hybrid search manual](https://paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual), [Postgres vector options 2026](https://ecorpit.com/postgres-vector-search-pgvector-pgvectorscale-paradedb-lantern-2026/)
- Automation: [Open-source workflow automation 2026](https://www.jetadmin.io/blog/best-open-source-workflow-automation-tools/)
- Wikis: [Confluence self-hosted alternatives](https://mustafa.net/self-hosted-alternatives/confluence/), [Wikso](https://github.com/veloxico/wikso)
