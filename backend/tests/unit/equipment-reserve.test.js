// Scrum-30: pure validation logic for add/update/retire a catalogue record.
// Pure functions with nothing to point a DB at - no Supabase wiring here,
// same reasoning as equipment.availability.test.js's pure unit half. Kept
// outside tests/unit/equipment/ (node:test, excluded from vitest.config.mjs)
// deliberately - new tests are Vitest-only going forward.
import { describe, expect, test } from "vitest";
import {
  validateCreateEquipment,
  validateUpdateEquipment,
  validateEquipmentStatusUpdate,
  EQUIPMENT_STATUSES,
  OPERATIONAL_STATUSES,
} from "../../src/modules/equipment/equipment.validation";

function fieldsOf(result) {
  return result.errors.map((e) => e.field).sort();
}

describe("Scrum-30 AC1/AC2: validateCreateEquipment", () => {
  test("a fully-specified record is accepted and fields are trimmed", () => {
    const result = validateCreateEquipment({
      type: "  Projector  ",
      description: "  4K, ceiling-mounted  ",
      current_location: "  Store A  ",
      status: "AVAILABLE",
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      type: "Projector",
      current_location: "Store A",
      description: "4K, ceiling-mounted",
      status: "AVAILABLE",
    });
  });

  test("type and current_location are required", () => {
    for (const bad of [undefined, null, "", "   "]) {
      const result = validateCreateEquipment({ type: bad, current_location: bad });
      expect(result.ok).toBe(false);
      expect(fieldsOf(result)).toEqual(["current_location", "type"]);
    }
  });

  test("description is optional and nullable", () => {
    const withoutDescription = validateCreateEquipment({ type: "Mic", current_location: "A" });
    expect(withoutDescription.ok).toBe(true);
    expect("description" in withoutDescription.value).toBe(false);
  });

  test("description must be text when given", () => {
    const result = validateCreateEquipment({ type: "Mic", current_location: "A", description: 123 });
    expect(result.ok).toBe(false);
    expect(fieldsOf(result)).toContain("description");
  });

  test("status defaults to absent (schema default applies) but is validated when given", () => {
    const omitted = validateCreateEquipment({ type: "Mic", current_location: "A" });
    expect(omitted.ok).toBe(true);
    expect("status" in omitted.value).toBe(false);

    const invalid = validateCreateEquipment({ type: "Mic", current_location: "A", status: "BROKEN" });
    expect(invalid.ok).toBe(false);
    expect(fieldsOf(invalid)).toContain("status");

    // Unlike the quick-status endpoint, creating a record accepts every
    // recognised status up front, including UNAVAILABLE.
    for (const status of EQUIPMENT_STATUSES) {
      expect(validateCreateEquipment({ type: "Mic", current_location: "A", status }).ok).toBe(true);
    }
  });
});

describe("Scrum-30 AC1/AC2: validateUpdateEquipment", () => {
  test("a single field can be edited without touching the others", () => {
    const result = validateUpdateEquipment({ description: "Updated" });
    expect(result).toEqual({ ok: true, errors: [], value: { description: "Updated" } });
  });

  test("every editable field can be changed together", () => {
    const result = validateUpdateEquipment({
      type: "Spotlight", description: "New bulb", current_location: "Store B", status: "MAINTENANCE",
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      type: "Spotlight", description: "New bulb", current_location: "Store B", status: "MAINTENANCE",
    });
  });

  test("an empty body is rejected - at least one field is required", () => {
    const result = validateUpdateEquipment({});
    expect(result.ok).toBe(false);
  });

  test("a field this endpoint does not own is rejected", () => {
    const result = validateUpdateEquipment({ id: "11111111-1111-1111-1111-111111111111", type: "Mic" });
    expect(result.ok).toBe(false);
    expect(fieldsOf(result)).toContain("id");
  });

  test("type and current_location, if given, cannot be blank", () => {
    for (const field of ["type", "current_location"]) {
      const result = validateUpdateEquipment({ [field]: "   " });
      expect(result.ok).toBe(false);
      expect(fieldsOf(result)).toContain(field);
    }
  });

  test("description can be explicitly cleared to null", () => {
    const result = validateUpdateEquipment({ description: null });
    expect(result).toEqual({ ok: true, errors: [], value: { description: null } });
  });

  test("status, if given, must be a recognised value - including UNAVAILABLE (editing is a full management action)", () => {
    expect(validateUpdateEquipment({ status: "NOT_REAL" }).ok).toBe(false);
    expect(validateUpdateEquipment({ status: "UNAVAILABLE" }).ok).toBe(true);
  });
});

describe("Scrum-30 AC1: the quick operational-status change never offers or accepts UNAVAILABLE", () => {
  test("validateEquipmentStatusUpdate accepts every operational status", () => {
    for (const status of OPERATIONAL_STATUSES) {
      expect(validateEquipmentStatusUpdate({ status }).ok).toBe(true);
    }
  });

  test("validateEquipmentStatusUpdate rejects UNAVAILABLE - retire is the only path there", () => {
    const result = validateEquipmentStatusUpdate({ status: "UNAVAILABLE" });
    expect(result.ok).toBe(false);
    expect(fieldsOf(result)).toContain("status");
  });
});
