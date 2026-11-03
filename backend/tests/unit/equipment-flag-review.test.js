// SCRUM-150 AC2/AC3: the equipment-side machinery that survives SCRUM-37's
// retirement of flagReservationsForReview (see the comment further down) -
// isRequestAvailableForWindow and the guarantee that only Technical Support's
// own decision ever sets APPROVED. Doubles only, no live Supabase - same
// in-memory fake client shape as equipment-release-event.test.js.
import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createEquipmentService } = require("../../src/modules/equipment/equipment.service");

function fakeSupabase(initialTables) {
  const store = {};
  for (const [name, rows] of Object.entries(initialTables)) {
    store[name] = rows.map((row) => ({ ...row }));
  }

  function from(table) {
    let rows = store[table];
    let patch = null;

    function applyPatch() {
      if (!patch) return;
      const ids = new Set(rows.map((row) => row.id));
      store[table] = store[table].map((row) => (ids.has(row.id) ? { ...row, ...patch } : row));
      rows = rows.map((row) => ({ ...row, ...patch }));
    }

    const builder = {
      select() { return builder; },
      order() { return builder; },
      eq(field, value) { rows = rows.filter((row) => row[field] === value); return builder; },
      neq(field, value) { rows = rows.filter((row) => row[field] !== value); return builder; },
      in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return builder; },
      update(fields) { patch = fields; return builder; },
      async maybeSingle() { applyPatch(); return { data: rows[0] || null, error: null }; },
      then(resolve, reject) { applyPatch(); return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return builder;
  }

  return { from, store };
}

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

function request(overrides) {
  return {
    id: "req-" + Math.random().toString(36).slice(2),
    event_id: EVENT_ID,
    equipment_id: "22222222-2222-2222-2222-222222222222",
    status: "APPROVED",
    borrow_start: "2026-01-01T09:00:00Z",
    borrow_end: "2026-01-01T17:00:00Z",
    ...overrides,
  };
}

// SCRUM-150 AC1's flagReservationsForReview (and the four cases that used to
// be proven directly against it here - PENDING/APPROVED/REVIEW_REQUIRED
// requests moving to REVIEW_REQUIRED, the borrow-window update, re-flagging
// on a second reschedule, REJECTED/RELEASED never reopened) was retired as
// part of SCRUM-37's team design: a significant edit now regresses the event
// itself to SUBMITTED for the coordinator's decision, which then releases
// arrangements outright (review.service.js) rather than holding this same
// reservation for Technical Support to re-decide. SCRUM-150's AC1 is
// therefore unreachable via this trigger now, by deliberate decision - see
// this story's task note and docs/equipment-integration.md's SCRUM-37
// addendum. apply_organiser_event_edit (SQL) only decides whether to
// regress; it never writes equipment_requests/venue_bookings, so there is no
// successor rule to prove here or anywhere else.

// SCRUM-150 AC2: isRequestAvailableForWindow itself. The "no conflict"/
// "conflicting request" cases and "same answer for both roles" are already
// proven over real HTTP in tests/unit/equipment-reschedule-review.routes.test.js
// (TC-150-05/06/07); this covers the one case that route suite doesn't - a
// unit the equipment-status guard elsewhere protects (DAMAGED etc.) - plus
// the self-exclusion nuance explicitly, rather than only implicitly.
describe("SCRUM-150: isRequestAvailableForWindow", () => {
  test("a DAMAGED unit is never available, even with no conflicting request at all", async () => {
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED", equipment_id: "eq-damaged" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [flagged],
      equipment: [{ id: "eq-damaged", type: "Projector", status: "DAMAGED" }],
    }));

    expect(await service.isRequestAvailableForWindow(flagged)).toBe(false);
  });

  test("the request itself is excluded from its own overlap check", async () => {
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED", equipment_id: "eq-ok" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [flagged],
      equipment: [{ id: "eq-ok", type: "Projector", status: "AVAILABLE" }],
    }));

    expect(await service.isRequestAvailableForWindow(flagged)).toBe(true);
  });
});

// SCRUM-150 AC3: a REVIEW_REQUIRED request never silently becomes APPROVED
// through anything but Technical Support's own decision. Exhausts every
// other mutating path this story touches on the same request, then uses the
// explicit decision as a positive control to prove the test would actually
// catch a regression that set APPROVED some other way.
describe("SCRUM-150 AC3: nothing but the explicit decision sets APPROVED", () => {
  // SCRUM-37: the "reschedule the same event again" step this test used to
  // include (via flagReservationsForReview, retired) is no longer exercisable
  // here - that re-flagging now happens inside apply_organiser_event_edit
  // (SQL), which this fake can't run. The remaining steps still hold: nothing
  // else in equipment.service.js ever sets APPROVED but the explicit decision.
  test("[TC-150-09] an unrelated event's release and a re-fetch both leave it REVIEW_REQUIRED - only the explicit decision flips it", async () => {
    const OTHER_EVENT_ID = "99999999-9999-9999-9999-999999999999";
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED" });
    const unrelated = request({ id: "req-unrelated", event_id: OTHER_EVENT_ID, equipment_id: "eq-other", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [flagged, unrelated],
      equipment: [{ id: "22222222-2222-2222-2222-222222222222", type: "Projector", status: "AVAILABLE" }, { id: "eq-other", type: "Speaker", status: "AVAILABLE" }],
    }));

    // Postpone/cancel sweep running against a different, unrelated event.
    await service.releaseReservationsForEvent(OTHER_EVENT_ID);
    expect((await service.findRequestById("req-flagged")).status).toBe("REVIEW_REQUIRED");

    // A plain re-fetch changes nothing.
    expect((await service.findRequestById("req-flagged")).status).toBe("REVIEW_REQUIRED");

    // Positive control: only the explicit Technical Support decision flips it.
    await service.updateStatus("req-flagged", "APPROVED");
    expect((await service.findRequestById("req-flagged")).status).toBe("APPROVED");
  });
});
