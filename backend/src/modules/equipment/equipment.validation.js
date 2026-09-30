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

// scrum-27 AC1 + AC4: which equipment and which event this request belongs to. Both
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

// scrum-27 AC2: required quantity, must be a positive whole number.
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

// scrum-27 AC3: optional technical requirement, free text within a sane length.
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

// Technical Support Staff manually record equipment
// status changes (e.g. AVAILABLE -> MAINTENANCE) - there is no automatic
// status write anywhere else in the app (see equipment-integration.md), so
// this is currently the only way equipment.status ever changes.
const EQUIPMENT_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "UNAVAILABLE", "DAMAGED", "UNDER_MAINTENANCE"];

function validateEquipmentStatusUpdate(input) {
  const data = asObject(input);
  const errors = [];

  const unknown = Object.keys(data).filter((key) => key !== "status");
  for (const field of unknown) {
    errors.push(err(field, "cannot be changed through this endpoint"));
  }

  if (!EQUIPMENT_STATUSES.includes(data.status)) {
    errors.push(err("status", `must be one of ${EQUIPMENT_STATUSES.join(", ")}`));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { status: data.status } };
}

// Scrum-29: equipment availability check.
//
// AC2 + AC4 : overlap is Rule B - day-granularity, touching
// endpoints blocked ("Return Day + 1") - and it now applies everywhere an
// overlap is checked, not just in the availability check below.
// equipment.service.js's hasOverlappingRequest (used by
// POST /events/:eventId/equipment-requests) was previously Rule A
// (timestamp-precision, touching allowed); the team decided that divergence
// was unacceptable - an item must never show as unavailable in this check
// while still being bookable through that endpoint - so hasOverlappingRequest
// now calls isBlockingOverlap too. See that file for the superseded Rule A
// query.

const BLOCKING_REQUEST_STATUSES = ["PENDING", "APPROVED"];

// borrow_start/borrow_end are timestamptz columns stored in UTC. Truncating
// to a UTC calendar day (rather than comparing full timestamps) is what
// makes AC4 hold: a request ending at any time on day D and a request
// starting at any time on day D are treated as the same day, so the
// equipment isn't free again until day D+1.
function startOfUtcDay(isoString) {
  const date = new Date(isoString);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// scrum-29 AC2 (Rule B) + AC4 (day granularity, Return Day + 1): true when the
// existing request's borrow window and the requested window fall on
// overlapping or touching days.
function isBlockingOverlap(existingRequest, requestedStart, requestedEnd) {
  const existingStartDay = startOfUtcDay(existingRequest.borrow_start);
  const existingEndDay = startOfUtcDay(existingRequest.borrow_end);
  const requestedStartDay = startOfUtcDay(requestedStart);
  const requestedEndDay = startOfUtcDay(requestedEnd);
  return existingStartDay <= requestedEndDay && existingEndDay >= requestedStartDay;
}

// scrum 29 AC3: anything not AVAILABLE is excluded. Written as an allowlist (not a
// denylist of known-bad values) so it excludes correctly both before and
// after the team's planned status-constraint update - a status value this
// code has never seen is excluded by default, not opted into.
function isStatusAvailable(equipmentUnit) {
  return equipmentUnit.status === "AVAILABLE";
}

//  AC1-AC4: `equipmentUnits` and `requestsByEquipmentId` are pre-scoped by the
// caller (the service queries by equipment type and by blocking status). A
// unit is available for the requested period when its status passes AC3 and
// none of its own PENDING/APPROVED requests block the period under AC2/AC4.
function findAvailableUnits({ equipmentUnits, requestsByEquipmentId, requestedStart, requestedEnd }) {
  return equipmentUnits.filter((unit) => {
    if (!isStatusAvailable(unit)) return false;
    const requests = requestsByEquipmentId.get(unit.id) || [];
    return !requests.some((request) => isBlockingOverlap(request, requestedStart, requestedEnd));
  });
}

// AC1 + quantity handling: returns the available count and
// whether it meets the requested quantity, so a caller can use either
// without recomputing.
function checkAvailability({ equipmentUnits, requestsByEquipmentId, requestedStart, requestedEnd, requestedQuantity }) {
  const availableUnits = findAvailableUnits({ equipmentUnits, requestsByEquipmentId, requestedStart, requestedEnd });
  return {
    available_quantity: availableUnits.length,
    requested_quantity: requestedQuantity,
    fulfillable: availableUnits.length >= requestedQuantity,
    available_equipment_ids: availableUnits.map((unit) => unit.id),
  };
}

// scrum 29 AC1: accepts event start/end date-time, equipment type, requested
// quantity, and event location. Location is accepted and echoed back but not
// used for filtering yet - deferred to a later sprint per the story's scope.
function validateAvailabilityQuery(input) {
  const data = asObject(input);
  const errors = [];

  if (typeof data.type !== "string" || data.type.trim() === "") {
    errors.push(err("type", "required"));
  }
  if (typeof data.location !== "string" || data.location.trim() === "") {
    errors.push(err("location", "required"));
  }

  const startMillis = checkRequiredTime(data, "start", errors);
  const endMillis = checkRequiredTime(data, "end", errors);
  if (startMillis !== null && endMillis !== null && endMillis <= startMillis) {
    errors.push(err("end", "must be after start"));
  }

  const quantity = Number(data.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    errors.push(err("quantity", "must be a whole number greater than zero"));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: [],
    value: {
      type: data.type.trim(),
      location: data.location.trim(),
      start: new Date(data.start).toISOString(),
      end: new Date(data.end).toISOString(),
      quantity,
    },
  };
}

// The equipment-request form's dropdown needs only a
// start/end window (no type/quantity/location) to ask "which units are
// bookable for this period at all" - shared with validateAvailabilityQuery's
// time parsing, but without the fields that check has no use for here.
function validateAvailabilityWindow(input) {
  const data = asObject(input);
  const errors = [];

  const startMillis = checkRequiredTime(data, "start", errors);
  const endMillis = checkRequiredTime(data, "end", errors);
  if (startMillis !== null && endMillis !== null && endMillis <= startMillis) {
    errors.push(err("end", "must be after start"));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: [],
    value: { start: new Date(data.start).toISOString(), end: new Date(data.end).toISOString() },
  };
}

module.exports = {
  validateCreateRequest,
  validateStatusUpdate,
  WRITABLE_COLS,
  REVIEW_STATUSES,
  EQUIPMENT_STATUSES,
  validateEquipmentStatusUpdate,
  BLOCKING_REQUEST_STATUSES,
  startOfUtcDay,
  isBlockingOverlap,
  isStatusAvailable,
  findAvailableUnits,
  checkAvailability,
  validateAvailabilityQuery,
  validateAvailabilityWindow,
};
