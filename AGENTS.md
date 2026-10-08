# AGENTS.md

Guidance for any coding agent (Claude Code, Codex, Cursor, …) working in this repository. `CLAUDE.md` only imports
this file. Durable reference lives in [.agent/docs/](.agent/docs/); per-story task notes, roadmaps and any other
Markdown working notes live in [.agent/docs/other/](.agent/docs/other/). [.agent/tasks/](.agent/tasks/) holds only the
workflow README and the task note template.

ConnectSphere is the IS212 Event Planning and Venue Booking System, built by a six-person Scrum team in five lanes
(Access, Event Lifecycle, Venue, Equipment, Registration). **The user story and its acceptance criteria decide what
gets built.** This file decides how.

The person you are working with may not be technical. Assume nothing about their knowledge of git, npm, React,
SQL or testing, and never leave them stuck on a step they can't do alone. See *Working with the user*.

---

## 1. Scope rules

These come first.

- **Build to the story's acceptance criteria (AC).** Each dev decides how they give the agent their stories. If
  anything goes beyond the AC, say so to the user, who must be able to justify why it fits the story.
- **Customer clarifications are binding.** Answers in the course's GitHub Discussions for **our section** count as
  requirements. Other sections' answers don't apply. When an AC relies on one, cite the discussion number in the task
  note's *Decisions* and in a code comment where the rule lives. If an AC and a clarification conflict, stop and ask.
  Our section tag: **`[T?]`**. Ask the user to fill this in if it's still `?`.
- **Stay in the lane.** Each lane owns its `features/<feature>/` and `modules/<feature>/` folders. The shared files
  (`backend/src/app.js`, `backend/src/auth/permissions.js`, `frontend/src/App.jsx`,
  `frontend/src/routes/WorkspaceLayout.jsx`, `tests/playwright/support/*`) get the smallest possible addition, and
  you mention it so the user can warn the team. Never rewrite another lane's code to suit this story. If it blocks
  you, stop and say what you need from its owner.

## 2. Working rules

- **YAGNI.** Build only what is asked. No speculative abstractions, no defensive checks for conditions that cannot
  occur, no config knobs with one caller, no "future-proofing" parameters.
- **Self-documenting code over comments.** Name things so the logic reads on its own. Comments are for *why*: a
  non-obvious constraint, a security invariant, a customer clarification, a workaround, a story boundary. Never a
  restatement of the code. See [backend/src/middleware/requireAuth.js](backend/src/middleware/requireAuth.js) and
  [backend/src/auth/permissions.js](backend/src/auth/permissions.js) for the intended density.
- **Match the house style.** Follow [.agent/docs/conventions.md](.agent/docs/conventions.md). It's taken from the
  sign-in, RBAC and routing code (Ryan / PewPew) and is the reference whenever lanes disagree.
- **Smallest correct change.** Extend an existing helper before writing a parallel one. Reuse `apiFetch`,
  `requirePermission`, `Modal`/`ErrorModal`, the shared CSS classes and the Playwright fixtures.
- **Never run `git stash`.** Use branches or commits.
- **Never install anything.** That covers npm packages, Playwright browsers, CLIs, global tools and MCP servers. If
  something is missing, stop and give the user the exact command (e.g. `npm --prefix frontend install <pkg>`) and
  explain why it's needed. Even then, a new dependency needs a reason tied to an AC. The stack is fixed:
  [.agent/docs/architecture.md](.agent/docs/architecture.md).
