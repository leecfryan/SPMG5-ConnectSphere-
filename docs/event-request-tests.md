# Event Request — Test Documentation

> Historical catalog of the original 80 feature tests. These cases are retained.
> PR #2 adds authenticated submission tests and runs both Node and Vitest backend
> suites. Current commands and integration scope: [integration guide](event-request-integration.md).

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
> **The draft tests carry `SCRUM-147`.** They were labelled `US-13 (deferred)` until the draft story was raised
> on the board; SCRUM-147 relabelled them and built drafts. §10 is its record.

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
| Cross-cutting | **0 in the original catalog** | Auth/permissions are covered by the merged HTTP integration tests in `tests/integration/events.submit.test.js` |
| SCRUM-147 (drafts) | 8 | ER-D01–D08 — `validateDraft`, now called when a draft is saved; see §7 and §10 |
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

**The original 64-case catalog has no cross-cutting cases.** The merged
`tests/integration/events.submit.test.js` now covers authentication, role
authorization, and verified ownership over HTTP. The controller obtains
`organiser_id` from the verified `req.user.id`; it does not use a placeholder.
The historical unit cases below continue to record the original validation and
repository contract.

**SCRUM-50 is proven indirectly.** "Available for coordinator assignment and
subsequent review" is satisfied by the shape of the stored row: `status = SUBMITTED`,
`coordinator_id` never set (ER-N19 asserts its absence), and `submitted_at` always
populated (ER-H03, ER-H04) because that column is the queue's sort key. What is
*not* tested here is `repository.findSubmittedUnassigned()`, which on this
branch had no endpoint in front of it. **That endpoint has since arrived with
SCRUM-26 (Assign Event Coordinator)**, and its 77 cases are catalogued in
[coordinator assignment tests](event-assignment-tests.md).

**The eight `validateDraft` tests are SCRUM-147's now.** They were written in phase one, named `US-13 (deferred)`
and called by nothing. SCRUM-147 relabelled them and calls `validateDraft` whenever a draft is saved; the draft
story's own cases are in §10.

| ID | Rule proven about `validateDraft` | Automated test |
| --- | --- | --- |
| ER-D01 | A name alone is a valid draft | `SCRUM-147: a name alone is enough for a draft` |
| ER-D02 | A draft still requires a name | `SCRUM-147: a draft still requires a name` |
| ER-D03 | The 200-char name cap applies to drafts too | `SCRUM-147: an over-long draft name is rejected` |
| ER-D04 | Purpose and description are not required | `SCRUM-147: purpose and description are not required for a draft` |
| ER-D05 | Neither timestamp is required | `SCRUM-147: a draft needs neither start_time nor end_time` |
| ER-D06 | A non-string optional field is rejected | `SCRUM-147: a non-string optional field is rejected` |
| ER-D07 | Null / undefined optional fields are ignored | `SCRUM-147: null / undefined optional fields are ignored` |
| ER-D08 | Optional text cap holds at 2000 / 2001 | `SCRUM-147 boundary: draft optional text at 2000 / 2001 characters` |

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
   `coordinator_id` null, and `organiser_id` matching the authenticated
   Event Organiser's verified user id.
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
   anything created above and any identified legacy test rows.

---

## 9. Requirements sources

- **Week 4 Project Instructions**, *Event Request Creation* — organisers "can create
  and submit event requests", in one action with no separate submit step.
- **Epic SCRUM-7 — Event Request**, holding SCRUM-23 (Create event request, 2 SP,
  Done), SCRUM-25 (Submit event request, 1 SP, In Progress) and SCRUM-26 (Assign
  Event Coordinator, 2 SP, To Do). This document covers the first two; SCRUM-26
  is in [coordinator assignment tests](event-assignment-tests.md).
- **SCRUM-44 / 45 / 46 / 47** — SCRUM-23's four acceptance criteria.
- **SCRUM-49 / 50 / 51** — SCRUM-25's three acceptance criteria.
- **Clarification #82** — mandatory fields "have not been firmed out… do propose
  what is appropriate". **The required-field set and both 200 / 2000-character caps
  are therefore our proposal, not a customer requirement.** They are an
  implementation decision for team review.
