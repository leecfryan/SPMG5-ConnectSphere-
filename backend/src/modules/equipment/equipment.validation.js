// Field rules for an equipment request. Two gates:
//   validateCreateRequestGroup - everything needed to insert the N sibling
//                                 rows one submission creates (SCRUM-31).
//   validateStatusUpdate       - the review action: PENDING -> APPROVED/REJECTED.
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
// `requested_by`, `status`, `equipment_id` and `group_id` are deliberately not
// accepted here: requested_by is never client input (the controller attaches
// the authenticated caller's id), status starts at PENDING and only ever
// changes through validateStatusUpdate or the reserve action, and
// equipment_id/group_id are decided server-side once a unit is assigned
// (SCRUM-31 - see equipment.service.js's createRequestGroup/reserveGroup).

const TECH_REQUIREMENT_MAX = 2000;

// SCRUM-31 AC1: a generous sanity ceiling (same spirit as
// TECH_REQUIREMENT_MAX), not a real business limit - no realistic single
// equipment request needs more than this.
const QUANTITY_CAP = 50;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// scrum-27 AC2 + SCRUM-31 AC1: required quantity, a positive whole number up
// to QUANTITY_CAP. SCRUM-31 Decision 13: the cap is a sanity ceiling, not a
// business rule - this is how many sibling rows one submission creates.
function checkQuantity(data, errors) {
  const value = data.quantity_requested;
  if (value === undefined || value === null) {
    errors.push(err("quantity_requested", "required"));
  } else if (!Number.isInteger(value) || value <= 0 || value > QUANTITY_CAP) {
    errors.push(
      err("quantity_requested", `must be a whole number between 1 and ${QUANTITY_CAP}`),
    );
  }
}

// SCRUM-31: the type being requested - no specific unit is picked at
// submission any more (see the task note's Data model decision). Plain text,
// same convention as equipment.type itself: required, non-blank, trimmed.
function checkEquipmentType(data, errors) {
  const value = data.equipment_type;
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(err("equipment_type", "required"));
  }
}

