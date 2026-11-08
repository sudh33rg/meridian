# Meridian — feature parity gap register (Jira and top work tools)

> Status: analysis dated 8 November 2026, written after the D-series close-out. Each row is one capability that Jira (Software, Work Management, Service Management, Advanced Roadmaps) or a leading tracker (Linear, Azure Boards, GitHub Projects, Asana, ClickUp, YouTrack, Shortcut, Plane) provides and that a team expects. The **Plan** column names the phase in `REMAINING_PLAN.md` that closes the row. Nothing here is a claim that Meridian has the capability until `IMPLEMENTATION_STATUS.md` says so.

**How to read the status.** *Have* = implemented and checked by the API or browser scripts recorded in `BEST_IN_CLASS_ANALYSIS.md`. *Partial* = a starting point exists but a user would notice the gap in daily use. *Missing* = no source for it.

**Evidence level.** Capabilities are taken from public product documentation and from Meridian's code (routes in `apps/server/src/api/`, migrations `0001`–`0018`, web components in `apps/web/src/features/`). They are a desk comparison, not a hands-on test of competitor instances.

## 0. The headline gaps

The user-visible answer to "where are the backlogs and release scope?" is: **there are none.** Before this register the product had sprints as a list of cards, releases as a list of names, and no way to rank work, to assign work to a team's backlog, to move unfinished work between sprints or releases, to see a burndown, or to say which issues ship in which release. Those are the first phase (E), because every planning view in Jira depends on them.

Other gaps that matter as much to a Jira-style buyer, in rough order: configurable issue types and per-type workflows; reporting over time (needs a status history table, which does not exist yet); roadmaps and initiatives above epics; automation rules beyond two fixed ones; outbound email and personal API tokens; permission schemes and issue-level security; project templates for Scrum, Kanban and service work.

## 1. Backlogs, sprints and release scope (Jira Software)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 1.1 | Product backlog: project-wide ranked list of work not in a sprint | Jira, Linear, Azure Boards, Plane | No backlog view or ordering. Issues list is by number | Missing | E1 |
| 1.2 | Rank by drag, or move to top, bottom, before or after another item | All | None | Missing | E1 |
| 1.3 | Team backlog: work owned by one team inside a shared project | Jira team-managed, Azure area paths, Linear teams | `teams` exist, but issues have no team | Missing | E2 |
| 1.4 | Sprint per team, one active sprint per team | Jira (per board), Azure iterations | One active sprint per project | Partial | E2 |
| 1.5 | Sprint planning: add and remove issues from a sprint in bulk | Jira, Azure, ClickUp | One issue at a time, through the edit form | Partial | E3 |
| 1.6 | Sprint goal shown during planning and in the sprint view | Jira, Azure | Stored, shown as text on a card | Partial | E3 |
| 1.7 | Sprint start and complete, with carryover of unfinished work to backlog or a named sprint | Jira (move incomplete), Azure | Complete only; unfinished issues stay attached to a closed sprint | Partial | E3 |
| 1.8 | Sprint summary: committed, completed, not completed, added mid-sprint | Jira sprint report | None | Missing | E5 |
| 1.9 | Burndown chart (remaining points or issues per day) | Jira, Azure, ClickUp | None | Missing | E5 |
| 1.10 | Burnup chart (scope and done per day) | Jira, Azure | None | Missing | E5 |
| 1.11 | Velocity chart and rolling average per team | Jira, Azure | None | Missing | E5 |
| 1.12 | Scope creep: work added after the sprint started | Jira sprint report | None | Missing | E5 |
| 1.13 | Sprint board: a board filtered to one sprint, columns by status | Jira Scrum board | Board is project-wide | Partial | E6 |
| 1.14 | Releases (versions): name, date, status (unreleased, released, archived) | Jira versions, Azure releases | Releases with name, date and status; no scope | Partial | E4 |
| 1.15 | Release scope: which issues ship in which release | Jira fix versions, GitHub milestones | None | Missing | E4 |
| 1.16 | Scope freeze: additions after freeze are recorded and flagged | Jira release reports, Azure | None | Missing | E4 |
| 1.17 | Release notes generated from done scope | Jira release notes, GitHub releases, Linear | None | Missing | E4 |
| 1.18 | Release move-unfinished on release, to backlog or another release | Jira | None | Missing | E4 |
| 1.19 | Release progress: done, remaining, story points, scope changes | Jira release hub | Counts only in overview | Missing | E4 |
| 1.20 | Components (ownership groups) with default assignee | Jira components | None | Missing | F1 |
| 1.21 | Swimlanes on boards (assignee, epic, query) | Jira, Linear | None | Missing | F9 |
| 1.22 | WIP limits per column | Jira Kanban, Azure, Trello | None | Missing | F9 |
| 1.23 | Board configuration: column to status mapping, quick filters | Jira | Columns follow the workflow; no quick filters | Partial | F9 |
| 1.24 | Estimation: story points and time estimates | Jira, Azure | Story points only | Partial | F4 |
| 1.25 | Capacity planning per person and per sprint | Jira Advanced Roadmaps, Azure capacity | Workload view (basic) | Partial | H4 |

