# UX benchmark and modernization plan

Status: **implemented and visually checked** (S1–S8 below). Open items are listed in section 8.

Scope: the Meridian web app (`apps/web`). The API, data model and Constitution invariants are untouched by this work.

## 1. Method and honesty note

This is a desk comparison, not a hands-on lab test. It is built from the product knowledge of the author (a model, with a training cutoff), grouped by category, and it asks one question of each group: *which interaction and design patterns have become table stakes, and does Meridian have them?* Individual products were not re-installed or re-timed for this document, and vendor features change often. Treat the lists as a map of the field, and the pattern matrix (section 4) as the actionable output. This complements the earlier 100-solution inventory in `COMPETITIVE_LANDSCAPE.md`; the 300 names below are a superset focused on **UX and design-system practice**, not licensing or pricing.

## 2. The field: 300 solutions in 12 categories

<!-- COUNTED: keep one comma-separated list per category line so `scripts` can count them -->

**A. Work and issue tracking (30):** Jira, Linear, Asana, Monday.com, ClickUp, Trello, Basecamp, Wrike, Smartsheet, Shortcut, YouTrack, Azure Boards, GitHub Issues, GitHub Projects, GitLab Issues, Height, Plane, Taiga, OpenProject, Redmine, Teamwork, Hive, Productive, ZenHub, Pivotal Tracker, Phabricator, Bugzilla, Mantis, Kanboard, Backlog

**B. Knowledge and docs (28):** Confluence, Notion, Coda, Slite, Nuclino, Slab, Almanac, Guru, Tettra, Papyrus, GitBook, Docusaurus, Readme, Mintlify, BookStack, Wiki.js, Outline, AppFlowy, Anytype, Obsidian, Logseq, Roam Research, Craft, Bear, Dropbox Paper, Google Docs, Quip, Zoho Notebook

**C. Personal tasks and planners (24):** Todoist, TickTick, Things, OmniFocus, Microsoft To Do, Google Tasks, Any.do, Structured, Sunsama, Motion, Reclaim, Akiflow, Amie, Morgen, Fantastical, Notion Calendar, Cron, Superhuman Tasks, 2Do, Remember The Milk, Habitica, Routine, Tweek, Sorted

**D. Chat and collaboration (24):** Slack, Microsoft Teams, Discord, Mattermost, Rocket.Chat, Zulip, Element, Google Chat, Zoom Team Chat, Twist, Flock, Chanty, Campfire, Loom, Miro, FigJam, Mural, Whimsical, Lucidchart, Excalidraw, tldraw, Pitch, Gather, Around

**E. Design and no-code builders (24):** Figma, Sketch, Framer, Webflow, Canva, Penpot, Adobe XD, Zeplin, InVision, Bubble, Retool, Airtable, Softr, Glide, Adalo, Appsmith, Budibase, NocoDB, Baserow, Supabase Studio, Xano, Wix, Squarespace, Builder.io

**F. Developer platforms and consoles (30):** GitHub, GitLab, Bitbucket, Vercel, Netlify, Railway, Render, Fly.io, Heroku, Cloudflare Dashboard, AWS Console, Google Cloud Console, Azure Portal, DigitalOcean, Stripe Dashboard, Sentry, Datadog, Grafana, New Relic, PagerDuty, Postman, Insomnia, Docker Desktop, Kubernetes Lens, Warp, VS Code, JetBrains Fleet, Zed, Cursor, Raycast

**G. Email, calendar and inbox (22):** Gmail, Outlook, Superhuman, Hey, Spark, Mimestream, Front, Missive, Fastmail, ProtonMail, Zoho Mail, Shortwave, Notion Mail, Apple Mail, Thunderbird, Google Calendar, Apple Calendar, Calendly, Cal.com, Cron Calendar, Zoom Scheduler, Clockwise

**H. CRM, support and service (28):** Salesforce, HubSpot, Pipedrive, Zoho CRM, Close, Attio, Folk, Copper, Freshsales, Zendesk, Intercom, Freshdesk, Help Scout, Front Support, Gorgias, Crisp, Drift, Linear Asks, Jira Service Management, ServiceNow, Kustomer, Gladly, Plain, Pylon, Dixa, LiveChat, Tidio, Zoho Desk

**I. Product analytics and BI (24):** Amplitude, Mixpanel, PostHog, Heap, FullStory, Hotjar, LogRocket, Pendo, Looker, Tableau, Power BI, Metabase, Superset, Mode, Hex, Observable, Count, Sigma, Lightdash, Redash, Evidence, Preset, Grafana Cloud, Google Analytics

**J. HR, finance and operations (22):** Rippling, Deel, Gusto, BambooHR, Workday, Personio, Lattice, Culture Amp, Ramp, Brex, Mercury, QuickBooks, Xero, FreshBooks, Expensify, Bill.com, Notion Finance, Pilot, Carta, Pleo, Airwallex, Navan

