# Conventions

How code, tests and documentation are written here. Read the file you're editing and match it.

## Code

### Principles

- **One job per function.** Split out a block when it has a name of its own and would read better called than
  inlined (`signInErrorMessage`, `getResponsibilities`). Don't split one-use, unnameable fragments.
- **Small, flat, explicit.** Early returns over nested `if`/`else`. Guard clauses first, happy path last.
- **Security reads as code, not convention.** Fail closed: missing roles grant nothing, a missing record denies
  access, a lookup failure returns 503 rather than guessing. Require an explicit `=== true` from access checks.
- **Never trust the client** for identity, role, ownership, status or timestamps. The server sets them.
  `organiser_id = req.user.id`, `status` is written only by the transition function, and `WRITABLE_COLS`
  allow-lists what a body may set.
- **User-facing text is a finished sentence** in plain English with a next step: "Your session has expired. Please
  sign in again." Never show provider, SQL or stack text. Never reveal whether an account or record exists to
  someone who can't see it.
- **Constants for fixed values.** Name limits and labels (`SIGN_IN_LIMITS`, `LABELS`, `WRITABLE_COLS`) and
  `Object.freeze` lookup tables.

### Comments

Comments say **why**, never what. Good reasons for a comment:

- a security invariant: `// Verify with Supabase on every protected request. Never trust a decoded JWT or browser profile.`
- a non-obvious constraint: `// Keep this synchronous: invoking async SDK methods here can deadlock refresh.`
- a customer clarification or story boundary, with its ID: `// SCRUM-22: … a rejection records the decision and nothing else.`
- a *Deliberately absent* block at the top of a page or module listing neighbouring stories that are not built here

If code needs a comment to say what it does, rename things instead. Don't leave commented-out code, TODOs without a
story ID, or changelog comments ("updated for sprint 2").

### Backend (CommonJS, Express 5)

- `require` / `module.exports`. One factory per router or controller: `function createXRoutes(deps, authenticate)`,
  `function createXController(deps)`, `function createXService({ repository, … })`.
- Services return result objects (`{ ok: true, event }` / `{ ok: false, reason: "not_found" }`); controllers map
  `reason` to status codes. Services don't throw for expected outcomes.
- Repositories: explicit `select("id, name, …")` column lists (never `select("*")` on a response path), one
  `unwrap({ data, error }, action)` helper per file, race-safe updates with `.eq("status", from)` so zero rows
  means "someone got there first" (409).
- Async handlers: `try`/`catch` in the controller only where the error is mapped to a safe response; otherwise let
  Express 5 pass it to `errorHandler`. No `catch` that swallows.
- Double quotes, semicolons, 2-space indent, trailing commas in multi-line literals.

### Frontend (React 19, JSX)

- Function components, `export default function PageName()`. One component per file; file name = component name.
- Hooks: `useState` / `useEffect` / `useRef`. No state library, no context beyond `AuthContext`.
- Data effects follow the `AuthProvider` pattern: an `active` flag or `AbortController`, and results keyed by
  `token` (and a reload counter) so a sign-out or account switch can't show one user another's data:

  ```jsx
  useEffect(() => {
    let active = true;
    fetchQueue(token)
      .then((events) => { if (active) setQueue({ token, events, error: "" }); })
      .catch((error) => { if (active) setQueue({ token, events: [], error: error.message }); });
    return () => { active = false; };
  }, [token]);
  ```

- Every data view handles **loading, empty, error (with retry where it makes sense) and success**. Buttons disable
  while a request is in flight; a double click never sends twice.
- Permissions come from `useAuth().hasPermission(name)`. Never inspect roles in the browser.
- Accessibility: every input has a `<label>`; errors use `role="alert"` or `aria-describedby` +
  `aria-invalid`; sections have `aria-labelledby`; status is never shown by colour alone.
- Import order: React / router, then `../auth/useAuth`, then feature services, then components, then CSS last.


## Testing

Testing follows the IS212 method (Weeks 4, 6 and 9) and the project rubric. The rubric's top band for *Testing and
traceability* asks for tests that are comprehensive and traceable, cover **normal, boundary, conflict and
failure** scenarios across unit and integration/end-to-end layers, and reach **100% coverage unless that isn't
possible, with the reason stated**. Deliverable 3 is a test case document that traces acceptance criteria to tests.
Everything below serves those three things.

