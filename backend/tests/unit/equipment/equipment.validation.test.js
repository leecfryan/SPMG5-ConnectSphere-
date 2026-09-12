const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCreateRequest,
  validateUpdateRequest,
} = require("../../../src/modules/equipment/equipment.validation");

const fieldsOf = (result) => result.errors.map((e) => e.field).sort();

const VALID_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const VALID_EQUIPMENT_TYPE_ID = "22222222-2222-2222-2222-222222222222";

// A valid, complete create payload. Tests clone it and break one thing.
function completeInput() {
  return {
    event_id: VALID_EVENT_ID,
    equipment_type_id: VALID_EQUIPMENT_TYPE_ID,
    quantity_requested: 3,
    technical_requirements: "Needs HDMI and a wireless mic.",
  };
}

test("fixture guard: completeInput passes create validation", () => {
  assert.deepEqual(validateCreateRequest(completeInput()), {
    ok: true,
    errors: [],
  });
});

// --- validateCreateRequest ------------------------------------------------

test("create: technical_requirements is optional", () => {
  const input = completeInput();
  delete input.technical_requirements;
  assert.equal(validateCreateRequest(input).ok, true);
});

test("create: null / non-object input reports every required field", () => {
  for (const bad of [undefined, null, "nope", 7]) {
    assert.deepEqual(fieldsOf(validateCreateRequest(bad)), [
      "equipment_type_id",
      "event_id",
      "quantity_requested",
    ]);
  }
});

// AC1: equipment type can be recorded.
test("create: equipment_type_id is required and must be a valid id", () => {
  for (const bad of [undefined, null, "", "not-a-uuid", 123]) {
    const input = completeInput();
    input.equipment_type_id = bad;
    const result = validateCreateRequest(input);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("equipment_type_id"));
  }
});

// AC2: required quantity, whole number > 0.
test("create: quantity_requested must be a whole number greater than zero", () => {
  for (const bad of [0, -5, 12.5, "3", null, undefined, NaN]) {
    const input = completeInput();
    input.quantity_requested = bad;
    const result = validateCreateRequest(input);
    assert.equal(result.ok, false, `quantity ${String(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("quantity_requested"));
  }
});

test("create: a valid positive integer quantity passes", () => {
  for (const good of [1, 2, 100]) {
    const input = completeInput();
    input.quantity_requested = good;
    assert.equal(validateCreateRequest(input).ok, true);
  }
});

// AC3: relevant technical requirements can be recorded.
test("create: technical_requirements must be text within the length cap", () => {
  const nonString = completeInput();
  nonString.technical_requirements = { rooms: 2 };
  assert.ok(
    fieldsOf(validateCreateRequest(nonString)).includes(
      "technical_requirements",
    ),
  );

  const tooLong = completeInput();
  tooLong.technical_requirements = "a".repeat(2001);
  assert.ok(
    fieldsOf(validateCreateRequest(tooLong)).includes(
      "technical_requirements",
    ),
  );

  const atCap = completeInput();
  atCap.technical_requirements = "a".repeat(2000);
  assert.equal(validateCreateRequest(atCap).ok, true);
});

test("create: null technical_requirements is treated as absent", () => {
  const input = completeInput();
  input.technical_requirements = null;
  assert.equal(validateCreateRequest(input).ok, true);
});

// AC4: the request remains associated with the relevant event.
test("create: event_id is required and must be a valid id", () => {
  for (const bad of [undefined, null, "", "not-a-uuid", 123]) {
    const input = completeInput();
    input.event_id = bad;
    const result = validateCreateRequest(input);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("event_id"));
  }
});

test("create: both foreign keys missing are reported independently", () => {
  const input = completeInput();
  delete input.event_id;
  delete input.equipment_type_id;
  assert.deepEqual(fieldsOf(validateCreateRequest(input)), [
    "equipment_type_id",
    "event_id",
  ]);
});

// --- validateUpdateRequest -------------------------------------------------

test("update: quantity_requested alone is a valid partial update", () => {
  assert.deepEqual(validateUpdateRequest({ quantity_requested: 5 }), {
    ok: true,
    errors: [],
  });
});

test("update: technical_requirements alone is a valid partial update", () => {
  assert.equal(
    validateUpdateRequest({ technical_requirements: "Two projectors now." })
      .ok,
    true,
  );
});

test("update: empty payload is rejected", () => {
  for (const bad of [{}, undefined, null]) {
    const result = validateUpdateRequest(bad);
    assert.equal(result.ok, false);
  }
});

test("update: event_id and equipment_type_id cannot be changed", () => {
  for (const field of ["event_id", "equipment_type_id"]) {
    const result = validateUpdateRequest({ [field]: VALID_EVENT_ID });
    assert.equal(result.ok, false);
    assert.ok(fieldsOf(result).includes(field));
  }
});

test("update: invalid quantity on an otherwise valid patch still fails", () => {
  const result = validateUpdateRequest({ quantity_requested: 0 });
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("quantity_requested"));
});
