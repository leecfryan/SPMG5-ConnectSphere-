# Event Request — Test Documentation

**Deliverable 3 evidence for SCRUM-23 (Create event request) and SCRUM-25 (Submit event request), both under epic SCRUM-7 (Event Request).**
Branch: `feature/eventRequest` · Written 18 Sep · **80 documented cases, all passing**
— 64 backend (§3–§5) and 16 frontend (§6).

Run everything:

```bash
npm --prefix backend test          # 64 tests
npm --prefix frontend test         # 16 tests
npm --prefix backend run test:cov  # backend, with coverage
npm --prefix frontend run test:cov # frontend, with coverage
npm --prefix backend run check     # ESLint across src/ and tests/
npm --prefix frontend run lint     # ESLint across the frontend
```

Both suites run on **Vitest**, and both run in CI on every pull request to `main`
(`.github/workflows/ci.yml`).

> **On the runner.** The backend suite was written against `node --test` and moved
> to Vitest so one runner covers both halves of the app. The tests themselves are
> unchanged in substance — same cases, same names, same 64 — only the assertion
> and spy APIs were rewritten (`assert.equal` → `expect().toBe`, `mock.method` →
> `vi.spyOn`). The modules under test are still CommonJS and are loaded with
> `createRequire`, so a spy set in a test and the reference the source closes over
> stay the same object.
>
> **An earlier draft of this document claimed 70 tests**, counting six for an
> `events.status.js` lifecycle module. Neither that module nor its test file
> exists on this branch; the count has always been 64. Corrected here.

Every row below names the automated test that executes it. Test names lead with the
story and criterion, so `npm test` output *is* the traceability report — the last
column is a copy of a line you can read in the terminal.

> **Criterion IDs are Jira subtask keys.** Each row names the subtask it proves —
> SCRUM-44/45/46/47 under SCRUM-23, SCRUM-49/50/51 under SCRUM-25. A test that
> proves a *design* rule rather than a customer criterion carries the story key
> and the word `design` (`SCRUM-23 design:`, `SCRUM-25 design:`), because no
> subtask claims it. `SCRUM-46/47` tags the two tests that walk all four optional
> text fields in one loop, which spans both subtasks.
>
> **`US-13` is the one label here that is not a Jira key.** The draft story has
> not been raised on the board, so the eight `validateDraft` tests keep the
> phase-one list's number until it is. Relabel them when the issue exists — see §7.

---

## 1. What the criteria are, and where they are proven

**SCRUM-23 — Create event request** (Done on the board; subtasks SCRUM-44–47 all Done):

| Criterion | Statement | Proven by | Strength |
| --- | --- | --- | --- |
| **SCRUM-44** | The Organiser can provide the event name, purpose and description | `SCRUM-44:` ×14 — validation, service and HTTP | **Direct** |
| **SCRUM-45** | The Organiser can provide the proposed date and time and expected attendance | `SCRUM-45:` ×22 — validation, service and HTTP | **Direct.** Includes ER-H11: the timestamps reach the row as ISO |
| **SCRUM-46 / 47** | The Organiser can provide venue, accessibility, equipment and registration needs where relevant | `SCRUM-46/47:` ×4 — two prove the field is *accepted*, two prove it is *stored* | **Direct.** See the mutation check under §3 |
| **SCRUM-23** (story level) | A request is judged as a whole: the required set, and a body that is not an object at all | `SCRUM-23:` ×4 + `SCRUM-23 design:` ×2 | **Direct.** Spans all four subtasks, so no single one owns it |

**SCRUM-25 — Submit event request** (In Progress; subtasks SCRUM-49–51 still To Do on the board — see §7):

| Criterion | Statement | Proven by | Strength |
| --- | --- | --- | --- |
| **SCRUM-49** | When the Organiser submits a request, it is no longer treated as a draft | `SCRUM-49:` ×2 — service + repository | **Direct.** The row is built with `status: "SUBMITTED"` outside `pickCol` |
| **SCRUM-50** | The submitted request becomes available for coordinator assignment and subsequent review | `SCRUM-50:` ×1, plus `SCRUM-25 design: status, owner and coordinator in the fields are ignored` | **Indirect** — see §7 |
| **SCRUM-51** | The event status reflects that the request has been submitted | `SCRUM-51:` ×1 — the 201 response carries `status: "SUBMITTED"` | **Direct** |
| **SCRUM-25** (story level) | Ownership, lifecycle and error leakage — rules the story needs that no subtask states | `SCRUM-25 design:` ×5 | **Direct** |

