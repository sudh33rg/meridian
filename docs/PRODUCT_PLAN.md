# Meridian — full product plan

> **Status:** Target feature catalog and roadmap, not a statement of delivered parity. The current M0–M10 implementation ledger is in `IMPLEMENTATION_STATUS.md`.

## Product positioning

Meridian is a connected system for work and knowledge: from company objective to initiative to project to issue to documentation to decision to evidence to release. It is designed for product/engineering, operations, professional services, marketing, IT and enterprise PMOs, while keeping the first-run experience fast and simple.

## Feature catalog and acceptance outcomes

### P0 — SaaS platform essentials
- Signup/invite/login, OIDC/SAML SSO, MFA, SCIM, email verification, account recovery, organizations and workspaces, tenant billing, plans, data regions, configurable roles, groups, custom permissions, audit log, settings, branding, accessibility, onboarding.
- Acceptance: users cannot read/write another tenant's entities even with guessed UUIDs; billing changes cannot bypass entitlements; account recovery expires and is audited.

### P1 — Jira-comparable work management
- Project templates and types (software/business/service), issue types, epics, stories, tasks, bugs, subtasks, issue hierarchies, unique readable IDs, configurable workflows, transition screens, fields/field schemes, schemes per project, components, labels, versions, assignees, watchers, votes, mentions, links, blockers, attachments, checklists, saved filters, JQL-like query language, bulk edit, clone, move, merge, archive, trash/recovery, cross-project boards, issues history.
- Agile: backlog, Scrum/Kanban boards, swimlanes, WIP limits, sprint goal/planning/closure, estimation/story points, burndown/burnup/velocity, CFD, control chart, versions/releases, agile forecasts.
- Acceptance: moving an issue across projects preserves audit and redirects; workflows reject invalid transitions; issue query engine enforces ACL before filtering; no collisions in issue keys under concurrency.

### P2 — Confluence-comparable knowledge
- Knowledge spaces, page hierarchy, templates, collaborative block-based editor, live drafts, publishing, content status, permissions, inline/page comments, tasks/mentions, version compare/restore, tree moves, attachments, page macros/embeds, export/import, document labels, content owners, verification/expiry, guest/public sharing, analytics, databases, whiteboards, diagrams, meeting notes, calendars, multimedia and video embeds.
- Acceptance: 20 concurrent editors converge without data loss; restore recovers exact earlier revision; permission revocation removes access to search results, cached data and realtime rooms.

### P3 — Planning, portfolio and enterprise work
- Goals/OKRs, initiatives, programs, cross-project portfolio roadmap, milestones, Gantt, critical path, dependency graph, resource capacity, workloads, budgets, timesheets, risks/issues/decisions (RAID), approvals, client portals, request forms, intake queues, SLAs, service catalog, incident/change/problem flows, advanced analytics, baseline schedules, scenarios, multi-project reporting.

### P4 — Collaboration and automation
- Discussion channels attached to entities, threaded comments, rich notifications, per-user preferences, digests, activity feed, in-app inbox, meeting agenda/actions, video integrations, guest collaboration, mobile push, approval queues.
- Automation builder: triggers, conditional filters, scheduled jobs, action templates, safe expressions, retries/compensation, execution history, quotas, loop prevention, idempotent integrations.

### P5 — Intelligent work and knowledge
- Semantic/keyword hybrid unified search, saved searches, type-aware results, knowledge provenance, typed linking, automatic backlink suggestions, duplicate issue detection, stale docs, decision records and ownership, impact analysis and change maps.
- Optional AI: user-controlled summaries, grounded Q&A with citations, status reporting, triage and issue decomposition, meeting action extraction, risk signals, knowledge upkeep; model-provider abstraction, tenant policy, opt-in data controls, budget caps, evaluation framework and human approval for destructive actions.

### P6 — Platform/ecosystem
- REST v1 + OpenAPI, outbound webhooks and inbound connectors, OAuth apps, admin APIs, Marketplace/SDK later, Jira/Confluence importer with incremental sync and cutover plan; Slack, Teams, GitHub, GitLab, Google Workspace, Microsoft 365, Figma, calendar, CI/CD and support integrations; billing with usage metering, feature flags, license contracts, regional deployments, enterprise export and legal retention.

