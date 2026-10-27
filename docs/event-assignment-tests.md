# Coordinator Assignment — Test Documentation

SCRUM-142 renames the current manager role to Event Coordinator Lead (`event_coordinator_lead`).
Historical acceptance criteria and customer quotations retain their original wording.
Earlier execution results are historical evidence; rename verification is recorded separately.

**Deliverable evidence for SCRUM-26 (Assign Event Coordinator), under epic SCRUM-7 (Event Request).**
Branch: `feature/assignCoordinator` · **77 documented cases, all passing**
— 63 backend (§2–§5) and 14 frontend (§6).

Story context — the rules enforced server-side, the routes, the acceptance
criteria and the manual script — is in [Coordinator assignment](event-assignment.md).
The sibling catalog for SCRUM-23 and SCRUM-25 is
[Event request tests](event-request-tests.md).

Run everything:

```bash
npm --prefix backend test          # includes the 63 assignment cases
npm --prefix frontend run test:report
npm --prefix backend run check
npm --prefix frontend run lint
npm --prefix frontend run build
```

Both suites run on **Vitest**, and both run in CI on every pull request to `main`
(`.github/workflows/ci.yml`). **No test connects to Supabase.**

Every row below names the automated test that executes it, so `npm test` output
*is* the traceability report — the last column is a copy of a line you can read
in the terminal. Backend test names lead with `SCRUM-26:`; frontend names carry a
`[SCRUM-26-UI-nnn]` tag.

IDs use the `AS-` prefix to keep them distinct from SCRUM-25's `ER-` cases, with
the same category letters (`H` happy, `X` cross-cutting, `N` negative,
`B` boundary).

| Category | Tests | IDs | Note |
| --- | --- | --- | --- |
| Happy path | 11 | AS-H01–H11 | |
| Cross-cutting | 10 | AS-X01–X04 | Auth and permissions — unlike SCRUM-25, which had none |
| Negative | 12 | AS-N01–N12 | |
| Boundary | 30 | AS-B01–B16 | Heaviest again, and concentrated in the directory's paging |
| Frontend | 14 | AS-UI-001–010 | Catalogued in §6 |
| **Total** | **77** | | 63 backend + 14 frontend |

The counts above are test counts, matching what the runner reports. Six of the
43 backend IDs are parametrised loops, so there are more tests than IDs; each
loop's range is given in *Test data*.

---

## 1. Shared pre-conditions

Stated once rather than repeated in every row. The per-case columns carry only
what is specific to that case.

| Layer | File | Tests | Pre-conditions for every case in that file |
| --- | --- | --- | --- |
| Directory (unit) | `backend/tests/unit/events/coordinators.directory.test.js` | 22 | None beyond a hand-built `{ auth: { admin: { listUsers } } }` client passed to the factory. No `stubSupabase` — the module takes its client as an argument. |
| Service and repository (unit) | `backend/tests/unit/events/assignments.service.test.js` | 19 | `build()` returns the service with `repository` and `directory` as `vi.fn()` stubs. The repository cases use `recorder()`, which records PostgREST builder calls and history RPC arguments. |
| API (integration) | `backend/tests/integration/events.assign.test.js` | 22 | Express app on an ephemeral port (`listen(0)`); the bearer token **is** the comma-separated role list, so each case states the identity it exercises. Repository and directory both faked. |
| Page (frontend) | `frontend/src/features/events/AssignmentQueuePage.test.jsx` | 14 | jsdom; `getAuthClient` mocked and `fetch` stubbed, both reset in `afterEach`. The page is rendered through the real `App` and router, so the route guard is exercised rather than bypassed. Permissions come from the **real** `backend/src/auth/permissions.js`, loaded with `createRequire` — removing the manager's capability fails these tests. |

Permission coverage for `event_coordinator_lead` beyond this feature lives in
`backend/tests/integration/auth.test.js` and `frontend/src/Rbac.test.jsx`.

---

## 2. Test cases — happy path

