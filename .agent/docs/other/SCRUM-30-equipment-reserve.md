# SCRUM-30 — Reserve Available Equipment for an Event

**Backlog ID:** US-30 · **Epic:** Equipment · **Lane:** Equipment · **Points:** TBD · **Assignee:** ky
**Branch:** `feature/equipmentReserveFlow` (proposed) · **Mode:** build
**State:** 🔧 in progress (2026-10-02)

## Contract (word for word, as given by the user on 2026-10-02)

> **Story:** As Technical Support Staff, I want to reserve available equipment for an event so that the same limited
> equipment is not simultaneously committed to incompatible events.
>
> **Acceptance criteria**
> 1. Technical Support Staff can add, update and retire equipment records.
> 2. Each record carries type, description, quantity held, location and operational status.
> 3. The system knows the quantity available for any equipment type at any time.
> 4. Catalogue changes are reflected immediately in availability checks.
> 5. No negative values.

Full build prompt (scope boundary, locked model decisions, schema, day-granularity mapping, availability rule,
explicit DO-NOTs) supplied by the user alongside the AC — kept in session context, summarised into *Decisions* below
rather than repeated here in full.

## Plan against the acceptance criteria

| AC | Requirement (short) | How it's built | How it's proven (test IDs, layer) | Done |
|---|---|---|---|---|
| 1 | Add/update/retire equipment records | New `createEquipment`, `updateEquipment`, `retireEquipment` in `equipment.service.js`; new validation in `equipment.validation.js`; new controller actions + `POST /equipment`, `PATCH /equipment/:id`, `PATCH /equipment/:id/retire` routes guarded by new `equipment.manage` permission (`technical_support_staff` only); catalogue UI gets Add/Edit/Retire actions | TC-30-01..05, unit (validation) + functional (role gating, fakes) + live-DB integration | ☑ |
| 2 | Record carries type, description, quantity held (row count), location, status | Validation requires `type`/`current_location` non-empty, `description` nullable, `status` in allowed set; "quantity held" = count of rows per type, no stored column | TC-30-06..08, unit + live-DB count check | ☑ |
| 3 | System knows available quantity per type, any time | Reuse Scrum-29 `checkAvailability`/`findAvailableUnits` unchanged; reserve flow calls the same path for one unit + window before creating a request | TC-30-09..10, reuse Scrum-29 coverage + new reserve-specific case | ☑ |
| 4 | Catalogue changes reflect immediately in availability | No caching anywhere in the read path today (verified) — every add/update/retire write is followed by a fresh Supabase read on the next availability call, so this holds by construction; must not introduce caching | TC-30-11..12, live-DB: add unit → availability +1; retire unit → availability -1, same request | ☑ |
| 5 | No negative values | No quantity column exists to go negative; reserve flow enforces `quantity_requested = 1` and rejects over-commit via the existing overlap check; availability count can't go below 0 since it's `array.length` | TC-30-13..14, boundary: last unit of a type, exactly-touching-day booking | ☑ |

## Test cases