### P7 — Mobile feature parity by workflow
- Flutter login, tenant switcher, My Work, projects, issues, boards, docs, threaded comments, approvals, search, notifications, camera attachments, share extension, deep links, offline read and draft write, conflict review, accessibility, biometric app lock and local secure storage.
- Avoid porting desktop-only configuration and huge visual diagrams blindly to small screens; include mobile-specific workflows.

## Key differentiators

1. Connected knowledge graph: every relevant decision and plan points to live delivery evidence, not duplicated text.
2. Intelligent context surfaced *without unnecessary AI generation*: trusted owner/source/version/permission visible at point of use.
3. Structured mode and lightweight mode: advanced Jira-like controls available where needed without forcing all teams to configure them.
4. Work-native docs and docs-native work: turn a selected doc section into an issue, mirror live issue state within a page.
5. Clear customer-facing progress: project health, accountable owners, blockers, confidence and next action instead of generic charts.
6. Performance and low-resource support: virtualization, optimistic client state, scoped querying, offline drafts and low memory overhead.

## Delivery phases, ordered and gated

| Phase | Outcome | Release gate |
|---|---|---|
| M0 Foundation | Architecture, design system, CI, tenant schema, session and permissions model, infra | Tenant isolation tests + schema audit |
| M1 Work core | Projects, teams, issue CRUD, comments, workflow engine, attachments, history, filters, list and board | Correct cross-tenant negative tests, browser E2E |
| M2 Knowledge | Spaces, document trees, block editor, versions, publishing, document ACLs | Restore, concurrency, search ACL tests |
| M3 Agile | Scrum, sprints, estimates, releases, dependencies, roadmaps | Sprint integrity and analytics reconciliation |
| M4 Collaboration | Inbox, real-time rooms, page CRDT, notifications, mobile push, whiteboards | Reconnect/convergence tests, permission revocation |
| M5 Enterprise | OIDC/SAML, SCIM, groups/ACL, billing, data region, advanced audit and retention | External security audit, billing reconciliation |
| M6 Intelligence | Unified indexing, relations, hybrid search, AI controls and citations | Permission-aware retrieval + evaluation battery |
| M7 Portfolios | Goals, capacity, budgets, risk, program reporting, approval workflows | Data parity with transactional records |
| M8 Integrations | APIs, import/export, Jira/Confluence migration, webhooks, SDK | Migration checksums, webhook idempotency |
| M9 Mobile parity | Flutter offline drafts, sync/conflicts, knowledge, issues, notifications | Device performance + accessibility tests |
| M10 Scale/GA | Multi-region practices, disaster recovery, production observability, support | Restore drill, pentest, load test, SLO review |

Phases overlap when safe; phase gates define release readiness, not calendar promises. No phase beyond the starter foundation is claimed as delivered in the source archive.

## Engineering test matrix

- Unit: validation, permissions, workflow guards, key allocation, issue projection, doc diff/merge, billing entitlements.
- DB integration: migrations up/down rehearsal, multi-tenant isolation, unique constraints, concurrency, RLS, transaction rollback, serialized numbering.
- API contract: OpenAPI golden snapshots, negative payloads, idempotency, pagination, consistent errors.
- Web E2E: sign-up, create projects, issues, board moves, page version conflict, keyboard-only flow, screen reader checks.
- Mobile: secure token storage, login, offline flows, sync conflict, push, unstable network and background resume.
- Security: IDOR, SSRF, XSS/CSRF, tenant escape, attachment upload, expired credentials, auth rate limits, ACL propagation.
- Performance: p50/p95/p99 latency, DB wait, allocations, 10k issues board, 100k pages search, 1m+ issues tenant, slow devices, network jitter.
- Reliability: worker crash, queue duplicate, Redis outage, index lag, region outage, backup restoration, partial migration.

## Target initial success metrics

- New tenant to first created project: <= 2 minutes at p75.
- Weekly active project participants, documentation reuse/link ratio, issue-to-decision traceability, task completion by due date.
- Search success click-through and zero-result rate; document conflict and restore rate.
- First contentful useful task on mid-range mobile under 2 seconds on warm app launch (measurement target, not validated).
