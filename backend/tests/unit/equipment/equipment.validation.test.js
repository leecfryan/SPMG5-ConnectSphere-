const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCreateRequestGroup,
  validateStatusUpdate,
} = require("../../../src/modules/equipment/equipment.validation");

const fieldsOf = (result) => result.errors.map((e) => e.field).sort();

const VALID_EVENT_ID = "11111111-1111-1111-1111-111111111111";

// SCRUM-31 changed how AC1 is satisfied: a request used to carry one
// resolvable equipment_id (a specific physical unit, picked at submission);
// it now carries equipment_type (a type + desired quantity, units assigned
// later by Technical Support's reserve action - see the task note's Data
// model decision). The SCRUM-27 AC1-AC4 coverage below is preserved under
// that new shape, not deleted - these are still the live tests proving
// SCRUM-27's ACs, just against validateCreateRequestGroup instead of the
// retired validateCreateRequest. SCRUM-31's own new rules (is_essential, the
// quantity cap, and the reservation-planning logic) are NOT duplicated here;
// they live in tests/unit/equipment-group-reserve.test.js (Vitest - see that
// file's header for why new equipment work goes there, not here).

// A valid, complete create payload. Tests clone it and break one thing.
function completeInput() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return {
    event_id: VALID_EVENT_ID,
    equipment_type: "Projector",
    quantity_requested: 3,
    technical_requirement: "Needs HDMI and a wireless mic.",
    borrow_start: start.toISOString(),
    borrow_end: end.toISOString(),
  };
}

