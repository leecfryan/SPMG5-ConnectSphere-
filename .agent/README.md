# .agent

Working space for coding agents. The rules are in [../AGENTS.md](../AGENTS.md).

| File | Holds | Read it when |
|---|---|---|
| [docs/architecture.md](docs/architecture.md) | Stack, request path, backend layers, auth and permissions, endpoints, frontend structure, database and schema changes, external integrations | Adding an endpoint, permission, page, table or dependency |
| [docs/conventions.md](docs/conventions.md) | How code, tests and docs are written: the AC → test case → test → code method, test case specs, coverage, test review, C4 / ADR rules | Writing any code, test or doc |
| [docs/ui.md](docs/ui.md) | The current Staging UI: shell, layouts, palette, shared classes and components, screen patterns | Building or changing a screen |
| [tasks/](tasks/) | The story workflow and the task note template only | Starting a story |
| [docs/other/](docs/other/) | Task notes (one per story), roadmaps and other working Markdown | Starting or resuming a story |

## Rules for `docs/`

Durable reference: how the code is **today**. It is not a changelog and not a place for status. Don't write "added in
SCRUM-41" or "now supports…". History belongs in git; progress, decisions and open questions belong in the story's
task note; sprint status belongs in the team's tracker.

Every file in `docs/` must match the code at every commit. If a change makes a sentence untrue, fix it in the same
commit. A stale doc is worse than none, because the next agent will believe it.

Team-facing documentation (feature integration guides, test catalogues, seed accounts) stays in
[../docs/](../docs/). These files link to it rather than repeating it.