| ID | Scenario | Test data | Expected result | Automated test |
| --- | --- | --- | --- | --- |
| AS-H01 | Only Event Coordinators are listed, as three fields | 4 users: coordinator, venue, technical, manager | Exactly the coordinator, as `{id, fullName, email}` | `only event_coordinator accounts are returned, as id, fullName and email` |
| AS-H02 | A multi-role account holding the role is still a coordinator | `["venue_staff","event_coordinator"]` | Listed | `an account holding the role alongside others is still a coordinator` |
| AS-H03 | Coordinators sort alphabetically by displayed name | Cara, Ada, Ben | Ada, Ben, Cara | `coordinators are sorted by the name the row actually displays` |
| AS-H04 | The table counts active events and keeps coordinators with none | 3 coordinators, 1 with assignments | Counts joined onto the directory; the idle coordinator is present with `0` | `the coordinator table counts active events and keeps coordinators with none` |
| AS-H05 | A successful assignment returns the updated event | `assign("evt-1","coord-1")` | `{ok:true, event}`; repository called with both ids | `a successful assignment returns the updated event` |
| AS-H06 | The queue is SUBMITTED, unassigned, oldest first | `findSubmittedUnassigned()` | `eq status SUBMITTED`, `is coordinator_id null`, `order submitted_at nullsFirst:false`, `order created_at` | `the queue is submitted, unassigned, oldest first, with a created_at tiebreak` |
| AS-H07 | Workload reads only assigned events in an active status | `findActiveAssignments()` | `select coordinator_id, start_time`; `in status [SUBMITTED, APPROVED]`; `not coordinator_id is null` | `workload counts read only assigned events in an active status` |
| AS-H08 | The queue endpoint returns the repository's order | 2 seeded requests | `200`; both names in order; all SUBMITTED and unassigned | `the queue returns submitted, unassigned requests in the repository's order` |
| AS-H09 | The coordinator endpoint carries each workload figure | 2 coordinators, 1 assignment | `200`; `activeEvents` 1 and 0; `nextEventStart` ISO and `null` | `the coordinator table carries each coordinator's active workload` |
| AS-H10 | Assignment succeeds and does not move the event's status | `PUT` with a valid coordinator | `200`; `coordinator_id` set; `status` still `SUBMITTED` | `assignment succeeds and does not move the event's status` |
| AS-H11 | The repository forwards first-assignment guards and the verified actor to history storage | `assignCoordinator("evt-1","coord-1", actor)` | Calls `assign_event_coordinator` with the event/coordinator IDs, expected coordinator `null`, allowed status `["SUBMITTED"]`, and verified actor ID/name. No lifecycle transition is requested. | `SCRUM-26 / SCRUM-155: assignCoordinator sends first-assignment guards and verified actor to history storage` |

---

## 3. Test cases — cross-cutting, auth and permissions

| ID | Scenario | Test data | Expected result | Automated test |
| --- | --- | --- | --- | --- |
| AS-X01 | No endpoint is reachable unauthenticated | `""`, `"invalid"` × 3 paths | `401` every time | `an unauthenticated caller (%s) reaches no assignment endpoint` |
| AS-X02 | No other role reaches any endpoint | 6 roles × 3 paths | `403`; repository never called | `%s is signed in but cannot see or change assignments` |
| AS-X03 | `internal.access` alone is not enough | `event_coordinator` | `403` — the capability is specific, not the area | `an event_coordinator holds internal.access yet is still refused - the capability is specific` |
| AS-X04 | A multi-role account holding the manager role is admitted | `event_coordinator,event_coordinator_lead` | `200` | `a multi-role account holding event_coordinator_lead is admitted` |

Forged `x-user-role` headers are sent on **every** request in this file; roles
come from the verified token's `app_metadata` only. The matching blast-radius
case lives in `auth.test.js`: the manager reaches `/api/internal/access` and is
still refused all six venue, equipment and technical-support routes.

---

## 4. Test cases — negative

| ID | Scenario | Test data | Expected result | Automated test |
| --- | --- | --- | --- | --- |
| AS-N01 | An auth failure is raised, never shown as an empty directory | `error: "service role key revoked"` | Throws `coordinators.directory: listUsers failed - …` | `a Supabase Auth failure is raised, never returned as an empty directory` |
| AS-N02 | No field beyond the three leaves the server | User with phone, `last_sign_in_at`, identities, password hash | Keys are exactly `email`, `fullName`, `id` | `no field beyond the three leaves the server` |
| AS-N03 | An id not in the directory is never written | `"not-a-coordinator"` | `unknown_coordinator`; repository never called | `a coordinator id that is not in the directory is never written` |
| AS-N04 | A guarded write matching nothing is a conflict when the event exists | `findById` returns a row | `{ok:false, reason:"conflict"}` | `a guarded write that matches nothing is a conflict when the event still exists` |
| AS-N05 | …and a 404 when it does not | `findById` returns `null` | `{ok:false, reason:"not_found"}` | `a guarded write that matches nothing is a 404 when the event does not exist` |
| AS-N06 | A missing coordinator is a 400 and writes nothing | `PUT` with `{}` | `400`; repository never called | `a missing coordinator is a 400 and writes nothing` |
| AS-N07 | A non-coordinator is a 422 and writes nothing | `{coordinatorId:"venue-staff-1"}` | `422`; repository never called | `someone who is not an Event Coordinator is a 422 and writes nothing` |
| AS-N08 | An unknown event is a 404 | Unknown uuid | `404` | `an unknown event is a 404` |
| AS-N09 | An already-assigned request is a 409, not an overwrite | Guarded update matches nothing, event exists | `409`; the colleague's assignment stands | `a request another manager already assigned is a 409, not a silent overwrite` |
| AS-N10 | Storage failures are logged, never returned | Repository throws | `500` with a generic message; Supabase's text only in the log | `a storage failure is logged, never returned to the manager` |
| AS-N11 | A client cannot smuggle status or owner into the body | `status`, `organiser_id` in the PUT body | Ignored; only `coordinator_id` is written | `a status or organiser smuggled into the body is ignored` |
| AS-N12 | Without the server data key, assignment degrades without breaking sign-in | No `SUPABASE_SECRET_KEY` | `503` on all three routes; `/api/auth/me` still works | `without the server data key, assignment reports 503 and sign-in still works` |

---

## 5. Test cases — boundary

| ID | Scenario | Test data | Expected result | Automated test |
| --- | --- | --- | --- | --- |
| AS-B01 | A page of exactly the page size is not the last page | 100 users on page 1, 1 on page 2 | 101 coordinators; `listUsers` called twice | `a page of exactly the page size is not mistaken for the last page` |
| AS-B02 | A short first page ends the walk | 1 user | One call, `{page:1, perPage:100}` | `a short first page ends the walk without a second request` |
| AS-B03 | Pages that never run short stop at the cap | Always 100 users | Exactly 20 calls; 2000 coordinators | `pages that never run short stop at the cap` |
| AS-B04 | Malformed role data grants nothing and does not throw | 6 shapes: `app_metadata` absent/null, `roles` absent/null/string/object | `[]` each time | `a malformed %s grants nothing and does not throw` |
| AS-B05 | No staff at all is an empty list | No pages | `[]` | `no staff at all is an empty list, not a failure` |
| AS-B06 | A response with no data or no users array reads as empty | `data:null`; `data:{}` | `[]`; one call | `%s is read as an empty page` |
| AS-B07 | A missing, non-string or whitespace name falls back to email | `undefined`, `42`, `"   "` | `fullName` is `""`; sort uses the email | `a %s full name becomes empty and sorts on the email instead` |
| AS-B08 | A padded name is trimmed before display | `"  Ada Tan  "` | `"Ada Tan"` | `a full name padded with whitespace is trimmed before display` |
| AS-B09 | An account with no email is listed, not dropped | `email: undefined` | `email: ""` | `an account with no email is still listed rather than dropped` |
| AS-B10 | The next event is the earliest *instant*, not the lowest string | Same moment at different UTC offsets | The genuinely earliest | `a coordinator's next event is the earliest instant, not the lowest string` |
| AS-B11 | Unparseable and orphaned rows do not corrupt counts | Junk `start_time`; null `coordinator_id` | Counts unaffected; no `NaN` | `unparseable and orphaned assignment rows do not corrupt the counts` |
| AS-B12 | A malformed coordinator id is rejected before any lookup | `undefined`, `null`, `""`, `"   "`, `42`, `{}` | `invalid_coordinator`; **directory never consulted** | `a missing or malformed coordinator id is rejected before any lookup (%s)` |
| AS-B13 | An empty directory is an empty table, not a failure | `coordinators: []` | `{ok:true, coordinators:[]}`; the workload join still runs | `an empty directory is an empty coordinator table, not a failure` |
| AS-B14 | With no coordinators, every assignment is refused | `coordinators: []` | `unknown_coordinator`; nothing written | `with no coordinators at all, every assignment is refused before the write` |
| AS-B15 | A fully routed queue is an empty list | `findSubmittedUnassigned: []` | `{ok:true, events:[]}`; over HTTP, `200 {events:[]}` | `a fully routed queue is an empty list, not a missing one`; `an empty queue is a 200 with an empty list` |
| AS-B16 | An empty directory over HTTP is a 200, not a 404 | `listCoordinators: []` | `200 {coordinators:[]}` | `an empty directory is a 200 with an empty list` |