- **Clarification #42** — assignment follows submission, and the Event Operations
  Manager assigns. This is SCRUM-26's source, and is why SCRUM-50 is proven only
  indirectly here (§7); the assignment lane's own sources are listed in
  [coordinator assignment tests](event-assignment-tests.md) §9.
- **SCRUM-47** — equipment and registration needs captured "where relevant", hence
  optional. This is the criterion `events.validation.js:20` names in a comment.

**Open against the board:**

- **SCRUM-49/50/51 are still `To Do` while the code that satisfies them is written
  and green.** SCRUM-25 shows 0% of subtasks done. Move them when the branch merges,
  or the board understates the lane.
- The exact `CHECK` constraint on `events.status`, which was widened or dropped by
  another lane without a migration — `APPROVED` is now in use and the constraint's
  current definition is unverified.

---

## 10. SCRUM-147 — Save and continue a draft event request

> As an Event Organiser, I want to save an incomplete event request as a draft so that I can return later and
> continue editing it before submission.
>
> 1. An organiser can save an incomplete event request as a draft.
> 2. Required fields are only enforced on submission.
> 3. The organiser can view their drafts, continue editing and submit them.
> 4. Drafts are only visible to the organiser who created them.

Source: *Week 4 Project Instructions*, *Draft Event Requests*. Clarification #116: no retention period. Expected
values come from the AC: "incomplete" means only the name (the one `NOT NULL` form column), and "only visible to
the organiser" includes colleagues in the same client organisation, who otherwise share request visibility
(SCRUM-100).

**Latest execution:** TC-01 to 14: 2026-10-19 · pass · local, Javen (agent run). TC-15: 2026-10-19 · pass ·
local, shared dev database (run by Javen; `npm --prefix tests/e2e test -- draft-request`). Backend 1086 passed; frontend 496
passed; Playwright 197 passed, 1 failed (`VENUE-E2E-001`, Venue lane, unrelated and already failing on `staging`).

### 10.1 Test case specifications

