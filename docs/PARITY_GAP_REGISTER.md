# Meridian — feature parity gap register (Jira and top work tools)

> Status: analysis dated 8 November 2026. Rows were updated after the E to P build; the status column now reflects source as of the Q build (see `IMPLEMENTATION_STATUS.md`). Each row is one capability that Jira (Software, Work Management, Service Management, Advanced Roadmaps) or a leading tracker (Linear, Azure Boards, GitHub Projects, Asana, ClickUp, YouTrack, Shortcut, Plane) provides and that a team expects. The **Plan** column names the phase in `REMAINING_PLAN.md` that closes the row. Nothing here is a claim that Meridian has the capability until `IMPLEMENTATION_STATUS.md` says so.

**How to read the status.** *Have* = implemented and checked by the API or browser scripts recorded in `BEST_IN_CLASS_ANALYSIS.md`. *Partial* = a starting point exists but a user would notice the gap in daily use. *Missing* = no source for it.

**Evidence level.** Capabilities are taken from public product documentation and from Meridian's code (routes in `apps/server/src/api/`, migrations `0001`–`0018`, web components in `apps/web/src/features/`). They are a desk comparison, not a hands-on test of competitor instances.

## 0. The headline gaps (updated after the parity build, 8 November 2026)

The earlier version of this register said there were no backlogs or release scope. That was stale. Phase E built the product backlog (ranked, per project), team backlogs and team sprints, sprint execution with carry-over, and release scope with freeze, history and notes. The Backlog, Sprints and Releases tabs are in the navigation under Work and Plan. The demo seed (`scripts/seed_demo.py`) now creates two teams, an active team sprint and a release with scope, so the views have content on first run.

What is still missing or partial, in rough order of what a Jira-class buyer will notice:

1. Cross-project automation rules and branches in rules (6.3, 6.1).
2. OAuth 2.0 apps for third-party integrations (6.10), and pulling Jira Cloud and Confluence directly (6.12, 6.13).
3. Per-action permission levels beyond sprints, releases and trash (7.2).
4. Rich text editing with tables and images (2.21), field contexts per issue type (2.10), per-type workflows (2.4).
5. Sprint report page, burnup chart, dashboard drag-to-arrange (1.8, 1.10, 4.7).
6. Accessibility pass with a screen reader and a full keyboard walk (10.4), and most strings in the catalogue (10.5).
7. OpenTelemetry trace export (10.9), mobile Android build and device run (10.6).

Status words: *Have* means built in source and listed in `IMPLEMENTATION_STATUS.md`. *Have (unverified)* means the code exists but has not been exercised against the real provider. *Partial* means a user would notice a gap in daily use. *Missing* means no source. *Closed* means an owner decision.

