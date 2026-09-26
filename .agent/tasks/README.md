# Tasks

One note per story being worked on: `SCRUM-<n>-<short-slug>.md`, copied from [_template.md](_template.md).
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

- Ask the user for the story: key, title, the user story sentence and the **acceptance criteria**, plus any
  related stories they know of.
- Ask for the **mode**: build or teach (see AGENTS.md §3).
- Create the task note. Paste the story text **word for word** under *Contract*, with the date. If the story
  changes mid-way, update the note and say what changed.

### 2. Understand before planning

- Read [../docs/](../docs/) and the lane's guide in `docs/` (`docs/<feature>*.md`).
- Read the code the story touches and the tests around it. Run the existing suites once so you know the baseline.
- `git log origin/Staging --oneline -- <paths>` to see recent work in the area.
- List the **neighbouring stories** (same epic, related, or obvious next steps). They go under *Deliberately
  absent*.

### 3. Plan against the AC

Fill in the note's AC table: for each criterion, **how it's built** (files, endpoint, permission, migration) and
**how it's proven** (the test IDs you'll write, at which layer; see [../docs/conventions.md](../docs/conventions.md)).

Then write the **test cases** before any code: run the five steps (workflow, happy path, cross-cutting, negative,
boundary) over every AC, add conflict and failure cases, and fill in the note's *Test cases* table with
pre-conditions, exact test data and expected results taken from the AC, not from code. Rewrite fuzzy checklist AC as
Given / When / Then first.

Then write down:

- **Decisions**: every interpretation of an ambiguous AC, and why, citing the customer clarification (discussion #)
  where there is one. Ask the user when a decision isn't obvious. If a decision is expensive to change later, it also
  gets an ADR.
- **Shared files touched**: `app.js`, `permissions.js`, `App.jsx`, `WorkspaceLayout.jsx`, Playwright support.
- **Migration**: yes/no, the next free number on `origin/Staging`.
- **Slices**: the order you'll build in, riskiest AC first.

Show the plan **and the test cases** to the user in plain language. Agreeing the test cases is agreeing what
"done" means. Start only on a go-ahead.

### 4. Build

- Branch `feature/SCRUM-<n>-<slug>` off the latest `origin/Staging`.
- One vertical slice at a time, **test first**: write the slice's tests from the agreed cases and watch them fail
  (red), write just enough code to pass (green), then tidy with the tests still green (refactor). A slice runs
  migration → repository → service → controller + route + guard → frontend service → page → docs, and ends green
  before the next starts.
- A new case discovered while coding goes into the *Test cases* table first, then into a test.
- Stop at every stop point (AGENTS.md §3). Write a migration, then hand it to the user.
- Update *Status* and the *Log* as you go, not at the end.

### 5. Prove it

- **Every** suite passes locally (AGENTS.md §4), not just the story's. That's the regression run.
- Coverage: `npm --prefix backend run test:cov` and `npm --prefix frontend run test:cov`. 100% of the story's
  own lines and branches, or each gap written down with its reason.
- Review every new test against the five questions (conventions.md, *Testing* §5); strengthen any that no plausible
  bug would break.
- Walk every AC in the table and tick it only when its test cases are automated (or justified as manual) and pass.
  Fill in *Latest execution* for each case.
- Write the manual demo steps: which seeded account, which URL, which clicks, what should appear.

### 6. Document

In the same change: the lane's `docs/` guide; the lane's test guide (copy the *Test cases* table with execution
results, the AC → test traceability and coverage notes: this is Deliverable 3); `docs/frontend-routing.md` for
routes; `docs/staff-access.md` for permissions; the README if user-visible behaviour changed; the C4 model or a new
ADR if the change is architectural; and any `.agent/docs/` file the change made untrue.

### 7. Hand off

- Run the Definition of Done (AGENTS.md §5). Report honestly: what passed, what failed, what wasn't run.
- Write the **explain-back** in the note and walk the user through it (AGENTS.md §3).
- Propose the commit message and the PR description (AGENTS.md §7). Wait for approval.
- List everything under *Found, not built* so the user can raise it at stand-up or with the Product Owner.

## When the user asks for something outside the story

Say plainly that it's outside the story's acceptance criteria, name the story it belongs to (or say that none
exists yet), and offer to record it under *Found, not built*. Build it only if the user confirms the Product
Owner agreed to change the story. Then update the *Contract* section, noting who agreed and when.