**Test-case categories follow the Week 4 five-step method:** visualise the workflow →
happy path → cross-cutting → negative → boundary. IDs below are prefixed accordingly
(`H` happy, `N` negative, `B` boundary, `D` deferred).

| Category | Cases | Note |
| --- | --- | --- |
| Happy path | 11 | ER-H01–H11 |
| Negative | 20 | ER-N01–N20, plus the 2 supporting cases named at the end of §4.3 |
| Boundary | 23 | ER-B01–B23 — heaviest by design; every rule in the validation contract has a threshold |
| Cross-cutting | **0** | Auth/permissions land with the merge — see §7 |
| Deferred (US-13, not yet in Jira) | 8 | ER-D01–D08 — `validateDraft` is tested but **called by nothing**, see §7 |
| **Total** | **64** | 62 with an ER id + the 2 supporting cases. This is the backend suite only; the 16 frontend cases are counted separately in §6 |

**A test case may cover several data points.** Fourteen of the tests below are
parametrised loops (e.g. `each required field missing on its own` walks all six
required fields). The table gives the loop's range in *Test data*. Counting
assertions rather than cases would give a number roughly twice as large; the case
count is the honest one.

---

## 2. Shared pre-conditions

Stated once rather than repeated in all 64 rows. The *Pre-conditions* column
carries only what is specific to that case.

| Layer | File | Pre-conditions for every case in that file |
| --- | --- | --- |
| Validation (unit) | `tests/unit/events/events.validation.test.js` | None. Pure functions, no I/O, no Supabase client. |
| Service (unit) | `tests/unit/events/events.service.test.js` | `stubSupabase()` seeds the require cache; `repository.createSubmitted` replaced with a `vi.spyOn` spy, reset in `beforeEach`. |
| Repository (unit) | `tests/unit/events/events.repository.test.js` | `stubSupabase()` installs a fake `from().insert().select().single()` chain that records the row. |
| HTTP (integration) | `tests/integration/events.submit.test.js` | Express app on an ephemeral port (`listen(0)`); `express.json()` mounted as `server.js` does; only the repository is faked. |
| Browser service (unit) | `frontend/src/features/events/eventsService.test.js` | `fetch` replaced with `vi.stubGlobal`, cleared in `afterEach`; no DOM and no server. Time zone pinned to UTC+8 — see §6. |

**No test touches the shared Supabase database.** `tests/helpers/stubSupabase.js`
seeds Node's require cache so the real `src/supabase.js` never executes — it
throws at import time without credentials, and every module above the validator
imports it. This is why the suite runs in CI with no `.env` and writes no rows.

**Why the backend tests use `createRequire` rather than `import`.** The modules
under test are CommonJS. Under Vitest an ESM `import` of a CommonJS module is
served from a different module graph than the `require` the source itself uses,
so the test and the code under test would hold two separate copies — a spy set on
one would never be seen by the other, and the require-cache stub above would not
take effect at all. Loading them with `createRequire` keeps one graph, which is
also why `require` still appears inside files that are otherwise ES modules.

---

## 3. Test cases — happy path