**K. Design systems and UI kits (28):** Material 3, Apple HIG, Fluent 2, Atlassian Design System, GitHub Primer, Shopify Polaris, IBM Carbon, Salesforce Lightning, Adobe Spectrum, Radix Themes, Radix Colors, shadcn/ui, Chakra UI, Mantine, Ant Design, MUI, Blueprint, Geist (Vercel), Untitled UI, Tailwind UI, Park UI, Ark UI, React Aria, Headless UI, daisyUI, NextUI, Base UI, Open Props

**L. Mobile, desktop and cross-platform apps (16):** Notion Mobile, Linear Mobile, Slack Mobile, Jira Mobile, Asana Mobile, Trello Mobile, Things 3 iOS, Fantastical iOS, Spotify, Arc Browser, Apple Notes, Apple Reminders, Bear iOS, Craft iOS, Obsidian Mobile, Telegram

<!-- Categories above total the count checked by the command in section 7. -->

## 3. What the leaders do that Meridian did not (before this work)

Observed in `apps/web` at commit `8ddf9b9`:

- ~100 hardcoded hex colors across ~1,800 lines of CSS; no design tokens, no dark mode, no theming, no `color-scheme`.
- A fixed 250px sidebar with a long, flat list of ~25 destinations; no collapse, no grouping you can fold, no keyboard access beyond Tab.
- No command palette, no keyboard shortcuts, no shortcut help.
- Board without drag and drop (status changed through a `<select>` on every card).
- Issue list with a text filter only: no sort, no group-by, no filter chips, no density control.
- No toasts or undo; errors appear in a banner; loading is blank or a bare empty state (no skeletons).
- Mobile = same sidebar behind a hamburger; no bottom navigation, tables overflow.
- Accessibility gaps: no skip link, no visible focus ring system, no reduced-motion handling, icon-only buttons without labels.

## 4. Pattern matrix: what we take from whom

| # | Pattern | Seen in (examples) | Meridian before | Action | Step |
|---|---|---|---|---|---|
| 1 | Semantic design tokens (surface, text, border, accent, status) | Radix Colors, Primer, Polaris, Atlassian DS, Geist | None | Token layer in `tokens.css`; every hardcoded color migrated | S1 |
| 2 | Light / dark / follow-system theme, no flash on load | Linear, GitHub, Notion, Vercel, Slack | None | Theme provider + pre-paint init script | S2 |
| 3 | Accent color choice | Linear, Slack, Obsidian, Notion | Fixed blue | 6 accents, applied via tokens | S2 |
| 4 | Density (comfortable / compact) | Gmail, Jira, Outlook, Linear | Fixed | Density token scale | S2 |
| 5 | High-contrast theme and reduced motion | GitHub, VS Code, GOV.UK | None | Contrast theme, `prefers-reduced-motion` | S2 |
| 6 | Appearance settings page with live preview | Slack, GitHub, Notion | None | Appearance panel | S2 |
| 7 | Command palette (⌘/Ctrl+K): navigate, create, search, switch theme | Linear, Raycast, Notion, GitHub, Superhuman | Search tab only | Palette with grouped actions, fuzzy match, recents | S4 |
| 8 | Keyboard shortcuts + cheat sheet (`?`), `g` then key navigation, `c` create | Linear, Gmail, GitHub, Superhuman | None | Shortcut layer + help dialog | S4 |
| 9 | Collapsible, sectioned, remembered sidebar; icons for every item | Linear, Notion, Slack, Arc | Flat, fixed | Rebuilt sidebar, collapse to icon rail, section folding | S3 |
| 10 | Contextual top bar: breadcrumb, global search trigger, quick create, theme, user menu | Atlassian, GitHub, Linear | Basic | Rebuilt top bar | S3 |
| 11 | Mobile bottom navigation + sheet menu | Slack, Jira Mobile, Notion Mobile | Hamburger | Bottom tab bar under 820px | S3 |
| 12 | Drag-and-drop board with drop targets, optimistic move | Trello, Jira, Linear, Asana | `<select>` | Native DnD + keyboard-accessible fallback | S5 |
| 13 | Filter chips, sort, group-by, view toggle (list / board) | Linear, Asana, Airtable, ClickUp | Text filter | Toolbar with status / priority / type filters, sort, group | S5 |
| 14 | Inline status / priority pills (popover edit) | Linear, Height | `<select>` | Styled pill controls | S5 |
| 15 | Quick create from anywhere | Linear, Todoist | Buttons only | `c` shortcut, palette, top bar | S4 |
| 16 | Toasts with undo | Gmail, Linear, Notion | Banner | Toast system, undo on move | S4 |
| 17 | Skeleton loading | Linear, GitHub, YouTube | Blank | Skeleton primitives on overview / board / list | S5 |
| 18 | Guided empty states and getting-started checklist | Notion, Asana, Stripe, HubSpot | Single empty state | Onboarding checklist on overview, better empties | S5 |
| 19 | Dashboard hierarchy: stat cards, progress, recent activity | Linear Pulse, Jira dashboards, Vercel | Four plain tiles | Stat cards with progress ring, status breakdown | S5 |
| 20 | Visible focus ring, skip link, ARIA roles, labelled icon buttons | GOV.UK, Atlassian, React Aria | Partial | System-wide focus-visible, skip link, labels | S6 |
| 21 | Subtle motion (overlay, popover, drawer) | Linear, Arc, Vercel | Almost none | Short, reducible transitions | S6 |
| 22 | Favorites and recents | Notion, Confluence, Linear | None | Recents in palette; pinned projects in sidebar | S4 |
| 23 | Typography scale and tabular numerals | Geist, Inter, Radix | Ad-hoc font sizes of 10–13px | Scale tokens, 13px base, tabular numbers | S1 |
| 24 | Avatars and presence | Figma, Notion, Google Docs | Initial circle | Deterministic avatar colors | S3 |
| 25 | Auth screens: calm, centered, themed | Linear, Vercel, Stripe | Themed after S1 | Reuse tokens | S1 |