## 1. Backlogs, sprints and release scope (Jira Software)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 1.1 | Product backlog: project-wide ranked list of work not in a sprint | Jira, Linear, Azure Boards, Plane | Ranked product backlog per project (`GET /projects/{id}/backlog`, Backlog tab, drag and Alt+arrow ranking) | Have | — |
| 1.2 | Rank by drag, or move to top, bottom, before or after another item | All | Drag, Alt+arrow, and top, bottom, before or after placement (`POST /issues/{id}/rank`) | Have | — |
| 1.3 | Team backlog: work owned by one team inside a shared project | Jira team-managed, Azure area paths, Linear teams | Team on every issue; team backlog filter; team picker in create, drawer and bulk edit | Have | — |
| 1.4 | Sprint per team, one active sprint per team | Jira (per board), Azure iterations | One active sprint per team and one per project scope (partial unique index) | Have | — |
| 1.5 | Sprint planning: add and remove issues from a sprint in bulk | Jira, Azure, ClickUp | Bulk add and remove to sprints; refusals reported per issue | Have | — |
| 1.6 | Sprint goal shown during planning and in the sprint view | Jira, Azure | Sprint goal stored, shown on the sprint card and sprint detail | Have | — |
| 1.7 | Sprint start and complete, with carryover of unfinished work to backlog or a named sprint | Jira (move incomplete), Azure | Start and complete; carry-over to backlog or another open sprint of the same team | Have | — |
| 1.8 | Sprint summary: committed, completed, not completed, added mid-sprint | Jira sprint report | Committed scope recorded at start; sprint detail totals (committed, done, carried) | Partial | Sprint report page with added-mid-sprint list |
| 1.9 | Burndown chart (remaining points or issues per day) | Jira, Azure, ClickUp | Burndown from stored daily snapshots (start, close and hourly); live point for today | Have | Earlier days before the first build are not reconstructed |
| 1.10 | Burnup chart (scope and done per day) | Jira, Azure | Burnup is not drawn; scope and done totals are stored per day | Partial | Burnup chart |
| 1.11 | Velocity chart and rolling average per team | Jira, Azure | Velocity per team and project over the last N closed sprints | Have | — |
| 1.12 | Scope creep: work added after the sprint started | Jira sprint report | Committed scope versus scope at close (scope creep figures) | Partial | Explicit list of items added after start |
| 1.13 | Sprint board: a board filtered to one sprint, columns by status | Jira Scrum board | Sprint filter on the board query (`sprint:openSprints()`) and board lanes; no dedicated sprint board page | Partial | Sprint board page with the sprint preselected |
| 1.14 | Releases (versions): name, date, status (unreleased, released, archived) | Jira versions, Azure releases | Releases with name, date, status (planned, released, cancelled) and scope | Have | — |
| 1.15 | Release scope: which issues ship in which release | Jira fix versions, GitHub milestones | Release scope with add and remove history (`/releases/{id}/issues`, `/history`) | Have | — |
| 1.16 | Scope freeze: additions after freeze are recorded and flagged | Jira release reports, Azure | Scope freeze, one way; additions and removals after freeze are flagged | Have | — |
| 1.17 | Release notes generated from done scope | Jira release notes, GitHub releases, Linear | Release notes generated from scope (markdown) with copy | Have | — |
| 1.18 | Release move-unfinished on release, to backlog or another release | Jira | Release action moves unfinished work to backlog or another planned release | Have | — |
| 1.19 | Release progress: done, remaining, story points, scope changes | Jira release hub | Release totals: scope and done counts and points, added after freeze, removed | Have | — |
| 1.20 | Components (ownership groups) with default assignee | Jira components | Components with default assignee; issues carry components | Have | — |
| 1.21 | Swimlanes on boards (assignee, epic, query) | Jira, Linear | Swimlanes by assignee or epic on the board | Have | Swimlanes by query |
| 1.22 | WIP limits per column | Jira Kanban, Azure, Trello | WIP limit per status column, refused with the count | Have | — |
| 1.23 | Board configuration: column to status mapping, quick filters | Jira | Quick filters (mine, unassigned, high priority); column mapping follows the workflow | Have | Quick filters saved as views |
| 1.24 | Estimation: story points and time estimates | Jira, Azure | Story points and original and remaining estimates | Have | — |
| 1.25 | Capacity planning per person and per sprint | Jira Advanced Roadmaps, Azure capacity | Capacity per person per week (`GET /capacity`); no per-sprint capacity | Partial | Per-sprint capacity and allocation over time |

