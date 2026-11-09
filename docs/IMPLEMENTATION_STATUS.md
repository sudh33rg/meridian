# Implementation status

**Release designation:** Meridian 0.2 development preview. **Not GA.**

This ledger states what the source contains, what has been checked, and what is still open. Source code existing
in the tree does not mean a milestone's release gate has passed. Where this file and the code disagree, the code
is right and this file must be corrected in the same change (Constitution III.9).

## Milestones

| Milestone | Delivered in source | Open before the gate | Gate |
|---|---|---|---|
| M0 — Platform | Rust/Axum API in domain modules; typed `ApiError`; PostgreSQL row level security on every tenant table with one tenant-bound transaction per request; per-tenant event log written atomically with audit rows; session families with rotating refresh tokens, HttpOnly cookies and CSRF for browsers; email verification, password reset and invitation mail; durable Postgres job queue; project visibility and grants; rate limits; security headers; request IDs; Prometheus metrics; OpenAPI and generated web types; CI workflow; Docker Compose | Secret rotation; shared rate limits at the ingress; OTLP trace export; wider negative tests; first CI run on GitHub | Not passed |
| M1 — Project work | Issue create, edit, status and rich text; board and list views with cursor paging and filters; `If-Match` on edits; `Idempotency-Key` on create; archive and unarchive; bulk status, priority and assignee changes; saved views; workflow statuses with categories and WIP limits; custom fields; issue types; comment edit and history; trash with restore | Attachment object storage hardening; project-level access rules beyond grants | Not passed |
| M2 — Knowledge | Hierarchical pages with optimistic versions, snapshots and restore; page comments and inline comments; templates; blog posts and a project home page; collaborative editing (Yjs over WebSocket, verified with two users); full-text search | Spaces with independent access rules; macros and embeds; whiteboards | Not passed |
| M3 — Agile | Sprints (planned, active, completed, one active per team); product backlog with ranking; team backlogs; sprint execution with carry-over; releases; burndown and velocity; reports and exports | Sprint capacity; scope and forecasting models; release links to deployments | Not passed |
| M4 — Collaboration | Comments and replies; notifications inbox with read state; approvals; allow-listed automation rules with execution logs; activity records; notification preferences | Real-time presence; a visual rule builder; cross-project rules; outbound notification delivery beyond email digests | Not passed |
| M5 — Enterprise | Multiple workspaces per user; tokenised invitations; teams; roles; workspace switching; role checks; admin audit; two-step verification (TOTP with recovery codes); OpenID Connect single sign-on with verified email domains; SCIM 2.0 provisioning; guests; permission schemes; security levels | Verification against real identity providers and a real directory; passkeys; retention policies; SOC 2 controls | Not passed |
| M6 — Intelligence | PostgreSQL full-text search with GIN indexes; ranked results; typed relations between issues, pages, goals, decisions, releases and risks; optional AI drafts and summaries | Semantic search; permission-aware AI grounding and evaluations; provider policy | Not passed |
| M7 — Portfolio | Goals, risks and decisions; approvals; project overview; cross-project portfolio; workload view; timeline and milestones; roadmap views; capacity view | Gantt editing and critical path; budgets; cross-team capacity planning | Not passed |
| M8 — Ecosystem | Bounded JSON export; CSV import (dry run first, idempotent by issue key); CSV exports for sprints, releases and history; webhook registration with delivery **disabled**; outbound outbox table | Reliable webhook dispatcher; OAuth apps; retries and a dead-letter queue; signed export checksums | Not passed |
| M9 — Mobile | Flutter companion app: sign-in, issue list and details, status and comments, knowledge reader, goals, sprints, inbox, search, encrypted offline drafts ([`SYNC_PROTOCOL.md`](SYNC_PROTOCOL.md)) | Android build and device runs; push; camera attachments; deep links; accessibility and device matrix | Not passed |
| M10 — Delivery and scale | Multi-stage Dockerfiles; full preview Compose file; Kubernetes reference manifests; liveness and readiness probes; local verification script; SQL indexes; smoke and k6 load scripts | CI run on GitHub; benchmark results; production secrets handling; external security tests; disaster recovery drill; SLO telemetry | Not passed |

## Verification status

- **Checked locally on 7 November 2026:** Rust build and tests, web build, PostgreSQL migrations, the API smoke test, and browser end-to-end checks.
- **Not checked:** the CI workflow on GitHub; the Flutter app on Android; any live identity provider, directory, or payment provider; webhook failure and retry paths; the malware scanner against real files.
- **Changed since that run, checked only by reading the source and by visual inspection:** most of the work after it. Re-run the checks before relying on them.

## Open items by area

- **Work:** attachment hardening; issue-level access rules (none exist); estimates are not reduced when time is logged; per-type default workflows and field contexts are not built.
- **Agile and planning:** sprint capacity; release links to deployments; timeline is read-only (no drag to reschedule); no critical path, float or baselines; capacity is not allocated across projects over time.
- **Reports and history:** labels, custom fields and estimates are not in the change log; reports do not filter by team, assignee or label; dashboards draw no charts.
- **Automation:** no visual rule builder; cross-project rules and branches are not built; OAuth apps and per-token project restriction are not built.
- **Integrations:** git hosting events are limited to one host's format; chat posts use incoming-webhook URLs, which Slack and Teams do not sign, so the URL is the secret; email needs a production sender domain (`MAIL_FROM` defaults to `no-reply@meridian.local`) and a real SMTP server.
- **Service management:** escalation is one notification per request, not a chain of levels.
- **Administration:** branding without a logo upload or custom domain; the audit log cannot search event details; attachment retention beyond trash is not built.
- **Localisation:** most strings are still English; Spanish is the only added language.
- **Mobile:** conflicts are handled for status changes only; comments never conflict; tokens do not rotate transparently on every screen.

## Release risks

1. **Identity and payments:** SSO and SCIM have only run against local test setups; the payment adapter is written but has not run against a test account.
2. **Permissions:** project-level grants, visibility, guests and page restrictions exist. Issue-level access rules do not. Restricted fields are hidden from members who cannot see them; background jobs read every issue, so their counts include restricted issues.
3. **Live editing:** tested with two users only. Concurrency has not been load-tested.
4. **Webhooks:** signing, SSRF protection, retries and auto-disable are implemented but the failure paths have not been exercised. Delivery is off.
5. **Owner connection:** sign-in and cross-workspace flows use the owner connection and scope queries by hand.
6. **No certification:** no external audit, penetration test, verified backups, load run or accessibility certification.

## Next steps

1. Run CI on GitHub and fix what it finds, including the Flutter job.
2. Exercise the untested paths against real or test-mode providers: SSO, SCIM, the payment adapter, the malware scanner, webhook failure and retry.
3. Build the Android app and run it on a device.
4. Add passkeys and an external security review.
5. Re-run the smoke test, the browser end-to-end checks and a visual pass after the changes above, then update this ledger.
