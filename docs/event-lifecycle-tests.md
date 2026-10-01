# Event Status Lifecycle — Test Documentation

**Deliverable evidence for SCRUM-97 (Progress an event through its status lifecycle), epic Event Lifecycle &
Approval.** SCRUM-98 (review) and SCRUM-99 (approve) are in §8. Branch: `feature/eventLifecycleStatus` · **15 documented cases, 43 automated tests, all passing**
— 34 backend unit, 9 frontend component, plus 1 manual database case.

Story context — the eight statuses, the permitted moves, who sets each status and the schema change — is in
[Event requests](event-requests.md) §Status values. The sibling catalogues for the same lane are
[Event request tests](event-request-tests.md) (SCRUM-23, SCRUM-25) and
[Coordinator assignment tests](event-assignment-tests.md) (SCRUM-26).

Run everything:

```bash
npm --prefix backend test               # includes the 34 SCRUM-97 backend tests
npm --prefix frontend test -- --run     # includes the 9 StatusBadge tests
npm --prefix backend run test:cov       # coverage, §6
npm --prefix frontend run test:cov
npm --prefix backend run check
npm --prefix frontend run lint
```

**No test connects to Supabase.** Backend test names lead with `SCRUM-97 AC<k>:` (or `SCRUM-97 conflict:` /
`SCRUM-97 failure:`); frontend names carry a `[SCRUM-97-UI-nnn]` tag. The last column of every table is a line
you can read in the runner's output, so `npm test` *is* the traceability report.

| Type | Cases | IDs |
| --- | --- | --- |
| Happy | 5 | TC-SCRUM-97-01, 02, 07, 13, 15 |
| Negative | 6 | TC-SCRUM-97-03, 04, 06, 08, 09, 12 |
| Boundary | 2 | TC-SCRUM-97-05, 14 |
| Conflict | 1 | TC-SCRUM-97-10 |
| Failure | 1 | TC-SCRUM-97-11 |

Some cases are parametrised (`test.each`), so there are more tests than cases; each loop's range is in *Test
data*. One extra test (the lifecycle is frozen, §3) guards the rules themselves rather than a case.

---

## 1. Acceptance criteria and traceability

| AC | Criterion (word for word) | Test cases | Evidence level |
| --- | --- | --- | --- |
| 1 | The event carries a status covering at least draft, submitted, under review, approved/planning, confirmed, completed, cancelled and rejected. | 01, 15 | **Direct** — code and live database |
| 2 | Each status change is the consequence of an action a permitted user performed; status cannot be edited freely. | 02, 07, 08, 10, 11, 12 | **Foundation only** — see §7 |
| 3 | Invalid transitions are refused (for example, an event cannot be confirmed directly from draft). | 03, 04, 05, 06, 09 | **Direct** at unit level; no user-facing path yet (§7) |
| 4 | The current status is visible to every user permitted to see the event. | 13, 14 | **Partial** — labels proven; coordinator views arrive with SCRUM-98 (§7) |

---

## 2. Shared pre-conditions

| Layer | File | Tests | Pre-conditions for every case in that file |
| --- | --- | --- | --- |
| Lifecycle (unit) | `backend/tests/unit/events/lifecycle.test.js` | 28 | None. `lifecycle.js` is pure; it is loaded with `createRequire`. Expected statuses and moves are **typed into the test from the agreed lifecycle table**, not read back from the module, so a wrong edit to `TRANSITIONS` goes red. |
| Repository (unit) | `backend/tests/unit/events/events.transition.test.js` | 8 (2 added with SCRUM-98, §8) | `recorder()` stubs Supabase with a Proxy that records every query-builder call and resolves to a chosen `{ data, error }`. Modules are reset before each test. |
| Component (frontend) | `frontend/src/features/events/components/StatusBadge.test.jsx` | 9 | jsdom; `StatusBadge` rendered on its own; `cleanup` after each test. |

---

