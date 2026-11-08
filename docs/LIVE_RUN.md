# Live run record (8 November 2026)

This records the first run of the stack against a real PostgreSQL 17 server and the real API, with the
web app in a browser. It was done once, in a test environment, with the sandbox disabled for that run at
the owner's explicit request. The database was the PostgreSQL binary from the `embedded-postgres` npm
package, started on `127.0.0.1` with no persistent data. The owner's Docker stack was not used.

## Results

| Check | Result |
|---|---|
| Smoke test: auth, projects, issues, board, history, ETag and stale write, reactions, reminders, digest, AI off, chat validation, permission scheme, custom role, service queue, SLA, macros, blog, home page, page parent, audit, CSV export, trash, Jira dry run | 44 of 44 |
| Access rules with a real invited member: visibility by security level in list, search, board and details; restricted fields hidden and not writable; member cannot search them; member cannot change the scheme or roles; a custom admin role lifts a member | 27 of 27 |
| Chat and AI: Slack webhook saved; URL never returned; message delivered to a local sink with no description text; AI refused while off; summary and triage through the model call; model received the text inside tags with the server key; refused again after switching off | 13 of 13 |
| Service and Jira: request type with approval and a required form field; refused without the field; submitted with it; approval created; overdue request escalated at restart; SLA shows the breach; Jira issues and extras imported; sprints and releases created; repeating the extras changed nothing | 11 of 11 |
| Browser: sign-in; overview; board with swimlanes by assignee (preference kept); service tab with queue, request type and SLA; knowledge page with issues and chart macros; issue drawer with markdown and favourite; workflow section with security levels, permissions and custom roles | Rendered and checked |

## Defects found and fixed in this run

- AI refused with HTTP 500 instead of 503 (the error helper had no service-unavailable mapping). Fixed.
- A page macro with no query called the search endpoint with an empty query, which the server refuses; the
  chart macro showed "could not be loaded". The macro now reads the issue list when there is no query. Fixed.
- Chart, table and list macros had no styles, so chart counts were unreadable. Styles added. Fixed.

## Not covered by this run

- Real Slack and Teams channels and a real model provider: the chat and AI calls went to a local sink.
- Email: no SMTP server; digests were not sent.
- Escalation was triggered by backdating rows and restarting the API, not by waiting an hour.
- Layouts: on a narrow pane the service forms and the member checkboxes of security levels are cramped
  (inputs overlap their labels). Recorded for the layout pass; not fixed here.
- Keyboard walk, screen readers and contrast (see `docs/ACCESSIBILITY_AUDIT.md`).
- Android build and device run (no SDK here).

## Environment notes

- The sandbox blocks local listening sockets and System V shared memory. For this run it was disabled at the
  owner's explicit request, for the test commands only.
- A `meridian-api` process that was already running on port 8080 was not stopped or used. Its database is
  unknown; it should be checked by the owner.