## 2. Issues and work items

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 2.1 | Readable keys (PROJ-123) and numbering per project | All | Readable keys and per-project numbering | Have | — |
| 2.2 | Issue types (task, bug, story, epic) | All | Issue types per project (migration 0026) | Have | — |
| 2.3 | Configurable issue types per project, with icons and hierarchy levels | Jira issue type schemes | Issue types per project with icon, hierarchy level and key; API and web editor | Have | Per-type default workflow and field contexts |
| 2.4 | Workflow per issue type | Jira workflow schemes | One workflow per project; per-type workflow not built | Partial | Workflow per issue type |
| 2.5 | Workflow statuses, categories, custom statuses | Jira, Linear, Plane | Statuses, categories and custom statuses | Have | — |
| 2.6 | Transition rules (allowed moves, required fields) | Jira conditions and validators | Transition rules and admin-only moves | Have | — |
| 2.7 | Transition validators and post-functions (e.g. set field, notify, create subtask) | Jira | Validators (required field, admin only) and post-functions (set field, notify admins, notify assignee, create subtask) | Have | More post-functions (e.g. transition a linked issue) |
| 2.8 | Screens: which fields appear on create, edit and transition | Jira field configurations and screens | Transition screens list the fields shown per action; required fields checked | Partial | Per-field conditional screens |
| 2.9 | Custom fields with types and options | All | Custom fields with types and options | Have | — |
| 2.10 | Custom field contexts per issue type | Jira | Custom fields are per project; contexts per issue type are not built | Partial | Field contexts per issue type |
| 2.11 | Epics, with child issues and progress roll-up | Jira, Azure, Linear | Epics with child issues, progress roll-up and an epic summary in roll-ups | Have | Child board for epics |
| 2.12 | Subtasks (first-class children) | Jira | Subtasks (one level deep), with roll-up and drawer list | Have | Deeper nesting is not in Jira either |
| 2.13 | Labels | All | Labels, with bulk add and remove | Have | — |
| 2.14 | Priority | All | Priority (four levels) | Have | — |
| 2.15 | Due dates and reminders | All | Due dates and reminders (inbox and digest) | Have | — |
| 2.16 | Assignee, reporter | All | Assignee and creator | Have | — |
| 2.17 | Watchers | Jira, Azure, YouTrack | Watchers (add and remove; bulk add) | Have | — |
| 2.18 | Votes | Jira | Votes (count and voted) | Have | — |
| 2.19 | Mentions (@user) that notify | All | @mentions notify the member in the inbox | Have | — |
| 2.20 | Comments: threaded replies, edit, delete, reactions | All | Comments: threaded replies, edit with revision history, delete, reactions | Have | — |
| 2.21 | Rich text descriptions (formatting, tables, code, images) | Jira, Linear, Notion | Markdown descriptions (sanitised subset): headings, lists, code, links; no tables or images | Partial | Rich text editor with tables and images |
| 2.22 | Checklists in an issue | Azure, ClickUp, Asana | Checklists (add, tick, rename, delete) | Have | — |
| 2.23 | Attachments with quotas and scanning | All | Attachments with quotas, type checks and optional malware scan | Have | — |
| 2.24 | Issue links with types (blocks, is blocked by, relates, duplicates, causes) | All | Issue links with types (blocks, relates, duplicates) | Have | — |
| 2.25 | Dependency view and blockers | Jira, Azure | Dependency view (`/dependencies`) and blockers from blocking links | Have | — |
| 2.26 | Clone issue | Jira | Clone (content, classification, estimates, components) | Have | — |
| 2.27 | Move issue between projects, with field mapping | Jira | Move between projects with field mapping and a comment on the old key | Have | — |
| 2.28 | Bulk edit: status, priority, assignee | All | Bulk edit: status, priority, assignee | Have | — |
| 2.29 | Bulk edit: sprint, team, labels, release, watchers | Jira | Bulk edit: sprint, team, release, labels (add and remove), watchers | Have | — |
| 2.30 | Archive, restore, trash with recovery window | Jira, Linear | Archive, restore and trash with a restore window; automatic purge | Have | Trash view page (trashed issues show under archived) |
| 2.31 | Issue change history: field-level diff with author and time | All | Field-level change history (title, kind, priority, assignee, sprint, team, due, points) and status history | Partial | Labels, custom fields and estimates in the change log |
| 2.32 | Activity stream on an issue | All | Activity on the issue (history timeline in the drawer) | Have | — |
| 2.33 | Time tracking: worklogs and time spent | Jira, Azure, ClickUp | Worklogs with author and day; time reports | Have | Time-tracking timer |
| 2.34 | Duplicate detection when creating | Jira (similar issues), Linear | Similar issues while creating (full text on titles) | Have | — |
| 2.35 | Project templates that seed statuses, types, fields and boards | Jira, Asana, ClickUp | Project templates seed statuses (software, kanban, bugs, service) | Partial | Templates that also seed types, fields and boards |

