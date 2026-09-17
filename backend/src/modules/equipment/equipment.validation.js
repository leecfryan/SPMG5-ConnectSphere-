// Field rules for an equipment request. Two gates:
//   validateCreateRequest  - everything needed to insert a new request row.
//   validateStatusUpdate   - the review action: PENDING -> APPROVED/REJECTED.
//
// Both return { ok: boolean, errors: [{ field, message }], value }. `errors`
// lists EVERY problem, not just the first - `value` is the normalised
// (trimmed) payload built only when ok is true, same shape as
// venues.validation.js.
//
// Validation reads, never mutates. This file does not import the Supabase
// client, so these tests run without SUPABASE_URL / SUPABASE_SECRET_KEY set -
// same reasoning as events.validation.js.
//
// `requested_by` and `status` are deliberately not accepted here: requested_by
// is never client input (the controller attaches the authenticated caller's
// id), and status starts at PENDING and only ever changes through
// validateStatusUpdate.

const TECH_REQUIREMENT_MAX = 2000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns a caller may set when creating a request.
const WRITABLE_COLS = [
  "event_id",
  "equipment_id",
  "quantity_requested",
  "technical_requirement",
  "borrow_start",
  "borrow_end",
];

const REVIEW_STATUSES = ["APPROVED", "REJECTED"];

function asObject(input) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
}

function err(field, message) {
  return { field, message };
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// AC1 + AC4: which equipment and which event this request belongs to. Both
// are foreign keys - a well-formed UUID is all this layer can check; whether
// the row actually exists is the service's job.
function checkForeignKey(data, field, errors) {
  const value = data[field];
  if (value === undefined || value === null || value === "") {
    errors.push(err(field, "required"));
  } else if (!isUuid(value)) {
    errors.push(err(field, "must be a valid id"));
  }
}

// AC2: required quantity, must be a positive whole number.
function checkQuantity(data, errors) {
  const value = data.quantity_requested;
  if (value === undefined || value === null) {
    errors.push(err("quantity_requested", "required"));
  } else if (!Number.isInteger(value) || value <= 0) {
    errors.push(
      err("quantity_requested", "must be a whole number greater than zero"),
    );
  }
}

// AC3: optional technical requirement, free text within a sane length.
function checkTechnicalRequirement(data, errors) {
  const value = data.technical_requirement;
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    errors.push(err("technical_requirement", "must be text"));
  } else if (value.length > TECH_REQUIREMENT_MAX) {
    errors.push(
      err(
        "technical_requirement",
        `must be ${TECH_REQUIREMENT_MAX} characters or fewer`,
      ),
    );
  }
}

// Returns the field's value in epoch millis, or null when missing/unparseable
// - an error is pushed in both cases. Callers use that null to skip
// comparisons that would be meaningless against a value we could not read.
function checkRequiredTime(data, field, errors) {
  const value = data[field];
  if (value === undefined || value === null || value === "") {
    errors.push(err(field, "required"));
    return null;
  }
  const millis = new Date(value).getTime();
  if (Number.isNaN(millis)) {
    errors.push(err(field, "must be a valid date/time"));
    return null;
  }
  return millis;
}

function validateCreateRequest(input) {
  const data = asObject(input);
  const errors = [];

  checkForeignKey(data, "event_id", errors);
  checkForeignKey(data, "equipment_id", errors);
  checkQuantity(data, errors);
  checkTechnicalRequirement(data, errors);

  const startMillis = checkRequiredTime(data, "borrow_start", errors);
  const endMillis = checkRequiredTime(data, "borrow_end", errors);
  if (startMillis !== null && endMillis !== null && endMillis <= startMillis) {
    errors.push(err("borrow_end", "must be after borrow_start"));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };

  const value = {
    event_id: data.event_id,
    equipment_id: data.equipment_id,
    quantity_requested: data.quantity_requested,
    borrow_start: new Date(data.borrow_start).toISOString(),
    borrow_end: new Date(data.borrow_end).toISOString(),
  };
  if (typeof data.technical_requirement === "string") {
    value.technical_requirement = data.technical_requirement.trim();
  }

  return { ok: true, errors: [], value };
}

// The review action. Only a transition to APPROVED or REJECTED is a valid
// request body - PENDING is a starting state, never a target, and no other
// field on the request may change through this endpoint.
function validateStatusUpdate(input) {
  const data = asObject(input);
  const errors = [];

  const unknown = Object.keys(data).filter((key) => key !== "status");
  for (const field of unknown) {
    errors.push(err(field, "cannot be changed on an existing request"));
  }

  if (!REVIEW_STATUSES.includes(data.status)) {
    errors.push(
      err("status", `must be one of ${REVIEW_STATUSES.join(", ")}`),
    );
  }

  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { status: data.status } };
}

module.exports = {
  validateCreateRequest,
  validateStatusUpdate,
  WRITABLE_COLS,
  REVIEW_STATUSES,
};
