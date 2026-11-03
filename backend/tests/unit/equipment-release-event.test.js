// SCRUM-150: releaseReservationsForEvent (renamed from
// releaseReservationsForCancelledEvent, SCRUM-104/148) is now called by both
// cancel() and postpone() - it never reads events.status itself, only an
// eventId, so these tests exercise the function directly rather than through
// either caller. Doubles only, no live Supabase - a fake client that
// actually applies .eq/.in filters and .update patches to an in-memory
// table, close enough to the real query chain to prove the releasable and
// unit-reversion filters, without any network dependency.
//
// AC: all six tests below are the "audit completion" work (postpone/cancel
// equipment handling), not one of SCRUM-150's four scored AC - see the task
// note's Decisions and its Plan-against-AC row marked "-".
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
      in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return builder; },
      update(fields) { patch = fields; return builder; },
      async maybeSingle() { applyPatch(); return { data: rows[0] || null, error: null }; },
      async single() { applyPatch(); return { data: rows[0] || null, error: null }; },
      then(resolve, reject) { applyPatch(); return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return builder;
  }

  return { from, store };
}

const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_EVENT_ID = "99999999-9999-9999-9999-999999999999";
const EQ_A = "22222222-2222-2222-2222-222222222222";
const EQ_B = "33333333-3333-3333-3333-333333333333";

function request(overrides) {
  return {
    id: "req-" + Math.random().toString(36).slice(2),
    event_id: EVENT_ID,
    equipment_id: EQ_A,
    status: "APPROVED",
    borrow_start: "2026-01-01T09:00:00Z",
    borrow_end: "2026-01-01T17:00:00Z",
    ...overrides,
  };
}

function equipment(overrides) {
  return { id: EQ_A, type: "Projector", current_location: "Store", status: "AVAILABLE", ...overrides };
}

describe("SCRUM-150: releaseReservationsForEvent - shared by cancel() and postpone()", () => {
  // AC: - (postpone completion work; this is the function postpone() now calls)
  test("[TC-150-14] PENDING and APPROVED requests both move to RELEASED", async () => {
    const pending = request({ id: "req-pending", status: "PENDING" });
    const approved = request({ id: "req-approved", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [pending, approved],
      equipment: [equipment()],
    }));

    const summary = await service.releaseReservationsForEvent(EVENT_ID, "actor-1");

    expect(summary.released.sort()).toEqual(["req-approved", "req-pending"]);
    const requests = await service.listRequestsByEvent(EVENT_ID);
    expect(requests.every((r) => r.status === "RELEASED")).toBe(true);
  });

  // AC: - (postponed-then-cancelled edge case named in the additional task)
  test("[TC-150-15] running it again on the same event is a safe no-op", async () => {
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [request({ id: "req-approved", status: "APPROVED" })],
      equipment: [equipment()],
    }));

    await service.releaseReservationsForEvent(EVENT_ID, "actor-1");
    const second = await service.releaseReservationsForEvent(EVENT_ID, "actor-1");

    expect(second).toEqual({ released: [], equipmentReverted: [], equipmentSkipped: [] });
  });

  // AC: - (cancel-after-a-reschedule-flag edge case named in the additional task)
  test("[TC-150-16] a REVIEW_REQUIRED request (flagged by a reschedule) is released too, not left stranded", async () => {
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [flagged],
      equipment: [equipment()],
    }));

    const summary = await service.releaseReservationsForEvent(EVENT_ID, "actor-1");

    expect(summary.released).toEqual(["req-flagged"]);
    const [updated] = await service.listRequestsByEvent(EVENT_ID);
    expect(updated.status).toBe("RELEASED");
  });

  // AC: - ("a request already returned or rejected should not be reopened" edge case)
  test("[TC-150-17] RELEASED and REJECTED requests are never reopened; an unrelated event's request is untouched", async () => {
    const released = request({ id: "req-released", status: "RELEASED" });
    const rejected = request({ id: "req-rejected", status: "REJECTED" });
    const approved = request({ id: "req-approved", status: "APPROVED" });
    const otherEvent = request({ id: "req-other-event", event_id: OTHER_EVENT_ID, status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [released, rejected, approved, otherEvent],
      equipment: [equipment()],
    }));

    const summary = await service.releaseReservationsForEvent(EVENT_ID, "actor-1");

    expect(summary.released).toEqual(["req-approved"]);
    expect((await service.findRequestById("req-released")).status).toBe("RELEASED");
    expect((await service.findRequestById("req-rejected")).status).toBe("REJECTED");
    expect((await service.findRequestById("req-other-event")).status).toBe("APPROVED");
  });

  // AC: - (unit-reversion eligibility now also covers REVIEW_REQUIRED, not just APPROVED)
  test("[TC-150-18] mixed APPROVED and REVIEW_REQUIRED on the same IN_USE unit both release and the unit reverts to AVAILABLE", async () => {
    const approved = request({ id: "req-approved", status: "APPROVED", equipment_id: EQ_A });
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED", equipment_id: EQ_A });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [approved, flagged],
      equipment: [equipment({ id: EQ_A, status: "IN_USE" })],
    }));

    const summary = await service.releaseReservationsForEvent(EVENT_ID, "actor-1");

    expect(summary.released.sort()).toEqual(["req-approved", "req-flagged"]);
    expect(summary.equipmentReverted).toEqual([EQ_A]);
    expect((await service.findEquipmentById(EQ_A)).status).toBe("AVAILABLE");
  });

  // AC: - (pre-existing DAMAGED guard, reproven after the filter changes above)
  test("[TC-150-19] a unit manually marked DAMAGED is left alone even though its reservation is released", async () => {
    const approved = request({ id: "req-approved", status: "APPROVED", equipment_id: EQ_B });
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [approved],
      equipment: [equipment({ id: EQ_B, status: "DAMAGED" })],
    }));

    const summary = await service.releaseReservationsForEvent(EVENT_ID, "actor-1");

    expect(summary.released).toEqual(["req-approved"]);
    expect(summary.equipmentReverted).toEqual([]);
    expect((await service.findEquipmentById(EQ_B)).status).toBe("DAMAGED");
  });
});