## 3. Search, filters and queries

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 3.1 | Query language with fields, operators, grouping and ordering | JQL, Linear filters | Query language: fields, negation, OR, parentheses (nesting up to four levels), ORDER, functions currentUser() and openSprints() | Have | More functions (e.g. this sprint in dates) |
| 3.2 | Functions such as current user, this sprint, last week | JQL | `currentUser()` and `openSprints()`; no date functions | Partial | Date functions (last week, this sprint dates) |
| 3.3 | Saved filters, personal and shared | Jira, Linear, YouTrack | Saved views, personal or shared with the project; stale views flagged | Have | — |
| 3.4 | Favourite and recent items | Jira, Linear | Favourites and recent issues | Have | — |
| 3.5 | Global full-text search | All | Global full-text search | Have | — |
| 3.6 | Filter subscriptions (email digest) | Jira | Saved-view subscriptions: daily or weekly inbox notification with matches and changes (email through the digest) | Have | Email delivery needs EMAIL_NOTIFICATIONS and SMTP |

## 4. Reporting and analytics

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 4.1 | Status history per issue (the data every time-based report needs) | Jira changelog, Linear | Status history on every write path (migration 0021) | Have | — |
| 4.2 | Cumulative flow diagram | Jira, Azure, Kanbanize | Cumulative flow report | Have | — |
| 4.3 | Cycle time, lead time, throughput | Jira, Azure, Linear | Cycle time, lead time and throughput | Have | — |
| 4.4 | Control chart | Jira, Azure | Control chart points in the cycle-time report | Have | — |
| 4.5 | Created versus resolved | Jira built-in reports | Created versus resolved report | Have | — |
| 4.6 | Pie and bar charts of issues by status, assignee, priority, component | Jira gadgets | Status, assignee and time charts in reports and dashboards | Have | — |
| 4.7 | Dashboards with configurable widgets | Jira, Azure, ClickUp | Dashboards with widgets (status, priority, assignee, time, cycle, velocity) | Partial | Drag to arrange; flow and time-series widgets drawn as charts |
| 4.8 | Time reports | Jira | Time report by person and issue (`/reports/time`) | Have | — |
| 4.9 | CSV export of issues | All | CSV export: issues, sprint scope, release scope, and status and field history (formula-safe) | Have | — |
| 4.10 | Workload by person | Jira, Azure, Float | Workload view; capacity per person | Have | — |

## 5. Roadmaps and portfolio (Jira Advanced Roadmaps, Azure Plans, Aha!, Productboard)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 5.1 | Timeline (roadmap) of epics, releases and milestones | Jira Plans, Azure, Linear, Asana timeline | Timeline of epics, releases, sprints and milestones | Have | Drag to reschedule |
| 5.2 | Milestones | Jira, Azure | Milestones with dates | Have | — |
| 5.3 | Dependency lines and critical path | Jira Plans, Azure | Dependency lines (`/dependencies`) and critical path | Have | Float and calendar-aware scheduling |
| 5.4 | Initiatives above epics, configurable hierarchy levels | Jira Plans, Aha! | Initiatives above epics with linked epics and progress | Have | Initiative pages with owners |
| 5.5 | Cross-project portfolio view | Jira Plans | Portfolio endpoint and workload across visible projects | Partial | Portfolio dashboard across projects |
| 5.6 | Goals and OKRs with progress rolled up from linked work | Asana goals, Lattice, Linear initiatives | Goals with progress from linked issues | Have | Check-in cadence and reminders |
| 5.7 | Project updates with health (on track, at risk, off track) | Asana, Linear, Jira Work Management | Project updates with health (on track, at risk, off track) | Have | — |
| 5.8 | Risks, assumptions, issues, decisions (RAID) | Jira Plans (via marketplace), Smartsheet | Risks and decisions; RAID as separate lists | Partial | Assumptions and issues as RAID items |
| 5.9 | Baselines and scenarios for schedules | Jira Plans, MS Project | Baselines of due dates with variance | Partial | Scenarios and re-baselining |
| 5.10 | Capacity and resource allocation across projects | Jira Plans, Float, Runn | Capacity per person; no allocation across projects over time | Partial | Allocation across projects |