- **No migration files.** Never create a migration file, and never suggest writing one. Instead, tell the user
  every SQL change the story needs (new columns, tables, constraints), with the exact SQL, so they can make it by
  hand in the Supabase dashboard. Record the same SQL in the task note and, in the same commit as the code, in a
  *Schema reference* section of the lane's existing guide in `docs/` (as `docs/venue-integration.md` does). No
  `supabase/` folder or migration `.sql` file is committed; the isolated `tests/sql/` harness builds its own
  fixtures and must not depend on one. Remind the user to tell teammates **before**
  the change (what will change) and **after** it (that it's done), because the database is shared and their tests
  may depend on it. Never run SQL against the Supabase project
  or use the secret key from the agent.
- **Code comments cite the Jira work ID only.** Write `SCRUM-<n>`, never the backlog user story ID (`US-<n>`), in any
  code or test comment, test name or *Deliberately absent* block.
- **Never touch secrets.** Don't read `.env` aloud, print keys, commit `.env`, or put the secret key anywhere in
  `frontend/`.
- **Task notes, roadmaps and other working Markdown go in [.agent/docs/other/](.agent/docs/other/), never in
  [.agent/tasks/](.agent/tasks/).** Durable reference goes in [.agent/docs/](.agent/docs/). Check both before
  starting work.
- **Keep the docs current as part of the work, not after it.** A change that alters anything described in
  `.agent/docs/`, `docs/`, `README.md` or this file isn't finished until those files match the
  code, in the same task and the same commit. That covers endpoints, permissions, route paths, schema, status
  values, UI tokens, test commands and security invariants. A stale doc is worse than no doc, because people
  believe it.

## 3. Working with the user

### At the start of every story, ask the mode

> "Do you want me to **build** this story (I write the code and explain each step in plain English), or **teach**
> you through it (you type it, I guide line by line)?"

Record the answer in the task note. Keep that mode for the whole story unless the user switches.

**Build mode.** You write the code, tests and docs, one slice at a time (see §5). After each slice, say in plain
language what changed, why, and how to see it working, then continue. You still stop at every *stop point* below.

**Teach mode.** One concrete step at a time. Show exactly what to type and where. Explain every non-obvious line:
what it does and why it's there. When a decision comes up, name the options, the tradeoffs and your
recommendation, then wait. End each step with a short summary: what we did, what it gives us, what's next. Doc
edits and read-only investigation are always fine without asking.

### The user must be able to explain it

The Week 13 Q&A asks the team to trace a requirement to its code and tests and to justify design choices and AI
contributions. "The AI wrote it" scores badly. So in either mode:

- Explain *why* as well as *what*: the alternatives and the tradeoff behind each design decision.
- At hand-off, give an **explain-back**: a short plain-language walkthrough of the story's path from AC to test to
  code, the key decisions, and three questions an instructor might ask, with good answers. Put it in the task note.
- Never leave code the user hasn't seen summarised. If they can't explain a part, go through it again.

### Stop points (both modes)

Stop, explain, and wait for the user before:

- any database change: new columns, tables or constraints (they add them by hand in the dashboard; you give the SQL
  and the steps)
- installing anything (they run the command you give)
- `git commit`, `git push`, opening a PR, merging, deleting a branch, `reset --hard`, force-push
- changing a shared file another lane depends on in a way beyond a one-line addition
- creating a new top-level folder, file type, `package.json`, config or test harness the repo doesn't already use
  (the user checks with the team first)
- interpreting an ambiguous AC, or anything that would widen scope

### Talking to a non-technical user

- Plain words first, the technical term in brackets once: "the part of the server that checks who you are
  (middleware)".
- Every command comes with **where to run it** (which folder, which terminal), **what you should see** and
  **what to do if you see something else**. Suggest the `! <command>` prefix so the output lands in the
  conversation.
- Say what's done, what's left, and what the next step is. Don't bury a failing test or a skipped check.
- When something fails, explain the cause in one sentence before the fix.
- Before a commit, summarise the change in words a teammate would understand, and list the files touched.

## 4. Commands

Run from the repository root. Node 22.

| Purpose | Command |
|---|---|
| Install deps (user runs) | `npm ci && npm --prefix backend ci && npm --prefix frontend ci` |
| Backend dev server (:3000) | `npm --prefix backend run dev` |
| Frontend dev server (:5173) | `npm --prefix frontend run dev` |
| Both in Docker | `docker compose up --build --renew-anon-volumes` |
| Backend tests | `npm --prefix backend test` |
| Backend lint | `npm --prefix backend run check` |
| Frontend tests | `npm --prefix frontend test -- --run` |
| Frontend lint / build | `npm --prefix frontend run lint` · `npm --prefix frontend run build` |
| Playwright (browser + API) | `npm run test:playwright` (`test:e2e` browser only, `test:api` API only) |
| Playwright report | `npm run test:playwright:report` |
| Seed demo users (user runs) | `npm --prefix backend run seed:users`. Accounts are in [docs/seed-users.md](docs/seed-users.md) |

**CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on push and PR to `staging` and runs all four
suites: frontend lint + test + build, backend check + test, Docker build, and Playwright. Every one of them must
be green locally before you call a story done. Backend `npm test` needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in
the root `.env` (see §6, *Tests*).

## 5. How a story is built

The full checklist with templates is in [.agent/tasks/README.md](.agent/tasks/README.md). In short:

1. **Load the story.** Ask the user for the story: its key, title, user story sentence ("As a <role>, I want
   <goal>, so that <benefit>") and AC (a checklist or Given / When / Then). Copy it word for word into a new task
   note `.agent/docs/other/SCRUM-<n>-<slug>.md` from [the template](.agent/tasks/_template.md).
2. **Read before planning.** Read `.agent/docs/`, the lane's `docs/<feature>*.md`, and the code the story touches.
   Check `git log origin/staging` for related work.
3. **Plan against the AC.** Fill in the task note's AC table: each criterion gets a *how it's built* and a *how
   it's proven*. Then write the **test case specifications** for every AC (happy, negative, boundary, conflict,
   failure; see *Testing* in [.agent/docs/conventions.md](.agent/docs/conventions.md)). List *Deliberately
   absent* items and open questions. Show the plan and the test cases to the user, agree them, and ask for a go-ahead
   and the mode.
4. **Branch.** `feature/<threeWordSummary>` (or `fix/…`, `chore/…`) off the latest `origin/staging`, summarising
   the 1–3 related user stories in three words (§7). Never work on `main` or `staging`. Remind the user to move the
   Jira card to *In Progress*.
5. **Build in vertical slices, with tests.** Each slice's tests are written alongside its code and pass before the
   PR. Test-first (red → green → refactor) is recommended but not required; the dev chooses. A slice
   covers manual schema change → repository/service → controller/route + permission → frontend service → page/component →
   docs, and is proven before the next one starts. Order slices so the riskiest AC is proven first.
6. **Test at every layer the story touches, then review the tests.** Every AC maps to test cases and automated
   tests. Security-relevant AC (who can see or change what) need a denied-role test at the API level, not just a
   hidden button. Run coverage for the story's files, and put every new test through the five review questions.
7. **Docs in the same change.** Update the lane's `docs/` guide; the test guide (test case specs with latest
   execution, traceability, coverage notes); the README if user-visible behaviour changed;
   `docs/frontend-routing.md` / `docs/staff-access.md` for new routes or permissions; the C4 model if the change is
   architectural (`docs/design/` doesn't exist yet: create it on first need, per *Documentation* in
   [.agent/docs/conventions.md](.agent/docs/conventions.md)). ADRs live in the team's Google Drive, not the repo:
   if a decision is expensive to change later, or you're unsure how an earlier one applies, ask the dev to check
   the ADRs there; and
   any `.agent/docs/` file the change contradicts.