## 2. Issues and work items

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 2.1 | Readable keys (PROJ-123) and numbering per project | All | Yes | Have | — |
| 2.2 | Issue types (task, bug, story, epic) | All | Fixed set of four | Partial | F3 |
| 2.3 | Configurable issue types per project, with icons and hierarchy levels | Jira issue type schemes | None | Missing | F3 |
| 2.4 | Workflow per issue type | Jira workflow schemes | One workflow per project | Missing | F3 |
| 2.5 | Workflow statuses, categories, custom statuses | Jira, Linear, Plane | Yes (C1) | Have | — |
| 2.6 | Transition rules (allowed moves, required fields) | Jira conditions and validators | Yes (D3) | Have | — |
| 2.7 | Transition validators and post-functions (e.g. set field, notify, create subtask) | Jira | None | Missing | F7 |
| 2.8 | Screens: which fields appear on create, edit and transition | Jira field configurations and screens | Required flag only | Partial | F7 |
| 2.9 | Custom fields with types and options | All | Yes (D1) | Have | — |
| 2.10 | Custom field contexts per issue type | Jira | None | Missing | F3 |
| 2.11 | Epics, with child issues and progress roll-up | Jira, Azure, Linear | `epic` kind and `parent_id`; no roll-up | Partial | F2 |
| 2.12 | Subtasks (first-class children) | Jira | Child issues through `parent_id` | Partial | F2 |
| 2.13 | Labels | All | Yes | Have | — |
| 2.14 | Priority | All | Yes (four levels, fixed) | Have | — |
| 2.15 | Due dates and reminders | All | Due date only, no reminder | Partial | F5 |
| 2.16 | Assignee, reporter | All | Assignee and creator | Have | — |
| 2.17 | Watchers | Jira, Azure, YouTrack | None | Missing | F4 |
| 2.18 | Votes | Jira | None | Missing | F4 |
| 2.19 | Mentions (@user) that notify | All | None confirmed | Missing | F5 |
| 2.20 | Comments: threaded replies, edit, delete, reactions | All | Threaded replies, no edit history or reactions | Partial | F5 |
| 2.21 | Rich text descriptions (formatting, tables, code, images) | Jira, Linear, Notion | Plain text description | Partial | F5 |
| 2.22 | Checklists in an issue | Azure, ClickUp, Asana | None | Missing | F5 |
| 2.23 | Attachments with quotas and scanning | All | Yes (B11, optional scanner) | Have | — |
| 2.24 | Issue links with types (blocks, is blocked by, relates, duplicates, causes) | All | `issue_links` exist | Partial | F5 |
| 2.25 | Dependency view and blockers | Jira, Azure | None | Missing | F5 |
| 2.26 | Clone issue | Jira | None | Missing | F6 |
| 2.27 | Move issue between projects, with field mapping | Jira | None | Missing | F6 |
| 2.28 | Bulk edit: status, priority, assignee | All | Yes (B5) | Have | — |
| 2.29 | Bulk edit: sprint, team, labels, release, watchers | Jira | Not yet | Missing | E3 (sprint and team), F4 (rest) |
| 2.30 | Archive, restore, trash with recovery window | Jira, Linear | Archive and restore; no trash | Partial | F6 |
| 2.31 | Issue change history: field-level diff with author and time | All | Audit rows and events, no field diff | Partial | G3 |
| 2.32 | Activity stream on an issue | All | Partial, via audit | Partial | G3 |
| 2.33 | Time tracking: worklogs and time spent | Jira, Azure, ClickUp | None | Missing | F4 |
| 2.34 | Duplicate detection when creating | Jira (similar issues), Linear | None | Missing | F6 |
| 2.35 | Project templates that seed statuses, types, fields and boards | Jira, Asana, ClickUp | None | Missing | K1 |

## 3. Search, filters and queries

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 3.1 | Query language with fields, operators, grouping and ordering | JQL, Linear filters | Subset (D2): fields, equality, AND, negation | Partial | F8 |
| 3.2 | Functions such as current user, this sprint, last week | JQL | None | Missing | F8 |
| 3.3 | Saved filters, personal and shared | Jira, Linear, YouTrack | Personal saved views | Partial | F8 |
| 3.4 | Favourite and recent items | Jira, Linear | None | Missing | F8 |
| 3.5 | Global full-text search | All | Yes | Have | — |
| 3.6 | Filter subscriptions (email digest) | Jira | None | Missing | I2 |