## 3. Test cases — lifecycle rules (AC1, AC2, AC3)

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-97-01 | 1 | Happy | The lifecycle has the eight agreed statuses | `STATUSES` | Exactly `DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, CONFIRMED, COMPLETED, CANCELLED, REJECTED` (order ignored) | `SCRUM-97 AC1: the lifecycle has exactly the eight agreed statuses` | 2026-09-27 · pass · local |
| TC-SCRUM-97-02 | 2 | Happy | Each agreed move is permitted | The 10 edges: DRAFT→SUBMITTED; SUBMITTED→UNDER_REVIEW, CANCELLED; UNDER_REVIEW→APPROVED, REJECTED, CANCELLED; APPROVED→CONFIRMED, CANCELLED; CONFIRMED→COMPLETED, CANCELLED | `canTransition` is `true` for each | `SCRUM-97 AC2: %s -> %s is a permitted transition` (×10) | 2026-09-27 · pass · local |
| TC-SCRUM-97-03 | 3 | Negative | The AC's example: draft straight to confirmed | `DRAFT → CONFIRMED` | `false` | `SCRUM-97 AC3: an event cannot be confirmed directly from draft` | 2026-09-27 · pass · local |
| TC-SCRUM-97-04 | 3 | Negative | A submitted event cannot skip review | `SUBMITTED → APPROVED` | `false` | `SCRUM-97 AC3: a submitted event cannot skip review and be approved` | 2026-09-27 · pass · local |
| TC-SCRUM-97-05 | 3 | Boundary | Every move outside the table is refused, including end states, self-moves and backward moves | All 64 pairs of the 8 statuses; `COMPLETED`, `CANCELLED`, `REJECTED` → each status; each status → itself; `UNDER_REVIEW→SUBMITTED`, `APPROVED→UNDER_REVIEW`, `SUBMITTED→DRAFT` | Only the 10 agreed pairs are `true`; the three end states allow nothing | `SCRUM-97 AC3: every pair not in the agreed table is refused`; `… %s is terminal and refuses every next status` (×3); `… %s -> itself is not a transition` (×8); `… an event cannot move backwards to an earlier status` | 2026-09-27 · pass · local |
| TC-SCRUM-97-06 | 3 | Negative | Unknown, missing or wrongly-cased statuses | `BOGUS`, `undefined`, `null`, `draft`/`submitted`, `toString`, `__proto__` | `false`; never throws | `SCRUM-97 AC3: unknown, missing or wrongly-cased statuses are refused, not thrown` | 2026-09-27 · pass · local |
| — | 2 | Negative | The rules cannot be altered while the app runs | `STATUSES`, `TRANSITIONS` and each next-status list | All frozen | `SCRUM-97 AC2: the lifecycle cannot be changed at runtime` | 2026-09-27 · pass · local |

---

## 4. Test cases — the only status writer (AC2, AC3)