The order is always **AC → test cases → automated tests → code**:

1. **Acceptance criteria** say what the story must do (word for word, as the user gave them).
2. **Test cases** are the concrete evidence that will show each behaviour. They're written and agreed with the user
   **before** implementation (Week 4: "agree the important behavioural examples before implementation begins").
3. **Automated tests** encode those cases. They're written first and fail first (TDD: red → green → refactor).
4. **Code** is written to make them pass, and no more.

### 1. Derive test cases from the AC: the five steps

For each AC, work through Week 4's five steps and write down the cases before writing any code:

| Step | Ask | ConnectSphere examples |
|---|---|---|
| 1. Visualise the workflow | What does each role see and click? What's on screen before and after? | The coordinator opens `/events/reviews`, picks an event, clicks *Start review* |
| 2. Happy path | The path with no errors. Test it first | Assigned coordinator approves an `UNDER_REVIEW` event → `APPROVED`, approver and time shown |
| 3. Cross-cutting quality | Auth, role and relationship access, safe errors, accessibility, mobile (375px), consistent UI | Only write a story-specific test when the concern produces story-specific behaviour (e.g. *this* endpoint's record check). The generic bar lives in the Definition of Done |
| 4. Negative | Wrong input, wrong role, wrong record, wrong state, dependency down | Unassigned coordinator → 403 and event unchanged; approve from `SUBMITTED` → 409; Supabase error → safe 500/503 |
| 5. Boundary | Just below, at and just above every limit; equivalence partitions | Capacity 99/100/101 attendees; registration period opening at exactly the start time; max-length fields; empty and whitespace-only strings |

Then add the two scenario types the rubric names that the five steps don't:

- **Conflict**: two users or two requests racing for the same thing (double approve, double booking, the last
  registration place, a status changed underneath you). Expect 409 and nothing half-written.
- **Failure**: storage or provider unavailable, malformed responses, expired sessions. Expect a safe message, no
  leaked detail, no partial write, and a retry path in the UI.

When a checklist AC hides several behaviours, rewrite it as **Given / When / Then** scenarios first. Each scenario
becomes at least one test case.

### 2. Write the test case specification

The Week 4 template, one row per case, kept in the lane's `docs/` test guide (the Deliverable 3 document) and
drafted in the task note first:

| Field | Content |
|---|---|
| Test case ID | `TC-SCRUM-<n>-NN` (unique, never reused) |
| AC | The AC number(s) it is evidence for |
| Scenario | One-line objective, e.g. "Unassigned coordinator cannot approve" |
| Type | Happy · Negative · Boundary · Conflict · Failure · Cross-cutting |
| Pre-conditions | Data and state needed, e.g. "Event E1 `UNDER_REVIEW`, assigned to coordinator.demo; signed in as coordinator2.demo" |
| Steps | Exact actions a person could follow, e.g. "1. Open `/events/E1/review` 2. Click *Approve*" |
| Test data | Exact inputs (accounts, IDs, values). Not "a valid event" |
| Expected result | Specific observable outcome, e.g. "403 *You do not have permission…*; event status still `UNDER_REVIEW`" |
| Automated by | The test ID(s) that execute this case, or **Manual** with the reason |
| Latest execution | Date · pass/fail · where (local / CI run link) |

The specification is written once and changes only when the requirement changes. The *Latest execution* column is
updated each time the story's tests are run for a PR, because a pass only holds for that build.

Expected results come from the **AC and customer clarifications, never from what the code currently does**. If you
can't justify an expected value without reading the implementation, ask the user.

### 3. Automate at the right layer

The testing pyramid: many fast unit tests, fewer integration tests, a few end-to-end journeys.

| Layer | Runner | Lives in | What it proves | Fakes |
|---|---|---|---|---|
| Backend unit | Vitest | `backend/tests/unit/<feature>/*.test.js` | Validation, service rules, status transitions, repository query shape | Repository / Supabase client (`tests/helpers/stubSupabase.js`) |
| Backend integration | Vitest | `backend/tests/integration/<feature>.<story>.test.js` | Real `createApp` over HTTP: auth, permission and record guards, status codes, response shape | `authClient.getUser` and the injected service/repository |
| Frontend component / flow | Vitest + React Testing Library + user-event (jsdom) | Next to the code: `features/<f>/**/X.test.jsx` | Real `App` + `AuthProvider` + router + guards: what each role sees, loading/empty/error states, form behaviour | `lib/supabase` (`vi.mock`) and `fetch` (`vi.stubGlobal`) |
| API acceptance | Playwright `api` project | `tests/playwright/<feature>.api.spec.cjs` | The real Express app over HTTP with real Supabase SDKs against the local Auth simulator; role × endpoint matrices | Storage only (`tests/playwright/support/<f>-storage.cjs`) |
| End-to-end | Playwright `chromium` project | `tests/playwright/<feature>.browser.spec.cjs` | A user's journey through the real UI, Vite proxy and backend | Storage only |

The older `auth`, `permissions` and `equipment` backend suites run on `node:test`; leave them as they are. All new
tests use Vitest or Playwright.

| The story adds… | Tests required |
|---|---|
| Validation or a rule | Backend unit: each equivalence class, each boundary (below / at / above), empty and whitespace |
| A status transition | Backend unit: every allowed transition and every refused one; the race (zero rows updated → 409) |
| An endpoint | Backend integration: success; 401 without a token; 403 for each wrong role; 403 for the right role on someone else's record; 400 for bad input; 404; 409 where state matters; 503 when the dependency is missing |
| A permission | Update the role/permission matrices in `tests/playwright/api.spec.cjs` and any Vitest matrix; add a Playwright API case per role |
| A page | Frontend: the permitted role sees it and its nav link; a denied role is redirected to `/forbidden` and sees no link; loading, empty, error + retry, success; server error text shown safely |
| A user journey in an AC | Playwright browser: the journey end to end with seeded fixture accounts |
| "X cannot see / change Y" | **API-level** denial test (integration or Playwright API). A hidden button is not evidence |
| Cross-lane workflow (e.g. approve → venue booking sees it) | One Playwright test for the hand-off between lanes. The rubric grades coherent end-to-end workflows, not isolated features |

### 4. Write good tests

- **FIRST**: Fast, Isolated (any order, in parallel), Repeatable (no flakiness; fixed UUIDs, far-future `2099-…`
  dates, `TZ=Asia/Singapore` on the frontend), Self-validating (assertions, never "look at the output"), Timely
  (written before or with the code).
- **Arrange, Act, Assert**, one behaviour per test, no logic in the assertions.
- **Assert the full outcome**: the response *and* the state afterwards ("403 **and** the event is unchanged",
  "409 **and** no booking row was written").
- **No real Supabase, network or secrets.** Fakes only at the boundary (Auth transport, storage). Guards,
  controllers and validation stay real.

### 5. Review every test before trusting it

Code and tests written by the same author, human or agent, share the same blind spots. A green suite only means the
tests agree with the code. Before a story is done, check every new test against Week 6's five questions and record
any fixes in the task note:

1. **Which AC does it cover?** Every test traces to an AC (or a Definition of Done item).
2. **What wrong implementation would make it fail?** If nothing plausible would, it's decoration: strengthen or
   delete it. Mentally mutate the code (`>` to `>=`, drop a `.eq("status", from)`, return `true` from a record
   check) and confirm some test goes red.
3. **Can the user explain the setup, action and expected result?** If not, they can't defend it in the Week 13 Q&A.
4. **Is the expected value justified by the AC, not by the code?**
5. **Is it deterministic and non-vacuous?** "All tests pass" from the agent is not evidence on its own. CI on the PR
   is the gate.

### 6. Coverage

- Run `npm --prefix backend run test:cov` and `npm --prefix frontend run test:cov` for the story and report
  statement and branch coverage for the files it touched.
- Target: **100% of the story's own code**, lines and branches. Anything uncovered is either covered by a new test
  or listed with the reason in the lane's test guide (unreachable, wiring only, third-party). The backend
  `vitest.config.mjs` `exclude` list, with its reasons, is the pattern.
- Coverage is a diagnostic, not the goal. 100% with weak assertions fails question 2 above. Never add a test only
  to raise the number.

### 7. Naming and IDs

Test names lead with an ID so the runner output is the traceability report:

| Layer | Pattern | Example |
|---|---|---|
| Backend unit / integration | `[SCRUM-<n>] <behaviour>` or `SCRUM-<n> AC<k>: <behaviour>` | `[SCRUM-22] Rejecting records the reason and changes no booking` |
| Frontend | `[SCRUM-<n>-UI-NNN] <behaviour>` | `[SCRUM-26-UI-001] the Event Operations Manager reaches the queue…` |
| Playwright API | `[<AREA>-API-NNN] <behaviour>` | `[EVENT-API-006] Anonymous and forged-token submissions fail before persistence` |
| Playwright browser | `[E2E-<AREA>-NNN] <behaviour>` | `[E2E-AUTH-004] Sign-out removes persisted session across reload and browser history` |

IDs are unique and never reused. A parameterised case gets a distinct ID per row. The behaviour is a sentence
stating the outcome ("…is refused and leaves the event unchanged"), not the action ("test reject").

### 8. Patterns to copy

- **Backend integration**: `backend/tests/integration/venueDecisions.test.js`. Build `createApp` with a fake
  `authClient` whose token string encodes the roles, and `vi.fn()` service methods reset in `beforeEach`. Listen
  on port 0 and `fetch` it.
- **Frontend flow**: `frontend/src/features/events/AssignmentQueuePage.test.jsx` and `frontend/src/Rbac.test.jsx`.
  Render the real `<App/>` in a `MemoryRouter` and mock only `getAuthClient` and `fetch`. Compute the expected
  permissions from the **real** `backend/src/auth/permissions.js` (via `createRequire`) so the browser and the
  server can't drift apart.
- **Playwright**: `tests/playwright/events.api.spec.cjs` / `events.browser.spec.cjs`. Use the `accounts` fixture
  from `support/fixtures.cjs` to create disposable users with roles, and `signIn(page, account)`. New storage
  goes in a `support/<f>-storage.cjs` module that `support/server.cjs` passes to `createApp`.

### 9. Regression and CI

- Before calling a story done, run **every** suite, not just the story's. Other lanes' tests are the regression
  suite.
- CI on the pull request is the authoritative gate (Week 6). Never delete, skip (`.skip`, `.only`,
  `test.fixme`) or loosen a test to get green. Fix the cause. If a test is wrong because the AC changed, say so to
  the user and update the test, the test case spec and the traceability table together.
- Report pass/fail counts per suite to the user, and say which suites weren't run.

## Documentation

Agile favours working code over documents, but the course wants **"just enough" documentation that is accurate**
and legible to humans and agents. Four kinds exist. Update each in the same change as the code it describes.

| Document | Lives in | Updated when | Graded as |
|---|---|---|---|
| Lane guide (`<feature>-integration.md`, `<feature>.md`): routes, endpoints, permissions, statuses, setup | `docs/` | Any behaviour, route, endpoint, permission or schema change | Evidence for *Working software* and the Q&A |
| Test guide: test case specs + AC → test traceability + coverage notes | `docs/<feature>-tests.md` or `docs/testing/` | Every story (§2 above) | **Deliverable 3** |
| C4 model (C1 context, C2 containers; C3 only if a container needs explaining) as **Structurizr DSL text** | `docs/design/` | A change adds or removes a user role, an external system, a container (app, API, database) or a relationship between them | **Deliverable 2** |
| Architecture Decision Record: context, decision, alternatives considered, consequences; one short file per decision | `docs/adr/NNNN-<title>.md` | A story makes a decision that is expensive to change later (a status model, a permission model, where a rule is enforced, a data-ownership choice) | *System design* rubric: "well-justified trade-offs" |

- **Diagrams are text** (Structurizr DSL for C4; Mermaid inside Markdown for state and sequence diagrams) so they
  diff and review in PRs. Draw one only when it says something more clearly than the code, e.g. a status lifecycle
  as a Mermaid state diagram, or a multi-step flow with a failure branch as a sequence diagram.
- `docs/design/` and `docs/adr/` don't exist yet. Create them the first time a story needs them, not before, and
  tell the user, since the C4 model is a team deliverable.
- The README keeps a correct *how to run* and *how to test* section (Deliverable 6) and the repository link
  (Deliverable 7).
- Scrum evidence (backlogs, burndowns, boards, retros, recordings, Deliverables 1 and 4) lives in the team's tracker and
  drive, not in the repo. The agent can help draft it when asked, but never invents meeting outcomes or
  estimates.