**Why the directory carries most of the boundary weight.** It is the only file
that talks to Supabase Auth, and everything in it is arithmetic over data the
module does not own: a paging loop whose termination depends on a page being
short, a role filter over free-form `app_metadata`, and a whitelist that is the
last thing between an auth record and the browser. The service and HTTP suites
stub it out entirely, so nothing else in the suite would notice if it broke.

---

## 6. Test cases — the assignment queue in the browser

`frontend/src/features/events/AssignmentQueuePage.test.jsx` — 10 IDs, 14 tests.
**AS-UI-002 is a `test.each` over five roles**, which is where the extra four
come from; the other nine IDs are one test each.

| ID | Scenario | Expected result |
| --- | --- | --- |
| AS-UI-001 | The manager reaches the queue and sees the nav entry | Page renders; "Assign coordinators" present |
| AS-UI-002 | Five other roles are redirected away | `/forbidden` for each of `event_coordinator`, `venue_staff`, `technical_support_staff`, `event_organiser`, `attendee` |
| AS-UI-003 | Requests appear in the server's order | No client-side re-sort |
| AS-UI-004 | An empty queue is a plain statement | Not an error state |
| AS-UI-005 | Request details are read-only | Nothing on the page is typeable |
| AS-UI-006 | Assigning needs a coordinator chosen first | One action; confirm disabled until selection |
| AS-UI-007 | Workload shows without becoming a rule | No row disabled, ranked or pre-selected |
| AS-UI-008 | A successful assignment confirms and clears the row | Request leaves the queue |
| AS-UI-009 | A 409 explains itself and offers a refresh | Message names the colleague conflict |
| AS-UI-010 | A manager-fixable failure offers no pointless refresh | 400/422 do not suggest refreshing |

