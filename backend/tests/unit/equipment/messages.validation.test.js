const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCreateMessage,
  validateUpdateMessage,
} = require("../../../src/modules/equipment/messages.validation");

const VALID_REQUEST_ID = "22222222-2222-2222-2222-222222222222";

// --- Scrum-28-Scrum65 (AC3): validateCreateMessage -------------------------

test("create: a well-formed message passes and is normalised", () => {
  const result = validateCreateMessage({
    equipment_request_id: VALID_REQUEST_ID,
    body: "  Need the exact HDMI adapter model.  ",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    equipment_request_id: VALID_REQUEST_ID,
    body: "Need the exact HDMI adapter model.",
  });
});

test("create: equipment_request_id is required and must be a valid id", () => {
  assert.equal(
    validateCreateMessage({ body: "hi" }).errors.some((e) => e.field === "equipment_request_id"),
    true,
  );
  assert.equal(
    validateCreateMessage({ equipment_request_id: "not-a-uuid", body: "hi" }).errors.some(
      (e) => e.field === "equipment_request_id",
    ),
    true,
  );
});

test("create: body is required", () => {
  const result = validateCreateMessage({ equipment_request_id: VALID_REQUEST_ID });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{ field: "body", message: "required" }]);
});

test("create: a whitespace-only body is treated as empty", () => {
  const result = validateCreateMessage({ equipment_request_id: VALID_REQUEST_ID, body: "   " });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{ field: "body", message: "required" }]);
});

test("create: a body over 4000 characters is rejected", () => {
  const result = validateCreateMessage({
    equipment_request_id: VALID_REQUEST_ID,
    body: "a".repeat(4001),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].field, "body");
});

test("create: null / non-object input reports every required field", () => {
  const result = validateCreateMessage(null);
  assert.deepEqual(
    result.errors.map((e) => e.field).sort(),
    ["body", "equipment_request_id"],
  );
});

// --- validateUpdateMessage --------------------------------------------------

test("update: a well-formed body passes and is trimmed", () => {
  const result = validateUpdateMessage({ body: "  edited text  " });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { body: "edited text" });
});

test("update: body is required", () => {
  assert.equal(validateUpdateMessage({}).ok, false);
});

test("update: equipment_request_id cannot be changed through this endpoint", () => {
  const result = validateUpdateMessage({ body: "hi", equipment_request_id: VALID_REQUEST_ID });
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((e) => e.field === "equipment_request_id"),
    true,
  );
});
