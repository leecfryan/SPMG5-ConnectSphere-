// Unlike equipment.functional.test.js (which fakes hasOverlappingRequest
// entirely with a hardcoded true/false to test the controller's handling of
// it), this file exercises the REAL query chain in equipment.service.js -
// against a fake Supabase client that actually applies .eq/.neq/.lt/.gt
// filters to an in-memory table, not a stub that ignores them. That's the
// only way to genuinely prove the overlap guard is scoped to one piece of
// equipment_id, not to a whole event.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createEquipmentService } = require("../../../src/modules/equipment/equipment.service");

function fakeSupabase(tables) {
  return {
    from(table) {
      let rows = (tables[table] || []).slice();
      let limitN = null;
      const builder = {
        select() { return builder; },
        eq(field, value) { rows = rows.filter((r) => r[field] === value); return builder; },
        neq(field, value) { rows = rows.filter((r) => r[field] !== value); return builder; },
        lt(field, value) { rows = rows.filter((r) => r[field] < value); return builder; },
        gt(field, value) { rows = rows.filter((r) => r[field] > value); return builder; },
        limit(n) { limitN = n; return builder; },
        then(resolve, reject) {
          const data = limitN !== null ? rows.slice(0, limitN) : rows;
          Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const EQ_PROJECTOR = "22222222-2222-2222-2222-222222222222";
const EQ_MIC = "33333333-3333-3333-3333-333333333333";

function existingRequest(overrides = {}) {
  return {
    id: "existing-1",
    event_id: EVENT_A,
    equipment_id: EQ_PROJECTOR,
    status: "PENDING",
    borrow_start: "2026-01-01T10:00:00.000Z",
    borrow_end: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

test("the same event and borrow window is allowed for a different piece of equipment", async () => {
  const service = createEquipmentService(fakeSupabase({ equipment_requests: [existingRequest()] }));
  const overlapping = await service.hasOverlappingRequest(
    EQ_MIC, // different equipment_id, same event/time as existingRequest()
    "2026-01-01T10:00:00.000Z",
    "2026-01-01T12:00:00.000Z",
  );
  assert.equal(overlapping, false);
});

test("the same equipment cannot be double-booked for an overlapping window, even across different events", async () => {
  const service = createEquipmentService(fakeSupabase({
    equipment_requests: [existingRequest({ event_id: "some-other-event" })],
  }));
  const overlapping = await service.hasOverlappingRequest(
    EQ_PROJECTOR,
    "2026-01-01T10:30:00.000Z",
    "2026-01-01T11:30:00.000Z",
  );
  assert.equal(overlapping, true);
});

test("back-to-back windows on the same equipment (touching, not crossing) do not count as overlapping", async () => {
  const service = createEquipmentService(fakeSupabase({ equipment_requests: [existingRequest()] }));
  const overlapping = await service.hasOverlappingRequest(
    EQ_PROJECTOR,
    "2026-01-01T12:00:00.000Z", // starts exactly when the existing request ends
    "2026-01-01T13:00:00.000Z",
  );
  assert.equal(overlapping, false);
});

test("a REJECTED request on the same equipment/window never blocks a new one", async () => {
  const service = createEquipmentService(fakeSupabase({
    equipment_requests: [existingRequest({ status: "REJECTED" })],
  }));
  const overlapping = await service.hasOverlappingRequest(
    EQ_PROJECTOR,
    "2026-01-01T10:00:00.000Z",
    "2026-01-01T12:00:00.000Z",
  );
  assert.equal(overlapping, false);
});