---

## 7. Gaps, and why they are gaps

**There is no browser-level acceptance case for the queue.** The Playwright
suite covers sign-in and RBAC only; `/events/assignments` appears in none of its
specs, so the guard is proven by AS-UI-002 in jsdom and by the route tests in
`Rbac.test.jsx`, not against a real browser. Recorded in
[Playwright acceptance](testing/playwright-acceptance.md) §Remaining evidence.

**Nothing here proves the database enforces the guard.** AS-H11 asserts the
first-assignment parameters sent to `assign_event_coordinator` — allowed status
`SUBMITTED` and expected coordinator `null` — against a recording client, not
against Postgres. The 409 path (AS-N09) is
therefore evidence that the code handles a zero-row update correctly, not that
two concurrent managers actually produce one. The two-tab step in
[Coordinator assignment](event-assignment.md) §Manual verification is what
closes that gap today.

**The `events.status` CHECK constraint is unverified.** `APPROVED` is in use in
the workload query (AS-H07) after another lane widened or dropped the
constraint without a migration. No test asserts the constraint's current
definition, because no test reaches the database.

**Reassignment is not tested because it is not built.** US-50 (reassign a
coordinator), US-49 (search and filter the queue) and US-29–32 (notify the
coordinator) are later stories. The guarded write deliberately matches only
unassigned events, so reassignment cannot be done through this endpoint at all —
AS-N09 is the test that pins that down.

---

## 8. Manual verification

Automated coverage stops at the faked repository and directory. The six-step
script against real Supabase — seeding the queue, assigning, checking
`coordinator_id` is set while `status` stays `SUBMITTED`, the two-tab conflict,
the empty queue and the coordinator's denied route — is in
[Coordinator assignment](event-assignment.md) §Manual verification. It is kept
there rather than duplicated here, so the seed accounts and the steps stay in one
place.

---

## 9. Requirements sources

| Ref | What it says |
| --- | --- |
| **Clarification #42** | After an event request is submitted, an Event Operations Manager assigns an Event Coordinator. |
| **Clarification #1** | There is no acceptance step; any issue is handled outside the system. |
| **Clarification #3** | The choice of coordinator is up to the Event Operations Manager and their own SOP, outside the system. Proven negatively by AS-UI-007: workload is shown, never ranked or enforced. |
| **Clarification #2** | Reassignment is by the Operations Manager and may be assumed already approved. Not implemented — see §7. |
| **SCRUM-26** | Assign Event Coordinator, 2 SP, under epic SCRUM-7. Its acceptance criteria are in [Coordinator assignment](event-assignment.md) §Acceptance criteria. |
| **SCRUM-55** | Defers the choice of coordinator to the Manager's external SOP. |