### Deliberately not taken (recorded, out of scope for this change)

- AI assistants and AI-generated summaries (Notion AI, Linear AI): outward service dependency; needs an owner decision (Constitution Art. V.5).
- Slash commands and block editor in pages (Notion, Coda): the collaborative editor is a separate workstream.
- Real-time presence avatars in the top bar (Figma): the collaboration server exists, UI wiring is a later step.
- Per-user server-stored preferences: theme is stored in the browser only. Syncing it across devices needs an API field; not changed here (Art. III.5).
- Custom views saved on the server (Linear Views, Jira filters): needs new API; filters here are session-local.
- Internationalization and RTL: not started.

## 5. Implementation plan

Each step is independent enough to commit on its own. Verification happens once at the end (Constitution Art. V.3–V.4).

| Step | Work | Files | Status |
|---|---|---|---|
| S1 | Design tokens; migrate every hardcoded color to tokens; type scale | `src/tokens.css`, `src/style.css`, `src/advanced.css` | done |
| S2 | Theme system: light, dark, system, high-contrast, 6 accents, density, reduced motion; pre-paint script (CSP-safe); appearance panel | `src/lib/theme.tsx`, `public/theme-init.js`, `src/features/shell/ThemeMenu.tsx`, `src/features/workspace/AppearancePanel.tsx` | done |
| S3 | New app shell: collapsible sidebar with folding sections and icons, new top bar, mobile bottom navigation, user menu, avatars | `src/features/shell/*`, `src/ui.css` | done |
| S4 | Command palette, keyboard shortcuts and help, toasts with undo, quick create | `src/features/shell/CommandPalette.tsx`, `Shortcuts.tsx`, `src/features/shared/Toast.tsx` | done |
| S5 | Overview dashboard, drag-and-drop board, issue list toolbar (filter, sort, group), skeletons, empty states, onboarding checklist | `src/features/work/*` | done |
| S6 | Accessibility and motion pass: skip link, focus ring, labels, reduced motion | cross-cutting | done |
| S7 | Docs: status ledger, manifest; commit | `docs/IMPLEMENTATION_STATUS.md`, `MANIFEST.json` | done |
| S8 | Visual verification in the browser (light, dark, orange accent, compact, 390px mobile) and fixes | n/a | done (partial: see section 8) |

## 6. Constraints honored

- No API, schema or OpenAPI change; no new runtime dependency (fonts, icons already bundled; CSP stays `self`).
- No automated tests added (Constitution Art. V.2). Existing tests are untouched; if a class name they rely on changes, that is reported rather than silently edited.
- Docs state only what was verified.

## 7. Counting the benchmark

```sh
grep -E '^\*\*[A-L]\.' docs/UX_BENCHMARK_AND_PLAN.md | sed -E 's/^\*\*[A-L]\.[^:]*:\*\* //' | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -c .
```

## 8. What was verified, and what was not

Verified by running the app and looking at it: overview (dark, light + orange + compact), board with a synthetic drag-and-drop and its Undo toast, issue list with chips and skeletons, command palette search, appearance page, knowledge page and editor, issue drawer, forgot-password page, and the 390px mobile layout with bottom navigation. Fixed along the way: stacked filter chips (a global `label` rule), white controls left over in the drawer and modal, slate borders that followed the accent color, and a "no projects" flash while projects load.

Not verified: a formal accessibility audit and screen-reader pass; Safari and Firefox; real touch drag-and-drop; the high-contrast theme beyond its tokens; the Playwright e2e suite (selectors were traced by hand against the new markup); the admin panels (Security, Identity, Billing, Integrations) in every theme; the Flutter app (untouched).

Known follow-ups, recorded rather than silently added (Constitution Art. V.7): the legacy admin panels still use their original layout under the new tokens; the board and list have no saved views; the theme is per-browser; pages have no slash commands; the old sidebar CSS classes were removed, so any outside code that styled them needs updating.
