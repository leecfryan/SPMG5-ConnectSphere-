// Field rules for an equipment request. Two gates, mirroring events.validation.js:
//   validateCreateRequest  - everything needed to insert a new request row.
//   validateUpdateRequest  - a strict subset; only the fields a requester may
//                            change after creation.
//
// Both return { ok: boolean, errors: [{ field, message }] }. `errors` lists
// EVERY problem, not just the first.
//
// Validation reads, never mutates. Trimming for storage is the service's job.
//
// This file does not import the Supabase client (see equipment.service.js),
// so these tests run without SUPABASE_URL / SUPABASE_SECRET_KEY set - same
// reasoning as events.validation.js.
//
// `requested_by` is deliberately not validated here: it is never client
// input. It comes from the authenticated caller and is attached by the
// controller/service layer, same as organiser_id in events.repository.js.

const TECH_REQUIREMENTS_MAX = 2000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fields a requester may change after creation. event_id and
// equipment_type_id identify what the row *is* - changing either is a new
// request, not an edit, so they're excluded here on purpose.
const UPDATABLE_FIELDS = ["quantity_requested", "technical_requirements"];

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

// AC3: optional technical requirements, free text within a sane length.
function checkTechnicalRequirements(data, errors) {
  const value = data.technical_requirements;
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    errors.push(err("technical_requirements", "must be text"));
  } else if (value.length > TECH_REQUIREMENTS_MAX) {
    errors.push(
      err(
        "technical_requirements",
        `must be ${TECH_REQUIREMENTS_MAX} characters or fewer`,
      ),
    );
  }
}

// AC1 + AC4: the equipment type and the event this request belongs to.
// Both are foreign keys - a well-formed UUID is all this layer can check;
// whether the row actually exists is the service's job.
function checkForeignKey(data, field, errors) {
  const value = data[field];
  if (value === undefined || value === null || value === "") {
    errors.push(err(field, "required"));
  } else if (!isUuid(value)) {
    errors.push(err(field, "must be a valid id"));
  }
}

function validateCreateRequest(input) {
  const data = asObject(input);
  const errors = [];

  checkForeignKey(data, "event_id", errors);
  checkForeignKey(data, "equipment_type_id", errors);
  checkQuantity(data, errors);
  checkTechnicalRequirements(data, errors);

  return { ok: errors.length === 0, errors };
}

function validateUpdateRequest(input) {
  const data = asObject(input);
  const errors = [];

  const unknown = Object.keys(data).filter(
    (key) => !UPDATABLE_FIELDS.includes(key),
  );
  for (const field of unknown) {
    errors.push(err(field, "cannot be changed on an existing request"));
  }

  const known = Object.keys(data).filter((key) =>
    UPDATABLE_FIELDS.includes(key),
  );
  if (known.length === 0) {
    errors.push(err("_", "at least one updatable field is required"));
  }

  if ("quantity_requested" in data) checkQuantity(data, errors);
  if ("technical_requirements" in data) {
    checkTechnicalRequirements(data, errors);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateCreateRequest,
  validateUpdateRequest,
  UPDATABLE_FIELDS,
};
