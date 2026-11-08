# Accessibility audit (Phase P1)

Status: partial. This records what was checked, what was found, and what has not been checked yet.

## What was checked

- **Static rules over the web source** (`apps/web/src`, every `.tsx` file): the jsx-a11y rule set (alt text,
  labels, roles, required ARIA properties, focus and keyboard handling, positive tab indexes). Run from a
  scratch install of `eslint-plugin-jsx-a11y` 6.10.2, not added to the repository.
- **Result:** no rule error in the code. Sixteen warnings, listed below. Two further errors were a
  configuration gap in the scratch run (the React hooks rule was not loaded) and are not findings.

## Warnings (static)

| File | Rule | What it is | Status |
|---|---|---|---|
| `features/advanced/IssueDrawer.tsx` | no-static-element-interactions | The drawer backdrop closes on click | Open. The drawer's close button is the keyboard path; add `role="presentation"` and an Escape handler |
| `features/advanced/NotificationPreferences.tsx` | label-has-associated-control | Switch labels wrap a span, not text the rule can see | Open. The label text is present; the rule cannot follow it |
| `features/agile/BacklogTab.tsx` | no-static-element-interactions, no-noninteractive-element-interactions | Drag-to-rank rows | Open. Keyboard ranking (Alt + arrows) exists; the rows need a role and an accessible name |
| `features/agile/SprintCard.tsx` | no-noninteractive-element-interactions | Drop target for backlog items | Open. Add a "To sprint" menu path for keyboard users (exists in the backlog) and a role |
| `features/auth/AuthPages.tsx` | no-autofocus | Sign-in field | Open. Accepted for a sign-in form |
| `features/shell/CommandPalette.tsx` | click-events-have-key-events, interactive-supports-focus | Palette option rows | Open. Options need tab focus |
| `features/shell/Shortcuts.tsx` | no-static-element-interactions, no-autofocus | Shortcut dialog | Open |
| `features/work/BoardTab.tsx` | no-noninteractive-element-interactions | Column drop targets and cards | Open. Cards have a keyboard path (Alt + arrows); the columns are drop targets only |
| `features/work/CreateModal.tsx` | no-static-element-interactions | Modal backdrop | Open, as the drawer |
| `features/work/IssuesTab.tsx` | no-autofocus | Save-view name field | Accepted. It opens on a user action |

## Not checked

- **Screen readers.** No screen reader has been run against any page. The status and error regions added
  in this build (screen notes, conflict messages, the board's quick filters) are not yet announced-tested.
- **Keyboard walk.** No full walk of the app has been made. The new controls are reachable by Tab in the
  source order they are written, but that has not been seen in a browser.
- **Contrast.** The new tokens (`.chip.on` on `--accent-soft`, the warning and error text) have not been
  measured against WCAG 2.2 AA in a render. The earlier D5 fix covered the priority and status labels only.
- **Mobile.** Flutter accessibility (TalkBack, VoiceOver) has not been checked on a device.
- **Reduced motion, zoom at 200 percent, and 390 px layouts** for the new board swimlanes and the page tree.

Each of these needs the running app (PostgreSQL, the API and the web app), so the walk is recorded as an
owner step in `IMPLEMENTATION_STATUS.md`.