`events.repository.js#transitionStatus(id, from, to, extra)` is the only function that changes `events.status`
after submission.

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-97-07 | 2 | Happy | A permitted move writes the new status only where the event is still in the old one | `transitionStatus("evt-1", "SUBMITTED", "UNDER_REVIEW")` | `update {status: "UNDER_REVIEW"}` on `events`, filtered `eq id evt-1` **and** `eq status SUBMITTED`; the updated row is returned | `SCRUM-97 AC2: transitionStatus writes the new status only where the event is still in the old one` | 2026-09-27 · pass · local |
| TC-SCRUM-97-08 | 2 | Negative | Extra columns cannot override the status | `extra: { decided_by: "coord-1", status: "CONFIRMED" }` on `UNDER_REVIEW → APPROVED` | Written: `{ decided_by: "coord-1", status: "APPROVED" }` | `SCRUM-97 AC2: extra columns are written alongside the status, but cannot override it` | 2026-09-27 · pass · local |
| TC-SCRUM-97-09 | 3 | Negative | A move outside the table is refused before the database | `DRAFT → CONFIRMED` | Throws `DRAFT -> CONFIRMED is not a permitted transition`; **no Supabase call recorded** | `SCRUM-97 AC3: a transition not in the lifecycle is refused before Supabase is called` | 2026-09-27 · pass · local |
| TC-SCRUM-97-10 | 2 | Conflict | Someone else moved the event first | Supabase returns no row | `null`, so the calling endpoint can answer 409; nothing overwritten | `SCRUM-97 conflict: zero rows matched returns null so the caller can answer 409` | 2026-09-27 · pass · local |
| TC-SCRUM-97-11 | 2 | Failure | The database reports an error | `error: { message: "boom" }` | Throws `events.repository: transitionStatus failed - boom` | `SCRUM-97 failure: a Supabase error is thrown with the action named` | 2026-09-27 · pass · local |
| TC-SCRUM-97-12 | 2 | Negative | A general edit cannot change status | `update("evt-1", { name: "Gala", status: "CONFIRMED" })` | `status` not in `WRITABLE_COLS`; only `{ name: "Gala" }` is written | `SCRUM-97 AC2: status is not a writable column, so a general update cannot change it` | 2026-09-27 · pass · local |

---

## 5. Test cases — status shown to users (AC4) and the database (AC1)

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-97-13 | 4 | Happy | Every status is shown as words, not colour alone | Each of the 8 stored values | Draft · Submitted · Under review · **Approved – planning** · Confirmed · Completed · Cancelled · Rejected; class `status-badge status-<value>` | `[SCRUM-97-UI-001] shows %s as "%s"` (×8) | 2026-09-27 · pass · local |
| TC-SCRUM-97-14 | 4 | Boundary | A status the badge doesn't know is still visible | `ON_HOLD` | `ON_HOLD` shown, not blank | `[SCRUM-97-UI-002] shows an unknown status as-is rather than hiding it` | 2026-09-27 · pass · local |
| TC-SCRUM-97-15 | 1 | Happy | The live database accepts all eight statuses | Supabase SQL Editor: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.events'::regclass;` | `events_status_check` lists the eight values | **Manual** — no test reaches the database | 2026-09-27 · constraint replaced by the story owner · Supabase dashboard |

---

## 6. Coverage

Run 2026-09-27 with `test:cov` (v8), local.

| File | Statements | Branches | Notes |
| --- | --- | --- | --- |
| `backend/src/modules/events/lifecycle.js` | 100% | 100% | |
| `backend/src/modules/events/events.repository.js` — `transitionStatus` | 100% | 100% | Whole file 82% / 71%. The uncovered lines (58, 66–67, 75, 83: `findById`, `findByIds`, the empty-patch path of `update`, `markSubmitted`) predate SCRUM-97 and belong to SCRUM-25/26. |
| `frontend/src/features/events/components/StatusBadge.jsx` | 100% | 100% | |

**Test review** (the five questions in `.agent/docs/conventions.md` §Testing 5). Each test was checked against a
plausible wrong implementation:

| Mutation | Test that goes red |
| --- | --- |
| Add, remove or rename a status | TC-01 |
| Remove an agreed edge, or add an extra one | TC-02, TC-05 |
| `Object.hasOwn` replaced by `in` | TC-06 (`toString` throws) |
| Drop `.eq("status", from)` from `transitionStatus` | TC-07 |
| Spread `extra` after `status` | TC-08 |
| Remove the `canTransition` guard | TC-09 |
| Add `status` to `WRITABLE_COLS` | TC-12 |
| Change or drop a label, or the unknown-status fallback | TC-13, TC-14 |

One test was renamed during review: the backward-move test claimed "from review onwards" but also checks
`SUBMITTED → DRAFT`. Its name now says what it checks.

---

## 7. Gaps, and why they are gaps