Written and agreed **before** code. Expected results come from the AC and clarifications, never from the code.
Column set is the team's standard test case register format (2026-10-02; see `.agent/docs/conventions.md` §Testing
and `.agent/tasks/_template.md`). All cases below were executed once already as part of building the story — see
*Actual Result*/*Remarks* for what each one found.

| Epic | Scrum-# | AC # | Type | Test Case ID | Test Scenario | Pre-conditions | Test Steps | Test Data | Expected Result | Created By* | Date of Creation* | Actual Result | Pass / Fail / Not Executed / Blocked | Remarks | Executed By | Date of Execution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Equipment | SCRUM-30 | 1 | Happy | TC-SCRUM-30-01 | Check that a Technical Support Staff member can add a brand-new physical equipment unit to the catalogue. | Signed in as `technical.demo@example.com` (role `technical_support_staff`, holds `equipment.manage`). No equipment row with this test's generated id exists yet. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "a technical support staff member can add a new record"`.<br>2. The test sends `POST /api/equipment` with the body in Test Data, bearer token scoped to `technical_support_staff`.<br>3. Confirm the response status and that the returned row matches every submitted field. | `{"type":"Projector","description":"4K projector","current_location":"Store A"}` | HTTP 201. Response body's `data` object has `type: "Projector"`, `description: "4K projector"`, `current_location: "Store A"`, and `status: "AVAILABLE"` (schema default, not supplied). | ky | 2026-10-02 | Request returned 201 with all four fields matching exactly; row was visible in a follow-up `GET /api/equipment` call within the same test. | Pass | New Scrum-30 test, live dev Supabase (not a fake). Row cleaned up in `afterEach`. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 1 | Happy | TC-SCRUM-30-02 | Check that a Technical Support Staff member can edit an existing equipment record's description and status together. | Signed in as `technical_support_staff`. One equipment row already exists (inserted directly via Supabase client in the test's setup, type `AVAILABLE`). | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "a technical support staff member can update type, description, location and status"`.<br>2. The test sends `PATCH /api/equipment/:id` with only `description` and `status` in the body.<br>3. Confirm the untouched fields (`type`, `current_location`) are unchanged in the response. | `{"description":"Needs a new bulb","status":"MAINTENANCE"}` | HTTP 200. Response's `data.description` is `"Needs a new bulb"`, `data.status` is `"MAINTENANCE"`, and `data.type`/`data.current_location` are unchanged from the pre-existing row. | ky | 2026-10-02 | All four field values matched exactly; partial update did not disturb the untouched columns. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 1 | Happy | TC-SCRUM-30-03 | Check that retiring a unit sets it to UNAVAILABLE and keeps the row on record rather than deleting it. | Signed in as `technical_support_staff`. One equipment row exists with `status: "AVAILABLE"`. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "retiring a record sets status to UNAVAILABLE and the row still exists"`.<br>2. The test sends `PATCH /api/equipment/:id/retire` with no body.<br>3. The test then calls `GET /api/equipment` and checks the same id is still present in the list. | None (retire takes no body; the target id is the row inserted in setup). | HTTP 200, `data.status` is `"UNAVAILABLE"`. The subsequent catalogue read still contains a row with this id — it is not deleted. | ky | 2026-10-02 | Status became `UNAVAILABLE`; the id was present in the follow-up catalogue fetch. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 1 | Negative | TC-SCRUM-30-04 | Check that an Event Coordinator — holding `equipment.request` but not `equipment.manage` — is refused on all three management actions (add, update, retire). | Signed in as `coordinator.demo@example.com` (role `event_coordinator`). | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "an Event Coordinator cannot add a record"`.<br>2. Separately run `-t "a Coordinator cannot update"` and `-t "a Coordinator cannot retire"` (the other two role-gating cases in the same file).<br>3. For each, confirm the response status and that no row was created or changed as a side effect. | Same valid bodies as TC-SCRUM-30-01/02 (an otherwise-valid create/update payload, and no body for retire). | HTTP 403 on all three calls, with no new row created (POST) and no field changed (PATCH/retire). | ky | 2026-10-02 | All three calls returned 403; a follow-up catalogue read confirmed no row was created and the existing row's fields were unchanged. | Pass | New Scrum-30 tests, live dev Supabase, 3 separate `it` blocks. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 1 | Failure | TC-SCRUM-30-05 | Check that an unauthenticated request to add equipment is rejected before any data access, not just permission-denied. | No `Authorization` header sent at all. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "an Event Coordinator cannot add a record (403); unauthenticated is 401"` (both assertions live in the same test). | A valid create body, sent with no bearer token. | HTTP 401. | ky | 2026-10-02 | Response was 401, confirmed before any permission or equipment-service code ran. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 1 | Negative | TC-SCRUM-30-05b | Check that the pre-existing quick operational-status endpoint can no longer be used to set a unit to UNAVAILABLE — retire must be the only path there. | Signed in as `technical_support_staff` (holds `equipment.review`, which gates this endpoint). One equipment row exists, `status: "AVAILABLE"`. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "the quick status endpoint .* rejects UNAVAILABLE"`.<br>2. The test sends `PATCH /api/equipment/:id/status` with `{"status":"UNAVAILABLE"}`.<br>3. Separately run `npx vitest run tests/unit/equipment-reserve.test.js -t "validateEquipmentStatusUpdate rejects UNAVAILABLE"` for the pure-logic equivalent. | `{"status":"UNAVAILABLE"}` | HTTP 400 from the API call; the pure validator returns `{ok:false}` with an error naming the `status` field. | ky | 2026-10-02 | Both the API call and the unit-level validator rejected `UNAVAILABLE` as expected. | Pass | New Scrum-30 tests, one live-DB integration + one pure unit test. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 2 | Happy | TC-SCRUM-30-06 | Check that a newly created record carries every AC2 field (type, description, location, status) when read back through the catalogue. | Signed in as `technical_support_staff`. No pre-existing row for this test's generated type. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "a newly created record's fields round-trip through the catalogue read"`.<br>2. The test creates a record via `POST /api/equipment`, then reads it back via `GET /api/equipment` and locates it by id. | `{"type":"<fresh-generated-type>","description":"Wireless lapel mic","current_location":"Store B"}` | The catalogue entry for this id has `type`, `description`, `current_location` matching exactly what was submitted, and `status: "AVAILABLE"`. | ky | 2026-10-02 | All fields matched on the round-trip read. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 2 | Negative | TC-SCRUM-30-07 | Check that creating a record without `type` or `current_location` is rejected with a validation error naming the missing field(s), not a generic failure. | None (pure function, no DB, no auth). | 1. From `backend/`, run `npx vitest run tests/unit/equipment-reserve.test.js -t "type and current_location are required"`.<br>2. The test calls `validateCreateEquipment` with each of `undefined`, `null`, `""`, and `"   "` for both fields in turn. | `{type: <bad value>, current_location: <bad value>}` for each of the four bad values above. | `{ok:false}` every time, with `errors` containing entries for both `type` and `current_location`. | ky | 2026-10-02 | All four bad-value variants produced `ok:false` with both fields named in `errors`. | Pass | New Scrum-30 test, pure unit, no DB. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 2 | Boundary | TC-SCRUM-30-08 | Check that "quantity held" for a type is derived by counting physical rows, not read from any stored quantity column, by seeding exactly 3 units of one fresh type. | Signed in as `technical_support_staff`. Three equipment rows exist, same freshly generated type, all `status: "AVAILABLE"`, no competing requests. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "quantity held for a type is the count of its rows, not a stored number"`.<br>2. The test calls `GET /api/equipment/availability` for that type and a window with no conflicting bookings. | Query: `type=<fresh-type>&start=2026-09-10T09:00:00Z&end=2026-09-10T17:00:00Z&quantity=1&location=Main%20Hall` | `available_quantity` is exactly `3`. | ky | 2026-10-02 | `available_quantity` was `3`, matching the number of rows inserted. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 3 | Happy | TC-SCRUM-30-09 | Check that the availability check still correctly excludes a unit with an overlapping booking, proving Scrum-29's logic needed no change for Scrum-30. | Two equipment units of the same type exist; one has a `PENDING` request for the window under test. | 1. From `backend/`, run `npx vitest run tests/integration/equipment.availability.test.js -t "a unit with an overlapping PENDING request for another event is excluded"`. | Window `2026-09-10T09:00:00Z`–`2026-09-10T17:00:00Z`, overlapping an existing `PENDING` request on one of the two units. | `available_quantity` is `1`; `available_equipment_ids` contains only the non-booked unit's id. | ky | 2026-10-02 | `available_quantity` was `1` with the correct single id returned — unchanged from Scrum-29's original result. | Pass | Pre-existing Scrum-29 test, reused unmodified — no new Scrum-30 test needed for AC3. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 3 | Conflict | TC-SCRUM-30-10 | Check that attempting to reserve a unit already committed to an overlapping window is refused with a conflict, not silently double-booked. | One equipment unit exists with an `APPROVED` request covering the target window. | 1. From `backend/`, run `npx vitest run tests/integration/equipment.availability.test.js -t "equipment excluded by Return Day \+ 1.*cannot be successfully requested"` (the create-path equivalent of the availability exclusion). | `POST /api/events/:eventId/equipment-requests` with that unit's id and an overlapping `borrow_start`/`borrow_end`. | HTTP 409, and no new `equipment_requests` row is created. | ky | 2026-10-02 | Response was 409; a follow-up count of `equipment_requests` for that unit was unchanged. | Pass | Pre-existing Scrum-29 test, reused unmodified. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 4 | Happy | TC-SCRUM-30-11 | Check that adding a new unit of a type is visible in that type's availability count on the very next read, with no caching delay. | Signed in as `technical_support_staff`. One existing unit of a fresh type, baseline `available_quantity` of `1`. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "adding a new unit of a type immediately increases its available quantity"`.<br>2. The test reads availability (baseline), then `POST`s a second unit of the same type, then reads availability again in the same test run. | Second unit: `{"type":"<same fresh type>","current_location":"Store A"}` | Second availability read returns `available_quantity: 2`, one more than the baseline, with no delay or retry needed. | ky | 2026-10-02 | Baseline was `1`; immediately after the POST, the second read returned `2`. | Pass | New Scrum-30 test, live dev Supabase, single test run (no polling/wait). | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 4 | Happy | TC-SCRUM-30-12 | Check that retiring a unit removes it from that type's availability count on the very next read. | Signed in as `technical_support_staff`. One existing unit of a fresh type, baseline `available_quantity` of `1`. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "retiring a unit immediately decreases its available quantity"`.<br>2. The test reads availability (baseline), then `PATCH`es that unit's `/retire`, then reads availability again. | None (retire takes no body). | Second availability read returns `available_quantity: 0`. | ky | 2026-10-02 | Baseline was `1`; immediately after the retire call, the second read returned `0`. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 5 | Boundary | TC-SCRUM-30-13 | Check that retiring the only unit of a type drives its availability to exactly 0, never a negative number. | Signed in as `technical_support_staff`. Exactly one equipment unit exists for a fresh type, `status: "AVAILABLE"`, no competing requests. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "retiring the only unit of a type never reports a negative available quantity"`.<br>2. The test retires that single unit, then reads availability for the type. | None. | `available_quantity` is `0` (not `-1` or any negative value). | ky | 2026-10-02 | `available_quantity` was exactly `0`. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 5 | Boundary | TC-SCRUM-30-14 | Check that a booking starting on the exact calendar day an existing booking for the same unit ends is still blocked (Return Day + 1, touching endpoints count as overlap). | One equipment unit has an existing `PENDING` request ending on day D (`borrow_end` on 2026-01-01). | 1. From `backend/`, run `node --test --test-name-pattern "a window starting the same calendar day the existing request ends is now blocked" tests/unit/equipment/equipment.service.test.js`. | New window: `borrow_start` at `2026-01-01T12:00:00.000Z` (same calendar day the existing request's `borrow_end` falls on). | `hasOverlappingRequest` returns `true` — the new window is blocked. | ky | 2026-10-02 | Returned `true` as expected; unchanged from before Scrum-30. | Pass | Pre-existing Scrum-29 test (node:test), reused unmodified. | ky | 2026-10-02 |
| Equipment | SCRUM-30 | 5 | Boundary | TC-SCRUM-30-15 | Check that querying availability for a type with zero equipment rows at all returns a clean zero rather than an error or a negative value. | No equipment row anywhere in the dev database uses this test's freshly generated type. | 1. From `backend/`, run `npx vitest run tests/integration/equipment-reserve.test.js -t "an empty type .* reports zero, not negative or an error"`.<br>2. The test queries `GET /api/equipment/availability` for a type string that has never been inserted. | Query: `type=<never-used fresh type>&start=2026-09-10T09:00:00Z&end=2026-09-10T17:00:00Z&quantity=1&location=Main%20Hall` | HTTP 200, `available_quantity: 0`. No 404 or 500. | ky | 2026-10-02 | Response was 200 with `available_quantity: 0`. | Pass | New Scrum-30 test, live dev Supabase. | ky | 2026-10-02 |

**Coverage** (story's files): 28 new backend Vitest tests (15 unit + 13 integration) + 17 new frontend Vitest tests;
full regression (265 backend Vitest + 64 backend node:test + 196 frontend) green. Gap: `validateCreateRequest`'s
multi-quantity acceptance (values > 1) is no longer exercised by any test, at the user's request — see *Decisions*
and *Log*; re-widen in Scrum-31.

**Test review** (five questions): TBD after tests are written

## Deliberately absent

Neighbouring behaviour this story does **not** build, and the story that owns it.

| Behaviour | Belongs to |
|---|---|
| Multi-quantity reserve ("reserve 3 projectors"), `request_group_id`, junction tables, multi-row requests | Scrum-31 |
| "X available" modal / requested-quantity validation UI, partial approval | Scrum-31 |
| Location-based availability filtering | Not yet scoped |
| Timestamp-level return handling (sub-day granularity) | Not yet scoped |
| Notifications, audit logs, history tables | Not yet scoped |
| Auto-revert `equipment.status` on approval / return | Flagged in Scrum-29 notes as a future story; still not built |
| ~~Normalising messy `type` values~~ — user will standardise formatting directly in Supabase (2026-10-02) | Resolved, not this story |

## Decisions

- **Model (locked by the user's brief, not re-litigated):** 1 row = 1 physical item; no `quantity_held`/`retired_at`
  columns; retire = `status = 'UNAVAILABLE'`; approval never writes `equipment.status`; location is display-only,
  never a filter; `PENDING` and `APPROVED` both block availability identically.
- **`description` column:** brief said to add it via Supabase dashboard SQL; live check (read-only, 2026-10-02)
  shows it already exists on `public.equipment`. No schema change needed for this story.
- **Status allowlist verified:** `isStatusAvailable` in `equipment.validation.js` already uses the allowlist form
  (`status === 'AVAILABLE'`), confirmed live data never relies on a denylist. `UNDER_MAINTENANCE` requires no fix.
- **Access model:** brief said "reuse `public.has_role(text)`" / RLS — that function doesn't exist anywhere in this
  repo (confirmed by grep). User confirmed (2026-10-02): follow the repo's actual model instead —
  `requireAuth` + `requirePermission`, gated on role `technical_support_staff`. A new permission,
  `equipment.manage`, is needed (AC1's add/update/retire is not covered by the existing `equipment.review`
  permission, which only ever allowed a status PATCH).
- **E2E test location:** new live-DB E2E specs for this story go into `tests/e2e/` (self-contained, live Supabase),
  matching the Scrum-29 precedent — not the fake-simulator `tests/playwright/`.
- **CI wiring for `tests/e2e/` is on hold** (2026-10-02) — user is raising a `playwright-live` CI job proposal with
  the team separately; not blocking this story's build, but this story's new E2E specs won't run in CI until that
  lands.
- **Reserve flow UI (resolved 2026-10-02):** `EquipmentRequestForm.jsx` rebuilt entirely into the two-step flow
  (type dropdown → window → available-items list with read-only location → pick one). Quantity field removed from
  the UI; `quantity_requested` is always sent as `1`. Scrum-29's multi-unit `checkAvailability`/`findAvailableUnits`
  and the `quantity_requested` column are untouched and still fully tested — just unreachable from this form until
  Scrum-31 re-wires multi-unit selection into the UI.
- **Catalogue action area (resolved 2026-10-02):** rebuilt with an "Add equipment" entry point, per-row Edit and
  Retire actions (both `equipment.manage`), and the existing inline status dropdown kept for quick operational
  changes (`equipment.review`, now `OPERATIONAL_STATUSES` only — excludes `UNAVAILABLE`). Retired items are
  filtered out by default with a "Show retired equipment" toggle; shown greyed when revealed, never deleted.
- **Retire confirmation pattern:** no modal. Found the repo's actual existing convention for a destructive-ish
  action — `WithdrawButton.jsx` in registrations, an inline button → confirm-panel toggle, no dialog at all.
  Mirrored it exactly as `RetireButton.jsx` rather than building a new `ConfirmModal` (first attempted, then
  reconsidered after the user asked to check existing patterns first).
- **No new `GET /equipment/:id` endpoint.** First planned for the Edit page's prefill, then dropped after the user
  questioned its necessity — the Edit page reuses the existing `GET /equipment` (already fetched whole elsewhere
  in this feature, e.g. `EquipmentRequestPage`'s `equipmentLabel`) and finds the record client-side by id.
- **New permission:** `equipment.manage`, role `technical_support_staff` only (distinct from `equipment.review`,
  which only ever gated the status-only PATCH) — confirmed against the repo's dot-notation convention.

## Touches

- **Shared files:** `backend/src/auth/permissions.js` (new `equipment.manage` entry); `frontend/src/App.jsx` (two
  new routes, same pattern as the existing flat equipment routes)
- **Schema change (manual, no migration file):** none — `description` column already exists live
- **New permission:** `equipment.manage` — role `technical_support_staff`
- **New routes:** `POST /api/equipment`, `PATCH /api/equipment/:id`, `PATCH /api/equipment/:id/retire` (backend);
  `/equipment/catalogue/new`, `/equipment/catalogue/:id/edit` (frontend, both gated `equipment.manage`)
- **New files:** `EquipmentForm.jsx`, `EquipmentFormPage.jsx`, `RetireButton.jsx` + their test files

## Slices

1. Backend: `createEquipment`/`updateEquipment`/`retireEquipment` + validation + `equipment.manage` permission +
   routes (riskiest — new permission, new write paths)
2. Backend: reserve-flow endpoint reusing Scrum-29 availability check for one unit/window
3. Frontend: catalogue page Add/Edit/Retire UI
4. Frontend: reserve flow UI (type dropdown → available-items list → pick one) — pending the open decision above
5. Live-DB E2E specs in `tests/e2e/` covering the full reserve path

## Manual demo steps

TBD once built.

## Explain-back

TBD at hand-off.

## Found, not built

- Live `equipment.type` values are inconsistent (`"PROJECTOR"` vs `"Projector"`, `"MICROPHONE"` vs
  `"Wireless Microphone"`) — the type dropdown (distinct `type`) will surface near-duplicates. Not a Scrum-30 fix;
  flagging for the Product Owner / backlog.
- `tests/e2e/` is not wired into CI (user raising separately with the team, 2026-10-02).

## Log

- 2026-10-02 — created; mode chosen: build. Verified live schema (description column already present, status
  allowlist already correct). Confirmed `has_role`/RLS doesn't apply — using `requirePermission` instead. Two open
  UI-shape decisions raised with the user before building the reserve-flow and catalogue-action UI.
- 2026-10-02 — slice 1 (backend AC1) done: `equipment.manage` permission; `createEquipment`/`updateEquipment`/
  `retireEquipment` in the service; `validateCreateEquipment`/`validateUpdateEquipment` in validation;
  `POST /equipment`, `PATCH /equipment/:id`, `PATCH /equipment/:id/retire` routes. Decision made while coding:
  `equipment.review`'s quick status PATCH now rejects `UNAVAILABLE` via a new `OPERATIONAL_STATUSES` allowlist
  (full `EQUIPMENT_STATUSES` minus `UNAVAILABLE`) — retire is the only path there, per the user's instruction to
  scope the dropdown to operational statuses. TC-SCRUM-30-01..14 written (15 pure-logic unit tests in
  `tests/unit/equipment-reserve.test.js`, 13 live-DB integration tests in `tests/integration/equipment-reserve.test.js`,
  both Vitest per [[feedback_test_framework]] — the legacy node:test equipment suite is untouched). Fixed one
  exhaustive permission-list assertion in `tests/integration/auth.test.js` that correctly caught the new permission.
  Full regression (`npm test`, `npm run check`): 265 tests green, lint clean, no leftover test rows in the dev DB.
- 2026-10-02 — slice 2 (frontend) done: catalogue page rebuilt (Add/Edit/Retire, retired-filter toggle,
  operational-only quick-status dropdown); `EquipmentForm`/`EquipmentFormPage`/`RetireButton` added; reserve flow's
  `EquipmentRequestForm` rebuilt into the two-step type→item flow, quantity field removed. 17 new frontend tests
  (Vitest + Testing Library) all passing; full frontend regression (`npm test`, `npm run lint`, `npm run build`):
  197 tests green, lint clean, build succeeds. No backend changes needed for AC3/AC4's reserve-flow requirement —
  the existing `POST /events/:eventId/equipment-requests` already runs the Scrum-29 availability check before
  creating a request.
- 2026-10-02 — at the user's request, narrowed two pre-existing Scrum-27 tests that exercised multi-unit quantities
  (`equipment.validation.test.js`'s `[1, 2, 100]` range check → `[1]`; `equipment.functional.test.js`'s "a valid
  quantity is persisted" test, `quantity_requested: 5` → `1`), plus three incidental fixture defaults
  (`completeInput()`, `validCreatePayload()`, the Scrum-28 dashboard fixture) from 2/3 → 1. **Accepted coverage
  gap**: `validateCreateRequest` and the create-request path still accept and persist any positive integer
  (code unchanged), but that range is no longer exercised by any test. Re-widen in Scrum-31 when multi-unit
  selection is re-wired into the UI. Full regression re-run after the change: 265 backend Vitest tests + 64
  node:test tests, still green.
- 2026-10-02 — UI feedback round after manual review:
  1. **Reserve flow simplified further.** Dropped the per-unit radio list entirely (deviation from the original
     brief's "requester picks one specific item from a list" instruction, approved by the user). The specific
     physical unit is now auto-assigned (first available for the type/window) and never shown; the requester sees
     a plain review line ("You have requested 1 {type}.") before submitting. Location is no longer shown anywhere
     in this form.
  2. **Found and fixed a pre-existing bug** (not introduced by this story): `EquipmentRequestPage.jsx` had
     `const currentUserId = user.id;` with no null-guard, executed before the page's own `if (!token)` check.
     `AuthProvider.jsx` briefly exposes `user`/`token` as `null` on every auth re-verification blip (Supabase
     re-fires `onAuthStateChange` on browser tab-focus regain even with no real session change), which crashed
     this line and forced a full remount, wiping all in-progress form state. Fixed with `user?.id` - the deeper
     `AuthProvider` flicker itself was deliberately left untouched (shared file, affects every authenticated page)
     per the user's decision; they're raising it at daily scrum instead.
  3. **Found the same crash shape in `EquipmentRequestForm`'s own `handleSubmit`** (`assignedItem.id` unguarded) -
     surfaced as a render-time crash, not just an unreachable-code risk, because this repo's Vite config runs the
     React Compiler (`babel-plugin-react-compiler`), which appears to evaluate/memoize such expressions more
     eagerly than plain React would. Fixed with an explicit `if (!assignedItem) return;` guard.
  4. **Catalogue checkbox CSS bug fixed.** `App.css`'s global `input { width: 100%; min-height: 48px }` (meant for
     text fields) was also stretching the "Show retired equipment" checkbox, which visually separated it from its
     label. Added a scoped `input[type="checkbox"]` override.
  5. **Catalogue page restricted to Technical Support Staff.** Per the user's instruction, Event Coordinators no
     longer have a route to `/equipment/catalogue` (route guard + nav link both changed from `equipment.read` to
     `equipment.review`). The underlying `equipment.read` *permission* is untouched - coordinators still use it
     indirectly through the reserve flow's own `GET /api/equipment` call. Updated `docs/equipment-integration.md`
     accordingly; `docs/staff-access.md`'s read-permission matrix is unaffected since `equipment.manage` has no
     label (same as `equipment.review`/`equipment.request`, which were never in that table either).
  Full regression after all fixes: 196 frontend tests, lint clean, build succeeds.
- 2026-10-02 — Playwright live-DB E2E specs added/updated in `tests/e2e/` (per the earlier decision to follow the
  Scrum-29 precedent, not `tests/playwright/`):
  - New `equipment-catalogue-manage.spec.js`: add/edit/retire through the real browser UI (5 tests) - add via the
    catalogue's entry point, edit an existing unit, confirm the edit form's status dropdown never offers
    UNAVAILABLE, retire with cancel-then-confirm, and that a Coordinator is forbidden from both management routes.
  - Updated the two tests in `equipment-request.spec.js` that the UI rewrite made stale: the old per-unit
    dropdown + quantity test is replaced with the two-step type-then-review flow; the old "dropdown excludes a
    DAMAGED unit" test is redesigned for the new type-level dropdown (a type disappears entirely once every unit
    of it is unavailable, rather than one option per unit).
  - Added one role-gating case: an Event Coordinator can no longer open `/equipment/catalogue` directly.
  All 15 tests in these two files pass against the live dev Supabase project (servers already running via Docker,
  `reuseExistingServer: true` picked them up). Full `tests/e2e/` run: 20 passed, 3 failed - the 3 failures are in
  `technical-support-review.spec.js`, a pre-existing bug unrelated to this story (see
  [[project_scrum29_equipment_availability]]: its `signIn()` helper asserts text from a page it never navigates
  through; already deferred by the user). No leftover equipment rows in the dev DB after the run.
- 2026-10-02 — user pushed back on test count ("why so many, is 2-3 E2E not enough"). Reviewed every test against
  "does a plausible bug survive if this is deleted" and cut 3: a unit test asserting an internal constant's
  derivation rather than behavior (`OPERATIONAL_STATUSES is every status except UNAVAILABLE` - the next two tests
  already prove the real behavior); an E2E "editing..." test redundant with the "adding..." test's proof of the
  same form-submit wiring; an E2E test asserting the edit form excludes UNAVAILABLE from its dropdown, already
  fully covered by `EquipmentForm.test.jsx` at the much cheaper component layer. Also folded a standalone E2E
  "Coordinator cannot reach Add/Edit forms" test into the existing `role gating: direct URL access` loop in
  `equipment-request.spec.js` (2 more loop entries) rather than duplicating the sign-in/account setup in a new
  test. New Scrum-30 test count: 47 (27 backend: 14 unit + 13 integration; 16 frontend; 4 E2E: 2 new
  catalogue-manage + 2 role-gating loop entries). All still green after the cuts.