## 4. Reporting and analytics

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 4.1 | Status history per issue (the data every time-based report needs) | Jira changelog, Linear | Not stored | Missing | G1 |
| 4.2 | Cumulative flow diagram | Jira, Azure, Kanbanize | None | Missing | G2 |
| 4.3 | Cycle time, lead time, throughput | Jira, Azure, Linear | None | Missing | G2 |
| 4.4 | Control chart | Jira, Azure | None | Missing | G2 |
| 4.5 | Created versus resolved | Jira built-in reports | None | Missing | G2 |
| 4.6 | Pie and bar charts of issues by status, assignee, priority, component | Jira gadgets | Project overview counts | Partial | G4 |
| 4.7 | Dashboards with configurable widgets | Jira, Azure, ClickUp | Fixed analytics page | Partial | G4 |
| 4.8 | Time reports | Jira | None | Missing | G2 (after F4) |
| 4.9 | CSV export of issues | All | JSON export only | Partial | G5 |
| 4.10 | Workload by person | Jira, Azure, Float | Workload view | Have | — |

## 5. Roadmaps and portfolio (Jira Advanced Roadmaps, Azure Plans, Aha!, Productboard)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 5.1 | Timeline (roadmap) of epics, releases and milestones | Jira Plans, Azure, Linear, Asana timeline | None | Missing | H1 |
| 5.2 | Milestones | Jira, Azure | None | Missing | H1 |
| 5.3 | Dependency lines and critical path | Jira Plans, Azure | None | Missing | H5 |
| 5.4 | Initiatives above epics, configurable hierarchy levels | Jira Plans, Aha! | None | Missing | H2 |
| 5.5 | Cross-project portfolio view | Jira Plans | Portfolio endpoint and workload | Partial | H2 |
| 5.6 | Goals and OKRs with progress rolled up from linked work | Asana goals, Lattice, Linear initiatives | Goals with manual progress | Partial | H3 |
| 5.7 | Project updates with health (on track, at risk, off track) | Asana, Linear, Jira Work Management | None | Missing | H3 |
| 5.8 | Risks, assumptions, issues, decisions (RAID) | Jira Plans (via marketplace), Smartsheet | Risks and decisions | Partial | H3 |
| 5.9 | Baselines and scenarios for schedules | Jira Plans, MS Project | None | Missing | H6 |
| 5.10 | Capacity and resource allocation across projects | Jira Plans, Float, Runn | Workload view | Partial | H4 |

## 6. Automation and integrations

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 6.1 | Automation rule builder: triggers, conditions, branches, actions | Jira Automation, Linear, ClickUp | Two fixed rules | Partial | I1 |
| 6.2 | Scheduled automations | Jira, ClickUp | None | Missing | I1 |
| 6.3 | Cross-project automation and audit of runs | Jira | Automation runs table | Partial | I1 |
| 6.4 | Outbound email notifications | All | Inbox only; email blocked until Constitution III.7 gates | Missing | I2 |
| 6.5 | Daily or weekly digests | Jira, Linear | None | Missing | I2 |
| 6.6 | Slack and Microsoft Teams notifications | All | None | Missing | I3 |
| 6.7 | Git linking: branches, commits, pull requests referencing issue keys | Jira dev panel, GitHub, Linear, GitLab | None | Missing | I4 |
| 6.8 | Outbound webhooks, signed, retried, with SSRF protection | All | Yes (delivery enabled after the D-series gates) | Have | — |
| 6.9 | Personal API tokens, scoped and hashed | Jira API tokens, Linear keys | Browser sessions only | Missing | I5 |
| 6.10 | OAuth 2.0 apps for third-party integrations | Jira Connect, Linear | None | Missing | I5 |
| 6.11 | Importers: Jira CSV | Jira | Yes (D4) | Have | — |
| 6.12 | Importers: Jira JSON or Cloud API with changelog, sprints, versions | Jira | None | Missing | I6 |
| 6.13 | Importers: Confluence space export | Confluence | None | Missing | I6 |
| 6.14 | Importers: Linear, GitHub Issues, Trello, Asana | Vendor tools | None | Missing | I6 |
| 6.15 | Marketplace for apps and gadgets | Atlassian Marketplace | None | Missing | Owner decision (I7) |