| ID | Scenario | Pre-conditions | Test steps | Test data | Expected result | Criterion | Automated test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ER-H01 | A complete request submitted over HTTP is stored and returned as SUBMITTED | Repository spy returns the row it was given | `POST /api/events` with a complete body | name, purpose, description, start +7d, end +3h, attendance `"200"` | `201`; `event.status === "SUBMITTED"`; `organiser_id` is the server's, not the body's | SCRUM-51 | `SCRUM-51: 201 - a complete request comes back SUBMITTED` |
| ER-H02 | The service cleans up form input before storing it | Repository spied | Call `submitRequest(formInput(), organiserId)` | `name` padded with spaces; `attendance: "200"`; `venue_requirements: ""` | `ok: true`; name trimmed; attendance is integer `200`; blank optional stored as `null`; repository called exactly once | SCRUM-49 | `SCRUM-49: a complete request is submitted with cleaned-up fields` |
| ER-H03 | The repository writes the lifecycle columns itself | Insert chain stubbed | `createSubmitted({name}, "org-1", at)` | explicit `submitted_at` | Row carries `status: "SUBMITTED"`, the given `submitted_at`, `organiser_id: "org-1"` | SCRUM-49 | `SCRUM-49: createSubmitted inserts as SUBMITTED with submitted_at and the organiser` |
| ER-H04 | `submitted_at` defaults to now when not supplied | Insert chain stubbed | `createSubmitted({name}, "org-1")`, bracket with `Date.now()` | no `submittedAt` argument | Stamp falls between the before and after readings | SCRUM-50 | `SCRUM-50: createSubmitted defaults submitted_at to now` |
| ER-H05 | The fixture used by every other validation case is itself valid | None | `validateForSubmission(completeInput())` | the shared fixture | `{ ok: true, errors: [] }` | — (fixture guard) | `fixture guard: completeInput passes submission` |
| ER-H06 | `Date` objects are accepted, not just ISO strings | None | Validate with `Date` instances for both timestamps | `new Date(+1h)`, `new Date(+2h)` | `ok: true` | SCRUM-45 | `SCRUM-45: valid Date objects are accepted for both timestamps` |
| ER-H07 | Unknown fields in the body are ignored rather than rejected | None | Validate a complete input plus junk keys | `colour_scheme`, `organiser_id` | `ok: true` — extra keys neither fail validation nor reach the row | SCRUM-23 design | `SCRUM-23 design: unknown extra fields are ignored` |
| ER-H08 | Requirements fields are genuinely optional | None | Validate with all four optional fields populated within the cap | realistic venue / accessibility / comments text | `ok: true` | SCRUM-46/47 | `SCRUM-46/47: optional text within cap passes, over cap fails` |
| ER-H09 | Populated requirements fields survive to the stored row | Repository spied | `submitRequest` with all four optional fields filled | venue padded with spaces; accessibility, equipment, comments text | All four arrive at the repository with their values; venue trimmed | SCRUM-46/47 | `SCRUM-46/47: populated requirements fields reach the repository intact` |
| ER-H10 | The same four come back on the created event over HTTP | App listening | `POST /api/events` with all four optional fields filled | as ER-H09, unpadded | `201`; each of the four echoed on `body.event` | SCRUM-46/47 | `SCRUM-46/47: 201 - requirements fields are stored and returned` |
| ER-H11 | A non-ISO timestamp is normalised before storage | Repository spied | `submitRequest` with both times as RFC-1123 strings | `start.toUTCString()`, `end.toUTCString()` | Both reach the repository as ISO-8601 with milliseconds | SCRUM-45 | `SCRUM-45: both timestamps reach the repository as ISO strings` |

**Why ER-H09 to ER-H11 exist — a mutation check.** SCRUM-46 and SCRUM-47 say the
Organiser *can provide* those fields, and accepting a value is only half of that;
it has to reach the row. Deleting `accessibility_needs` from `WRITABLE_COLS`
(`events.repository.js:5`) was tried against the suite as it stood: the column
silently stopped being persisted and **all 67 tests still passed**. The only
assertion touching these columns was ER-H02's, which checks a *blank* optional
becomes `null`. The same held for the timestamps — nothing asserted `start_time`
reached the row at all, because the repository stub echoes the fields back.
With ER-H09 to ER-H11 in place the same deletion fails two tests, both of them
tagged with the criterion it breaks.

---

## 4. Test cases — negative

### 4.1 Missing and malformed input