**Open against the board:**

- **SCRUM-26 is still `To Do` while the code that satisfies it is written and
  green.** Move it when the branch merges, or the board understates the lane.
- **The Sprint 1 mockup contradicts Clarification #42** on who assigns
  (roadmap D6). The implementation follows the clarification.


## SCRUM-155 compatibility verification — 17 Oct 2026

The assignment notification feature passes the verified assigner to history
storage. The existing service/API assertions now include that identity, and the
repository test checks the history RPC's first-assignment guards instead of the
superseded direct-update query. The tampered-body case also supplies forged
assigner fields and verifies that the authenticated actor still reaches storage.
The workspace integration fixture reuses the existing assignment RPC adapter.

No original test was removed or skipped. Workspace checks still require unchanged
lifecycle status, revoked outgoing-coordinator access, refusal of stale changes,
postponed-event reassignment and refusal of rejected events. Production event
logic was not changed by this compatibility correction.

The same six-file regression selection that previously had eight failures now
passes **119/119**, with no failures or skipped tests. It comprises 82 existing
assignment/workspace tests and 37 notification tests. This is a targeted regression
result, not a claim that the entire backend or CI pipeline was run.

Run from the repository root:

```sh
npm --prefix backend run test:events -- tests/unit/events/assignments.service.test.js tests/integration/events.assign.test.js tests/integration/eventWorkspace.test.js tests/unit/notifications/notificationDelivery.test.js tests/integration/notifications.assignment.test.js tests/integration/notifications.delivery.test.js --pool=threads --maxWorkers=1
```

## SCRUM-159 — the unassigned request queue

> **SCRUM-159:** As an Event Coordinator Lead, I want to see submitted event requests that have no coordinator
> assigned so that no request goes unattended.
>
> 1. A submitted event request with no assigned coordinator appears in the unassigned queue.
> 2. The queue shows the event name, organiser, proposed dates and expected attendance.
> 3. Only the Event Coordinator Lead can view the unassigned queue.
> 4. An event leaves the queue once a coordinator is assigned to it.

SCRUM-26 built the queue, so AC1, AC3 and AC4 were already met; this story adds the organiser and shows all four AC2
fields in every row. AC3's role denials are the SCRUM-26 cases in §3 (every non-Lead role 403, no token 401, a
coordinator holding `internal.access` still 403), plus the API refusal inside `[E2E-QUEUE-001]`.