// SCRUM-31 Decision 7: optional, defaults to false. A coordinator who leaves
// it off gets partial fulfillment; ticking it makes the whole group
// all-or-nothing at reserve time (AC5).
function checkIsEssential(data, errors) {
  const value = data.is_essential;
  if (value !== undefined && typeof value !== "boolean") {
    errors.push(err("is_essential", "must be true or false"));
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

// SCRUM-31 AC1: one coordinator submission for `quantity_requested` units of
// `equipment_type`. No equipment_id is accepted or picked here any more -
// Decision 4: this never rejects for insufficient stock, so there is nothing
// about availability to check at this layer; equipment.service.js's
// createRequestGroup turns this into that many sibling rows.
function validateCreateRequestGroup(input) {
  const data = asObject(input);
  const errors = [];

  checkForeignKey(data, "event_id", errors);
  checkEquipmentType(data, errors);
  checkQuantity(data, errors);
  checkIsEssential(data, errors);
  checkTechnicalRequirement(data, errors);

  const startMillis = checkRequiredTime(data, "borrow_start", errors);
  const endMillis = checkRequiredTime(data, "borrow_end", errors);
  if (startMillis !== null && endMillis !== null && endMillis <= startMillis) {
    errors.push(err("borrow_end", "must be after borrow_start"));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };

  const value = {
    event_id: data.event_id,
    equipment_type: data.equipment_type.trim(),
    quantity_requested: data.quantity_requested,
    is_essential: data.is_essential === true,
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

// Scrum-30: UNAVAILABLE is reachable only through the dedicated retire action
// (equipment.manage). The quick operational-status change (equipment.review)
// covers day-to-day condition changes only, so it never offers or accepts
// UNAVAILABLE - that keeps "retired" a deliberate, confirmed action rather
// than one option among many in a status dropdown.
const OPERATIONAL_STATUSES = EQUIPMENT_STATUSES.filter((status) => status !== "UNAVAILABLE");

function validateEquipmentStatusUpdate(input) {
  const data = asObject(input);
  const errors = [];

  const unknown = Object.keys(data).filter((key) => key !== "status");
  for (const field of unknown) {
    errors.push(err(field, "cannot be changed through this endpoint"));
  }

  if (!OPERATIONAL_STATUSES.includes(data.status)) {
    errors.push(err("status", `must be one of ${OPERATIONAL_STATUSES.join(", ")}`));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { status: data.status } };
}

// Scrum-30 AC1/AC2: a new catalogue record. status defaults to AVAILABLE
// (the schema's own default) when omitted, but may be set to any recognised
// value up front - unlike the quick-status endpoint above, creating a record
// is a full management action, not a day-to-day condition tweak.
function validateCreateEquipment(input) {
  const data = asObject(input);
  const errors = [];

  if (typeof data.type !== "string" || data.type.trim() === "") {
    errors.push(err("type", "required"));
  }
  if (typeof data.current_location !== "string" || data.current_location.trim() === "") {
    errors.push(err("current_location", "required"));
  }
  if (data.description !== undefined && data.description !== null && typeof data.description !== "string") {
    errors.push(err("description", "must be text"));
  }
  if (data.status !== undefined && !EQUIPMENT_STATUSES.includes(data.status)) {
    errors.push(err("status", `must be one of ${EQUIPMENT_STATUSES.join(", ")}`));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };

  const value = {
    type: data.type.trim(),
    current_location: data.current_location.trim(),
  };
  if (typeof data.description === "string") value.description = data.description.trim();
  if (data.status !== undefined) value.status = data.status;

  return { ok: true, errors: [], value };
}

// Scrum-30 AC1/AC2: editing an existing record's type, description, location
// or status. Every field is optional (a caller changes only what it means
// to), but at least one must be present, and any field given must be valid -
// same "every problem, not just the first" shape as the rest of this file.
const EDITABLE_EQUIPMENT_FIELDS = ["type", "description", "current_location", "status"];

function validateUpdateEquipment(input) {
  const data = asObject(input);
  const errors = [];

  const unknown = Object.keys(data).filter((key) => !EDITABLE_EQUIPMENT_FIELDS.includes(key));
  for (const field of unknown) {
    errors.push(err(field, "cannot be changed through this endpoint"));
  }

  if (Object.keys(data).length === 0) {
    errors.push(err("type", "at least one field is required"));
  }
  if (data.type !== undefined && (typeof data.type !== "string" || data.type.trim() === "")) {
    errors.push(err("type", "must be a non-empty string"));
  }
  if (data.current_location !== undefined && (typeof data.current_location !== "string" || data.current_location.trim() === "")) {
    errors.push(err("current_location", "must be a non-empty string"));
  }
  if (data.description !== undefined && data.description !== null && typeof data.description !== "string") {
    errors.push(err("description", "must be text"));
  }
  if (data.status !== undefined && !EQUIPMENT_STATUSES.includes(data.status)) {
    errors.push(err("status", `must be one of ${EQUIPMENT_STATUSES.join(", ")}`));
  }

  if (errors.length > 0) return { ok: false, errors, value: null };

  const value = {};
  if (data.type !== undefined) value.type = data.type.trim();
  if (data.current_location !== undefined) value.current_location = data.current_location.trim();
  if (data.description !== undefined) value.description = data.description === null ? null : data.description.trim();
  if (data.status !== undefined) value.status = data.status;

  return { ok: true, errors: [], value };
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

// SCRUM-150: REVIEW_REQUIRED (a reservation flagged for re-review after an
// event reschedule) still holds the unit against other events, same as
// PENDING - it is not assumed invalid until Technical Support resolves it.
const BLOCKING_REQUEST_STATUSES = ["PENDING", "APPROVED", "REVIEW_REQUIRED"];

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

// Shared by every caller that needs "this unit's PENDING/APPROVED requests"
// grouped for findAvailableUnits: the catalogue/availability endpoints and
// (SCRUM-31) reserveGroup. Moved here from equipment.controller.js so the
// reserve action can reuse it without duplicating the loop.
function groupRequestsByEquipmentId(requests) {
  const requestsByEquipmentId = new Map();
  for (const request of requests) {
    const forUnit = requestsByEquipmentId.get(request.equipment_id) || [];
    forUnit.push(request);
    requestsByEquipmentId.set(request.equipment_id, forUnit);
  }
  return requestsByEquipmentId;
}

// SCRUM-31 AC1/AC2/AC5: the pure reservation decision. `pendingRequests` and
// `availableUnits` are pre-scoped by the caller (reserveGroup) - this just
// decides who gets what, so it can be tested without any I/O.
//
// AC5: an essential group (Decision 2: essential if *any* sibling is) is
// all-or-nothing - if there isn't enough stock to cover every pending
// sibling, nothing is reserved at all (Decision 9: checked before any write,
// so a 409 here always means zero side effects).
//
// Otherwise (AC1): assign units to as many pending siblings as there are
// available units, in order; whatever's left becomes UNFULFILLED
// (Decision 8: automatic, no manual flag).
function planReservation({ pendingRequests, availableUnits, isEssential }) {
  if (isEssential && availableUnits.length < pendingRequests.length) {
    return {
      ok: false,
      reason: "essential_shortfall",
      availableCount: availableUnits.length,
      pendingCount: pendingRequests.length,
    };
  }

  const reservedCount = Math.min(availableUnits.length, pendingRequests.length);
  const assignments = pendingRequests.slice(0, reservedCount).map((request, index) => ({
    requestId: request.id,
    equipmentId: availableUnits[index].id,
  }));
  const unfulfilledRequestIds = pendingRequests.slice(reservedCount).map((request) => request.id);

  return { ok: true, assignments, unfulfilledRequestIds };
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
  validateCreateRequestGroup,
  validateStatusUpdate,
  QUANTITY_CAP,
  REVIEW_STATUSES,
  EQUIPMENT_STATUSES,
  OPERATIONAL_STATUSES,
  validateEquipmentStatusUpdate,
  validateCreateEquipment,
  validateUpdateEquipment,
  BLOCKING_REQUEST_STATUSES,
  startOfUtcDay,
  isBlockingOverlap,
  isStatusAvailable,
  findAvailableUnits,
  checkAvailability,
  groupRequestsByEquipmentId,
  planReservation,
  validateAvailabilityQuery,
  validateAvailabilityWindow,
};
