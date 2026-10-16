// SCRUM-150 AC4: hasUnresolvedEquipment in isolation. No caller exists yet -
// nothing in this codebase transitions an event to CONFIRMED - so this is
// proven standalone, not through any route. Doubles only, no live Supabase.
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
    const builder = {
      select() { return builder; },
      order() { return builder; },
      eq(field, value) { rows = rows.filter((row) => row[field] === value); return builder; },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return builder;
  }
  return { from };
}

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

function request(overrides) {
  return {
    id: "req-" + Math.random().toString(36).slice(2),
    event_id: EVENT_ID,
    equipment_id: "22222222-2222-2222-2222-222222222222",
    borrow_start: "2026-01-01T09:00:00Z",
    borrow_end: "2026-01-01T17:00:00Z",
    ...overrides,
  };
}

describe("SCRUM-150 AC4: hasUnresolvedEquipment", () => {
  test("[TC-150-10] a REVIEW_REQUIRED request is listed as unresolved", async () => {
    const flagged = request({ id: "req-flagged", status: "REVIEW_REQUIRED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [flagged] }));

    const unresolved = await service.hasUnresolvedEquipment(EVENT_ID);

    expect(unresolved).toEqual([{
      type: "equipment",
      request_id: "req-flagged",
      description: "Equipment reservation",
      reason: "This reservation needs to be reviewed again after the event was rescheduled.",
      essential: true,
    }]);
  });

  test("[TC-150-11] once resolved (APPROVED), the list is empty", async () => {
    const approved = request({ id: "req-approved", status: "APPROVED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [approved] }));

    expect(await service.hasUnresolvedEquipment(EVENT_ID)).toEqual([]);
  });

  test("[TC-150-12] a REJECTED request still counts as unresolved, matching safetyReadiness.js's policy", async () => {
    const rejected = request({ id: "req-rejected", status: "REJECTED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [rejected] }));

    const unresolved = await service.hasUnresolvedEquipment(EVENT_ID);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ type: "equipment", request_id: "req-rejected" });
  });

  test("[TC-150-13] a RELEASED request does not count as unresolved", async () => {
    const released = request({ id: "req-released", status: "RELEASED" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [released] }));

    expect(await service.hasUnresolvedEquipment(EVENT_ID)).toEqual([]);
  });

  test("[TC-150-24] a PENDING request still counts as unresolved (never-touched equipment is not settled)", async () => {
    const pending = request({ id: "req-pending", status: "PENDING" });
    const service = createEquipmentService(fakeSupabase({ equipment_requests: [pending] }));

    const unresolved = await service.hasUnresolvedEquipment(EVENT_ID);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ type: "equipment", request_id: "req-pending" });
  });

  test("[TC-150-25] mixed statuses: only PENDING/REJECTED/REVIEW_REQUIRED rows are listed, APPROVED/RELEASED excluded", async () => {
    const service = createEquipmentService(fakeSupabase({
      equipment_requests: [
        request({ id: "req-approved", status: "APPROVED" }),
        request({ id: "req-pending", status: "PENDING" }),
        request({ id: "req-released", status: "RELEASED" }),
        request({ id: "req-rejected", status: "REJECTED" }),
      ],
    }));

    const unresolved = await service.hasUnresolvedEquipment(EVENT_ID);

    expect(unresolved.map((item) => item.request_id)).toEqual(["req-pending", "req-rejected"]);
  });
});