| ID | Scenario | Pre-conditions | Test steps | Test data | Expected result | Criterion | Automated test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ER-N01 | A null or non-object request names every required field | None | Validate each bad input | `undefined`, `null`, `"nope"`, `7` | All six required fields reported, never a throw | SCRUM-23 | `SCRUM-23: a null or non-object request lists every required field` |
| ER-N02 | Each required field missing alone is reported by name | None | For each field: delete it from the fixture, validate | loop over all 6 required fields | That field appears in `errors` | SCRUM-23 | `SCRUM-23: each required field missing on its own is reported` |
| ER-N03 | Whitespace-only text fails exactly as empty text does | None | Set `purpose` / `description` to whitespace | `"   "`, `"\n\t"` | Both reported; no other field faulted | SCRUM-44 | `SCRUM-44: whitespace-only text fails the same as empty` |
| ER-N04 | `start_time` must be real and in the future | None | Three bad values in turn | past ISO, `"tomorrow"`, `""` | `start_time` reported in all three | SCRUM-45 | `SCRUM-45: start_time must be a real, future date` |
| ER-N05 | `end_time` must be real and strictly after `start_time` | None | Four bad values in turn | earlier ISO, identical to start, `"later that evening"`, `""` | `end_time` reported in all four | SCRUM-45 | `SCRUM-45: end_time must be a real date strictly after start_time` |
| ER-N06 | `expected_attendance` must be a whole number above zero | None | Loop bad values | `0`, `-5`, `12.5`, `"30"`, `null`, `undefined`, `NaN` | Reported every time | SCRUM-45 | `SCRUM-45: expected_attendance must be a whole number > 0` |
| ER-N07 | Over-long required text is rejected at both fields | None | Validate at 2001 chars | `purpose` and `description` at 2001 | Exactly those two reported | SCRUM-44 design | `SCRUM-44 design: purpose and description are capped at 2000 characters` |
| ER-N08 | An incomplete request saves nothing | Repository spied | `submitRequest({name})` | name only | Five missing fields listed; repository called **0** times | SCRUM-23 | `SCRUM-23: an incomplete request lists every missing field and saves nothing` |
| ER-N09 | A malformed body is rejected, not thrown | Repository spied | `submitRequest(bad)` for each | `undefined`, `null`, `"nope"` | `ok: false` each time; repository never called | SCRUM-23 design | `SCRUM-23 design: an empty or non-object body is rejected, not thrown` |
| ER-N10 | Both date faults are reported together | Repository spied | Past start *and* end before start | start −1h, end −2h | Both `start_time` and `end_time` reported; nothing saved | SCRUM-45 | `SCRUM-45: start in the past and end before start are both reported` |
| ER-N11 | An empty HTTP body names every required field | App listening | `POST /api/events` with `{}` | `{}` | `400`; all six fields in `errors`; repository never called | SCRUM-23 | `SCRUM-23: 400 - an empty body names every required field` |
| ER-N12 | End-before-start is reported against `end_time` over HTTP | App listening | `POST` with end 1h before start | valid body, shifted `end_time` | `400`; exactly `[{field:"end_time", message:"must be after start_time"}]` | SCRUM-45 | `SCRUM-45: 400 - end before start is reported against end_time` |
| ER-N13 | Over-long description is rejected over HTTP | App listening | `POST` with a 2001-char description | `"x".repeat(2001)` | `400`; only `description` reported | SCRUM-44 | `SCRUM-44: 400 - an over-long description is rejected` |

### 4.2 One mistake, one message

The service normalises before validating. A value `normalise` cannot read is left
`undefined`, which the validator would separately report as "required" — so the
validator's entry for that field is dropped and the parse error stands alone.
These cases exist to hold that rule in place.

| ID | Scenario | Pre-conditions | Test steps | Test data | Expected result | Criterion | Automated test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ER-N14 | An unparseable date yields one message, not two | Repository spied | `submitRequest` with a junk `start_time` | `"next tuesday"` | Exactly `[{field:"start_time", message:"must be a valid date/time"}]` | SCRUM-45 design | `SCRUM-45 design: an unreadable date is reported once, with the parse message` |
| ER-N15 | Non-numeric attendance yields one message | Repository spied | `submitRequest` with junk attendance | `"lots"` | Only `expected_attendance` reported | SCRUM-45 design | `SCRUM-45 design: non-numeric attendance is reported once` |
| ER-N16 | An unreadable `start_time` does not smear onto `end_time` | None | Validate with junk then missing start | `"tomorrow"`; deleted | Errors are exactly `["start_time"]` both times | SCRUM-45 design | `SCRUM-45 design: an unreadable start_time does not also fault end_time` |
| ER-N17 | A past start still reports an end that precedes it | None | Validate with both in the past, end before start | start −1h, end −2h | Both reported — two genuine mistakes, two messages | SCRUM-45 design | `SCRUM-45 design: a past start_time still reports an end_time that precedes it` |

### 4.3 Ownership, lifecycle and error leakage

**The security-relevant cases.** `status`, `organiser_id`, `coordinator_id`,
`submitted_at` and `id` are server-owned. `WRITABLE_COLS` has none of them, and
`createSubmitted` sets the lifecycle columns *outside* `pickCol`.

| ID | Scenario | Pre-conditions | Test steps | Test data | Expected result | Criterion | Automated test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ER-N18 | A client cannot choose status, owner, coordinator or timestamp | Repository spied | `submitRequest` with all four forged in the body | `status:"APPROVED"`, `organiser_id:"someone-else"`, `coordinator_id:"self-assigned"`, `submitted_at:"1999-…"` | None of the four reach the repository; `organiser_id` is the argument, not the body | SCRUM-25 design | `SCRUM-25 design: status, owner and coordinator in the body never reach the repository` |
| ER-N19 | The repository ignores the same fields even if called directly | Insert chain stubbed | `createSubmitted` with forged fields incl. `id` | as above plus `id:"chosen-id"` | Row has server values; `coordinator_id` and `id` absent entirely | SCRUM-25 design | `SCRUM-25 design: status, owner and coordinator in the fields are ignored` |
| ER-N20 | A database failure does not leak the Supabase message to the organiser | App listening; `console.error` silenced | Force the repository to throw, `POST` a valid body | thrown message contains `"secret detail"` | `500`; body is the generic message; response does **not** contain `"secret detail"` | SCRUM-25 design | `SCRUM-25 design: 500 - a database failure returns a generic message, not the Supabase error` |