## 7. Permissions and administration

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 7.1 | Roles: owner, admin, member, viewer, guest | All | Yes | Have | — |
| 7.2 | Project permission schemes and custom roles | Jira permission schemes | Project visibility and grants | Partial | J1 |
| 7.3 | User groups for grants and reports | Jira groups | Teams only | Partial | J1 |
| 7.4 | Issue-level security levels | Jira issue security | None (Constitution scheduled ACLs after C3) | Missing | J2 |
| 7.5 | Field-level security | Jira field security | None | Missing | J2 |
| 7.6 | Single sign-on (OIDC) and SCIM | All | Yes in code, not exercised against a real provider | Have (unverified) | N |
| 7.7 | Multi-factor authentication | All | Yes (TOTP, recovery codes) | Have | — |
| 7.8 | Audit log: searchable, filterable, exportable | Jira, Confluence, Linear | Admin audit list | Partial | J3 |
| 7.9 | Data retention and deletion policies | Jira, Confluence | None | Missing | J4 |
| 7.10 | Workspace settings: time zone, working days, language, defaults | Jira admin | None | Missing | J5 |
| 7.11 | Branding and custom domain | Jira, Confluence | None | Missing | J5 |
| 7.12 | Plan limits and billing | All | Stripe adapter, server-enforced limits | Have (unverified) | N |

## 8. Knowledge (Confluence-style pages)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 8.1 | Page tree and nesting | Confluence | Nesting in API, UI partial | Partial | K3 |
| 8.2 | Page versions and restore | Confluence | Yes | Have | — |
| 8.3 | Collaborative editing | Confluence, Notion | Yes (Yjs, two-user verified) | Have | — |
| 8.4 | Page templates | Confluence | None | Missing | K3 |
| 8.5 | Macros and embedded blocks (issue lists, charts, tables) | Confluence | None | Missing | K4 |
| 8.6 | Page comments and inline comments | Confluence | Page comments | Partial | K3 |
| 8.7 | Page restrictions and guests | Confluence | Yes (page ACL, guests) | Have | — |
| 8.8 | Blog posts and space home pages | Confluence | None | Missing | K3 |

## 9. Service management (Jira Service Management, Zendesk-style)

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 9.1 | Request forms and request types | JSM | None | Missing | K2 |
| 9.2 | Queues and assignment rules | JSM | None | Missing | K2 |
| 9.3 | Service-level agreements with timers | JSM | None | Missing | K2 |
| 9.4 | Approvals | JSM, Azure | Yes (approvals) | Have | — |
| 9.5 | Incident, change and problem flows | JSM, ITIL tools | None | Missing | K2 |
| 9.6 | Customer portal for external requesters | JSM | Guests | Partial | K2 |

## 10. Experience, platform and operations

| # | Capability | Jira / top tools | Meridian today | Status | Plan |
|---|---|---|---|---|---|
| 10.1 | Light, dark and high-contrast themes, density | Jira, Linear | Yes | Have | — |
| 10.2 | Command palette and keyboard shortcuts | Linear, Jira | Yes | Have | — |
| 10.3 | Real-time updates | All | Yes (SSE feed) | Have | — |
| 10.4 | Accessibility conformance (WCAG 2.2 AA) | Atlassian, GOV.UK | Contrast fixed; no screen-reader or keyboard walk | Partial | P1 |
| 10.5 | Localisation | All | English only | Missing | K5 |
| 10.6 | Mobile companion app, offline drafts, push | All | Flutter source, analysed only | Partial | L |
| 10.7 | Mobile sync with conflict handling | Linear, Jira mobile | Drafts only | Partial | L |
| 10.8 | Shared rate limits across instances | All | Per process only (Constitution IV) | Partial | N |
| 10.9 | Observability: tracing export | All | Metrics and request ids | Partial | N |
| 10.10 | Self-hosting | Plane, Jira Data Center | Compose and Kubernetes references | Have | — |
| 10.11 | Governed AI assistance | Atlassian Intelligence, Linear Agent | Deferred | Blocked | M (owner decision) |

## 11. Counts

Rows marked *Missing* or *Partial* in sections 1 to 10: see the plan column. Rows marked *Have* are the ones listed in `BEST_IN_CLASS_ANALYSIS.md` as implemented. The register is the source for the phase plan in `REMAINING_PLAN.md`; when a row closes, its status changes here and the matching step's results are recorded there.

## 12. Sources and limits

- Capability names follow current vendor product documentation as known to the authors. Several vendors ship changes monthly, so each phase re-checks the row it closes against the vendor's current documentation before building it.
- The register does not rank vendors. It lists what a buyer expects, then records Meridian's state against that list.
- Anything marked *Unverified* was written but not exercised against a real provider or an external system.