## 6. Automation and integrations

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 6.1 | Automation rule builder: triggers, conditions, branches, actions | Jira Automation, Linear, ClickUp | Rule builder: triggers, conditions (up to 10), up to five actions, run log, enable and delete, preview | Have | Branches (if/else) |
| 6.2 | Scheduled automations | Jira, ClickUp | Scheduled rules (hourly, daily, weekly) with creator authority and a run log | Have | — |
| 6.3 | Cross-project automation and audit of runs | Jira | Rules are per project; no cross-project rule | Missing | Cross-project rules |
| 6.4 | Outbound email notifications | All | Outbound email through the job queue, default off (`EMAIL_NOTIFICATIONS`) | Have | Production sender domain (owner decision) |
| 6.5 | Daily or weekly digests | Jira, Linear | Daily digest of unread notifications, signed unsubscribe | Have | Weekly digest |
| 6.6 | Slack and Microsoft Teams notifications | All | Slack and Microsoft Teams incoming webhooks per project, default off | Have | Signed or app-based posts |
| 6.7 | Git linking: branches, commits, pull requests referencing issue keys | Jira dev panel, GitHub, Linear, GitLab | Git linking for GitHub-style signed push and pull request events (issue keys) | Partial | GitLab and Bitbucket formats; merge status updates |
| 6.8 | Outbound webhooks, signed, retried, with SSRF protection | All | Signed outbound webhooks with SSRF checks, retries and auto-disable | Have | — |
| 6.9 | Personal API tokens, scoped and hashed | Jira API tokens, Linear keys | Personal API tokens: read or write scope, hashed, shown once, expiry, revocation | Have | Per-token project restriction |
| 6.10 | OAuth 2.0 apps for third-party integrations | Jira Connect, Linear | No OAuth 2.0 apps or consent flow | Missing | OAuth 2.0 apps with consent |
| 6.11 | Importers: Jira CSV | Jira | Jira CSV importer with dry run and idempotency | Have | — |
| 6.12 | Importers: Jira JSON or Cloud API with changelog, sprints, versions | Jira | Jira issue JSON import (file), with sprints, versions and changelog (extras) | Partial | Pull from the Jira Cloud API |
| 6.13 | Importers: Confluence space export | Confluence | No Confluence space import | Missing | Confluence space export import |
| 6.14 | Importers: Linear, GitHub Issues, Trello, Asana | Vendor tools | Importers for Trello (board JSON), GitHub Issues (JSON), Linear and Asana (CSV) | Have | Mapping review step per field |
| 6.15 | Marketplace for apps and gadgets | Atlassian Marketplace | Marketplace closed: the owner decided Meridian does not host third-party apps | Closed | — |

## 7. Permissions and administration

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 7.1 | Roles: owner, admin, member, viewer, guest | All | Roles: owner, admin, member, viewer; guests with project grants | Have | — |
| 7.2 | Project permission schemes and custom roles | Jira permission schemes | Permission schemes (member, edit, workflow levels) and per-action levels for sprints, releases and trash | Partial | Per-action levels for comments, creating issues and components |
| 7.3 | User groups for grants and reports | Jira groups | Teams and custom project roles as groups; users and roles per project | Have | Groups as a first-class object across projects |
| 7.4 | Issue-level security levels | Jira issue security | Issue security levels, enforced by row level security on every read path | Have | — |
| 7.5 | Field-level security | Jira field security | Restricted fields: hidden from members, not writable, not searchable | Have | Field-level security for history export and reports |
| 7.6 | Single sign-on (OIDC) and SCIM | All | SSO (OIDC) and SCIM in code; not exercised against a real provider | Have (unverified) | Owner run against a provider |
| 7.7 | Multi-factor authentication | All | TOTP two-step verification with recovery codes | Have | Passkeys and hardware keys |
| 7.8 | Audit log: searchable, filterable, exportable | Jira, Confluence, Linear | Audit log with action, type, member and date filters; CSV export | Partial | Free-text search across event details |
| 7.9 | Data retention and deletion policies | Jira, Confluence | Trash retention setting; audit kept indefinitely (owner decision) | Partial | Attachment retention beyond trash |
| 7.10 | Workspace settings: time zone, working days, language, defaults | Jira admin | Workspace settings: time zone, working days, week start, sprint length, language, trash retention | Have | — |
| 7.11 | Branding and custom domain | Jira, Confluence | Brand name and accent colour in workspace settings, shown in the sidebar | Partial | Custom domain (infrastructure) and logo upload |
| 7.12 | Plan limits and billing | All | Plan limits enforced on the server with a Stripe adapter | Have (unverified) | Owner run against Stripe |