8. **Definition of Done check** (below). Report what passed, what didn't, and what wasn't run.
9. **Hand-off.** Give the explain-back (§3) and the list of new files with their reasons. Propose the commit
   message and the PR description, then wait for approval. When the PR opens, the Jira card moves to *In Review*;
   it moves to *Done* only after a teammate has reviewed the PR, CI is green and the author has merged (Jira
   history feeds the sprint charts). A story not done by sprint end goes back to the backlog; never merge it
   half-done.

### Definition of Done

- [ ] Every AC in the task note is ✅ with named tests, or explicitly agreed as descoped with the user
- [ ] Test case specs written for every AC: happy, negative, boundary, conflict and failure where they apply; each
      linked to its automated test IDs, with the latest execution date and result
- [ ] Every new test passes the five review questions; expected values come from the AC, not the code
- [ ] Coverage run: 100% of the story's own lines and branches, or each gap listed with its reason
- [ ] Anything beyond the AC has been pointed out to the user with its justification
- [ ] Backend: permission guard + record check on every new endpoint; 401 / 403 / 400 / 404 / 409 paths tested
- [ ] Frontend: route behind `RequireAuth` + `RequirePermission`, nav link behind the same permission, loading /
      empty / error states handled
- [ ] Backend and frontend Vitest and Playwright (API and browser) cover the story; **all** suites green
      locally, including earlier sprints' test cases (the regression run), then green in CI on the PR
- [ ] Cross-cutting bar: works at 375px wide, keyboard-usable, errors are safe sentences, access checked on the server
- [ ] Lint and build green; no `console.log` left behind (the startup scripts `server.js` and `checkSupabase.js`
      excepted); no skipped or deleted tests
- [ ] File discipline (§2): every new file listed with its reason; no duplicate docs, scratch or backup files
- [ ] Any new test script or npm test command is added to [.github/workflows/ci.yml](.github/workflows/ci.yml) so CI
      runs it (a shared file: tell the team)
