# Meridian — agent instructions

Read `CONSTITUTION.md` first; it is binding. Product detail is in `docs/README.md`.

## Non-negotiable working rules

- **Main branch only.** Commit directly to `main`. No branches, worktrees or PRs unless asked.
- **No tests.** Do not write or extend automated tests. Leave existing tests/CI untouched.
- **Visual verification only**, and only **after all planned work is complete**. Run the app and look at it (browser pane for web, simulator for mobile, computer use as needed). You already have permission; never ask for it.
- **Minimal questions.** Pick sensible defaults, state them in the summary. Ask only when truly blocked on the owner's decision.
- Keep invariants in Constitution Article III (tenant isolation, generated OpenAPI via `make openapi`, forward-only migrations, honest docs).

## Quick commands

- `make up` (Postgres), `make dev-api`, `make dev-web`; seed with `scripts/seed_demo.py`.
- `make openapi` after changing API handlers; `make manifest` after adding/removing files.