## 8. Knowledge (Confluence-style pages)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 8.1 | Page tree and nesting | Confluence | Page tree with parents, collapsible branches | Have | — |
| 8.2 | Page versions and restore | Confluence | Page versions and restore | Have | — |
| 8.3 | Collaborative editing | Confluence, Notion | Collaborative editing (Yjs) | Have | — |
| 8.4 | Page templates | Confluence | Page templates (create from template, save as template) | Have | — |
| 8.5 | Macros and embedded blocks (issue lists, charts, tables) | Confluence | Macros: issue list, table and chart; refused on malformed save | Have | Editor for macros; more embeds |
| 8.6 | Page comments and inline comments | Confluence | Page comments; inline comments not built | Partial | Inline comments on selected text |
| 8.7 | Page restrictions and guests | Confluence | Page restrictions and guests | Have | — |
| 8.8 | Blog posts and space home pages | Confluence | Blog posts and a project home page | Have | — |

## 9. Service management (Jira Service Management, Zendesk-style)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 9.1 | Request forms and request types | JSM | Request types with forms (custom fields, required checked) and approval | Have | — |
| 9.2 | Queues and assignment rules | JSM | Queues with a default assignee; request types route to queues | Have | Assignment rules by load |
| 9.3 | Service-level agreements with timers | JSM | SLA targets with met, missed, on track and breached timers | Have | — |
| 9.4 | Approvals | JSM, Azure | Approvals (approval created for a request that needs one) | Have | — |
| 9.5 | Incident, change and problem flows | JSM, ITIL tools | Incident and change request types with a label and a target; escalation to owners | Partial | Incident and change workflows with their own statuses and approvals |
| 9.6 | Customer portal for external requesters | JSM | Guests and project grants; no external requester portal | Partial | Customer portal for external requesters |

## 10. Experience, platform and operations

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 10.1 | Light, dark and high-contrast themes, density | Jira, Linear | Light, dark and high-contrast themes; density; reduced motion | Have | — |
| 10.2 | Command palette and keyboard shortcuts | Linear, Jira | Command palette and keyboard shortcuts | Have | — |
| 10.3 | Real-time updates | All | Real-time updates (live change feed) | Have | — |
| 10.4 | Accessibility conformance (WCAG 2.2 AA) | Atlassian, GOV.UK | Accessibility audit recorded; contrast fixed; keyboard and screen-reader pass not done | Partial | Screen-reader and keyboard walk |
| 10.5 | Localisation | All | English and Spanish catalogue; most strings still English | Partial | Remaining strings and more locales |
| 10.6 | Mobile companion app, offline drafts, push | All | Flutter companion: backlog, releases, sprint and release detail; not built for Android here | Partial | Android build and device run |
| 10.7 | Mobile sync with conflict handling | Linear, Jira mobile | Offline cache and visible conflicts on status and edits (web and mobile) | Partial | Conflicts for other fields and comments on mobile |
| 10.8 | Shared rate limits across instances | All | Shared rate limits in PostgreSQL, opt-in with RATE_LIMIT_SHARED | Have | Make it the default with a cache |
| 10.9 | Observability: tracing export | All | Request ids and metrics; no tracing export | Partial | OpenTelemetry trace export |
| 10.10 | Self-hosting | Plane, Jira Data Center | Docker Compose and Kubernetes references | Have | — |
| 10.11 | Governed AI assistance | Atlassian Intelligence, Linear Agent | AI summaries and triage over project text, opt-in; drafting not built | Partial | Drafting and provider choice (owner decision) |

## 11. Counts (after the Q build)

Of 138 rows: 100 *Have*, 2 *Have (unverified)*, 32 *Partial*, 3 *Missing* (6.3, 6.10, 6.13), 1 *Closed* (6.15). Rows marked *Have* are built in source. The phase plan for what is still open is in `REMAINING_PLAN.md` (Phase Q and the list in section 0).

## 12. Sources and limits

- Capability names follow current vendor product documentation as known to the authors. Several vendors ship changes monthly, so each phase re-checks the row it closes against the vendor's current documentation before building it.
- The register does not rank vendors. It lists what a buyer expects, then records Meridian's state against that list.
- Anything marked *Unverified* was written but not exercised against a real provider or an external system.