Two supporting cases sit behind these: the repository names the failed action in
its thrown error (`SCRUM-25 design: a Supabase error is thrown with the action named`,
for the log) and the service lets that error propagate rather than swallowing it
(`SCRUM-25 design: a repository failure propagates for the controller to handle`).

---

## 5. Test cases — boundary

Week 4's rule: **just below, exactly at, just above** every threshold where behaviour
changes. The cases in §4 prove the failing side; these prove the value that must
still be *accepted*, which is where an off-by-one actually costs an organiser their
input.

The same thresholds are tested at up to three layers on purpose. The validator holds
the rule; the service normalises *before* validating, so its boundary is not the
validator's; and HTTP proves the contract does not move the boundary between them.

| ID | Threshold | Layer | Test data | Expected result | Automated test |
| --- | --- | --- | --- | --- | --- |
| ER-B01 | `name` ≤ 200 | validation | 199 / 200 / 201, both validators | pass / pass / fail | `SCRUM-44 boundary: name at 199 / 200 / 201 characters` |
| ER-B02 | `name` trimmed before measuring | validation | 200 chars padded both sides | pass — padding is not counted | `SCRUM-44 boundary: a 200-character name still passes with surrounding whitespace` |
| ER-B03 | `attendance` > 0 | validation | `1` | accepted | `SCRUM-45 boundary: expected_attendance of 1 is accepted` |
| ER-B04 | `attendance` > 0 | validation | `0` | first rejected value; only that field | `SCRUM-45 boundary: expected_attendance of 0 is the first rejected value` |
| ER-B05 | required text ≤ 2000 | validation | 1999 / 2000 / 2001 for both fields | pass / pass / fail | `SCRUM-44 boundary: purpose and description at 1999 / 2000 / 2001 characters` |
| ER-B06 | optional text ≤ 2000 | validation | 1999 / 2000 / 2001 across all four optional fields | pass / pass / fail | `SCRUM-46/47 boundary: every optional text field at 1999 / 2000 / 2001 characters` |
| ER-B07 | required text measured **raw**, not trimmed | validation | 2000 chars + trailing spaces | **fails** — records the asymmetry with `name` (ER-B02) | `SCRUM-44 boundary: description of 2000 characters plus whitespace exceeds the cap` |
| ER-B08 | `start_time` strictly future | validation | exactly `now`; `now + 60s` | rejected; accepted | `SCRUM-45 boundary: start_time exactly now is in the past, one minute ahead is not` |
| ER-B09 | `end_time` strictly after start | validation | start + 1 ms | accepted | `SCRUM-45 boundary: end_time one millisecond after start_time is accepted` |
| ER-B10 | attendance coercion floor | service | `"1"` | accepted; arrives as **number** `1` | `SCRUM-45 boundary: attendance of "1" is the smallest accepted value` |
| ER-B11 | attendance coercion floor | service | `"0"` | rejected; nothing saved | `SCRUM-45 boundary: attendance of "0" is rejected and nothing is saved` |
| ER-B12 | attendance coercion with padding | service | `"  1  "` | read as `1` | `SCRUM-45 boundary: a padded attendance string is still read as its number` |
| ER-B13 | `name` cap after trimming | service | 200 chars padded | reaches repository at exactly 200 | `SCRUM-44 boundary: a name of exactly 200 characters reaches the repository` |
| ER-B14 | `name` cap after trimming | service | 201 chars | rejected; nothing saved | `SCRUM-44 boundary: a name of 201 characters is rejected and nothing is saved` |
| ER-B15 | **layer disagreement, recorded** | service | 2000 chars + padding | **passes** here (trimmed first) though the same raw string fails ER-B07 | `SCRUM-44 boundary: a 2000-character description padded with spaces is trimmed, then passes` |
| ER-B16 | description cap after trimming | service | 2001 chars + padding | rejected | `SCRUM-44 boundary: a description of 2001 characters is rejected after trimming` |
| ER-B17 | attendance floor over HTTP | integration | `"1"` | `201`; returned as number `1` | `SCRUM-45 boundary: 201 - attendance of 1 is accepted over HTTP` |
| ER-B18 | attendance floor over HTTP | integration | `"0"` | `400`; repository never called | `SCRUM-45 boundary: 400 - attendance of 0 is rejected over HTTP` |
| ER-B19 | description cap over HTTP | integration | exactly 2000 | `201`; length preserved | `SCRUM-44 boundary: 201 - a description of exactly 2000 characters is accepted` |
| ER-B20 | name cap over HTTP | integration | exactly 200 | `201` | `SCRUM-44 boundary: 201 - a name of exactly 200 characters is accepted` |
| ER-B21 | name cap over HTTP | integration | 201 | `400`; repository never called | `SCRUM-44 boundary: 400 - a name of 201 characters is rejected` |
| ER-B22 | future-start rule over HTTP | integration | start −1h, end +1h from it | `400`; only `start_time` | `SCRUM-45 boundary: 400 - a start_time in the past is rejected` |
| ER-B23 | strictly-after rule over HTTP | integration | end identical to start | `400`; exactly the `end_time` message | `SCRUM-45 boundary: 400 - identical start and end times are rejected` |

