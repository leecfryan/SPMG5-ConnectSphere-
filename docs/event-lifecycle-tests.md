# Event Status Lifecycle — Test Documentation

SCRUM-142 renames the current manager role to Event Coordinator Lead (`event_coordinator_lead`).
Historical acceptance criteria and customer quotations retain their original wording.
Earlier execution results are historical evidence; rename verification is recorded separately.

**Deliverable evidence for SCRUM-97 (Progress an event through its status lifecycle), epic Event Lifecycle &
Approval.** SCRUM-98 (review) and SCRUM-99 (approve) are in §8; SCRUM-139 (safety check) is in §9, SCRUM-140 (safety review) in §10, SCRUM-141 (safety decision) in §11, SCRUM-144 (confirmation) in §12 and SCRUM-37 (flag
significant edits) in §13. Branch: `feature/eventLifecycleStatus` · **15 documented cases, 43 automated tests, all passing**
— 34 backend unit, 9 frontend component, plus 1 manual database case. (Counts are SCRUM-97's own original scope;
each later section carries its own count.)

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
| TC-SCRUM-97-08 | 2 | Negative | Extra columns cannot override the status | `extra: { approved_rejected_by: "coord-1", status: "CONFIRMED" }` on `UNDER_REVIEW → APPROVED` | Written: `{ approved_rejected_by: "coord-1", status: "APPROVED" }` | `SCRUM-97 AC2: extra columns are written alongside the status, but cannot override it` | 2026-09-27 · pass · local |
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

**Status across roles is now shown and checked end to end.** The badge appears on the organiser's request page,
the Operations Manager's assignment queue and detail panel, and every event workspace list and detail page,
including the coordinator's (`[SCRUM-98-UI-011]`). `[REVIEW-E2E-UI-001]` (§8, TC-SCRUM-99-09) follows one event
from submit → assign → start review → approve and checks the badge at each step, closing AC2–AC4 through the app.

**Nothing here proves the database refuses an invalid value.** TC-15 confirms the constraint's definition, not
that an insert of `'BOGUS'` fails. `transitionStatus` never sends an unlisted value, so that path cannot be reached
through the code.

---

## 8. SCRUM-98 and SCRUM-99 — review and approve

