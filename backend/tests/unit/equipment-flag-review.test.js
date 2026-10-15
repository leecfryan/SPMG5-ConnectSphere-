// SCRUM-150 AC1/AC3: flagReservationsForReview itself (the function
// eventWorkspace.service.js#updateOrganiserEvent calls once it detects a real
// date/time/equipment_needs change - that diff-detection is proven separately
// in tests/unit/events/eventWorkspace.service.test.js). Doubles only, no live
// Supabase - same in-memory fake client shape as equipment-release-event.test.js.
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

describe("SCRUM-150: flagReservationsForReview", () => {
  // TC-150-01/02 prove *when* updateOrganiserEvent calls this function (see
  // eventWorkspace.service.test.js); these two prove what the function itself
  // then does with PENDING/APPROVED requests once called.
  test("PENDING and APPROVED requests both move to REVIEW_REQUIRED, borrow window updated when dates changed", async () => {
    const pending = request({ id: "req-pending", status: "PENDING" });
    const approved = request({ id: "req-approved", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [pending, approved] }));

    const summary = await service.flagReservationsForReview(EVENT_ID, {
      startTime: "2026-02-01T09:00:00Z",
      endTime: "2026-02-01T17:00:00Z",
      datesChanged: true,
    });

    expect(summary.flagged.sort()).toEqual(["req-approved", "req-pending"]);
    const requests = await service.listRequestsByEvent(EVENT_ID);
    expect(requests.every((r) => r.status === "REVIEW_REQUIRED")).toBe(true);
    expect(requests.every((r) => r.borrow_start === "2026-02-01T09:00:00Z" && r.borrow_end === "2026-02-01T17:00:00Z")).toBe(true);
  });

  test("datesChanged false (equipment_needs-only edit) flags status without touching the borrow window", async () => {
    const approved = request({ id: "req-approved", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [approved] }));

    await service.flagReservationsForReview(EVENT_ID, { datesChanged: false });

    const [updated] = await service.listRequestsByEvent(EVENT_ID);
    expect(updated.status).toBe("REVIEW_REQUIRED");
    expect(updated.borrow_start).toBe(approved.borrow_start);
    expect(updated.borrow_end).toBe(approved.borrow_end);
  });

  test("[TC-150-04] a second reschedule before review re-flags with the latest window", async () => {
    const approved = request({ id: "req-approved", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [approved] }));

    await service.flagReservationsForReview(EVENT_ID, {
      startTime: "2026-02-01T09:00:00Z", endTime: "2026-02-01T17:00:00Z", datesChanged: true,
    });
    await service.flagReservationsForReview(EVENT_ID, {
      startTime: "2026-03-01T09:00:00Z", endTime: "2026-03-01T17:00:00Z", datesChanged: true,
    });

    const [updated] = await service.listRequestsByEvent(EVENT_ID);
    expect(updated.status).toBe("REVIEW_REQUIRED");
    expect(updated.borrow_start).toBe("2026-03-01T09:00:00Z");
    expect(updated.borrow_end).toBe("2026-03-01T17:00:00Z");
  });

  test("[TC-150-23] REJECTED and RELEASED requests are never reopened by flagging", async () => {
    const rejected = request({ id: "req-rejected", status: "REJECTED" });
    const released = request({ id: "req-released", status: "RELEASED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [rejected, released] }));

    const summary = await service.flagReservationsForReview(EVENT_ID, {
      startTime: "2026-02-01T09:00:00Z", endTime: "2026-02-01T17:00:00Z", datesChanged: true,
    });

    expect(summary.flagged).toEqual([]);
    expect((await service.findRequestById("req-rejected")).status).toBe("REJECTED");
    expect((await service.findRequestById("req-released")).status).toBe("RELEASED");
  });
});

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
  test("[TC-150-09] re-flagging, an unrelated event's release, and a re-fetch all leave it REVIEW_REQUIRED - only the explicit decision flips it", async () => {
    const OTHER_EVENT_ID = "99999999-9999-9999-9999-999999999999";
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED" });
    const unrelated = request({ id: "req-unrelated", event_id: OTHER_EVENT_ID, equipment_id: "eq-other", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [flagged, unrelated],
      equipment: [{ id: "22222222-2222-2222-2222-222222222222", type: "Projector", status: "AVAILABLE" }, { id: "eq-other", type: "Speaker", status: "AVAILABLE" }],
    }));

    // Reschedule the same event again.
    await service.flagReservationsForReview(EVENT_ID, { startTime: "2026-04-01T09:00:00Z", endTime: "2026-04-01T17:00:00Z", datesChanged: true });
    expect((await service.findRequestById("req-flagged")).status).toBe("REVIEW_REQUIRED");

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
