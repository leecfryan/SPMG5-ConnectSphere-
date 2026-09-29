# Event Status Lifecycle — Test Documentation

**Deliverable evidence for SCRUM-97 (Progress an event through its status lifecycle), epic Event Lifecycle &
Approval.** Branch: `feature/eventLifecycleStatus` · **15 documented cases, 43 automated tests, all passing**
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
| Repository (unit) | `backend/tests/unit/events/events.transition.test.js` | 6 | `recorder()` stubs Supabase with a Proxy that records every query-builder call and resolves to a chosen `{ data, error }`. Modules are reset before each test. |
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

**No user action moves an event past `SUBMITTED` yet.** AC2's "consequence of an action a permitted user
performed" needs the actions themselves: review (SCRUM-98) and approve/reject (SCRUM-99). Until then AC2 is
proven at the foundation — status can't be edited freely, and the only writer checks the lifecycle and is
race-safe — not through an endpoint with a permission guard. Those stories add integration tests for 401 / 403 /
404 / 409 on each action.

**Invalid moves are refused in code, not yet through the app.** TC-03 to TC-09 prove the rule. The API-level
refusal (409 on, say, approving an event that is still `SUBMITTED`) arrives with SCRUM-99's endpoint.

**The coordinator can't see status yet.** The badge appears on the organiser's request page and the Operations
Manager's assignment queue and detail panel. The coordinator's own views are SCRUM-98. No Playwright case checks
status across roles; the roadmap's end-to-end journey (submit → assign → review → approve, status visible at each
step) closes AC2–AC4 for all three stories.

**Nothing here proves the database refuses an invalid value.** TC-15 confirms the constraint's definition, not
that an insert of `'BOGUS'` fails. `transitionStatus` never sends an unlisted value, so that path cannot be reached
through the code.

---

## 8. Requirements sources

| Ref | What it says |
| --- | --- |
| **SCRUM-97** (backlog US-40) | Progress an event through its status lifecycle, 3 SP. AC in §1. |
| Team-agreed lifecycle table | The 8 statuses and 10 permitted moves; recorded in `.agent/docs/architecture.md` §Database. `APPROVED` is the stored value for "approved / planning" because Registration and Venue already query it. |
| **SCRUM-98**, **SCRUM-99** | Review and approve: the actions that use this lifecycle. See §7. |