Server actions, the workspace decision fields, the review controls and decision summary on the event pages, and
the Playwright journey are all automated. Venue and equipment eligibility (TC-SCRUM-99-03/04) is proven by the
venue and equipment lanes' own tests.

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
| Frontend (component) | `frontend/src/features/events/components/EventDecisionControls.test.jsx`, `EventDecisionSummary.test.jsx` | Real component, `reviewService.js` and `apiFetch`; `fetch` stubbed; token `coordinator-token`; event `aaaaaaaa-0098-…`; `TZ=Asia/Singapore` |
| Frontend (page) | `frontend/src/features/events/pages/EventWorkspaceDetailPage.test.jsx` | Real `App`, guards, pages and services; real `getPermissions`; `lib/supabase` mocked; `fetch` stubbed by an in-memory event `aaaaaaaa-0098-…0002` assigned to `coord-1`, which the review POSTs update; approver `Ada Tan`, decided `2099-10-05T02:30:00Z` |
| HTTP (workspace read) | `backend/tests/integration/eventWorkspace.test.js` | Real `createApp`; the file's fake Supabase client and users (`first`, `second`, `organiser`, `otherOrganiser`, `manager`); events added per test with every organiser field; approver `full_name` `"  Ada Tan  "` |
| Playwright | `tests/playwright/event-workspace.api.spec.cjs`, `event-workspace.browser.spec.cjs` | Real Express app and UI against the local Auth simulator; fixture storage whose `transitionStatus` honours the status and coordinator filters; accounts from `setupWorkflow` (approver shown as "Coordinator One") |
| HTTP (integration) | `backend/tests/integration/events.review.test.js` | Real `createApp`; `authClient.getUser` faked (token = `<user id>:<roles>`); repository faked by an in-memory event `aaaaaaaa-0001-…`, `SUBMITTED`, assigned to `coord-assigned`, whose update honours the same status and coordinator filters as the real one |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-98-01 | 98-1 | Happy | Assigned coordinator opens their submitted event | `SUBMITTED` event with every organiser field, assigned to `first` | 200; name, status and every organiser-supplied field returned; shown on the page | `[SCRUM-98] AC1: the assigned coordinator opens a submitted request and sees everything the organiser supplied`; `[REVIEW-E2E-UI-001]` | 2026-10-05 · pass · local |
| TC-SCRUM-98-02 | 98-1 | Negative | Another coordinator opens it | `second` opens `first`'s event by id, in the list and by URL | 404 "Event not found."; no organiser detail in the response; not in their list (404, like an unknown id, so existence isn't revealed) | `[SCRUM-98] AC1: another coordinator cannot open the request, and its details are not revealed`; `[REVIEW-E2E-UI-003]` | 2026-10-05 · pass · local |
| TC-SCRUM-98-03 | 98-1, 98-4 | Negative | Any other role calls the review actions | `event_coordinator_lead`, `event_organiser`, `venue_staff`, `technical_support_staff`, `attendee`, `unknown` × the 3 actions | 403; nothing written | `SCRUM-98 AC4: %s cannot start, approve or reject a review` (×6) | 2026-10-01 · pass · local |
| TC-SCRUM-98-04 | 98-1 | Failure | No or invalid session | no token, `invalid` × the 3 actions | 401 | `SCRUM-98: an unauthenticated caller (%j) reaches no review action` (×2) | 2026-10-01 · pass · local |
| TC-SCRUM-98-05 | 98-2 | Happy | Assigned coordinator starts review | `POST …/start-review` | 200; `UNDER_REVIEW`; write filtered on `SUBMITTED` and the caller | `SCRUM-98 AC2: the assigned coordinator starts review and the event is UNDER_REVIEW`; `SCRUM-98 AC2: starting review moves SUBMITTED to UNDER_REVIEW for the calling coordinator only` | 2026-10-01 · pass · local |
| TC-SCRUM-98-06 | 98-2 | Conflict | Start review twice | second `start-review` | 409 with the refresh message; still `UNDER_REVIEW` | `SCRUM-98 AC2 conflict: starting review twice is a 409 and changes nothing` | 2026-10-01 · pass · local |
| TC-SCRUM-98-07 | 98-2 | Negative | Assignment does not start review | — | Status stays `SUBMITTED` (#95) | Existing SCRUM-26 tests in [Coordinator assignment tests](event-assignment-tests.md) | 2026-10-01 · pass · local |
| TC-SCRUM-98-08 | 98-3 | Happy | Reject with a reason | `{ note: "Attendance numbers are missing" }` | 200; `REJECTED`, `approved_rejected_by` = caller, `approved_rejected_at` = server clock, reason trimmed | `SCRUM-98 AC3: rejecting with a reason records REJECTED, the reviewer and the reason`; `SCRUM-98 AC3: rejecting records the reviewer, the time and the trimmed reason` | 2026-10-01 · pass · local |
| TC-SCRUM-98-09 | 98-3 | Boundary | Reject without a reason | `{}`, `""`, `"   "` (HTTP); also `undefined`, `null`, `42` (unit) | 400 "Give a reason for rejecting this request."; still `UNDER_REVIEW`; no write | `SCRUM-98 boundary: rejecting without a reason (%j) is a 400 and changes nothing` (×3); `SCRUM-98 boundary: a rejection without a written reason (%j) is refused before any write` (×5) | 2026-10-01 · pass · local |
| TC-SCRUM-98-10 | 98-4 | Negative | Unassigned coordinator acts | `coord-other` × the 3 actions; plus an unknown and a malformed id | 403, same message each time; nothing written; `SUBMITTED` | `SCRUM-98 AC4: a coordinator not assigned to the event cannot record anything on it`; `SCRUM-98 AC4: an unknown or malformed event id gets the same 403, revealing nothing` | 2026-10-01 · pass · local |
| TC-SCRUM-98-11 | 98-4 | Conflict | Reassigned between the access check and the write | the write finds `coordinator_id` changed | 409; no `approved_rejected_by` written; write filtered on `coordinator_id` | `SCRUM-98 AC4 conflict: an event reassigned after the access check records no outcome`; `SCRUM-98 AC4: with a coordinator given, the write also requires that coordinator to still hold the event` | 2026-10-01 · pass · local |
| TC-SCRUM-98-12 | 98-3 | Negative | Body tries to set status, approver, time or coordinator | `{ status: "CONFIRMED", approved_rejected_by: "coord-other", approved_rejected_at: "2000-01-01…", coordinator_id: "coord-other" }` | `APPROVED`; server values kept | `SCRUM-98: status, approved_rejected_by and approved_rejected_at in the body are ignored; the server's values win` | 2026-10-01 · pass · local |
| TC-SCRUM-98-13 | 98-3 | Failure | Event deleted after the access check | the write and the re-read find nothing | 404 | `SCRUM-98: an event deleted after the access check is a 404`; `SCRUM-98: a guarded write that matches nothing is not_found when the event is gone` | 2026-10-01 · pass · local |
| TC-SCRUM-98-14 | 98-3 | Failure | Storage fails | write error; access-check error; no storage configured | 500 safe message; 503 and nothing written; 503 | `SCRUM-98 failure: a storage error on the write is a safe 500`; `… during the access check is a 503 and nothing is written`; `… without storage configured, the actions answer 503` | 2026-10-01 · pass · local |
| TC-SCRUM-99-01 | 99-1, 98-3 | Happy | Approve an event under review | `{ note: "All details supplied" }` | 200; `APPROVED`, `approved_rejected_by` = caller, `approved_rejected_at` set, note saved | `SCRUM-99 AC1/SCRUM-98 AC3: approving records APPROVED, the approver and the time`; `… approving records the approver, the time and no note` | 2026-10-01 · pass · local |
| TC-SCRUM-99-02 | 99-1 | Conflict | Approve an event not under review | `SUBMITTED`; already `APPROVED` (approve and reject) | 409; status unchanged | `SCRUM-99 AC1 conflict: an event that is not under review cannot be approved`; `SCRUM-99 conflict: an approved event cannot be approved or rejected again`; `SCRUM-98 conflict: a guarded write that matches nothing is a conflict when the event still exists` | 2026-10-01 · pass · local |
| TC-SCRUM-99-03 | 99-1 | Happy | Approved event listed for venue and equipment | `APPROVED` event assigned to the coordinator | Listed and bookable; the event page links to venue and equipment arrangements | `[VENUE-DB-001]` (picker filters on `APPROVED`/`CONFIRMED`); the venue booking tests in `venues.integration.test.js` and the equipment request tests in `equipment.functional.test.js` (both use an `APPROVED` event); `[SCRUM-99-UI-009]`; `[REVIEW-E2E-UI-001]` | 2026-10-05 · pass · local |
| TC-SCRUM-99-04 | 99-1 | Negative | Pre-approval event in venue/equipment | `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `REJECTED` | Venue request refused; equipment request 409 "The event must be approved before requesting equipment."; nothing created | `[ACCESS-VENUE-002] %s events cannot request venues` (×4); `SCRUM-99 AC1: equipment cannot be requested for a ${status} event, only after approval` (×3) | 2026-10-05 · pass · local |
| TC-SCRUM-99-05 | 99-2 | Happy | Approval commits to nothing | approve | Only `approved_rejected_by`, `approved_rejected_at`, `approval_rejection_remark` (and `status`) written; no other repository call | `SCRUM-99 AC2: approval writes only the decision columns` | 2026-10-01 · pass · local |
| TC-SCRUM-99-06 | 99-3 | Happy | Organiser sees the decision | `APPROVED` event, `approved_rejected_by` = `first` ("Ada Tan"), note "Ready for planning." | 200 with `approved_rejected_by`, `approved_rejected_at`, `approval_rejection_remark`, `approved_rejected_by_name: "Ada Tan"`; page shows outcome, approver, time and note; no review buttons | `[SCRUM-99] AC3: the organiser, the assigned coordinator and the manager see the decision, the approver and the time`; `[SCRUM-99-UI-010]` (organiser); `[REVIEW-E2E-UI-001]` | 2026-10-05 · pass · local |
| TC-SCRUM-99-07 | 99-3 | Happy | Manager (and the assigned coordinator) see the decision | as TC-99-06 | As TC-99-06 | `[SCRUM-99] AC3: the organiser, the assigned coordinator and the manager see the decision, the approver and the time`; `[SCRUM-99-UI-010]` (manager); `[SCRUM-99-UI-009]` (coordinator); `[REVIEW-E2E-UI-001]` | 2026-10-05 · pass · local |
| TC-SCRUM-99-08 | 99-3 | Negative | Other organiser / unassigned coordinator | `otherOrganiser`, `second` | 404; the note is not in the response | `[SCRUM-99] AC3: another organiser and an unassigned coordinator cannot see the decision`; `[REVIEW-E2E-UI-003]` | 2026-10-05 · pass · local |
| TC-SCRUM-99-09 | all | Happy | Submit → assign → start review → approve, end to end | organiser submits; manager assigns Coordinator One; note "Ready for planning" | Badge Submitted after assignment (#95), Under review, then "Approved – planning"; venue link appears; organiser and manager see outcome, "Coordinator One", a time and the note | `[REVIEW-E2E-UI-001] TC-SCRUM-99-09 SCRUM-98/99: submit, assign, start review and approve; organiser and manager see the decision` | 2026-10-05 · pass · local |
| TC-SCRUM-99-10 | 99-1 | Boundary | Approval note handling | `"  Looks complete  "`, `"   "`; and `42`, `true`, an object, an array | Trimmed; blank stored as `null`; non-text refused with 400 before any write | `SCRUM-99: an approval note is trimmed, and a blank one is stored as none`; `SCRUM-99 boundary: an approval note that is not text (%j) is refused before any write` (×4); `SCRUM-99 boundary: an approval note that is not text is a 400` | 2026-10-01 · pass · local |
| TC-SCRUM-98-15 | 98-2 | Happy | Coordinator starts review from the UI | `SUBMITTED` event | *Start review* sends `POST …/start-review` with the coordinator's token and no body; the updated `UNDER_REVIEW` event is handed back | `[SCRUM-98-UI-001]` | 2026-10-03 · pass · local |
| TC-SCRUM-98-16 | 98-2 | Negative | No review action outside `SUBMITTED` / `UNDER_REVIEW` | `DRAFT`, `APPROVED`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `COMPLETED` | No button shown | `[SCRUM-98-UI-007]` (×6) | 2026-10-03 · pass · local |
| TC-SCRUM-98-17 | 98-3 | Happy | Reject with a reason from the UI | note `"Dates clash with exams."` | `POST …/reject` with `{ note }`; the `REJECTED` event is handed back | `[SCRUM-98-UI-002]` | 2026-10-03 · pass · local |
| TC-SCRUM-98-18 | 98-3 | Boundary | Reject without a reason in the UI | `""`, `"   "` | "Give a reason for rejecting this request." linked to the note (`aria-invalid`, `aria-describedby`); no request sent | `[SCRUM-98-UI-003]` (×2) | 2026-10-03 · pass · local |
| TC-SCRUM-98-19 | 98-4 | Negative | Server refuses the decision | 403 "You do not have permission to do that." | Message shown as an alert; nothing handed back as decided; buttons usable again | `[SCRUM-98-UI-004]` | 2026-10-03 · pass · local |
| TC-SCRUM-98-20 | 98-2 | Conflict | Request changed meanwhile | 409 with the refresh message | The server's refresh message shown; nothing handed back | `[SCRUM-98-UI-005]` | 2026-10-03 · pass · local |
| TC-SCRUM-98-21 | 98-3 | Failure | Double click while a decision is in flight | second click on *Approve* before the reply | Both buttons disabled; one request sent; enabled again after the reply | `[SCRUM-98-UI-006]` | 2026-10-03 · pass · local |
| TC-SCRUM-99-11 | 99-1 | Happy | Approve from the UI, with and without a note | no note; `"Venue needs are clear."` | `POST …/approve` with `{ note: "" }` / `{ note: "Venue needs are clear." }`; the `APPROVED` event is handed back | `[SCRUM-99-UI-001]`, `[SCRUM-99-UI-002]` | 2026-10-03 · pass · local |
| TC-SCRUM-99-12 | 99-2 | Happy | Coordinator is told approval books nothing | `UNDER_REVIEW` event | "It does not book anything." shown beside *Approve* | `[SCRUM-99-UI-003]` | 2026-10-03 · pass · local |
| TC-SCRUM-99-13 | 99-3, 98-3 | Happy | Decision summary | approver `Ada Tan`, `2099-10-10T02:30:00Z`; `APPROVED`, `CONFIRMED`, `REJECTED` | Outcome ("Approved – planning" / "Rejected"), approver, 10 Oct 2099 at 10:30 Singapore time, note or reason; no note row when there is none | `[SCRUM-99-UI-004]`, `[SCRUM-99-UI-005]`, `[SCRUM-98-UI-008]`, `[SCRUM-99-UI-006]` | 2026-10-03 · pass · local |
| TC-SCRUM-99-14 | 99-3 | Boundary | Approver missing, or no decision yet | `approved_rejected_by_name: null`; `SUBMITTED` / `UNDER_REVIEW` with no `approved_rejected_at` | "Not recorded"; no summary at all | `[SCRUM-99-UI-007]`, `[SCRUM-99-UI-008]` (×2) | 2026-10-03 · pass · local |
| TC-SCRUM-98-22 | 98-2 | Happy | Start review on the real page | assigned coordinator, `SUBMITTED` event | One `POST …/start-review`; page reloads with badge "Under review" and *Approve* shown | `[SCRUM-98-UI-009]` | 2026-10-05 · pass · local |
| TC-SCRUM-98-23 | 98-4 | Negative | Unassigned coordinator on the page | event assigned to `coord-2`; `SUBMITTED`, `UNDER_REVIEW` | Event shown, no *Start review* / *Approve* / *Reject* | `[SCRUM-98-UI-010]` (×2) | 2026-10-05 · pass · local |
| TC-SCRUM-98-24 | 98-3 | Happy | Reject on the real page, and the coordinator keeps seeing it | note "Dates clash with exams." | One `POST …/reject`; page reloads with badge "Rejected", outcome "Rejected" and the reason; no arrangement links; the coordinator's list and detail still include the `REJECTED` event, another coordinator gets 404 | `[SCRUM-98-UI-012]`; `[SCRUM-98] AC3: the coordinator who rejected a request still sees it and the reason they recorded` | 2026-10-05 · pass · local |
| TC-SCRUM-98-25 | 98-3 | Happy | Reject through the browser | *Reject* with no reason, then "Dates clash with exams." | Reason message shown and still Under review; then 200; the organiser (and the coordinator) see Rejected, "Coordinator One" and the reason | `[REVIEW-E2E-UI-002]` | 2026-10-05 · pass · local |
| TC-SCRUM-98-26 | 98-4 | Negative | Role × action matrix through the real app | `second`, organiser, manager, `venue_staff`, `technical_support_staff`, attendee × the 3 actions; no token | 403 each; 401 without a session; still `SUBMITTED`; approve before review 409; review then approve 200 with the decision recorded; reject after approval 409 | `[REVIEW-E2E-API-001] SCRUM-98/99 review actions: assigned coordinator only, in lifecycle order` | 2026-10-05 · pass · local |
| TC-SCRUM-99-15 | 99-1, 99-3 | Happy | Approve on the real page | note "Ready for planning." | Summary: "Approved – planning", "Ada Tan", 5 Oct 2099 at 10:30 Singapore time, the note; no *Approve*; *Arrange venue bookings* shown | `[SCRUM-99-UI-009]` | 2026-10-05 · pass · local |
| TC-SCRUM-99-16 | 99-3 | Boundary | Approver name | `full_name` blank → email; account gone; lookup error; undecided event | Email used; `approved_rejected_by_name: null` and still 200; no account lookup when undecided | `[SCRUM-99] boundary: an approver without a full name is shown by email`; `[SCRUM-99] boundary: when the approver's account no longer exists / cannot be looked up the event still loads with no approver name`; `[SCRUM-99] AC3: an undecided event has no approver and no account is looked up` | 2026-10-05 · pass · local |
| TC-SCRUM-97-16 | 97-4 | Happy | Coordinator's list shows status in words | `UNDER_REVIEW`, `APPROVED` | Badges "Under review", "Approved – planning"; no raw `UNDER_REVIEW` | `[SCRUM-98-UI-011]` | 2026-10-05 · pass · local |

**Coverage** (2026-10-01, `test:cov`, local): `review.service.js`, `review.controller.js` and `review.routes.js` are
100% statements, branches and functions; the new coordinator branch of `transitionStatus` is covered both ways.
(2026-10-03, `test:cov`, frontend): `reviewService.js` and `EventDecisionControls.jsx` 100%. `EventDecisionSummary.jsx`
100% lines and functions; v8 reports 75% statements and 62% branches because it counts JSX elements inside the
conditional rows as branches (the same artefact shows on the unchanged `EventDetailPanel.jsx`). Every real condition
(rejected or not, note or none, name or none, decided or not) has a test.
(2026-10-05): `eventWorkspace.service.js` 97% lines, 100% functions, 80% branches; every uncovered line and branch
predates this story, and every approver-name branch is covered. `EventWorkspaceDetailPage.jsx` and
`EventWorkspacePage.jsx` 100% lines and functions; branches 72% and 65%, partly the JSX artefact above and partly the
existing loading and error states, which these tests don't exercise.

**Test review.** Each case was checked against a plausible wrong implementation:

| Mutation | Test that goes red |
| --- | --- |
| Drop the record check, or compare against the wrong id | TC-98-10 |
| Drop `.eq("coordinator_id", …)` from the write | TC-98-11 (unit) |
| Take `approved_rejected_by` from the body | TC-98-12 |
| Allow `SUBMITTED → APPROVED` | TC-99-02 |
| Let a blank reason through | TC-98-09 |
| Write anything besides the decision columns on approve | TC-99-05 |
| UI: let a whitespace-only reason through (`!note` instead of `!note.trim()`) | TC-98-18 |
| UI: leave *Approve* enabled while a decision is in flight | TC-98-21 |
| A failed approver lookup fails the whole read | TC-99-16 (×2) |
| Stop selecting the three decision columns | TC-99-06, TC-99-07, TC-99-08, TC-99-16 |
| Show the review buttons to any coordinator | TC-98-23 (×2) |
| Leave `REJECTED` out of the coordinator's scope | TC-98-24 |
| Let any coordinator through the review guard | TC-98-26 |

TC-SCRUM-98-13, 98-14, 98-22 to 98-26, 99-10 and 99-15/16 were added during build. They aren't in the original draft, but each is the
failure or boundary path of an AC above.

## 9. SCRUM-149 — postpone an event

Same router/controller/service shape as SCRUM-148 (cancel, approved for this lane but never previously added to
this file — see the note at the end of this section). No live-DB or Playwright coverage was added for this story;
every AC is provable at the mocked-repository / component level, including the venue release call, to avoid load
on the shared Supabase project's free tier.

> **SCRUM-149:** As the assigned Event Coordinator, I want to postpone an event whose new date isn't known yet so
> that its venues are released while the event's details are kept.
>
> 1. The assigned Event Coordinator or the Event Coordinator Lead can postpone an event without a new date, with
>    a reason.
> 2. The event's details and registrations are retained.
> 3. The event's venue bookings and holds are released.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Lifecycle (unit) | `backend/tests/unit/events/lifecycle.test.js` | Extended with `POSTPONED` in `STATUSES`, the four new edges into it, `POSTPONED → CANCELLED`, and dedicated `ACTIVE_STATUSES`/`POSTPONABLE_STATUSES` assertions. Same "typed from the agreed table" discipline as §3. |
| Repository (unit) | `backend/tests/unit/events/events.transition.test.js` | Extended with `postpone()`'s own block, same `recorder()` harness as §2; `cancel()`'s existing test updated to expect `POSTPONED` in its status filter. |
| Workload (unit) | `backend/tests/unit/events/assignments.service.test.js` | Extended: `findActiveAssignments`'s real query now expected to include `POSTPONED`. |
| HTTP (integration) | `backend/tests/integration/events.review.test.js` | Same harness as SCRUM-98/99/148 (§8); `repository.postpone` added to the fake, gated on a local `POSTPONABLE_STATUSES`. |
| HTTP (workspace) | `backend/tests/integration/eventWorkspace.test.js` | Same harness as §8; `postponed_by`/`postponed_at`/`postponement_reason` added to the fixture's field set; one case postpones then reassigns, one postpones then checks visibility. |
| Registrations (integration) | `backend/tests/integration/registrations.test.js` | Existing non-`APPROVED` rejection test, one new case with a `POSTPONED` event. |
| Component | `frontend/src/features/events/components/EventPostponeControl.test.jsx` | New file, same shape as `EventCancelControl.test.jsx`: jsdom, real component/service/`apiFetch`, `fetch` stubbed. |
| Component | `frontend/src/features/events/components/EventCancelControl.test.jsx` | Extended: the "offers a cancel action" status list now includes `POSTPONED`. |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-149-01 | 149-1, 149-3 | Happy | Assigned coordinator postpones their own event; the venue release call happens in the same request (also proves TC-149-09) | Event `coordinator_id` = caller | 200; `POSTPONED`, `postponed_by`/`postponed_at`/`postponement_reason` set; `releaseVenueBookingsForCancelledEvent` called with the event id; equipment release **not** called | `[TC-149-01] the assigned coordinator postpones their own event; venue release runs synchronously, equipment is untouched` | 2026-10-11 · pass · local |
| TC-149-02 | 149-1 | Happy | Event Coordinator Lead postpones an event not assigned to them | caller role `event_coordinator_lead` | 200; `POSTPONED`; no `coordinatorId` passed to the write | `[TC-149-02] the coordinator lead postpones an event not assigned to them` | 2026-10-11 · pass · local |
| TC-149-03 | 149-1 | Negative | A coordinator not assigned to the event postpones it | caller `event_coordinator`, different id | 403; `repository.postpone` not called | `[TC-149-03] a coordinator not assigned to the event cannot postpone it` | 2026-10-11 · pass · local |
| TC-149-04 | 149-1 | Negative / Boundary | No reason, blank reason, whitespace-only reason | `{}`, `{ reason: "" }`, `{ reason: "   " }` | 400 "Give a reason for postponing this event."; nothing written | `[TC-149-04] postpone without a reason (%j) is a 400, nothing recorded` (×2); `[TC-149-04] a whitespace-only reason is treated as blank` | 2026-10-11 · pass · local |
| TC-149-05 | 149-1 | Conflict | Event reassigned between the access check and the write | write finds `coordinator_id` changed | 409; nothing recorded | `[TC-149-05] a reassignment between the access check and the write is a 409, nothing recorded` | 2026-10-11 · pass · local |
| TC-149-06 | 149-2 | Happy | Postponed event stays visible to the assigned coordinator and the manager, every field (including an earlier approval) intact | Event previously `APPROVED` with a decision, then `POSTPONED` | 200 in both scopes; `postponed_by_name` resolved; earlier `approved_rejected_by`/remark still present | `[TC-149-06] the assigned coordinator and the manager both still see a postponed event, with every field intact` | 2026-10-11 · pass · local |
| TC-149-08 | 149-2 | Boundary | A new registration attempt is refused once the event is postponed | Event `status = POSTPONED` | 409 "Registration is not open for this event." — the existing, unmodified `!== "APPROVED"` check | `[TC-149-08] POST /api/registrations: rejects registration for a POSTPONED event` | 2026-10-11 · pass · local |
| TC-149-10 | 149-3 | Boundary | Venue release is skipped when postpone itself fails | missing reason | `releaseVenueBookingsForCancelledEvent` not called | `[TC-149-10] venue release is skipped when postpone itself fails (missing reason)` | 2026-10-11 · pass · local |
| TC-149-11 | — | Happy | A `POSTPONED` event can still be cancelled | Event `status = POSTPONED` | 200; `CANCELLED`, cancellation fields set | `[TC-149-11] a POSTPONED event can still be cancelled` | 2026-10-11 · pass · local |
| TC-149-12 | — | Boundary | A terminal or already-postponed event cannot be postponed again | `COMPLETED`; already `POSTPONED` | 409 for each | `[TC-149-12] postpone is refused from a terminal stage (COMPLETED)`; `[TC-149-12] postpone is refused on an already-postponed event`; unit query construction in `events.transition.test.js` | 2026-10-11 · pass · local |
| TC-149-13 | 149-1, 149-3 | Happy / Negative | `EventPostponeControl` renders only on the four active stages, requires a non-blank reason, disables while in flight, surfaces a server refusal | Every status; empty/whitespace reason; a 403 response; an in-flight request | Hidden outside the four active stages; blocked client-side until typed; one request while disabled; server message shown as an alert | All cases in `EventPostponeControl.test.jsx` (`[TC-149-13]`, ×9) | 2026-10-11 · pass · local |
| TC-149-14 | — | Happy | `EventCancelControl` now also renders for a `POSTPONED` event | `event.status = "POSTPONED"` | Visible (previously hidden) | `[TC-148-18 / TC-149-14] a %s event offers a cancel action` (extended parameter list) | 2026-10-11 · pass · local |
| TC-149-15 | — | — | *Dropped.* `EventReviewControls.jsx` had no existing tests; building a new file's harness for one status case was judged disproportionate to the one-line fix. TC-149-17 proves the real behaviour at the integration layer instead. | — | — | — | not built — see *Decisions* in the task note |
| TC-149-16 | — | Happy | A `POSTPONED` event counts toward its coordinator's workload | Fixture includes a `POSTPONED` event | `findActiveAssignments`'s real query includes `POSTPONED` | `[TC-149-16] SCRUM-26/149: workload counts read only assigned events in an active status (postponed included)` | 2026-10-11 · pass · local |
| TC-149-17 | — | Happy | The coordinator lead can reassign a `POSTPONED` event to a different coordinator | Event `status = POSTPONED` | 200; `coordinator_id` updated | `[WORKFLOW-002b / TC-149-17] A postponed event can still be reassigned to a different coordinator` | 2026-10-11 · pass · local |
| TC-149-18 | 149-3 | Failure | **Characterization test**: venue release throws after the status write already committed | release mock rejects | 500 "Something went wrong…"; the event's status is already `POSTPONED` regardless — documents cancel's pre-existing, equally-untested behaviour, doesn't endorse it | `[TC-149-18] characterization: a venue-release failure is a 500, even though the status write already committed` | 2026-10-11 · pass · local |
| TC-149-19 | 149-1, 149-3 | Happy | Postpone succeeds from an active stage (`APPROVED`, representative) — the positive-side companion to TC-149-12, same split as cancel's TC-148-06/07 | Event `status = APPROVED` | 200; `POSTPONED` | `[TC-149-19] postpone succeeds from an active stage (APPROVED) - companion to TC-149-12's refusal boundary` | 2026-10-11 · pass · local |
| TC-149-20 | 149-1 | Negative | A caller with an unrelated role entirely (not just "wrong coordinator") cannot postpone | `event_organiser`, `venue_staff`, `technical_support_staff`, `attendee`, `unknown` | 403 each; `repository.postpone` never called | `[TC-149-20] %s cannot postpone an event` (×5) | 2026-10-11 · pass · local |

**On the gaps in the numbering:** there is no TC-149-07 — it was folded into TC-149-06 during planning review, before
any code was written. TC-149-19 and TC-149-20 were not in the original plan at all; they were added during the
build once it became clear that cancel's own precedent (TC-148-06/07 for the stage boundary, TC-148-04 for an
unrelated role) had no postpone equivalent allocated. Both are documented here now that TC-149-08 — previously
just a planned case — is a real, passing test, so this table matches what actually exists rather than what was
first sketched.

**Coverage** (2026-10-11, `test:cov`, local): `review.service.js` 100% statements/branches/functions for every
`postpone` branch (reason validation, ops-manager/coordinator split, conflict/not-found, the release call, its
skip path and its failure path). `events.repository.js#postpone` and the widened `cancel()` query are covered by
their own unit tests. One reporting quirk, not a real gap: the terminal coverage table doesn't list `lifecycle.js`
as a row at all despite 60+ passing assertions against it, and shows `review.controller.js` lines 39/51 (cancel's
and postpone's shared-shape failure-response line) as "uncovered" even though both have passing tests exercising
them — pre-existing behaviour of the tool, not something this story introduced or left unproven.

**Test review.** Each new case was checked against a plausible wrong implementation:

| Mutation | Test that goes red |
| --- | --- |
| Gate `postpone()` on `ACTIVE_STATUSES` instead of `POSTPONABLE_STATUSES` | TC-149-12 (second case) |
| Leave `POSTPONED` out of `ACTIVE_STATUSES` | TC-149-11, TC-149-16, TC-149-17 |
| Reuse cancel's `reason_required` failure key for postpone | would show cancel's message, not postpone's — TC-149-04 |
| Call the venue release before the status write succeeds | TC-149-10 |
| Pass `equipmentService` through to `postpone()`'s release call | TC-149-01's "equipment release not called" assertion |
| Let a non-assigned coordinator or an unrelated role through | TC-149-03, TC-149-20 |

**Note for whoever reads this next:** SCRUM-148 (cancel) itself never received an entry in this file, despite its
own task note listing one as planned — there is no TC-148-xx table anywhere here. Not backfilled as part of this
story (out of lane for what SCRUM-149 is responsible for), but worth raising with the story owner if cancel's own
traceability is ever asked for in the Week 13 Q&A.

---
## 9. SCRUM-139 — submit for the Operational Safety Check

Readiness rule, the three actions, the page controls and both Playwright journeys are automated. The venue and
equipment refusals during review (AC4) reuse those lanes' existing "must be approved" checks; `SAFETY_REVIEW` was
added to their refusal lists.

> **SCRUM-139:** As an Event Coordinator, I want to submit an event for the Operational Safety Check once its venue
> and technical arrangements are confirmed so that it can be reviewed and move into preparation.
>
> 1. An event can only be submitted once its essential venue bookings are approved and its technical arrangements
>    are reserved.
> 2. If arrangements are missing, submission is blocked and the missing items are shown.
> 3. The event moves to a safety review status when submitted.
> 4. Venue and technical arrangements cannot be changed during safety review unless the submission is withdrawn.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Rule (unit) | `backend/tests/unit/events/safetyReadiness.test.js` | Pure `findMissingArrangements`; arrangements built per test (venue "Hall B", 2099-05-01) |
| Repository (unit) | `backend/tests/unit/events/events.arrangements.test.js` | `recorder()` as in §2 |
| Lifecycle (unit) | `backend/tests/unit/events/lifecycle.test.js` | As §2, with `SAFETY_REVIEW` in the typed table |
| HTTP (integration) | `backend/tests/integration/events.safetyCheck.test.js` | Real `createApp`; `authClient.getUser` faked (token = `<user id>:<roles>`); in-memory event `APPROVED`, assigned to the caller, whose `transitionStatus` honours the status and coordinator filters |
| Frontend (component) | `frontend/src/features/events/components/SafetyCheckControls.test.jsx` | Real component, `safetyService.js`, `useApiResource` and `apiFetch`; `fetch` stubbed; token `coordinator-token`; event `aaaaaaaa-0139-…` |
| Frontend (page) | `frontend/src/features/events/pages/EventWorkspaceDetailPage.test.jsx` | As §8, with the in-memory event answering the safety-check POSTs |
| Playwright | `tests/playwright/safety-check.api.spec.cjs`, `safety-check.browser.spec.cjs` | Real Express app and UI against the local Auth simulator; arrangements made through the venue and equipment lanes' own endpoints on a date 45 days ahead |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-139-01 | 1 | Happy | Everything arranged | 2 confirmed venue requests, 1 `APPROVED` equipment | Nothing missing | `SCRUM-139 AC1: confirmed venues and approved equipment leave nothing missing` | 2026-10-09 · pass · local |
| TC-SCRUM-139-02 | 1 | Negative | No venue request | none | "No venue booking has been approved yet." | `SCRUM-139 AC1: an event with no venue request is missing a venue` | 2026-10-09 · pass · local |
| TC-SCRUM-139-03 | 1 | Negative | A venue still pending | 1 confirmed, 1 pending (Hall B · 2099-05-01) | Hall B listed, "Waiting for Venue Staff to decide." | `SCRUM-139 AC1: a pending venue request is missing, even beside a confirmed one` | 2026-10-09 · pass · local |
| TC-SCRUM-139-04 | 1 | Boundary | Rejected / cancelled beside a confirmed venue | 1 confirmed, 1 rejected, 1 cancelled | Nothing missing | `SCRUM-139 AC1: rejected and cancelled requests do not block when another venue is confirmed` | 2026-10-09 · pass · local |
| TC-SCRUM-139-05 | 1 | Boundary | Only rejected / cancelled venues | 1 rejected | "No venue booking has been approved yet." | `SCRUM-139 AC1: only rejected or cancelled requests count as no venue` | 2026-10-09 · pass · local |
| TC-SCRUM-139-06 | 1 | Negative | Equipment unattended or with issues | Projector `PENDING`, Speaker `REJECTED` | Both listed with the UI-label reasons | `SCRUM-139 AC1: unattended and issue equipment requests are missing` | 2026-10-09 · pass · local |
| TC-SCRUM-139-07 | 1 | Boundary | No equipment, or only released | 0 / 1 `RELEASED` | Nothing missing | `test.each` in `safetyReadiness.test.js` (×2) | 2026-10-09 · pass · local |
| TC-SCRUM-139-08 | 2 | Happy | Every missing item listed together | no venue, 2 pending equipment | Three items, venue first | `SCRUM-139 AC2: every missing item is listed together, venue first` | 2026-10-09 · pass · local |
| TC-SCRUM-139-09 | 1, 2 | Negative | Submit with missing items | `APPROVED`, 1 pending venue | 409 with `missing`; still `APPROVED`; no write | `SCRUM-139 AC1/AC2: submitting with missing arrangements is a 409 listing them, and changes nothing`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-10 | 2 | Happy | Readiness endpoint | not ready; ready | `{ ready: false, missing }`; `{ ready: true, missing: [] }` | `SCRUM-139 AC2: readiness lists what is missing…`; `SCRUM-139 AC1: readiness reports a fully arranged event as ready`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-11 | 3 | Happy | Ready event submitted | `APPROVED`, ready | 200, `SAFETY_REVIEW`; write filtered on `APPROVED` and the caller | `SCRUM-139 AC3: a ready approved event moves to SAFETY_REVIEW for the calling coordinator only`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-12 | 3 | Conflict | Wrong status, or changed meanwhile | `SUBMITTED`, `UNDER_REVIEW`, `SAFETY_REVIEW`, `CONFIRMED`, `CANCELLED`; lost race | 409 refresh message; nothing written | `test.each` wrong status (×5); `SCRUM-139 AC3 conflict: an event that changes between the check and the write is a 409` | 2026-10-09 · pass · local |
| TC-SCRUM-139-13 | 4 | Happy | Withdraw | `SAFETY_REVIEW` | 200, `APPROVED` | `SCRUM-139 AC4: withdrawing moves SAFETY_REVIEW back to APPROVED`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-14 | 4 | Conflict | Withdraw when not in review | `APPROVED` | 409; unchanged | `SCRUM-139 AC4 conflict: an event not under safety review cannot be withdrawn`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-15 | 4 | Negative | New venue request during review | `SAFETY_REVIEW` | Refused; nothing written | `[ACCESS-VENUE-002]` (now ×5); `[SAFETY-E2E-API-001]` (400) | 2026-10-09 · pass · local |
| TC-SCRUM-139-16 | 4 | Negative | New equipment request during review | `SAFETY_REVIEW` | 409 "The event must be approved before requesting equipment." | `SCRUM-99 AC1: equipment cannot be requested for a SAFETY_REVIEW event…`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-17 | 4 | Happy | Lifecycle table | — | `APPROVED→SAFETY_REVIEW`, `SAFETY_REVIEW→APPROVED/CANCELLED`; active, not planning | `lifecycle.test.js` | 2026-10-09 · pass · local |
| TC-SCRUM-139-18 | 1–4 | Negative | Access matrix | no token, `invalid`; 6 other roles; unassigned coordinator; unknown / malformed id | 401; 403; event unchanged | `SCRUM-139: an unauthenticated caller…` (×2); role `test.each` (×6); `SCRUM-139: a coordinator not assigned to the event…`; `SCRUM-139: an unknown or malformed event id…`; `[SAFETY-E2E-API-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-19 | 1–3 | Failure | Storage down | record check / arrangements / write throw | 503; 500 safe message, no provider text | `SCRUM-139 failure: …` (×5); `findArrangements throws when storage fails…` | 2026-10-09 · pass · local |
| TC-SCRUM-139-20 | 2 | Happy | Coordinator sees missing items | `APPROVED`, Hall B and Projector missing | Both listed; Submit disabled; *Check again* refetches | `[SCRUM-139-UI-001]`, `[SCRUM-139-UI-005]`, `[SCRUM-139-UI-011]`; `[E2E-SAFETY-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-21 | 2 | Failure | Readiness fails / submit refused meanwhile | 503; 409 with `missing` | Safe message and *Try again*; on 409 the server's message and the fresh list | `[SCRUM-139-UI-004]`, `[SCRUM-139-UI-003]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-22 | 3 | Happy | Submit from the page | ready `APPROVED` event | Badge "Safety review"; arrangement links gone; *Withdraw* shown | `[SCRUM-139-UI-002]`, `[SCRUM-139-UI-009]`; `[E2E-SAFETY-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-23 | 4 | Happy | Withdraw from the page | `SAFETY_REVIEW` | Badge "Approved – planning"; links back; a refused withdrawal shows the message | `[SCRUM-139-UI-006]`, `[SCRUM-139-UI-007]`, `[SCRUM-139-UI-009]`; `[E2E-SAFETY-001]` | 2026-10-09 · pass · local |
| TC-SCRUM-139-24 | 1 | Boundary | Confirmed + coordinator-cancelled slots | 2 confirmed, 1 cancelled | Counts as booked | `SCRUM-139 AC1: a request with confirmed and coordinator-cancelled slots counts as booked` | 2026-10-09 · pass · local |
| TC-SCRUM-139-25 | 2 | Boundary | Pending venue, nothing booked | 1 pending | Listed once, not also "No venue" | `SCRUM-139 AC2: a pending venue with nothing booked is listed once, not twice` | 2026-10-09 · pass · local |
| TC-SCRUM-139-26 | 3 | Negative | Controls only for the assigned coordinator, in the right status | organiser, manager, other coordinator; 6 other statuses | No section; no safety request sent | `[SCRUM-139-UI-010]` (×3), `[SCRUM-139-UI-008]` (×6) | 2026-10-09 · pass · local |
| TC-SCRUM-139-27 | 3, 4 | Failure | Double click while in flight | second click on *Submit* / *Withdraw* before the reply | Button "Submitting…" / "Withdrawing…" and disabled; one POST | `[SCRUM-139-UI-012]` (×2) | 2026-10-09 · pass · local |

**Coverage** (2026-10-09, `test:cov`, local): `safetyReadiness.js`, `safetyCheck.service.js`,
`safetyCheck.controller.js`, `safetyCheck.routes.js`, `lifecycle.js` and `review.routes.js` 100%.
`events.repository.js` 88% lines; `findArrangements` is fully covered and the uncovered lines (`findById`,
`findByIds`, `markSubmitted`) predate this story. `safetyService.js` 100%. `SafetyCheckControls.jsx` 100% lines and
functions; v8 reports 79% branches, the JSX artefact described in §8 (every status, ready / not ready, loading,
error and in-flight path has a test). The join hints in `findArrangements` (`venues!venue_id`,
`equipment!equipment_id`) are proven against real Supabase only by the manual demo.

**Test review.** Each case was checked against a plausible wrong implementation:

| Mutation | Test that goes red |
| --- | --- |
| Drop the server-side readiness check on submit | TC-139-09 |
| Drop the record check | the app refuses to start ("requires a server-side record access check") |
| Count a pending slot as booked | TC-139-03 |
| Let `REJECTED` equipment through | TC-139-06 |
| Put `SAFETY_REVIEW` in `PLANNING_STATUSES` | TC-139-15, TC-139-17 (TC-139-16 is guarded by the equipment lane's own status list) |
| UI: leave Submit enabled while in flight | TC-139-27 |

TC-SCRUM-139-26 and 27 were added during build; each is a negative or failure path of an AC above.

## 10. SCRUM-140 — review an event's operational safety information

The queue, the read-only detail, the role matrix and the refused writes are automated at every layer. No schema
change: the AC2 facts without their own column are read from existing fields (mapping in
[event-requests.md](event-requests.md#review-an-events-safety-information-scrum-140)).

> **SCRUM-140:** As a Safety Officer, I want to view the information needed to assess an event's safety so that I
> can make an informed decision.
>
> 1. The Safety Officer can view a list of events awaiting safety review.
> 2. The Safety Officer can view the event's attendance, venue capacity and layout, emergency access, accessibility,
>    equipment placement, crowd movement and venue restrictions.
> 3. The Safety Officer can view the confirmed venue and technical arrangements, with each venue shown separately.
> 4. The Safety Officer can view but not edit event details.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Service (unit) | `backend/tests/unit/events/safetyReview.service.test.js` | Repository faked; Hall A (capacity 200) and Hall B (80), 2099-05-01 |
| Repository (unit) | `backend/tests/unit/events/events.arrangements.test.js` | `recorder()` as in §2 |
| HTTP (integration) | `backend/tests/integration/events.safetyReview.test.js` | Real `createApp`; token = `<user id>:<roles>`; event `bbbbbbbb-0001-…` `SAFETY_REVIEW` whose stored row also carries organiser and coordinator ids |
| Frontend (pages) | `frontend/src/features/events/SafetyReview.test.jsx` | Real `App`, router and guards; permissions from the real `permissions.js`; `fetch` stubbed |
| Playwright | `tests/playwright/safety-review.api.spec.cjs`, `safety-review.browser.spec.cjs` | Real Express app and UI against the local Auth simulator; arrangements made through the venue and equipment lanes' own endpoints and submitted through SCRUM-139, 47 and 48 days ahead |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-140-01 | 1 | Happy | Officer lists events awaiting review | 2 `SAFETY_REVIEW` events | 200, soonest first, with name, times and attendance; nav link reaches the list | `[SCRUM-140] AC1: the Safety Officer gets the events awaiting safety review`; `[SCRUM-140-UI-001]`; `[SAFETY-REVIEW-API-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-02 | 1 | Negative | Other statuses are not listed | event `APPROVED` before submission and after withdrawal | Not in the list; query filtered on `SAFETY_REVIEW` | `SCRUM-140 AC1: findAwaitingSafetyReview reads only SAFETY_REVIEW events…`; `[SAFETY-REVIEW-API-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-03 | 1 | Boundary | Nothing awaiting review | empty queue | 200 `[]`; "No events are waiting for a safety review." | `[SCRUM-140] AC1: an empty queue is an empty list, not an error`; `[SCRUM-140-UI-002]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-04 | 1–4 | Negative | Only Safety Officers reach the API | no token; coordinator, lead, venue staff, tech support, organiser, attendee | 401; 403 for each role on list and detail, before any read | `[SCRUM-140] access: …` (7 tests); `[SAFETY-REVIEW-API-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-05 | 2 | Happy | Detail shows every AC2 fact | Hall A: capacity 200, Theatre, notes "Fire exits on the east wall."; projector "Mounted at the rear of Hall A" | Attendance, capacity, layout, emergency access/restrictions, accessibility, placement and crowd movement shown with their values | `[SCRUM-140] AC2/AC3: the detail shows…`; `[SCRUM-140-UI-003]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-06 | 2 | Boundary | Missing facts are visible as missing | `null`, `""` and `[]` values | Each reads "Not provided" | `[SCRUM-140-UI-005]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-07 | 3 | Happy | Each venue shown separately | Hall A (200) and Hall B (90) both booked | Two venue sections, each with its own capacity, notes and confirmed slots | `[SCRUM-140] AC3: each booked venue is returned separately…`; `[SCRUM-140-UI-004]`; `[E2E-SAFETY-REVIEW-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-08 | 3 | Negative | Only confirmed arrangements are shown | pending and rejected venue requests; `PENDING`, `REJECTED`, `RELEASED` equipment; cancelled slot | Only the booked venue (confirmed slots only) and `APPROVED` equipment | `[SCRUM-140] AC3: pending and rejected venue requests…`; `[SCRUM-140] AC2/AC3: only reserved (APPROVED) equipment…`; `[SAFETY-REVIEW-API-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-09 | 2–3 | Negative | Detail only for events awaiting review | `APPROVED` event; unknown UUID; `not-a-uuid` | 404 "That event is not waiting for a safety review." with no arrangement read; 400 "That event reference is not valid." | `[SCRUM-140] an event still in planning…`, `…an unknown event…`, `…a malformed event reference…`; `[SCRUM-140-UI-008]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-10 | 4 | Happy | The page offers no way to edit | detail page | No form, input or button outside SCRUM-141's *Safety decision* section, which holds only the note, *Approve* and *Reject*; "Read only." note; back link | `[SCRUM-140-UI-006]`; `[E2E-SAFETY-REVIEW-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-11 | 4 | Negative | The officer cannot change the event through the API | POST/PUT/PATCH/DELETE on both paths; lifecycle actions; workspace PATCH; venue decision | 403 on every one; nothing written; event still awaiting review | `[SCRUM-140] AC4: … is refused for the Safety Officer` (4); `[SCRUM-140] AC4: the Safety Officer cannot change the event…`; `[SAFETY-REVIEW-API-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-12 | 2 | Cross-cutting | Only safety-relevant fields leave the server (#45) | stored row with `organiser_id`, `coordinator_id` | Neither id nor `status` in the response; repository selects no organiser/coordinator column | `[SCRUM-140] #45: the detail carries no organiser, coordinator or status field`; `SCRUM-140 AC2: findAwaitingSafetyReviewById…` | 2026-10-14 · pass · local |
| TC-SCRUM-140-13 | 1–3 | Failure | Storage down or not configured | repository throws; no `eventsRepository` | 500 "Something went wrong. Please try again."; 503 "Safety review is not configured." after the permission check; page shows the message and *Try again* recovers | `[SCRUM-140] failure: …` (2); `SCRUM-140 failure: findAwaitingSafetyReview throws…`; `[SCRUM-140-UI-007]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-14 | 1 | Happy | Navigation follows the permission | coordinator, lead, venue staff | No *Safety reviews* link; direct URL shows Access denied without an API call | `[SCRUM-140-UI-009]`–`011`; `[SCRUM-142-SAFETY-UI-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-15 | 1–3 | Happy | Journey at 375 px: coordinator submits, officer reviews | Playwright accounts; Integration Hall | Event in the queue; detail shows one venue section and no buttons but *Approve*, *Reject* (SCRUM-141) and *Sign out*; no sideways scroll | `[E2E-SAFETY-REVIEW-001]` | 2026-10-14 · pass · local |
| TC-SCRUM-140-16 | 3 | Boundary | No confirmed venue and no equipment | empty `venues` and `equipment` | "No confirmed venue booking." and "No equipment is reserved for this event." | `[SCRUM-140-UI-012]` | 2026-10-14 · pass · local |

**Coverage (2026-10-14):** `safetyReview.service.js`, `safetyReview.controller.js`, `safetyReview.routes.js` and
the new repository functions 100% lines and branches. `SafetyReviewListPage.jsx` and `SafetyReviewDetailPage.jsx`
100% lines; the remaining branch counts are V8's per-JSX-expression entries for the dev-mode JSX transform, not
decisions in the code. Every real branch (loading, error, empty, present, *Not provided*) has a test above.

**Test review:** two deliberate mutations were each caught: showing every venue request instead of booked ones
(service and integration tests fail), and granting `events.safety.read` to coordinators (integration role matrix
fails). The SCRUM-142 role tests that pinned the officer to `internal.access` only were updated, not loosened: they
still assert the exact permission list.

## 11. SCRUM-141 — approve or reject the safety arrangement

A Safety Officer approves (to `PREPARATION`) or rejects with a reason (back to `APPROVED`); each decision is written
to the new `event_activity_log` table and shown on the event's page. Rules and SQL in
[event-requests.md](event-requests.md#approve-or-reject-the-safety-arrangement-scrum-141).

> **SCRUM-141:** As a Safety Officer, I want to approve or reject an event's safety arrangement so that only events
> with a safe arrangement proceed to preparation.
>
> 1. The Safety Officer can approve or reject an event under safety review.
> 2. A rejection must carry a reason.
> 3. An approved event can move to preparation; a rejected event cannot.
> 4. The decision is recorded in the event's activity history.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Service (unit) | `backend/tests/unit/events/safetyReview.service.test.js` (`[SCRUM-141] approve and reject`) | Repository faked; `transitionStatus` answers the moved row |
| Repository (unit) | `backend/tests/unit/events/events.transition.test.js` | `recorder()` as in §2 |
| Workspace (unit) | `backend/tests/unit/events/eventWorkspace.service.test.js` | Fake data client with an `event_activity_log` list in the live table's shape (`user_id`, `details`) |
| HTTP (integration) | `backend/tests/integration/events.safetyReview.test.js` | As §10; `transitionStatus` moves the stored row only from its current status |
| Lifecycle (unit) | `backend/tests/unit/events/lifecycle.test.js` | Typed table with `PREPARATION` |
| Frontend (pages) | `frontend/src/features/events/SafetyReview.test.jsx`, `pages/EventWorkspaceDetailPage.test.jsx` | As §10 and §8 |
| Playwright | `tests/playwright/safety-review.api.spec.cjs`, `safety-review.browser.spec.cjs` | `submittedForSafety` fixture: approved event, one confirmed venue, submitted through SCRUM-139, 49 and 50 days ahead |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-141-01 | 1, 3 | Happy | Officer approves | `SAFETY_REVIEW` event; note "Stewards confirmed" | 200 `{ id, status: PREPARATION }`; write filtered on `SAFETY_REVIEW` with no coordinator filter | `[SCRUM-141] approve and reject > AC1/AC3: approval moves…`; `[SCRUM-141] AC1/AC3/AC4: the Safety Officer approves…`; `[SAFETY-REVIEW-API-002]`; `[SCRUM-141-UI-001]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-02 | 2, 3 | Happy | Officer rejects with a reason | reason "Only one exit for 180 people" | 200 `{ id, status: APPROVED }`; not `PREPARATION`; reason trimmed | `…AC2/AC3/AC4: rejection with a reason sends the event back to planning…`; `[SCRUM-141] AC2/AC3/AC4: the Safety Officer rejects…`; `[SAFETY-REVIEW-API-002]`; `[SCRUM-141-UI-003]`; `[E2E-SAFETY-REVIEW-002]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-03 | 2 | Negative | Reject without a reason | missing, `null`, `""`, `"   "`, `42`, `["reason"]`, reason in `note` | 400 "Give a reason for rejecting this safety arrangement."; nothing written | `…AC2: a rejection without a text reason (%j)…` (×6); `[SCRUM-141] AC2: rejecting without a reason (%j)…` (×4); `[SAFETY-REVIEW-API-002]`; `[SCRUM-141-UI-002]`; `[E2E-SAFETY-REVIEW-002]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-04 | 1 | Negative | Approval note not text | `{ note: ["x"] }` | 400 "The note must be text."; nothing written | `…an approval note that is not text is refused…`; `[SCRUM-141] an approval note that is not text is a 400` | 2026-10-18 · pass · local |
| TC-SCRUM-141-05 | 3 | Conflict | Decide an event not under review, or decided twice | `APPROVED` event; second decision after the first | 409 refresh message; no history row | `…conflict: %s is refused and no history is written`; `[SCRUM-141] conflict: %s on an event not under safety review…` (×2); `[SAFETY-REVIEW-API-002]`; `[SCRUM-141-UI-004]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-06 | 1 | Negative | Unknown or malformed event | unknown UUID; `not-a-uuid` | 404 "That event no longer exists."; 400 "That event reference is not valid."; no history | `…not_found…`; `[SCRUM-141] an unknown event is a 404 and a malformed reference a 400…` | 2026-10-18 · pass · local |
| TC-SCRUM-141-07 | 1 | Negative | Only Safety Officers decide | no token; coordinator (assigned too), lead, venue staff, tech support, organiser, attendee | 401; 403 on both paths; status untouched | `[SCRUM-141] access: no token…`; `[SCRUM-141] access: %s cannot approve or reject…` (×6); `[SAFETY-REVIEW-API-002]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-08 | 4 | Happy | Decision recorded | approve and reject | One `event_activity_log` row each: action, `user_id` the officer, `details` with `SAFETY_REVIEW` → new status and note/reason; insert only | `…AC4: approval records who decided…`; `SCRUM-141 AC4: recordActivity inserts one event_activity_log row…`; HTTP approve/reject tests | 2026-10-18 · pass · local |
| TC-SCRUM-141-09 | 4 | Happy | History visible on the event | rejection then approval | Coordinator, organiser and lead see both, newest first, with the reason; no `user_id` | `[SCRUM-141 AC4] The event detail carries its own activity history…`; `[SAFETY-REVIEW-API-002]`; `[SCRUM-141-UI-006]` (×3); `[SCRUM-141-UI-009]`; `[E2E-SAFETY-REVIEW-002]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-10 | 4 | Boundary | No history, or unreadable history | `[]`; read error | "No activity recorded yet."; event still loads with `activity: null` and "Activity history is unavailable right now…" | `[SCRUM-141 AC4] An event with no recorded activity…`; `…A history row with empty details…`; `…A failed history read still loads the event…`; `[SCRUM-141-UI-007]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-11 | 4 | Failure | History write fails | `recordActivity` throws | Status move undone (`undoTransition`); 500 "Something went wrong. Please try again." | `…failure: when the history row cannot be written the move is undone…`; `[SCRUM-141] failure: if the history cannot be written…`; `SCRUM-141 AC4: undoTransition restores…` | 2026-10-18 · pass · local |
| TC-SCRUM-141-12 | 1 | Failure | Storage not configured | no `eventsRepository` | 403 for a coordinator, then 503 for the officer | `[SCRUM-141] failure: without event storage the decisions answer 503…` | 2026-10-18 · pass · local |
| TC-SCRUM-141-13 | 3 | Happy | Lifecycle table | — | Only `SAFETY_REVIEW → PREPARATION`; `PREPARATION → CANCELLED`; active, not planning, not postponable | `lifecycle.test.js` (SCRUM-141 tests); `[TC-149-13]` (`PREPARATION`) | 2026-10-18 · pass · local |
| TC-SCRUM-141-14 | 3 | Happy | Coordinator's page in preparation | `PREPARATION` event | Badge "Preparation"; no arrangement links or safety-check section; *Cancel event* offered | `[SCRUM-141-UI-008]`; `StatusBadge.test.jsx`; `[TC-148-18 / TC-149-14 / SCRUM-141]` | 2026-10-18 · pass · local |
| TC-SCRUM-141-15 | 1–2 | Cross-cutting | Controls, phone width, busy state, #45 | 375 px; in-flight decision; stored row with organiser/coordinator ids | Buttons disabled in flight; no sideways scroll; response carries id and status only | `[SCRUM-141-UI-005]`; `[E2E-SAFETY-REVIEW-002]`; `[SCRUM-141] #45: a decision answers with the id and status only` | 2026-10-18 · pass · local |

**Coverage (2026-10-18):** `safetyReview.service.js`, `safetyReview.controller.js`, `safetyReview.routes.js`,
`lifecycle.js`, `safetyService.js`, `SafetyDecisionControls.jsx`, `EventActivityHistory.jsx` and `StatusBadge.jsx`
100% lines and branches; `recordActivity`, `undoTransition` and `activityFor` fully covered (the uncovered lines in
`events.repository.js` and `eventWorkspace.service.js` predate this story). `SafetyReviewDetailPage.jsx` 100% lines;
its branch count is V8's dev-mode JSX entries, as in §10, and every real branch (decided, loading, error, data, with
and without `events.safety.decide`) has a test.

**Test review:** three deliberate mutations were each caught: rejection moving to `PREPARATION` (3 tests fail),
granting `events.safety.decide` to coordinators (2 fail), and dropping the undo after a failed history write
(2 fail). Pinned lists in SCRUM-97/139/142/148/149 tests were updated with `PREPARATION` and `events.safety.decide`,
not loosened. `[SCRUM-140-UI-006]` was narrowed to its intent: no control outside the decision section.

## 12. SCRUM-144 — confirm an event once essential arrangements are complete

The assigned coordinator confirms an event in `PREPARATION` when nothing essential is outstanding; an outstanding
venue booking or equipment request can be marked non-essential (`is_essential`) so it doesn't block. Rules and SQL in
[event-requests.md](event-requests.md#confirm-an-event-scrum-144).

> **SCRUM-144:** As an Event Coordinator, I want to confirm an event only when the arrangements essential to that
> event are complete, so that ConnectSphere never confirms an event it cannot deliver.
>
> 1. An event can only be confirmed once its essential arrangements are complete and it has passed the safety check.
> 2. On a multi-venue event, every essential venue booking must be approved.
> 3. If anything essential is outstanding, confirmation is blocked and the outstanding items are shown.
> 4. Non-essential outstanding actions do not block confirmation.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Rule (unit) | `backend/tests/unit/events/safetyReadiness.test.js` | Pure `checkArrangements`; requests built per test with ids and flags |
| Lifecycle (unit) | `backend/tests/unit/events/lifecycle.test.js` | Typed table: `PREPARATION → CONFIRMED`, no `APPROVED → CONFIRMED` |
| Repository (unit) | `backend/tests/unit/events/events.arrangements.test.js` | `recorder()` as in §2 |
| HTTP (integration) | `backend/tests/integration/events.safetyCheck.test.js` | As §9; in-memory event; `setArrangementEssential` answers only for request `cccccccc-0001-…` |
| Frontend (component) | `frontend/src/features/events/components/ConfirmEventControls.test.jsx` | Real components, service, hook and `apiFetch`; `fetch` stubbed |
| Frontend (page) | `frontend/src/features/events/pages/EventWorkspaceDetailPage.test.jsx` | As §8; the in-memory event answers `/confirm` |
| Playwright | `tests/playwright/confirm-event.api.spec.cjs`, `confirm-event.browser.spec.cjs` | Real Express app and UI; arrangements through the venue and equipment lanes' endpoints, submitted through SCRUM-139 and approved through SCRUM-141, 51–53 days ahead |
| Live DB (user-run) | `tests/e2e/confirm-event.spec.js`, `tests/e2e/support/live-confirmation-fixtures.js` | Shared dev Supabase; throwaway accounts, event, venue, booking rows and equipment unit, all deleted afterwards. Justified by the hand-made `is_essential` columns |

| ID | AC | Type | Scenario | Test data | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-SCRUM-144-01 | 1 | Happy | Confirm after the safety pass | `PREPARATION`, nothing essential outstanding | 200, `CONFIRMED`; write filtered on `PREPARATION` and the caller; badge *Confirmed* | `SCRUM-144 AC1: the assigned coordinator confirms an event in preparation…`; `[SCRUM-144-UI-002]`; `[SCRUM-144-UI-011]`; `[CONFIRM-API-001]`; `[E2E-CONFIRM-001]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-02 | 1 | Negative | No safety pass, or already confirmed | `APPROVED`, `SAFETY_REVIEW`, `CONFIRMED`, `CANCELLED`, `POSTPONED` | 409 refresh message; nothing written; no *Confirm event* section | `SCRUM-144 AC1: an event in %s … cannot be confirmed` (×5); `SCRUM-144 AC1: only an event that passed the safety check…` (lifecycle); `[SCRUM-144-UI-013]` (×3); `[CONFIRM-API-001]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-03 | 2 | Negative | Multi-venue: every essential booking listed | two pending essential booking requests beside a confirmed one | Each listed on its own line with its request id | `SCRUM-144 AC2: on a multi-venue event every essential venue still pending is listed…`; `[SCRUM-144-UI-001]`; `[CONFIRM-API-001]` (two days, one booking each) | 2026-10-19 · pass · local |
| TC-SCRUM-144-04 | 3 | Negative | Blocked, and the items shown | essential venue still pending | 409 "This event cannot be confirmed yet…" with `missing`; status unchanged; *Confirm event* disabled; a refused confirm reloads the list | `SCRUM-144 AC2/AC3: an essential venue still pending blocks confirmation…`; `[SCRUM-144-UI-001]`, `[SCRUM-144-UI-003]`; `[CONFIRM-API-001]`; `[E2E-CONFIRM-001]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-05 | 4 | Happy | Non-essential does not block | outstanding venue and equipment marked `is_essential = false` | Listed under `optional`; confirm 200; the items stay outstanding | `SCRUM-144 AC4: outstanding requests marked non-essential do not block…`; `…an essential item still blocks beside a non-essential one`; `SCRUM-144 AC4: a non-essential outstanding request does not block confirmation…`; `[SCRUM-144-UI-004]`; `[CONFIRM-API-001]`; `[E2E-CONFIRM-001]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-06 | 4 | Happy | Coordinator marks and unmarks | `APPROVED` and `PREPARATION` | PATCH writes only `is_essential` on that request of that event; lists move; Confirm / Submit follow | `SCRUM-144 AC4: the assigned coordinator marks a request non-essential while the event is %s` (×2); `…setArrangementEssential writes only is_essential…` (×2); `…findArrangements reads each request's is_essential flag`; `[SCRUM-144-UI-004]`, `-005`, `-010` | 2026-10-19 · pass · local |
| TC-SCRUM-144-07 | 4 | Boundary | A venue is always required; default is essential | only pending venue marked non-essential; request without the flag | "No venue booking has been approved yet." still blocks, with no mark button; an unflagged request blocks | `SCRUM-144 boundary: with no booked venue…`; `SCRUM-144: a request without the flag (column default) counts as essential`; `[SCRUM-144-UI-006]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-08 | 4 | Negative | Flag locked outside planning and preparation | `SAFETY_REVIEW`, `CONFIRMED`, `CANCELLED` | 409 "Arrangements can only be marked…"; nothing written; message shown on the page | `SCRUM-144 AC4: the flag cannot change while the event is %s` (×3); `[SCRUM-144-UI-007]`; `[CONFIRM-API-001]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-09 | 4 | Negative | Bad flag input | missing / `"no"` flag; kind `catering`; `not-a-uuid`; another event's request | 400 "Choose whether…"; 400 "That arrangement reference is not valid."; 404 "That arrangement is not part of this event." | `SCRUM-144 AC4: %s is a 400 and nothing is written` (×3); `…a malformed request id is a 400, and a request of another event is a 404`; `[CONFIRM-API-001]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-10 | 1, 4 | Negative | Only the assigned coordinator | no token; other coordinator, lead, Safety Officer, venue, tech support, organiser, attendee | 401; 403 on confirm and on the flag; nothing written; no section for them on the page | `SCRUM-144 access: …`; `[CONFIRM-API-001]`; `[SCRUM-144-UI-012]` (×3) | 2026-10-19 · pass · local |
| TC-SCRUM-144-11 | 1 | Conflict | Status changed between check and write | lost race | 409 | `SCRUM-144 conflict: a lost race…` | 2026-10-19 · pass · local |
| TC-SCRUM-144-12 | 1–4 | Failure | Storage down | readiness or flag write throws; readiness GET fails | 500 "Something went wrong. Please try again."; page shows it with *Try again* | `SCRUM-144 failure: storage errors answer a safe 500…`; `[SCRUM-144-UI-008]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-13 | 1–4 | Cross-cutting | Phone width and busy states | 375 px; confirm or mark in flight | No sideways scroll; *Confirming…* disabled; every mark button disabled while saving | `[E2E-CONFIRM-001]`; `[SCRUM-144-UI-009]`, `[SCRUM-144-UI-014]` | 2026-10-19 · pass · local |
| TC-SCRUM-144-14 | 4 | Regression | SCRUM-139 safety check follows the same rule | outstanding items marked non-essential during planning | Submit for safety check allowed; SCRUM-139 readiness answers carry `id` and `optional` | `[SCRUM-144-UI-010]`; `[CONFIRM-API-001]`; `[SAFETY-E2E-API-001]`, `[E2E-SAFETY-001]` (updated) | 2026-10-19 · pass · local |
| TC-SCRUM-144-15 | 4 | Happy | The hand-added columns match the code | real `venue_booking_requests` and `equipment_requests` rows | New rows default to `is_essential = true`; marking writes `false` to the real rows; readiness reads them through the real joins; confirm reaches `CONFIRMED` | `tests/e2e/confirm-event.spec.js` › `non-essential flags are stored on the real request rows and let the event be confirmed` | |

**Coverage (2026-10-19):** `safetyReadiness.js`, `safetyCheck.controller.js`, `safetyCheck.routes.js`, `lifecycle.js`,
`safetyService.js` and `ConfirmEventControls.jsx` 100% lines and branches; `setArrangementEssential` fully covered
(the uncovered lines in `events.repository.js` predate this story). `safetyCheck.service.js` 100% lines; the two
uncovered branches are `confirm` / `setEssential` finding no event, which HTTP cannot reach because the access check
already answers 403 for an unknown event (same shape as SCRUM-139's `submit`). `ArrangementChecklist.jsx` 100% lines;
its branch count is V8's dev-mode JSX entries, as in §10, and every real branch (with and without an id, busy,
error, empty lists) has a test.

**Test review:** removing the server's readiness re-check makes `[CONFIRM-API-001]` fail (the browser journey still
passes because the page also disables *Confirm event*, which is why the API journey exists). Pinned lists in
SCRUM-97/139/141 tests were updated for `PREPARATION → CONFIRMED`, the readiness `optional` list and item ids, not
loosened.

## 13. SCRUM-37 — flag edits that could invalidate existing arrangements

No live-DB or Playwright coverage was added for this story — every AC is provable at the mocked-repository /
component level, same reasoning as §9. Full design history and every scoping decision:
`.agent/docs/other/SCRUM-37-flag-significant-edits.md`.

> **SCRUM-37:** As an Event Coordinator, I want the system to flag edits that could invalidate existing
> arrangements so that only changes that matter trigger revalidation.
>
> 1. Changes to date, time, expected attendance, venue requirements, venue bookings or equipment requirements are
>    treated as significant.
> 2. Edits that cannot affect existing arrangements (for example description or internal notes) do not trigger
>    revalidation.
> 3. A significant change on an event with confirmed arrangements marks those arrangements for review.
> 4. The user is told, before saving, that the change will require arrangements (and safety review where
>    applicable) to be reviewed.

The team's own design reads AC3/AC4's "for review" as the full re-check chain — the coordinator re-approves the
edited request — and, after one design revision mid-build, resolves it by **releasing** arrangements outright on
that re-approval decision (approve or reject) rather than holding the same reservation for Technical Support or
Venue Staff to re-decide. See the task note's *Team design decision* for the word-for-word reasoning.

| Layer | File | Pre-conditions |
| --- | --- | --- |
| Lifecycle (unit) | `backend/tests/unit/events/lifecycle.test.js` | Extended with four new edges to `SUBMITTED` (from `APPROVED`, `SAFETY_REVIEW`, `PREPARATION`, `CONFIRMED`) in `AGREED_TRANSITIONS`; the existing `SAFETY_REVIEW` target-list assertion fixed to include `SUBMITTED`. Same "typed from the agreed table" discipline as §3 — the exhaustive "every other pair stays refused" test extends automatically. |
| Significance + regression (SQL, not JS) | `apply_organiser_event_edit` | One `plpgsql` function, applied by hand to the shared dev Supabase (no migration file) — the field write, the `is distinct from` significance check and the conditional `SUBMITTED` write are one transaction, so a mid-way failure can't leave an unreviewed edit live on a still-`CONFIRMED` event. Not independently testable at the JS layer (no live-DB suite was budgeted for this story); verified by reading the function. |
| RPC call shape (unit) | `backend/tests/unit/events/eventWorkspace.service.test.js` | `setup()`'s fake `client.rpc` replaced the old `equipmentService`/`updates`-tracking doubles; every `WRITABLE_COLS` field given a real fixture value (not left `undefined`) specifically so a gap in `FIELDS` shows up as a wrong argument, not a silent pass. |
| Release wiring (integration) | `backend/tests/integration/events.review.test.js` | `approve()`/`reject()` extended with the same `equipmentService`/`releaseVenueBookingsForCancelledEvent` dependencies `cancel`/`postpone` already had; `review.controller.js#approve` became its own dedicated handler (previously routed through the generic `handle` wrapper) so it could thread them through. |
| Component | `frontend/src/features/events/components/EventRequestForm.test.jsx` | New file: `AuthContext.Provider` + `vi.stubGlobal("fetch", ...)`, same pattern as `EventCancelControl.test.jsx`. |

| ID | AC | Type | Scenario | Expected result | Automated test | Latest execution |
| --- | --- | --- | --- | --- | --- | --- |
| TC-150-01/SCRUM-37 | 1 | Happy | Changing `start_time` | RPC called once with the new value merged onto every other current field | `eventWorkspace.service.test.js` › `[TC-150-01/SCRUM-37] changing start_time calls apply_organiser_event_edit with the new value merged onto the unchanged fields` | 2026-10-21 · pass · local |
| TC-150-03/SCRUM-37 | 1 | Negative | Resubmitting identical `start_time`/`end_time`/`equipment_needs` values | RPC still called — significance is the function's own decision now, not the caller's | `eventWorkspace.service.test.js` › `[TC-150-03/SCRUM-37] …` | 2026-10-21 · pass · local |
| TC-150-22/SCRUM-37 | 1, 2 | Negative | A change unrelated to date/time/equipment (`name`) | RPC called with `name` updated and every other field carried over unchanged | `eventWorkspace.service.test.js` › `[TC-150-22/SCRUM-37] …` | 2026-10-21 · pass · local |
| TC-37-21 | — | Failure | Every writable column reaches the function as a real value, never `undefined`, including fields the edit itself didn't touch | Complete RPC argument object asserted (not `objectContaining`) | `eventWorkspace.service.test.js` › `[TC-37-21] …` | 2026-10-21 · pass · local |
| — | — | Happy | `APPROVED`/`SAFETY_REVIEW`/`PREPARATION`/`CONFIRMED` each permit a transition to `SUBMITTED` (`test.each`, 4 rows) | Each new edge is a permitted transition; no other pair becomes permitted as a side effect | `lifecycle.test.js`'s extended `AGREED_TRANSITIONS` table and exhaustive-refusal test | 2026-10-21 · pass · local |
| TC-37-13 | 3 | Happy | Coordinator rejects the re-submitted event | `REJECTED`; both release calls made exactly once; the event's edited field is **not** reverted (known limitation, below) | `events.review.test.js` › `[SCRUM-37] TC-37-13: …` | 2026-10-21 · pass · local |
| TC-37-14 | 3 | Negative | Rejecting a first-time submission that never had arrangements | Release calls are safe no-ops | `events.review.test.js` › `[SCRUM-37] TC-37-14: …` | 2026-10-21 · pass · local |
| — | — | Boundary | Rejecting without a reason (400) | Neither release call made | `events.review.test.js` (boundary assertion alongside TC-37-13/14) | 2026-10-21 · pass · local |
| TC-37-19 | 3 | Happy | Approving a resubmission | `APPROVED`; both release calls made exactly once | `events.review.test.js` › `[SCRUM-37] TC-37-19: …` | 2026-10-21 · pass · local |
| TC-37-20 | 3 | Negative | Approving a first-time submission that never had arrangements | Release calls are safe no-ops | `events.review.test.js` › `[SCRUM-37] TC-37-20: …` | 2026-10-21 · pass · local |
| — | — | Boundary | Approving with an invalid note (400) | Neither release call made | `events.review.test.js` (boundary assertion alongside TC-37-19/20) | 2026-10-21 · pass · local |
| TC-37-FE-01 | 4 | Happy | A significant edit on an `APPROVED`/`SAFETY_REVIEW`/`PREPARATION`/`CONFIRMED` event (`test.each`, 4 statuses) | Warning shown; names safety review only for the latter three | `EventRequestForm.test.jsx` | 2026-10-21 · pass · local |
| TC-37-FE-02 | 4 | Boundary | Backing out with "Never mind" | Warning dismissed; nothing sent | `EventRequestForm.test.jsx` | 2026-10-21 · pass · local |
| TC-37-FE-03 | 4 | Happy | Confirming a second time | PATCH sent with the changed field | `EventRequestForm.test.jsx` | 2026-10-21 · pass · local |
| TC-37-FE-04 | 4 | Boundary | Editing another field while the warning is showing | Warning dismissed — what's about to save changed | `EventRequestForm.test.jsx` | 2026-10-21 · pass · local |
| TC-37-FE-05 | 2, 4 | Negative | A non-significant edit on a `CONFIRMED` event | Saves in one click, no warning | `EventRequestForm.test.jsx` | 2026-10-21 · pass · local |
| TC-37-FE-06 | 4 | Negative | A significant edit on a `SUBMITTED`/`UNDER_REVIEW` event (`test.each`, 2 statuses) | Saves in one click — nothing live to protect yet | `EventRequestForm.test.jsx` | 2026-10-21 · pass · local |

**Not independently tested, by design:** atomicity (the single-transaction property of `apply_organiser_event_edit`)
is structural, not something a JS-level test can exercise without a live-DB suite — none was budgeted for this
story (conventions.md §3's 1–3-per-epic limit); verifiable by reading the function. Whether the Event Coordinator
Lead's unconditional cancel/postpone access extends to approve/reject is true by code (`review.controller.js`'s
`approve`/`reject` take no `isCoordinatorLead`) but has no dedicated test — worth adding if graded on coverage
specifically, not required for the story to function.

**Test review.** Each case was checked against a plausible wrong implementation:

| Mutation | Test that goes red |
| --- | --- |
| Leave `FIELDS` missing a `WRITABLE_COLS` column (the live bug this story found and fixed — `registration_start`/`_end`) | TC-37-21 |
| Drop any of the four new `TRANSITIONS` edges | the `lifecycle.test.js` `test.each` row for that status |
| Add an edge not in the agreed table as a side effect | the exhaustive "every other pair stays refused" test |
| Call the release functions before the status write succeeds, or on a failed decision | the boundary assertions alongside TC-37-13/14/19/20 |
| Skip the release call entirely on approve, or forget it on reject | TC-37-19, TC-37-13 |
| Show the warning for a non-significant field, or skip it for a significant one | TC-37-FE-01, TC-37-FE-05, TC-37-FE-06 |
| Leave the warning up after a further edit changes what's about to save | TC-37-FE-04 |

**Coverage (2026-10-21):** full backend suite 1181 passed, 51 skipped (live-DB, by design, unrelated to this
story); full frontend suite 546 passed; lint and build clean on both.

**Known limitation (documented, not a bug):** rejecting a resubmission ends the whole event — it cannot undo just
the edit and leave the event exactly as it was before. See [Current limitations](event-requests.md#current-limitations)
and the task note's own *Known limitation* for the full reasoning and which story (SCRUM-36) would close it.

**SCRUM-150 cross-reference.** This story retires SCRUM-150's own `flagReservationsForReview` and its AC1
("marks reservations for review") trigger — see
[equipment-integration.md](equipment-integration.md#reviewing-equipment-on-a-reschedule-scrum-150)'s SCRUM-37
addendum and `.agent/docs/other/SCRUM-150-equipment-reschedule-review.md`'s own addendum for exactly what stays
dormant versus what was deleted outright.

## 14. Requirements sources

| Ref | What it says |
| --- | --- |
| **SCRUM-97** (backlog US-40) | Progress an event through its status lifecycle, 3 SP. AC in §1. |
| Team-agreed lifecycle table | The 8 statuses and 10 permitted moves; recorded in `.agent/docs/architecture.md` §Database. `APPROVED` is the stored value for "approved / planning" because Registration and Venue already query it. |
| **SCRUM-98**, **SCRUM-99** (backlog US-36, US-38) | Review and approve: the actions that use this lifecycle. See §8. |
| **SCRUM-139** (backlog US-83) | Submit for the Operational Safety Check, 3 SP. See §9. |
| **SCRUM-141** (backlog US-85) | Approve or reject the safety arrangement, 2 SP. See §11. Rejection back to `APPROVED` is roadmap decision 4; history is optional in Release 1 (#33) but this story's AC4 requires it. |
| **SCRUM-144** (backlog US-41) | Confirm an event once essential arrangements are complete, 1 SP. See §12. Discussions #106 (the coordinator decides with Technical Support whether an item is essential) and #80 (essential arrangements are event-specific; non-essential follow-ups may remain). |
| **SCRUM-37** (backlog US-37) | Flag edits that could invalidate existing arrangements, so only changes that matter trigger revalidation. See §13. The release-on-decision mechanism (regress to `SUBMITTED`, release on approve or reject) is a **team design decision**, not a customer clarification — AC3/AC4 don't specify it themselves; recorded word for word in the task note. |
| Discussions #80, #94, #95, #101, #125 | The assigned coordinator decides; the manager only assigns; assignment doesn't start review; `approved_rejected_by` kept apart from `coordinator_id`; who sees the outcome |