- [ ] Schema changes (if any) written as SQL in the task note and the lane guide's *Schema reference*, and added
      **manually by the user**; no migration file; seed updated if demos need new data
- [ ] Docs updated (lane guide, test guide, routing/permissions, C4 if architectural, ADR flagged to the dev for the
      team Drive, `.agent/docs/` if affected)
- [ ] Explain-back written in the task note; the user can walk AC → test → code unaided
- [ ] PR reviewed and approved by a teammate
- [ ] Task note *Status* and *Log* and the Jira card status current; *Found, not built* items passed to the user
- [ ] Manual walkthrough steps written for the demo, with the seeded accounts to use

## 6. Architecture in one page

Details: [.agent/docs/architecture.md](.agent/docs/architecture.md) (stack, layers, database, integrations),
[.agent/docs/ui.md](.agent/docs/ui.md), and the team guides in [docs/](docs/).

- **Frontend**: React 19 + Vite (JavaScript, JSX, no TypeScript), React Router 7 in declarative mode. Code goes in
  `frontend/src/features/<feature>/{pages,components,hooks}` (`features/auth` predates this and stays flat), and API helpers in `features/<feature>/<x>Service.js`
  or `lib/api.js`. Identity and permissions come only from `useAuth()`, which is backed by `GET /api/auth/me`.
- **Backend**: Express 5 on Node 22, CommonJS. The target path for new code, with `modules/events` as the
  reference, is `app.js` → `routes/<feature>.routes.js` (guards) → `modules/<feature>/<x>.controller.js` (HTTP
  mapping) → `<x>.service.js` (rules) → `<x>.repository.js` (Supabase). Not every lane has every layer yet (e.g.
  registrations mounts handler files straight from `app.js`); extend a lane's existing shape, don't restructure it.
  Dependencies are injected through `createApp({...})` so tests pass fakes.
- **Auth and RBAC**: Supabase email/password. `requireAuth` verifies the bearer token with Supabase on every
  request; roles come only from `app_metadata.roles`. `requirePermission(name, authorizeRecord?)` checks the
  policy in `auth/permissions.js`; `record: true` permissions must have a server-side relationship check.
  Frontend guards are UX, not security.
- **Database**: Supabase Postgres. Schema changes are made by hand in the dashboard; no migration files.
- **Tests**: Vitest (unit + integration, backend and frontend), Playwright (browser + API against a local Auth
  simulator; no cloud needed).
- **External APIs**: Novu Cloud selected for SCRUM-143 notifications. The backend signs own inbox identity; @novu/react renders the authenticated /notifications inbox and unread count. Event delivery is not built yet. Setup is in [docs/notifications.md](docs/notifications.md).
- **Deployment**: not planned yet. Don't add hosting config.

## 7. Git

- Branch: `feature/`, `fix/` or `chore/` plus a three-word camelCase summary of the 1–3 related user stories (e.g. `feature/eventLifecycleStatus`, `fix/coordinatorWorkloadCount`); no Jira or story IDs in branch names. Older branches (`feature/RBAC`, …) predate this rule. Branch off `origin/staging` (lowercase); PRs target `staging`.
- One PR per branch, covering its 1–3 stories. Keep the branch current by merging or rebasing from `origin/staging`.
  Never reuse a merged branch; delete it after merge (with approval).
- Commit: `feat: SCRUM-<n> <what changed, at feature level>`. Types are `feat`, `fix`, `test`, `docs`,
  `refactor`, `chore`. Short subject, detail in the body.
- **Never commit, push, open or merge a PR without explicit approval.** Show the summary and file list, then wait.
- Never add `Co-Authored-By` trailers or any AI attribution to commits or PRs.
- Keep PRs small and merge often. Every lane touches `app.js`, `permissions.js`, `App.jsx` and
  `WorkspaceLayout.jsx`.
- Reviews: every PR needs at least **one** reviewer (two for a bigger feature), preferably a dev, picked at random
  from the team. A failing CI run blocks the merge. Once approved, the **author** merges, not the reviewer. The
  author and reviewer, not the agent, are accountable for AI-written code and tests.
- PR description: the story key and title, what the PR delivers per AC, the test case IDs (`TC-SCRUM-<n>-NN`)
  that prove each AC, the test commands run and their results, new files added and why, schema changes to make by
  hand, and manual demo steps.