| ID | AC | Type | Pre-condition → action | Expected | Automated tests |
| --- | --- | --- | --- | --- | --- |
| TC-SCRUM-147-01 | 1 | Happy | Organiser sends only a name (plus a forged `status`/`organiser_id`) | 201; `DRAFT`, owned by the verified caller, no `submitted_at` | `SCRUM-147-UNIT-001`, `-REPO-001`, `-API-002`; `DRAFT-API-001`; `SCRUM-147-UI-004`; `E2E-DRAFT-001` |
| TC-SCRUM-147-02 | 1 | Negative | Save with no name, a blank name, or only other fields | 400 naming `name`; nothing saved; error shown against the name | `SCRUM-147-UNIT-002`, `-API-003`, `-UI-005`; ER-D02 |
| TC-SCRUM-147-03 | 2 | Happy | Save with a past start, end before start, blank required fields, reversed registration window | Saved; no submission rule applied | `SCRUM-147-UNIT-003`, `-UI-011`; ER-D04, ER-D05 |
| TC-SCRUM-147-04 | 2 | Boundary | Save with an unreadable date and attendance `0` | 400 for those two fields only | `SCRUM-147-UNIT-004` |
| TC-SCRUM-147-05 | 2 | Negative | Submit a draft missing required fields, or whose edit blanks one | 400 listing every missing field; draft stays `DRAFT`; each field highlighted; form stays open | `SCRUM-147-UNIT-008`, `-UNIT-011`, `-API-009`, `-UI-008`; `DRAFT-API-001`; `E2E-DRAFT-001` |
| TC-SCRUM-147-06 | 3 | Happy | Organiser opens *My event requests* | *Your drafts* lists own drafts newest first, apart from submitted requests; empty state when none | `SCRUM-147-REPO-002`, `-API-004`, `-UI-001`, `-UI-002`; `E2E-DRAFT-001` |
| TC-SCRUM-147-07 | 3 | Happy | Open a draft (`/events/new?draft=<id>`), including after a refresh | Form pre-filled; event and registration times in local time | `SCRUM-147-API-005`, `-UI-006`; `E2E-DRAFT-001` |
| TC-SCRUM-147-08 | 3 | Happy / negative | Edit and *Save draft*; then clear the name | Same draft updated (no new row), cleared fields cleared; clearing the name → 400, nothing written | `SCRUM-147-UNIT-005`, `-UNIT-006`, `-REPO-004`, `-API-008`, `-UI-006` |
| TC-SCRUM-147-09 | 3 | Happy | Complete the draft and submit | `SUBMITTED` with `submitted_at`, edits included, same id; leaves *Your drafts*; appears with submitted requests; "Submit another request" starts a blank form | `SCRUM-147-UNIT-009`, `-UNIT-010`, `-REPO-005`, `-API-010`, `-UI-007`; `DRAFT-API-001`; `E2E-DRAFT-001` |
| TC-SCRUM-147-10 | 4 | Security | A colleague in the same company lists, opens, edits and submits the owner's draft, by API and by URL | Empty list; 404 "Draft not found." each time; no form; draft unchanged | `SCRUM-147-UNIT-007`, `-API-004`, `-API-006`, `-UI-009`; `DRAFT-API-002`; `E2E-DRAFT-001` |
| TC-SCRUM-147-11 | 4 | Security | Colleague and owner read the organisation workspace list and detail | No `DRAFT` row for either; detail 404 | `SCRUM-147-UNIT-013`; `DRAFT-API-002`; `E2E-DRAFT-001` |
| TC-SCRUM-147-12 | 4 | Security | Attendee, venue staff, technical support, coordinator, coordinator lead, safety officer; no token; forged token | 403 / 401 on all five routes; nothing read or written | `SCRUM-147-API-001`; `DRAFT-API-003`…`-007` |
| TC-SCRUM-147-13 | 3 | Conflict | The draft is submitted or changed between the read and the write; then edited again | 409; afterwards 404 (no longer a draft) | `SCRUM-147-UNIT-012`, `-API-011`; `DRAFT-API-001` |
| TC-SCRUM-147-14 | — | Failure | Malformed id; storage error; storage not configured; slow and failed loads in the UI; no session | 400 "Invalid draft id."; 500 safe message (no database detail); 503; loading and error states, buttons locked while saving; nothing sent without a session | `SCRUM-147-API-007`, `-API-012`, `-API-013`, `-REPO-006`, `-UI-003`, `-UI-010`, `-SERVICE-001`…`-003` |
| TC-SCRUM-147-15 | 1, 4 | Live DB | Real Supabase: throwaway organiser saves a name-only draft, reads the workspace, edits, submits | Row stored `DRAFT` with every other form column and `submitted_at` null; absent from the workspace list; then `SUBMITTED` with `submitted_at` set; rows and account deleted afterwards | `LIVE-DRAFT-001` (`tests/e2e/draft-request.spec.js`) |

### 10.2 Coverage

`drafts.controller.js` and the draft functions in `events.service.js` / `events.repository.js`: 100% lines and
branches. `DraftList.jsx`, `EventRequestPage.jsx` and the SCRUM-147 parts of `EventRequestForm.jsx`: 100% lines
and functions; the remaining branch entries are V8's JSX conditional counting.

**Test review.** Removing the workspace `DRAFT` filter fails `DRAFT-API-002` and `E2E-DRAFT-001`; applying the
registration-window check to draft saves fails `SCRUM-147-UI-011`.

### 10.3 Not built