test("fixture guard: completeInput passes create validation", () => {
  const result = validateCreateRequestGroup(completeInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

// --- validateCreateRequestGroup ---------------------------------------------

test("create: technical_requirement is optional", () => {
  const input = completeInput();
  delete input.technical_requirement;
  assert.equal(validateCreateRequestGroup(input).ok, true);
});

test("create: null / non-object input reports every required field", () => {
  for (const bad of [undefined, null, "nope", 7]) {
    assert.deepEqual(fieldsOf(validateCreateRequestGroup(bad)), [
      "borrow_end",
      "borrow_start",
      "equipment_type",
      "event_id",
      "quantity_requested",
    ]);
  }
});

// Scrum-27 AC1: equipment type can be recorded (SCRUM-31: directly, no
// resolvable id - see this file's header comment).
test("Scrum-27 AC1: equipment_type is required and cannot be blank", () => {
  for (const bad of [undefined, null, "", "   ", 123]) {
    const input = completeInput();
    input.equipment_type = bad;
    const result = validateCreateRequestGroup(input);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("equipment_type"));
  }
});

test("Scrum-27 AC1: a well-formed equipment_type passes and is carried through to value", () => {
  const result = validateCreateRequestGroup(completeInput());
  assert.equal(result.ok, true);
  assert.equal(result.value.equipment_type, "Projector");
});

// Scrum-27 AC2: required quantity can be recorded.
test("Scrum-27 AC2: quantity_requested must be a whole number greater than zero", () => {
  for (const bad of [0, -5, 12.5, "3", null, undefined, NaN]) {
    const input = completeInput();
    input.quantity_requested = bad;
    const result = validateCreateRequestGroup(input);
    assert.equal(result.ok, false, `quantity ${String(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("quantity_requested"));
  }
});

test("Scrum-27 AC2: a valid positive integer quantity passes and is preserved", () => {
  for (const good of [1, 2, 45]) {
    const input = completeInput();
    input.quantity_requested = good;
    const result = validateCreateRequestGroup(input);
    assert.equal(result.ok, true);
    assert.equal(result.value.quantity_requested, good);
  }
});

// Scrum-27 AC3: relevant technical requirements can be recorded.
test("Scrum-27 AC3: technical_requirement must be text within the length cap", () => {
  const nonString = completeInput();
  nonString.technical_requirement = { rooms: 2 };
  assert.ok(
    fieldsOf(validateCreateRequestGroup(nonString)).includes("technical_requirement"),
  );

  const tooLong = completeInput();
  tooLong.technical_requirement = "a".repeat(2001);
  assert.ok(
    fieldsOf(validateCreateRequestGroup(tooLong)).includes("technical_requirement"),
  );

  const atCap = completeInput();
  atCap.technical_requirement = "a".repeat(2000);
  assert.equal(validateCreateRequestGroup(atCap).ok, true);
});

test("Scrum-27 AC3: technical_requirement is trimmed and carried through to value", () => {
  const input = completeInput();
  input.technical_requirement = "  Needs two mics.  ";
  const result = validateCreateRequestGroup(input);
  assert.equal(result.ok, true);
  assert.equal(result.value.technical_requirement, "Needs two mics.");
});

test("Scrum-27 AC3: null technical_requirement is treated as absent", () => {
  const input = completeInput();
  input.technical_requirement = null;
  const result = validateCreateRequestGroup(input);
  assert.equal(result.ok, true);
  assert.equal("technical_requirement" in result.value, false);
});

// Scrum-27 AC4: the request remains associated with the relevant event.
test("Scrum-27 AC4: event_id is required and must be a valid id", () => {
  for (const bad of [undefined, null, "", "not-a-uuid", 123]) {
    const input = completeInput();
    input.event_id = bad;
    const result = validateCreateRequestGroup(input);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("event_id"));
  }
});

test("Scrum-27 AC4: a well-formed event_id passes and is carried through to value", () => {
  const result = validateCreateRequestGroup(completeInput());
  assert.equal(result.ok, true);
  assert.equal(result.value.event_id, VALID_EVENT_ID);
});

test("create: event_id and equipment_type missing are reported independently", () => {
  const input = completeInput();
  delete input.event_id;
  delete input.equipment_type;
  assert.deepEqual(fieldsOf(validateCreateRequestGroup(input)), [
    "equipment_type",
    "event_id",
  ]);
});

test("create: borrow_start and borrow_end are required, real date/times", () => {
  for (const field of ["borrow_start", "borrow_end"]) {
    for (const bad of [undefined, null, "", "tomorrow"]) {
      const input = completeInput();
      input[field] = bad;
      const result = validateCreateRequestGroup(input);
      assert.equal(result.ok, false, `${field}=${JSON.stringify(bad)} should fail`);
      assert.ok(fieldsOf(result).includes(field));
    }
  }
});

test("create: borrow_end must be strictly after borrow_start", () => {
  const input = completeInput();
  input.borrow_end = input.borrow_start;
  assert.ok(fieldsOf(validateCreateRequestGroup(input)).includes("borrow_end"));

  const before = completeInput();
  before.borrow_end = new Date(
    new Date(before.borrow_start).getTime() - 60 * 60 * 1000,
  ).toISOString();
  assert.ok(fieldsOf(validateCreateRequestGroup(before)).includes("borrow_end"));
});

test("create: an unreadable borrow_start does not also fault borrow_end", () => {
  const input = completeInput();
  input.borrow_start = "not a date";
  assert.deepEqual(fieldsOf(validateCreateRequestGroup(input)), ["borrow_start"]);
});

// --- validateStatusUpdate ---------------------------------------------------

test("status update: APPROVED and REJECTED are accepted", () => {
  for (const status of ["APPROVED", "REJECTED"]) {
    const result = validateStatusUpdate({ status });
    assert.deepEqual(result, { ok: true, errors: [], value: { status } });
  }
});

test("status update: PENDING is rejected - it is a starting state, not a target", () => {
  const result = validateStatusUpdate({ status: "PENDING" });
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("status"));
});

test("status update: unknown status values are rejected", () => {
  for (const bad of [undefined, null, "", "approved", "CANCELLED", 1]) {
    const result = validateStatusUpdate({ status: bad });
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("status"));
  }
});

// SCRUM-31: UNFULFILLED is a real status, but never a client-supplied target
// through this endpoint - it is only ever written by reserveGroup itself
// (Decision 8), the same way PENDING is a starting state nothing can target.
test("SCRUM-31: status update: UNFULFILLED is rejected as a target - only reserveGroup writes it", () => {
  const result = validateStatusUpdate({ status: "UNFULFILLED" });
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("status"));
});

test("status update: no other field may be changed through this endpoint", () => {
  const result = validateStatusUpdate({
    status: "APPROVED",
    quantity_requested: 10,
  });
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("quantity_requested"));
});
