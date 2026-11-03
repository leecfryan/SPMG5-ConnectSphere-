// Scrum-29: pure-function tests for the availability check's business logic
// in equipment.validation.js. No express, no supabase - same reasoning as
// equipment.validation.test.js. Deliberately placed outside
// tests/unit/equipment/ (which node:test still owns via test:equipment) so
// this file runs under Vitest without touching that existing glob/config.
import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  validateAvailabilityQuery,
  isBlockingOverlap,
  findAvailableUnits,
  checkAvailability,
} = require("../../src/modules/equipment/equipment.validation");

function completeQuery(overrides = {}) {
  return {
    start: "2026-09-10T09:00:00Z",
    end: "2026-09-10T17:00:00Z",
    type: "PROJECTOR",
    quantity: "2",
    location: "Main Hall",
    ...overrides,
  };
}

describe("Scrum-29 AC1: The availability check accepts the event start date/time, end date/time, equipment type, requested quantity, and event location.", () => {
  test("a query with all five fields is accepted and normalised", () => {
    const result = validateAvailabilityQuery(completeQuery());
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      type: "PROJECTOR",
      location: "Main Hall",
      start: "2026-09-10T09:00:00.000Z",
      end: "2026-09-10T17:00:00.000Z",
      quantity: 2,
    });
  });

  test.each(["start", "end", "type", "quantity", "location"])(
    "a query missing %s is rejected, proving that field is genuinely required",
    (missingField) => {
      const query = completeQuery({ [missingField]: undefined });
      const result = validateAvailabilityQuery(query);
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.field)).toContain(missingField);
    },
  );
});

describe("Scrum-29 AC2: Equipment committed to another event that overlaps the requested period is excluded from the available quantity.", () => {
  const unit = { id: "unit-1", type: "PROJECTOR", status: "AVAILABLE" };

  test("a unit with a PENDING request overlapping the requested period is excluded", () => {
    const requestsByEquipmentId = new Map([
      ["unit-1", [{ borrow_start: "2026-09-10T08:00:00Z", borrow_end: "2026-09-10T12:00:00Z" }]],
    ]);
    const available = findAvailableUnits({
      equipmentUnits: [unit],
      requestsByEquipmentId,
      requestedStart: "2026-09-10T09:00:00Z",
      requestedEnd: "2026-09-10T17:00:00Z",
    });
    expect(available).toEqual([]);
  });

  test("a unit with an APPROVED request overlapping the requested period is excluded, while a non-overlapping unit is not", () => {
    const otherUnit = { id: "unit-2", type: "PROJECTOR", status: "AVAILABLE" };
    const requestsByEquipmentId = new Map([
      ["unit-1", [{ borrow_start: "2026-09-10T08:00:00Z", borrow_end: "2026-09-10T12:00:00Z" }]],
    ]);
    const result = checkAvailability({
      equipmentUnits: [unit, otherUnit],
      requestsByEquipmentId,
      requestedStart: "2026-09-10T09:00:00Z",
      requestedEnd: "2026-09-10T17:00:00Z",
      requestedQuantity: 1,
    });
    expect(result.available_quantity).toBe(1);
    expect(result.available_equipment_ids).toEqual(["unit-2"]);
  });
});

describe("Scrum-29 AC3: Equipment marked as Unavailable, Damaged, or Under Maintenance is excluded from the available quantity.", () => {
  test.each(["UNAVAILABLE", "DAMAGED", "UNDER_MAINTENANCE", "IN_USE", "MAINTENANCE"])(
    "a unit with status %s is excluded",
    (status) => {
      const available = findAvailableUnits({
        equipmentUnits: [{ id: "unit-1", type: "PROJECTOR", status }],
        requestsByEquipmentId: new Map(),
        requestedStart: "2026-09-10T09:00:00Z",
        requestedEnd: "2026-09-10T17:00:00Z",
      });
      expect(available).toEqual([]);
    },
  );

  test("only the AVAILABLE unit counts when mixed with excluded statuses, including a status value the code has never seen before", () => {
    const units = [
      { id: "unit-1", type: "PROJECTOR", status: "AVAILABLE" },
      { id: "unit-2", type: "PROJECTOR", status: "DAMAGED" },
      { id: "unit-3", type: "PROJECTOR", status: "SOME_FUTURE_STATUS" },
    ];
    const result = checkAvailability({
      equipmentUnits: units,
      requestsByEquipmentId: new Map(),
      requestedStart: "2026-09-10T09:00:00Z",
      requestedEnd: "2026-09-10T17:00:00Z",
      requestedQuantity: 1,
    });
    expect(result.available_quantity).toBe(1);
    expect(result.available_equipment_ids).toEqual(["unit-1"]);
  });
});

describe("Scrum-29 AC4: Equipment returned on a given day is not counted as available again until the following day (Return Day + 1).", () => {
  const existingRequest = { borrow_start: "2026-09-10T08:00:00Z", borrow_end: "2026-09-10T18:00:00Z" };

  test("a request starting the same calendar day the equipment is returned is still blocked", () => {
    expect(isBlockingOverlap(existingRequest, "2026-09-10T19:00:00Z", "2026-09-10T23:00:00Z")).toBe(true);
  });

  test("a request starting the day after the equipment is returned is available", () => {
    expect(isBlockingOverlap(existingRequest, "2026-09-11T00:00:00Z", "2026-09-11T08:00:00Z")).toBe(false);
  });
});