Deleting a draft, auto-save, and draft expiry (#116) are outside the AC.

**Why one live test.** It is the only check that the real `events` table accepts a draft with only a name and that
PostgREST's `neq` filter really hides `DRAFT` rows from the workspace — both depend on the real schema, which the
fakes cannot prove.

## SCRUM-117 Task 2 — return for changes

Scope: AC1 and the saved-message display portion of AC3. Notification delivery,
resubmission and difference presentation are covered in the later sections below; this table describes Task 2 only.

| Source tests | Observable outcome |
| --- | --- |
| SCRUM-117-API-001–007 in backend/tests/integration/events.review.test.js | Assigned coordinator only, UNDER_REVIEW only, required note, trusted actor, duplicate/stale refusals, safe storage failure, cancellation/postponement by coordinator or lead. Denials assert unchanged state. |
| SCRUM-117-API-008 in backend/tests/integration/eventWorkspace.test.js | Returned request remains visible; lead reassignment returns 409 and leaves stored events unchanged. |
| SCRUM-117-UNIT-001 in lifecycle.test.js | Returned requests count in workload but are neither assignable nor planning eligible. |
| SCRUM-117-UNIT-002 in eventWorkspace.service.test.js | Saved note is readable without leaking stored snapshots/actor details. |
| SCRUM-117-UNIT-003–004 in clarification.repository.test.js | Exact atomic RPC arguments, no-row conflict and storage error handling. |
| SCRUM-117-UNIT-005 in review.service.test.js | Deletion before the atomic return is not found. |
| SCRUM-117-UI-001–004 in EventDecisionControls.test.jsx | Required note, correct API call, retained input on error, state visibility and duplicate-click prevention. |
| SCRUM-117-UI-005–006 in EventWorkspaceDetailPage.test.jsx | Organiser reads the note after refresh; permitted cancellation/postponement; no reassignment/approval while returned. |
| E2E-CLARIFICATION-001 in tests/playwright/clarification.browser.spec.cjs | Real local UI/API return journey, reload, organiser sign-in/read, retained coordinator, one history entry and 375px layout. |

Run from the repository root using installed dependencies:

```sh
npm --prefix backend run test:events -- tests/unit/events tests/integration/events.review.test.js tests/integration/eventWorkspace.test.js --pool=threads --maxWorkers=1
npm --prefix frontend test -- --run src/features/events --maxWorkers=1 --reporter=default
npm run test:playwright -- tests/playwright/clarification.browser.spec.cjs --reporter=list
```

Expected: all selected tests pass; a nonzero exit requires investigation. These tests use
local storage substitutes, not deployed Supabase. They do not prove the installed SQL's
transaction/locking behavior. Human UAT remains Not Executed. Formal execution logs and
coverage reports are kept in Ryan's external ConnectSphere 2 workspace.

The existing workload/cancellation/postponement query-shape tests now include
CHANGES_REQUESTED to match Ryan's explicit rules; their assertions were retained.

## SCRUM-117 Task 3 — organiser notification

AC2: The Event Organiser is notified, with the coordinator's message and a link to the request.

| Source ID | Layer | Observable result |
| --- | --- | --- |
| SCRUM-117-N01 | Automated worker unit | Saved owner receives the exact message/path and workflow; successful delivery clears pending work. |
| SCRUM-117-N02 | Automated worker unit | Provider failure retains pending work; recovery sends the identical payload and idempotency ID. |
| SCRUM-117-N03 | Automated worker unit | Separate return cycles produce separate notices without overwriting the earlier message. |
| E2E-CLARIFICATION-002 | Automated isolated browser | Owner reads a worker-emitted notice, clicks it and sees the request message at 375px; duplicate return adds no notice and unrelated users receive none. |
| SCRUM-117-S01–S05 | Automated local PostgreSQL | Exact documented SQL proves denied-input isolation, recipient/message/link, separate cycles, rollback and browser-role restrictions. |

Commands from repository root:
- Worker regression: `npm --prefix backend run test:events -- tests/unit/notifications tests/integration/notifications.delivery.test.js tests/integration/notifications.assignment.test.js --maxWorkers=1 --reporter=dot`.
- Frontend: `npm --prefix frontend test -- --run src/features/notifications/NotificationCentre.test.jsx --maxWorkers=1 --reporter=default`.
- Browser regression: `npm run test:playwright -- tests/playwright/clarification.browser.spec.cjs tests/playwright/assignment-notifications.browser.spec.cjs tests/playwright/notifications.browser.spec.cjs --reporter=list`.
- SQL: `node tests/sql/run-assignment-notifications.cjs --clarification` with Docker running and the cached postgres:17-alpine image. Never run fixture SQL in Supabase.

All commands return zero on success. SQL prints CLARIFICATION SQL ASSERTIONS PASSED; Vitest and Playwright show passed totals. Investigate named failures before rerunning. No installation is required. Execution logs and coverage remain outside the repository in Ryan's ChatGPT workspace. These checks do not verify deployed Novu templates or shared Supabase schema; manual UAT remains Not Executed.

Executed by Codex on 22 Oct 2026: focused worker regression 40/40, inbox frontend 25/25, related browser regression 10/10, and all five local SQL scenarios passed. Four verification gates met. Earlier failing tests caught missing router integration; the final browser assertion requires the actual request page to render, not just a changed URL.

Final broader regression on 22 Oct 2026: frontend 548/548 across 52 files and isolated Playwright 210/210 passed. All 12 statements and recorded branch arms in NotificationCentrePage are covered. Frontend build passed. Backend source/test lint passed excluding existing generated .vitest UI assets; the plain command encounters those assets. Frontend lint reports zero errors and one existing generated coverage-file warning. Full backend regression and Docker image builds were not repeated for this slice; live cloud UAT is pending. Full execution details and changed-file list are in the external SCRUM-117-task3-review.md.


Test pruning requested by Ryan on 22 Oct 2026: removed the redundant SCRUM-117-N04 router-callback component test and three screenshot captures. E2E-CLARIFICATION-002 retains the stronger proof that clicking the actual notification renders the request and its message. Other acceptance and failure-path tests remain. Counts above describe historical runs before this pruning.

## SCRUM-117 resubmission acceptance checks

| Source ID | Acceptance criterion / risk | Observable result |
| --- | --- | --- |
| SCRUM-117-R01 | Organiser resubmits; same coordinator; coordinator sees changes | Save leaves returned status; resubmit moves to UNDER_REVIEW, queues one coordinator notice, duplicate is refused and later edits do not alter history. Organiser responses omit comparison values. |
| SCRUM-117-R02 | Only the responsible organiser can resubmit | Anonymous, wrong-role, unrelated and same-company non-owner attempts leave status, history and queue unchanged. |
| SCRUM-117-R03 | Valid resubmission before review proceeds | Invalid body, stale cycle, postponed request and invalid saved requirements refuse without a new notice/history. |
| SCRUM-117-R04 | All request details editable; no-change resubmission allowed | Partial registration edits validate the whole saved window; unchanged resubmission succeeds with an empty comparison. |
| RSQL01–05 in tests/sql/resubmission.assertions.sql | Database semantics supporting the AC | Real PostgreSQL rejects stale expected values/cycles/owners, compares all twelve fields, preserves snapshots and assignment, emits exact notice once, handles equivalent timestamps/clearing/reverts, rolls back failed queues and denies browser execution. |
| E2E-CLARIFICATION-002 | Full cross-role AC journey | Owner opens notice, edits attendance/layout, saves then resubmits; retained coordinator opens their notice and sees exactly those two before/after changes at 375px. |
| SCRUM-117-UI-R01–02 | Organiser can recover from failed resubmission | Conflict remains retryable; validation identifies details to correct; successful retry reloads. |

Run the existing local SQL command with --clarification, the focused browser spec, and backend eventWorkspace.test.js. SQL must print RESUBMISSION SQL ASSERTIONS PASSED. Frontend and backend runners must exit zero with no failed tests. No decorative UI assertions were added.

Manual UAT remains Not Executed until Ryan runs the completed workflow: return an assigned UNDER_REVIEW request with a message; owner opens the inbox link, edits and saves; verify it remains Changes requested; resubmit; verify Under review with the same coordinator; coordinator opens the new inbox notice and checks before/after fields. Also resubmit a second cycle without edits and expect No request fields changed. SQL/workflow setup is reported complete; this is not evidence of live delivery for the new action.

Final local verification, 22 October 2026: full backend Vitest 1158/1158 (live suites excluded), separate Auth 29/29 and equipment 68/68; frontend 549/549; Playwright 210/210; local SQL and production build passed. After final acceptance-case additions, focused backend 448/448 and frontend 252/252 passed. Four acceptance gates met. Source lint passes; backend command excludes pre-existing generated .vitest assets. No Docker application image builds or shared-cloud tests were run. Detailed logs/coverage and coverage limitations are in Ryan's external SCRUM-117-final-review.md.

Additional cases: SCRUM-117-R05 proves outage and concurrent-save refusal without partial resubmission; SCRUM-117-N02 parameterises retry for both workflow identifiers. SCRUM-117-UI-R03/R04 prove stored dates, cleared values, safe text and the latest no-change cycle.

LIVE-CLARIFICATION-001 in tests/e2e/clarification-request.spec.js checks the installed PostgREST RPCs and both notification queue records using disposable accounts/request. Syntax checked only; Not Executed. User only: notify teammates, then run npm --prefix tests/e2e test -- clarification-request.spec.js from repository root. Expect one passing test; share failure output if not. This checks installed schema, not Novu template delivery.

### SCRUM-117 reported no-change review blocker — 24 October 2026

E2E-CLARIFICATION-003 reproduces an organiser editing attendance during UNDER_REVIEW, followed by the assigned coordinator returning the request and the organiser resubmitting without further edits. It asserts No request fields changed, then uses the real coordinator Review decision section to approve and verifies APPROVED with the same coordinator and saved attendance. All three clarification browser cases passed locally (9.3 seconds). This is local fixture evidence, not a resolution of Ryan's reported live blocker.

Review decision is rendered on the assigned coordinator route below event details/activity history. The organiser route does not expose coordinator decisions. Existing organiser editing and no-change resubmission rules are unchanged pending agreement on any policy change. Logs for this run are external in outputs/scrum117-nochange-review-20261024.

### SCRUM-117 saved-edit baseline correction — 24 October 2026

Ryan clarified that saved organiser edits must be visible to the assigned coordinator before a formal return, and must remain in the comparison if resubmitted without more edits. This supersedes the former return-time baseline semantics, including the earlier E2E-CLARIFICATION-003 expectation.

- SCRUM-117-BASE-UNIT-001/002: all twelve editable fields, protected-field exclusion, equivalent times, optional clearing and reverted edits.
- SCRUM-117-BASE-API-001: owner save becomes visible to assigned coordinator before return; owner/peer/lead responses exclude comparison and internal baseline history; unrelated coordinator gets 404.
- SCRUM-117-BASE-UI-001/002: current saved changes show the right baseline; unavailable reads and limited older history are explicit.
- E2E-CLARIFICATION-003: edit 30 → 45 before return; coordinator sees it immediately; unchanged resubmission retains 30 → 45; later save 50 shows 45 → 50 while history stays 30 → 45; coordinator can approve.
- BASELINE01–06 in requestBaseline.assertions.sql: real SQL submitted-version retention, draft submission, advancement/revert, queue rollback, restricted trigger execution and all twelve field values. The --clarification harness option loads the exact correction block from docs/notifications.md.

Manual retest (Not Executed): create a fresh request with attendance 30 and start review. Owner edits/saves 45 before any return. Assigned coordinator refreshes and sees Saved organiser changes: 30 → 45. Return it, then owner resubmits without another edit. Coordinator sees 30 → 45 under Last resubmission. Owner later saves 50; coordinator refreshes and sees current 45 → 50 while historical 30 → 45 remains. Verify the unchanged status and same coordinator throughout. Earlier overwritten edits on existing requests are only recoverable if retained history contains them.

Final verification, 24 October 2026: local backend regression 1163/1163 (67 files, live Supabase suites excluded), frontend 553/553 (55 files), isolated Playwright 211/211. Focused clarification browser 3/3, exact applied SQL BASELINE01–06, production build and four acceptance gates pass. Source lint has zero errors; frontend retains one pre-existing generated coverage-file warning. No shared-cloud test or Docker application image build performed. Final external evidence/manual instructions: outputs/scrum117-nochange-review-20261024/saved-edit-implementation-review.md and manual-saved-edit-retest.md in Ryan's ConnectSphere 2 workspace. Manual saved-edit UAT remains Not Executed. No commit or push for this correction.
