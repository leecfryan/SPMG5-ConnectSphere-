// SCRUM-31: pure-function tests for what's genuinely NEW in the
// request-group model (is_essential, the quantity cap, and the reservation
// decision that assigns real units to as many pending siblings as stock
// allows). SCRUM-27's own AC1-AC4 coverage for validateCreateRequestGroup -
// equipment_type, quantity, technical_requirement, event_id - still lives in
// tests/unit/equipment/equipment.validation.test.js (updated in place for
// the new field name, not duplicated here - see that file's header). No
// express, no supabase. Deliberately outside tests/unit/equipment/
// (node:test's glob) so this runs under Vitest.
import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  validateCreateRequestGroup,
  planReservation,
  groupRequestsByEquipmentId,
  QUANTITY_CAP,
} = require("../../src/modules/equipment/equipment.validation");

function fieldsOf(result) {
  return result.errors.map((e) => e.field).sort();
}

const VALID_EVENT_ID = "11111111-1111-1111-1111-111111111111";

function completeInput(overrides = {}) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return {
    event_id: VALID_EVENT_ID,
    equipment_type: "Projector",
    quantity_requested: 3,
    technical_requirement: "Needs HDMI and a wireless mic.",
    borrow_start: start.toISOString(),
    borrow_end: end.toISOString(),
    ...overrides,
  };
}

describe("SCRUM-31 AC1: validateCreateRequestGroup", () => {
  test("fixture guard: a complete input passes", () => {
    const result = validateCreateRequestGroup(completeInput());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("no equipment_id is accepted or required any more - equipment_type replaces it", () => {
    const input = completeInput();
    input.equipment_id = "22222222-2222-2222-2222-222222222222";
    const result = validateCreateRequestGroup(input);
    expect(result.ok).toBe(true);
    expect("equipment_id" in result.value).toBe(false);
  });

  // TC-SCRUM-31-16: the new upper bound - 0/negative/non-integer are
  // SCRUM-27 AC2's own cases, already covered where that AC lives.
  test("TC-SCRUM-31-16: quantity_requested above the cap is rejected", () => {
    const result = validateCreateRequestGroup(completeInput({ quantity_requested: QUANTITY_CAP + 1 }));
    expect(result.ok).toBe(false);
    expect(fieldsOf(result)).toContain("quantity_requested");
  });

  test("quantity_requested accepts 1 and the cap itself (boundary)", () => {
    for (const good of [1, QUANTITY_CAP]) {
      const result = validateCreateRequestGroup(completeInput({ quantity_requested: good }));
      expect(result.ok).toBe(true);
      expect(result.value.quantity_requested).toBe(good);
    }
  });

  // TC-SCRUM-31-20/21: is_essential defaults to false, and a true value is honoured.
  test("TC-SCRUM-31-20: is_essential defaults to false when omitted", () => {
    const input = completeInput();
    delete input.is_essential;
    const result = validateCreateRequestGroup(input);
    expect(result.ok).toBe(true);
    expect(result.value.is_essential).toBe(false);
  });

  test("TC-SCRUM-31-21: is_essential true is carried through to value", () => {
    const result = validateCreateRequestGroup(completeInput({ is_essential: true }));
    expect(result.ok).toBe(true);
    expect(result.value.is_essential).toBe(true);
  });

  test("is_essential must be a boolean when given", () => {
    for (const bad of ["true", 1, 0, "yes"]) {
      const result = validateCreateRequestGroup(completeInput({ is_essential: bad }));
      expect(result.ok).toBe(false);
      expect(fieldsOf(result)).toContain("is_essential");
    }
  });

});

describe("SCRUM-31 AC1/AC2/AC5: planReservation (pure reservation decision)", () => {
  const pending = (...ids) => ids.map((id) => ({ id }));
  const units = (...ids) => ids.map((id) => ({ id }));

  // TC-SCRUM-31-01
  test("TC-01: enough stock for every pending sibling reserves all of them", () => {
    const result = planReservation({
      pendingRequests: pending("r1", "r2", "r3"),
      availableUnits: units("u1", "u2", "u3"),
      isEssential: false,
    });
    expect(result.ok).toBe(true);
    expect(result.assignments).toEqual([
      { requestId: "r1", equipmentId: "u1" },
      { requestId: "r2", equipmentId: "u2" },
      { requestId: "r3", equipmentId: "u3" },
    ]);
    expect(result.unfulfilledRequestIds).toEqual([]);
  });

  // TC-SCRUM-31-02
  test("TC-02: short of stock, non-essential, partially reserves and marks the rest unfulfilled", () => {
    const result = planReservation({
      pendingRequests: pending("r1", "r2", "r3", "r4", "r5"),
      availableUnits: units("u1", "u2", "u3"),
      isEssential: false,
    });
    expect(result.ok).toBe(true);
    expect(result.assignments).toEqual([
      { requestId: "r1", equipmentId: "u1" },
      { requestId: "r2", equipmentId: "u2" },
      { requestId: "r3", equipmentId: "u3" },
    ]);
    expect(result.unfulfilledRequestIds).toEqual(["r4", "r5"]);
  });

  // TC-SCRUM-31-07
  test("TC-07: essential group short of stock is refused entirely, nothing assigned", () => {
    const result = planReservation({
      pendingRequests: pending("r1", "r2", "r3", "r4"),
      availableUnits: units("u1", "u2", "u3"),
      isEssential: true,
    });
    expect(result).toEqual({
      ok: false,
      reason: "essential_shortfall",
      availableCount: 3,
      pendingCount: 4,
    });
  });

  // TC-SCRUM-31-08
  test("TC-08: essential group with exactly enough stock fully reserves (boundary)", () => {
    const result = planReservation({
      pendingRequests: pending("r1", "r2", "r3"),
      availableUnits: units("u1", "u2", "u3"),
      isEssential: true,
    });
    expect(result.ok).toBe(true);
    expect(result.unfulfilledRequestIds).toEqual([]);
    expect(result.assignments).toHaveLength(3);
  });

  test("boundary: no pending siblings is a safe no-op, essential or not", () => {
    for (const isEssential of [true, false]) {
      const result = planReservation({ pendingRequests: [], availableUnits: units("u1"), isEssential });
      expect(result).toEqual({ ok: true, assignments: [], unfulfilledRequestIds: [] });
    }
  });

  test("boundary: zero available units, non-essential, marks every pending sibling unfulfilled", () => {
    const result = planReservation({
      pendingRequests: pending("r1", "r2"),
      availableUnits: [],
      isEssential: false,
    });
    expect(result).toEqual({ ok: true, assignments: [], unfulfilledRequestIds: ["r1", "r2"] });
  });
});

describe("groupRequestsByEquipmentId", () => {
  test("groups requests by their equipment_id, preserving order within a unit", () => {
    const grouped = groupRequestsByEquipmentId([
      { equipment_id: "u1", borrow_start: "a" },
      { equipment_id: "u2", borrow_start: "b" },
      { equipment_id: "u1", borrow_start: "c" },
    ]);
    expect(grouped.get("u1")).toEqual([{ equipment_id: "u1", borrow_start: "a" }, { equipment_id: "u1", borrow_start: "c" }]);
    expect(grouped.get("u2")).toEqual([{ equipment_id: "u2", borrow_start: "b" }]);
  });

  test("an empty list produces an empty map", () => {
    expect(groupRequestsByEquipmentId([]).size).toBe(0);
  });
});