| Epic | Scrum-# | AC # | Type | Test Case ID | Test Scenario | Pre-conditions | Test Steps | Test Data | Expected Result | Created By* | Date of Creation* | Actual Result | Pass / Fail / Not Executed / Blocked | Remarks | Executed By | Date of Execution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Event Lifecycle | SCRUM-159 | 1, 2 | Happy | TC-SCRUM-159-01 | A submitted, unassigned request reaches the Lead with its four fields | Lead signed in; one `SUBMITTED` request, no coordinator | GET `/api/internal/events/unassigned` | Organiser *Olivia Ong*; 2099-10-02 01:00–05:00Z; 30 attendees | 200; the event has `name`, `organiser_name: "Olivia Ong"`, `start_time`, `end_time`, `expected_attendance: 30` | Agent | 2026-10-22 | As expected | Pass | Automated: `backend/tests/integration/events.assign.test.js` `[SCRUM-159] TC-SCRUM-159-01`; `backend/tests/unit/events/assignments.service.test.js` "each queued request carries its organiser's name…" | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Boundary | TC-SCRUM-159-02 | An organiser without a usable full name is shown by email | Organiser account exists | `displayNameOf(id)` | `full_name` padded; absent; whitespace only | "Olivia Ong" trimmed; otherwise the email | Agent | 2026-10-22 | As expected | Pass | Automated: `backend/tests/unit/events/coordinators.directory.test.js` "an organiser is shown by…" (3 cases) | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Failure | TC-SCRUM-159-03 | An organiser who can't be named never hides the request | Auth lookup fails / account deleted / no name or email | GET the queue | `getUserById` error; `user: null`; neither field | `organiser_name: null`; 200 with the request still listed | Agent | 2026-10-22 | As expected | Pass | Automated: directory "an organiser is unknown (null)…" (3 cases); service "…cannot be named, stays in the queue"; integration `TC-SCRUM-159-03/04` | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Cross-cutting | TC-SCRUM-159-04 | The queue sends only what the screen needs | Repository row includes `organiser_id` | Build the query; GET the queue | — | Explicit column list, never `*`; the response contains no `organiser_id` | Agent | 2026-10-22 | As expected | Pass | Automated: service test "the queue reads an explicit column list…"; integration `TC-SCRUM-159-03/04` | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Happy | TC-SCRUM-159-05 | An organiser with several requests is looked up once | Three requests, two organisers | `listQueue()` | org-1 ×2, org-2 ×1 | Every row named; two lookups, one per organiser | Agent | 2026-10-22 | As expected | Pass | Automated: service "an organiser with several queued requests is looked up once" | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Negative | TC-SCRUM-159-06 | A request with no organiser | `organiser_id` null | `listQueue()` | — | `organiser_name: null`; no lookup made for it | Agent | 2026-10-22 | As expected | Pass | Automated: service "…without an organiser…" | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 4 | Negative | TC-SCRUM-159-07 | An assigned request is gone on the next read | Two queued requests | GET queue; PUT coordinator on the first; GET queue | coord-1 | First read both; second read only the unassigned one | Agent | 2026-10-22 | As expected | Pass | Automated: integration `TC-SCRUM-159-07` (the filter itself is proven by SCRUM-26's query-shape unit test and by `[E2E-QUEUE-001]` over fake storage) | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 1–4 | Happy | TC-SCRUM-159-08 | The full journey in a real browser at 375 px | Fake storage; organiser *Olivia Ong*, Lead, coordinator | Organiser submits via API; coordinator GETs the queue; Lead opens `/events/assignments`, checks the row, assigns, reloads | 2099 dates, 30 attendees | Coordinator 403; row shows *Olivia Ong*, 2099, *30 expected*; no sideways scroll; after assigning the row is gone, also after reload; stored event `SUBMITTED` with the coordinator | Agent | 2026-10-22 | As expected | Pass | Automated: `tests/playwright/assignment-queue.browser.spec.cjs` `[E2E-QUEUE-001]` | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Happy | TC-SCRUM-159-UI-01 | Each row shows name, organiser, proposed dates and attendance | Lead; two queued requests | Open `/events/assignments` | *Olivia Ong* / `peter@example.com`; 2099 dates; 30 / 24 | Each row's text has the organiser, "2099 … 9:00 – 2099 … 1:00" (Singapore time), "30 expected" (its person icon is `aria-hidden`), and the "Ref" | Agent | 2026-10-22 | As expected | Pass | Automated: `frontend/src/features/events/AssignmentQueuePage.test.jsx` `[SCRUM-159-UI-001]` | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Boundary | TC-SCRUM-159-UI-02 | Missing values read as words | One request with no organiser name, dates or attendance | Open the queue | nulls | *Organiser unavailable*, *Dates not set*, *Attendance not set* | Agent | 2026-10-22 | As expected | Pass | Automated: `[SCRUM-159-UI-002]` | Agent (local) | 2026-10-22 |
| Event Lifecycle | SCRUM-159 | 2 | Happy | TC-SCRUM-159-UI-03 | The details panel names the organiser | Lead; queued request | Select the request | *Olivia Ong* | *Organiser* reads *Olivia Ong* | Agent | 2026-10-22 | As expected | Pass | Automated: `[SCRUM-159-UI-003]` | Agent (local) | 2026-10-22 |

**Live-DB test:** none. The only query change is the column list, and every column in it is already read live by the
event workspace's `FIELDS`.

**Test review:** expected values come from the AC and the user's display decisions. Dropping the name lookup fails
TC-01 and UI-01; returning `organiser_id` fails TC-04; letting a lookup error throw fails TC-03; reverting to `select("*")`
fails TC-04; removing the coordinator filter from the fake queue or the real query fails `[E2E-QUEUE-001]` or SCRUM-26's
query-shape test. The shared test helpers gained a `displayNameOf` fake. One pre-existing assertion changed because
AC2 changed the response: `[SCRUM-142-INT-001/002]` (`backend/tests/integration/roles.rename.test.js`) compares the
Lead's queue response exactly, and now expects the added `organiser_name: null`. It is still an exact comparison.
