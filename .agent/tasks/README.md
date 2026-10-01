# Tasks

One note per story being worked on: `SCRUM-<n>-<short-slug>.md`, copied from [_template.md](_template.md) and saved
in [../docs/other/](../docs/other/), **not in this folder**. This folder holds only this workflow and the template.
Roadmaps, plans and any other working Markdown also go in `../docs/other/`.
The note is where the agent keeps the story's contract (the story text word for word), the plan against each acceptance
criterion, decisions, status and a log. It lets the next session, or the next person, pick up the story without
re-deriving anything.

Durable facts about the codebase don't belong here; put them in [../docs/](../docs/). Sprint status doesn't belong
here either; it lives in the team's tracker.

## Tracker

Update the row when a story changes state. Keep finished rows. They're the record of what the agent built.

| Story | Title | Lane | State | Branch |
|---|---|---|---|---|
| — | — | — | — | — |

States: `📋 planned` · `🔧 in progress (<date>)` · `🧪 in review (PR #n)` · `✅ merged (<date>)` · `⏸ blocked (<on what>)`

## The story workflow

### 1. Load the story

- Ask the user for the story: key, title, the user story sentence ("As a <role>, I want <goal>, so that
  <benefit>") and the **acceptance criteria** (checklist or Given / When / Then), plus any related stories they
  know of.
- Ask for the **mode**: build or teach (see AGENTS.md §3).
- Create the task note. Paste the story text **word for word** under *Contract*, with the date. If the story
  changes mid-way, update the note and say what changed.

### 2. Understand before planning

- Read [../docs/](../docs/) and the lane's guide in `docs/` (`docs/<feature>*.md`).
- Read the code the story touches and the tests around it. Run the existing suites once so you know the baseline.
- `git log origin/staging --oneline -- <paths>` to see recent work in the area.
- List the **neighbouring stories** (same epic, related, or obvious next steps). They go under *Deliberately
  absent*.

### 3. Plan against the AC

Fill in the note's AC table: for each criterion, **how it's built** (files, endpoint, permission, manual schema change) and
**how it's proven** (the test IDs you'll write, at which layer; see [../docs/conventions.md](../docs/conventions.md)).

Then write the **test cases** before any code: run the five steps (workflow, happy path, cross-cutting, negative,
boundary) over every AC, add conflict and failure cases, and fill in the note's *Test cases* table with
pre-conditions, exact test data and expected results taken from the AC, not from code. Rewrite fuzzy checklist AC as
Given / When / Then first.

Then write down:

- **Decisions**: every interpretation of an ambiguous AC, and why, citing the customer clarification (discussion #)
  where there is one. Ask the user when a decision isn't obvious. If a decision is expensive to change later, ask the
  dev to check the team's ADRs in Google Drive.
- **Shared files touched**: `app.js`, `permissions.js`, `App.jsx`, `WorkspaceLayout.jsx`, Playwright support.
- **Schema change**: none, or the exact SQL the user will run by hand in the dashboard. It also goes in the lane
  guide's *Schema reference* section (AGENTS.md §2). Never a migration file.
- **New files**: each one and why, after searching for an existing file to extend (AGENTS.md §2, *File discipline*).
- **Slices**: the order you'll build in, riskiest AC first.

Show the plan **and the test cases** to the user in plain language. Agreeing the test cases is agreeing what
"done" means. Start only on a go-ahead.

### 4. Build

- Branch off the latest `origin/staging`: `feature/`, `fix/` or `chore/` plus a three-word camelCase summary of the 1–3 related user stories (e.g. `feature/eventLifecycleStatus`, `fix/coordinatorWorkloadCount`); no Jira or story IDs in branch names. Remind the user to move the Jira card to *In Progress*. Keep the branch current by merging or
  rebasing from `origin/staging`.
- One vertical slice at a time, with its tests written alongside the code. Test-first (red → green → refactor) is
  recommended but not required; the dev chooses. A slice runs
  manual schema change → repository → service → controller + route + guard → frontend service → page → docs, and ends green
  before the next starts.
- A new case discovered while coding goes into the *Test cases* table first, then into a test.
- Stop at every stop point (AGENTS.md §3). Write any schema SQL in the task note, then hand it to the user to add
  manually.
- Update *Status* and the *Log* as you go, not at the end.

### 5. Prove it

- **Every** suite passes locally (AGENTS.md §4), not just the story's, so earlier sprints' test cases rerun. That's
  the regression run.
- Coverage: `npm --prefix backend run test:cov` and `npm --prefix frontend run test:cov`. 100% of the story's
  own lines and branches, or each gap written down with its reason. `test:cov` is Vitest only, so code proven only by
  a `node:test` suite shows as a gap; say so.
- Review every new test against the five questions (conventions.md, *Testing* §5); strengthen any that no plausible
  bug would break.
- Walk every AC in the table and tick it only when its test cases are automated (or justified as manual) and pass.
  Fill in *Latest execution* for each case.
- Write the manual demo steps: which seeded account, which URL, which clicks, what should appear.

### 6. Document

In the same change: the lane's `docs/` guide (with its *Schema reference* for any SQL); the lane's test guide (copy the *Test cases* table with execution
results, the AC → test traceability and coverage notes: this is Deliverable 3); `docs/frontend-routing.md` for
routes; `docs/staff-access.md` for permissions; the README if user-visible behaviour changed; the C4 model if the
change is architectural (ADRs are in the team's Google Drive: ask the dev); and any `.agent/docs/` file the change made untrue.

### 7. Hand off

- Run the Definition of Done (AGENTS.md §5). Report honestly: what passed, what failed, what wasn't run.
- Write the **explain-back** in the note and walk the user through it (AGENTS.md §3).
- List every new file and why.
- Propose the commit message and the PR description (AGENTS.md §7). Wait for approval. Remind the user to move the
  Jira card to *In Review* when the PR opens, and to *Done* after the merge.
- If the story can't finish this sprint, it goes back to the backlog unmerged; record why in the *Log*.
- List everything under *Found, not built* so the user can raise it at stand-up or with the Product Owner.

## When the user asks for something outside the story

Say plainly that it's outside the story's acceptance criteria, name the story it belongs to (or say that none
exists yet), and offer to record it under *Found, not built*. Build it only if the user confirms the Product
Owner agreed to change the story. Then update the *Contract* section, noting who agreed and when.