**AC2 and AC3 through the app arrive with SCRUM-98/99 (§8).** Start review, approve and reject are the first
user actions that move an event past `SUBMITTED`, each behind a permission and a record check, with 401 / 403 /
404 / 409 integration tests. Cancel, confirm and complete have no action yet, so those moves are proven only at
unit level (TC-02 to TC-09).

**The coordinator can't see status yet.** The badge appears on the organiser's request page and the Operations
Manager's assignment queue and detail panel. The coordinator's own views are SCRUM-98. No Playwright case checks
status across roles; the roadmap's end-to-end journey (submit → assign → review → approve, status visible at each
step) closes AC2–AC4 for all three stories.

**Nothing here proves the database refuses an invalid value.** TC-15 confirms the constraint's definition, not
that an insert of `'BOGUS'` fails. `transitionStatus` never sends an unlisted value, so that path cannot be reached
through the code.

---

## 8. SCRUM-98 and SCRUM-99 — review and approve

**Server actions built (2026-10-01).** The coordinator's read views, the decision UI, venue/equipment eligibility
and the Playwright journey are later slices; their cases are listed as *Not yet automated*.

> **SCRUM-98:** As an Event Coordinator, I want to review the full contents of a submitted event request so that I
> can decide whether planning should proceed.
>
> 1. The assigned Event Coordinator can open a submitted request and see all information supplied by the Event
>    Organiser.
> 2. The request moves to an 'under review' state when review begins.
> 3. The reviewing coordinator and the review outcome are recorded against the event.
> 4. A coordinator not assigned to the event cannot record a review outcome for it.
>
> **SCRUM-99:** As an Event Coordinator, I want to approve a request once it contains sufficient information, so
> that venue and equipment planning can begin.
>
> 1. Approval moves the event into planning and makes it eligible for venue and equipment arrangements.
> 2. Approval does not commit ConnectSphere to any venue, equipment, technical support or registration arrangement.
> 3. The approval decision, the approver and the time of approval are visible to the relevant users.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Service (unit) | `backend/tests/unit/events/review.service.test.js` | Fake repository; clock fixed at `2026-10-01T02:00:00.000Z` |
| Repository (unit) | `backend/tests/unit/events/events.transition.test.js` | `recorder()` as in §2 |
| HTTP (integration) | `backend/tests/integration/events.review.test.js` | Real `createApp`; `authClient.getUser` faked (token = `<user id>:<roles>`); repository faked by an in-memory event `aaaaaaaa-0001-…`, `SUBMITTED`, assigned to `coord-assigned`, whose update honours the same status and coordinator filters as the real one |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-98-01 | 98-1 | Happy | Assigned coordinator opens their submitted event | — | Every organiser-supplied field shown | Not yet automated (slice 3) | — |
| TC-SCRUM-98-02 | 98-1 | Negative | Another coordinator opens it | — | 403 | Not yet automated (slice 3) | — |
| TC-SCRUM-98-03 | 98-1, 98-4 | Negative | Any other role calls the review actions | `event_ops_manager`, `event_organiser`, `venue_staff`, `technical_support_staff`, `attendee`, `unknown` × the 3 actions | 403; nothing written | `SCRUM-98 AC4: %s cannot start, approve or reject a review` (×6) | 2026-10-01 · pass · local |
| TC-SCRUM-98-04 | 98-1 | Failure | No or invalid session | no token, `invalid` × the 3 actions | 401 | `SCRUM-98: an unauthenticated caller (%j) reaches no review action` (×2) | 2026-10-01 · pass · local |
| TC-SCRUM-98-05 | 98-2 | Happy | Assigned coordinator starts review | `POST …/start-review` | 200; `UNDER_REVIEW`; write filtered on `SUBMITTED` and the caller | `SCRUM-98 AC2: the assigned coordinator starts review and the event is UNDER_REVIEW`; `SCRUM-98 AC2: starting review moves SUBMITTED to UNDER_REVIEW for the calling coordinator only` | 2026-10-01 · pass · local |
| TC-SCRUM-98-06 | 98-2 | Conflict | Start review twice | second `start-review` | 409 with the refresh message; still `UNDER_REVIEW` | `SCRUM-98 AC2 conflict: starting review twice is a 409 and changes nothing` | 2026-10-01 · pass · local |
| TC-SCRUM-98-07 | 98-2 | Negative | Assignment does not start review | — | Status stays `SUBMITTED` (#95) | Existing SCRUM-26 tests in [Coordinator assignment tests](event-assignment-tests.md) | 2026-10-01 · pass · local |
| TC-SCRUM-98-08 | 98-3 | Happy | Reject with a reason | `{ note: "Attendance numbers are missing" }` | 200; `REJECTED`, `decided_by` = caller, `decided_at` = server clock, reason trimmed | `SCRUM-98 AC3: rejecting with a reason records REJECTED, the reviewer and the reason`; `SCRUM-98 AC3: rejecting records the reviewer, the time and the trimmed reason` | 2026-10-01 · pass · local |
| TC-SCRUM-98-09 | 98-3 | Boundary | Reject without a reason | `{}`, `""`, `"   "` (HTTP); also `undefined`, `null`, `42` (unit) | 400 "Give a reason for rejecting this request."; still `UNDER_REVIEW`; no write | `SCRUM-98 boundary: rejecting without a reason (%j) is a 400 and changes nothing` (×3); `SCRUM-98 boundary: a rejection without a written reason (%j) is refused before any write` (×5) | 2026-10-01 · pass · local |
| TC-SCRUM-98-10 | 98-4 | Negative | Unassigned coordinator acts | `coord-other` × the 3 actions; plus an unknown and a malformed id | 403, same message each time; nothing written; `SUBMITTED` | `SCRUM-98 AC4: a coordinator not assigned to the event cannot record anything on it`; `SCRUM-98 AC4: an unknown or malformed event id gets the same 403, revealing nothing` | 2026-10-01 · pass · local |
| TC-SCRUM-98-11 | 98-4 | Conflict | Reassigned between the access check and the write | the write finds `coordinator_id` changed | 409; no `decided_by` written; write filtered on `coordinator_id` | `SCRUM-98 AC4 conflict: an event reassigned after the access check records no outcome`; `SCRUM-98 AC4: with a coordinator given, the write also requires that coordinator to still hold the event` | 2026-10-01 · pass · local |
| TC-SCRUM-98-12 | 98-3 | Negative | Body tries to set status, approver, time or coordinator | `{ status: "CONFIRMED", decided_by: "coord-other", decided_at: "2000-01-01…", coordinator_id: "coord-other" }` | `APPROVED`; server values kept | `SCRUM-98: status, decided_by and decided_at in the body are ignored; the server's values win` | 2026-10-01 · pass · local |
| TC-SCRUM-98-13 | 98-3 | Failure | Event deleted after the access check | the write and the re-read find nothing | 404 | `SCRUM-98: an event deleted after the access check is a 404`; `SCRUM-98: a guarded write that matches nothing is not_found when the event is gone` | 2026-10-01 · pass · local |
| TC-SCRUM-98-14 | 98-3 | Failure | Storage fails | write error; access-check error; no storage configured | 500 safe message; 503 and nothing written; 503 | `SCRUM-98 failure: a storage error on the write is a safe 500`; `… during the access check is a 503 and nothing is written`; `… without storage configured, the actions answer 503` | 2026-10-01 · pass · local |
| TC-SCRUM-99-01 | 99-1, 98-3 | Happy | Approve an event under review | `{ note: "All details supplied" }` | 200; `APPROVED`, `decided_by` = caller, `decided_at` set, note saved | `SCRUM-99 AC1/SCRUM-98 AC3: approving records APPROVED, the approver and the time`; `… approving records the approver, the time and no note` | 2026-10-01 · pass · local |
| TC-SCRUM-99-02 | 99-1 | Conflict | Approve an event not under review | `SUBMITTED`; already `APPROVED` (approve and reject) | 409; status unchanged | `SCRUM-99 AC1 conflict: an event that is not under review cannot be approved`; `SCRUM-99 conflict: an approved event cannot be approved or rejected again`; `SCRUM-98 conflict: a guarded write that matches nothing is a conflict when the event still exists` | 2026-10-01 · pass · local |
| TC-SCRUM-99-03 | 99-1 | Happy | Approved event listed for venue and equipment | — | Listed | Not yet automated (`fix/eventStatusAlignment`) | — |
| TC-SCRUM-99-04 | 99-1 | Negative | Pre-approval event in venue/equipment | — | Not listed | Not yet automated (`fix/eventStatusAlignment`) | — |
| TC-SCRUM-99-05 | 99-2 | Happy | Approval commits to nothing | approve | Only `decided_by`, `decided_at`, `decision_note` (and `status`) written; no other repository call | `SCRUM-99 AC2: approval writes only the decision columns` | 2026-10-01 · pass · local |
| TC-SCRUM-99-06 | 99-3 | Happy | Organiser sees the decision | — | Decision, approver, time | Not yet automated (slice 4) | — |
| TC-SCRUM-99-07 | 99-3 | Happy | Manager sees the decision | — | Decision, approver, time | Not yet automated (slice 4) | — |
| TC-SCRUM-99-08 | 99-3 | Negative | Other organiser / unassigned coordinator | — | Can't see it | Not yet automated (slice 4) | — |
| TC-SCRUM-99-09 | all | Happy | Submit → assign → start review → approve, end to end | — | Organiser sees "Approved – planning", approver and time | Not yet automated (slice 6) | — |
| TC-SCRUM-99-10 | 99-1 | Boundary | Approval note handling | `"  Looks complete  "`, `"   "`; and `42`, `true`, an object, an array | Trimmed; blank stored as `null`; non-text refused with 400 before any write | `SCRUM-99: an approval note is trimmed, and a blank one is stored as none`; `SCRUM-99 boundary: an approval note that is not text (%j) is refused before any write` (×4); `SCRUM-99 boundary: an approval note that is not text is a 400` | 2026-10-01 · pass · local |

**Coverage** (2026-10-01, `test:cov`, local): `review.service.js`, `review.controller.js` and `review.routes.js` are
100% statements, branches and functions; the new coordinator branch of `transitionStatus` is covered both ways.

**Test review.** Each case was checked against a plausible wrong implementation:

| Mutation | Test that goes red |
| --- | --- |
| Drop the record check, or compare against the wrong id | TC-98-10 |
| Drop `.eq("coordinator_id", …)` from the write | TC-98-11 (unit) |
| Take `decided_by` from the body | TC-98-12 |
| Allow `SUBMITTED → APPROVED` | TC-99-02 |
| Let a blank reason through | TC-98-09 |
| Write anything besides the decision columns on approve | TC-99-05 |

TC-SCRUM-98-13, 98-14 and 99-10 were added during build. They aren't in the original draft, but each is the
failure or boundary path of an AC above.

## 9. Requirements sources

| Ref | What it says |
| --- | --- |
| **SCRUM-97** (backlog US-40) | Progress an event through its status lifecycle, 3 SP. AC in §1. |
| Team-agreed lifecycle table | The 8 statuses and 10 permitted moves; recorded in `.agent/docs/architecture.md` §Database. `APPROVED` is the stored value for "approved / planning" because Registration and Venue already query it. |
| **SCRUM-98**, **SCRUM-99** (backlog US-36, US-38) | Review and approve: the actions that use this lifecycle. See §8. |
| Discussions #80, #94, #95, #101, #125 | The assigned coordinator decides; the manager only assigns; assignment doesn't start review; `decided_by` kept apart from `coordinator_id`; who sees the outcome |