**ER-B07 and ER-B15 are the pair worth reading together.** The same 2000-character
string with trailing spaces fails the validator and passes the service, because the
service trims first. The layers disagree by design; these two tests record which
behaviour an organiser actually meets (the service's — it runs first) so the
inconsistency is a decision on the record rather than a latent surprise.

---

## 6. Frontend test cases — the submit path in the browser

`frontend/src/features/events/eventsService.test.js` — 16 cases covering
`submitEventRequest`, the one piece of the frontend that holds logic rather than
markup. It is the layer between the form and `POST /api/events`: it rewrites the
two timestamps, then maps the response onto the `{ event, errors, message }`
shape `EventRequestForm` renders from. `fetch` is the only thing faked.

These prove the *browser's* half of SCRUM-25. The server's half is §3–§5; neither
suite covers the other, and the field errors in FE-N01 are the same shape the
validator produces, which is what lets the form show them against each input.

**The time zone is pinned to UTC+8 (`Asia/Singapore`) in `vite.config.js`.**
`withZonedTimes` converts using whatever zone the browser is in, so an assertion
on the ISO it produces is only meaningful against a known offset — unpinned, these
cases would pass on a Singapore laptop and fail in CI, which runs UTC. It is set
in the config rather than as a `TZ=` prefix on the npm script so it holds
identically on Windows. **FE-G01 fails first if that pinning ever stops working**,
so a broken fixture does not read as a bug in the service.

| ID | What it proves | Test data | Automated test |
| --- | --- | --- | --- |
| **FE-G01** | Fixture guard: the suite is really running at UTC+8 | `"2026-09-20T10:00"` | `fixture guard: the suite runs in the pinned UTC+8 time zone` |
| **FE-H01** | A 201 hands back the created event and no errors | `{ event: { id, name, status } }` | `SCRUM-51: a 201 returns the created event with no errors` |
| **FE-H02** | The request is a JSON `POST` to `/api/events` | complete form fields | `SCRUM-25: the request is a JSON POST to /api/events` |
| **FE-N01** | A 400 passes the validator's field errors through untouched | `errors: [name, end_time]` | `SCRUM-23: a 400 passes the validator's field errors straight through` |
| **FE-N02** | A 500 surfaces the server's message against no field | `{ error: "Could not submit…" }` | `SCRUM-25 design: a 500 surfaces the server's message against no field` |
| **FE-N03** | A body `json()` cannot parse still yields a message, not a crash | 502, `json()` throws | `SCRUM-25 design: a response that is not JSON falls back to a generic message` |
| **FE-N04** | A network failure reads as a connection problem | `fetch` rejects | `SCRUM-25 design: a network failure is reported as a connection problem` |
| **FE-N05** | A 201 with no event in the body is a failure, not a success | 201, `{}` | `SCRUM-25 design: a 201 without an event in the body is treated as a failure` |
| **FE-N06** | A 400 with no `errors` array falls through to the message branch | 400, `{ error }` | `SCRUM-23 design: a 400 without an errors array falls through to the message` |
| **FE-B01** | `datetime-local` is converted to ISO in the organiser's zone | `10:00`/`13:00` → `02:00Z`/`05:00Z` | `SCRUM-45: datetime-local values are converted to ISO in the browser's zone` |
| **FE-B02** | An unreadable value is sent as typed, so the server names the field | `"next tuesday"` | `SCRUM-45 design: an unreadable date/time is sent untouched so the server names the field` |
| **FE-B03** | An empty time field stays empty rather than becoming an epoch date | `""` | `SCRUM-45 boundary: an empty time field is sent empty, not as an epoch date` |
| **FE-B04** | A value already in ISO survives the round trip unchanged | `"2026-09-20T02:00:00.000Z"` | `SCRUM-45 boundary: a value already in ISO survives the round trip unchanged` |
| **FE-X01** | Only the two time fields are rewritten | name, purpose, description, attendance | `SCRUM-45 design: only the two time fields are rewritten` |
| **FE-X02** | The caller's fields object is not mutated | complete form fields | `SCRUM-45 design: the caller's fields object is not mutated` |
| **FE-X03** | `EVENT_LIMITS` mirrors the backend caps and is frozen | `{ name: 200, text: 2000 }` | `SCRUM-44: EVENT_LIMITS mirrors the backend caps and is frozen` |

**Why FE-B01 is the case that earns this file.** When the conversion breaks, nothing
errors: the request still returns 201 and the organiser still sees "Request
submitted". The event is simply stored eight hours out. FE-B01 and FE-B04 together
pin both directions — a value that needs converting and one that must not be
converted twice — which is what distinguishes a correct fix from appending `Z` to
the string and calling it UTC.

**FE-X02 guards a rendering bug, not a data one.** The form re-renders from the
same state object after a failed submit. If `withZonedTimes` mutated its argument,
`start_time` would come back as an ISO string, which `<input type="datetime-local">`
cannot display — the organiser's entry would silently vanish from the field while
they were fixing a different one.

---

## 7. Gaps, and why they are gaps

Stated plainly so each reads as a decision rather than an omission.

**The repository layer has no boundary cases.** It holds no thresholds. Its job is
field mapping and lifecycle ownership — `WRITABLE_COLS` in, row out — and there is
no value at which its behaviour changes. Its four tests are happy-path and negative
only, and that is the correct shape for the layer.

**There are no cross-cutting tests, because there is nothing yet to cross.**
`POST /api/events` is deliberately unguarded: `feature/SignIn` owns `requireAuth`
and `requirePermission`, and this lane intentionally did not write a second set.
`events.controller.js` carries a hardcoded `DEV_ORGANISER_ID` behind a `TODO` for
the same reason. Authentication, authorisation and ownership tests arrive with the
merge, and **until then a green suite here is not evidence the endpoint is secure.**
It is evidence the validation contract holds.

**SCRUM-50 is proven indirectly.** "Available for coordinator assignment and
subsequent review" is satisfied by the shape of the stored row: `status = SUBMITTED`,
`coordinator_id` never set (ER-N19 asserts its absence), and `submitted_at` always
populated (ER-H03, ER-H04) because that column is the queue's sort key. What is
*not* tested is `repository.findSubmittedUnassigned()`, which exists but has no
endpoint in front of it — that arrives with **SCRUM-26 (Assign Event Coordinator)**,
and its tests belong to that story, under SCRUM-52–55.

**Eight tests cover deferred work, under the one label that is not a Jira key.**
`validateDraft` is implemented and tested but **called by nothing** — the submit
path runs `validateForSubmission`. Those tests are named `US-13 (deferred):`
precisely so nobody reads their presence as evidence that drafts work.

US-13 (save & continue a draft) is out of phase one and **has not been raised in
Jira**: the board holds SCRUM-23, SCRUM-25 and SCRUM-26 under epic SCRUM-7, and
nothing for drafts. The phase-one list's number is therefore the only identifier
these tests can carry today. **When the story is created, relabel these eight tests
and this table to its key** — it is the one piece of traceability in this document
that does not yet point at the board.

| ID | Rule proven about `validateDraft` | Automated test |
| --- | --- | --- |
| ER-D01 | A name alone is a valid draft | `US-13 (deferred): a name alone is enough for a draft` |
| ER-D02 | A draft still requires a name | `US-13 (deferred): a draft still requires a name` |
| ER-D03 | The 200-char name cap applies to drafts too | `US-13 (deferred): an over-long draft name is rejected` |
| ER-D04 | Purpose and description are not required | `US-13 (deferred): purpose and description are not required for a draft` |
| ER-D05 | Neither timestamp is required | `US-13 (deferred): a draft needs neither start_time nor end_time` |
| ER-D06 | A non-string optional field is rejected | `US-13 (deferred): a non-string optional field is rejected` |
| ER-D07 | Null / undefined optional fields are ignored | `US-13 (deferred): null / undefined optional fields are ignored` |
| ER-D08 | Optional text cap holds at 2000 / 2001 | `US-13 (deferred) boundary: draft optional text at 2000 / 2001 characters` |

The draft cap matches submission deliberately: a request captured early must not
become unsavable later because a free-text field was allowed to grow past the limit
the submit path enforces.

**The frontend service is tested; the components are not.** `eventsService.test.js`
landed with this change (§6). `EventRequestForm.test.jsx` did not: it needs jsdom
and React Testing Library, neither of which is installed, and the component must
first take `submitEventRequest` as a prop instead of importing it directly, since
that import cannot be faked from a test. Planned cases: required fields block
submission, server errors render against the right inputs, and the double-submit
guard (`submitting` ref) holds. **Until then nothing proves the form renders the
errors `eventsService` returns** — FE-N01 proves only that it hands them over in
the right shape.

`StatusBadge` and `EventRequestPage` have no tests and are not planned to get any
while they stay presentational; `formatWhen` in `EventRequestPage` is the one piece
of logic there, and it becomes worth testing if it grows a rule beyond delegating
to `toLocaleString`.

**There is no end-to-end test.** Playwright needs the merged app — all four lanes on
`main` together — which is Week 4's work, not this branch's.

---

## 8. Manual verification

Automated coverage stops at the faked repository. These steps were run against the
real Supabase instance to close that gap.

1. **Start the stack.** `docker compose up` (or `npm --prefix backend run dev` and
   `npm --prefix frontend run dev`). Frontend proxies `/api` to port 3000.
2. **Submit a complete request** from the form. Expect the "Request submitted" view
   showing the event name, formatted start time, a `Submitted` badge and the row's
   uuid as the reference.
3. **Confirm the row in Supabase.** `status = 'SUBMITTED'`, `submitted_at` set,
   `coordinator_id` null, `organiser_id` the `DEV_ORGANISER_ID` placeholder.
4. **Confirm the new column does not break inserts.** Registration added
   `registration_fields` to `events` without notice. Writes go through the explicit
   `WRITABLE_COLS` list, so an unknown column cannot break them — verify rather than
   assume, since the appendix in the roadmap was wrong once already.
5. **Submit an empty form.** Expect every required field flagged at once, each
   message against its own input, and no row created.
6. **Submit with an end time before the start time.** Expect one error, on
   `end_time` only.
7. **Check the timezone conversion.** Enter a local time, submit, and confirm the
   stored `timestamptz` matches the intended instant rather than being shifted by
   the organiser's UTC offset — `withZonedTimes` in `eventsService.js` exists for
   exactly this, because the server reads a zoneless string in its own zone (UTC in
   Docker).
8. **Delete the test rows.** The database is shared across all four lanes. Remove
   anything created above, plus the dev-era `organiser_id = 00000000-…0001` rows.

---

## 9. Requirements sources

- **Week 4 Project Instructions**, *Event Request Creation* — organisers "can create
  and submit event requests". The basis for D1: one action, no separate submit step.
- **Epic SCRUM-7 — Event Request**, holding SCRUM-23 (Create event request, 2 SP,
  Done), SCRUM-25 (Submit event request, 1 SP, In Progress) and SCRUM-26 (Assign
  Event Coordinator, 2 SP, To Do). This document covers the first two.
- **SCRUM-44 / 45 / 46 / 47** — SCRUM-23's four acceptance criteria.
- **SCRUM-49 / 50 / 51** — SCRUM-25's three acceptance criteria.
- **Clarification #82** — mandatory fields "have not been firmed out… do propose
  what is appropriate". **The required-field set and both 200 / 2000-character caps
  are therefore our proposal, not a customer requirement.** They are an
  implementation decision for team review.
- **Clarification #42** — assignment follows submission, and the Event Operations
  Manager assigns. Relevant to SCRUM-26 (and its SCRUM-55, which defers the choice
  of coordinator to the Manager's external SOP), and currently contradicted by the
  Sprint 1 mockup (roadmap D6).
- **SCRUM-47** — equipment and registration needs captured "where relevant", hence
  optional. This is the criterion `events.validation.js:20` names in a comment.

**Open against the board:**

- **SCRUM-49/50/51 are still `To Do` while the code that satisfies them is written
  and green.** SCRUM-25 shows 0% of subtasks done. Move them when the branch merges,
  or the board understates the lane.
- **US-13 has no Jira issue** — see §7.
- The exact `CHECK` constraint on `events.status`, which was widened or dropped by
  another lane without a migration — `APPROVED` is now in use and the constraint's
  current definition is unverified.
