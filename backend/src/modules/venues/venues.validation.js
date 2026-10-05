// Only sibling pure modules are imported here: no express and no supabase, so
// these rules stay testable without a server or a database.
const { SLOTS, isValidDateString } = require("./venues.availability");

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// SCRUM-89, SCRUM-90: only these fields may be updated
const UPDATABLE_FIELDS = [
  "name", "address", "city", "country", "capacity",
  "facilities", "accessibility_features", "room_layouts",
  "operating_hours", "setup_minutes", "teardown_minutes",
  "turnaround_minutes", "notes", "is_active",
];

const STRING_FIELDS = ["name", "address", "city", "country"];
const ARRAY_FIELDS = ["facilities", "accessibility_features", "room_layouts"];
const MINUTE_FIELDS = ["setup_minutes", "teardown_minutes", "turnaround_minutes"];

function validateOperatingHours(hours) {
  const errors = [];

  if (typeof hours !== "object" || hours === null || Array.isArray(hours)) {
    return ["operating_hours must be an object keyed by day"];
  }

  for (const [day, entry] of Object.entries(hours)) {
    if (!DAYS.includes(day)) {
      errors.push(`operating_hours has unknown day "${day}"`);
      continue;
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`operating_hours.${day} must be an object`);
      continue;
    }

    if (entry.closed === true) continue;

    if (!TIME_PATTERN.test(entry.open || "")) {
      errors.push(`operating_hours.${day}.open must be HH:MM`);
    }
    if (!TIME_PATTERN.test(entry.close || "")) {
      errors.push(`operating_hours.${day}.close must be HH:MM`);
    }
    if (
      TIME_PATTERN.test(entry.open || "") &&
      TIME_PATTERN.test(entry.close || "") &&
      entry.open >= entry.close
    ) {
      errors.push(`operating_hours.${day} open time must be before close time`);
    }
  }

  return errors;
}

function validateVenueUpdate(payload) {
  const errors = [];

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { errors: ["Request body must be an object"], value: null };
  }

  const unknown = Object.keys(payload).filter(
    (key) => !UPDATABLE_FIELDS.includes(key)
  );
  if (unknown.length > 0) {
    errors.push(`Unknown fields: ${unknown.join(", ")}`);
  }

  const known = Object.keys(payload).filter((key) =>
    UPDATABLE_FIELDS.includes(key)
  );
  if (known.length === 0) {
    errors.push("At least one updatable field is required");
  }

  for (const field of STRING_FIELDS) {
    if (field in payload) {
      if (typeof payload[field] !== "string" || payload[field].trim() === "") {
        errors.push(`${field} must be a non-empty string`);
      }
    }
  }

  if ("capacity" in payload) {
    if (!Number.isInteger(payload.capacity) || payload.capacity <= 0) {
      errors.push("capacity must be a positive whole number");
    }
  }

  for (const field of MINUTE_FIELDS) {
    if (field in payload) {
      if (!Number.isInteger(payload[field]) || payload[field] < 0) {
        errors.push(`${field} must be zero or a positive whole number`);
      }
    }
  }

  for (const field of ARRAY_FIELDS) {
    if (field in payload) {
      const value = payload[field];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push(`${field} must be an array of strings`);
      }
    }
  }

  if ("operating_hours" in payload) {
    errors.push(...validateOperatingHours(payload.operating_hours));
  }

  if ("is_active" in payload && typeof payload.is_active !== "boolean") {
    errors.push("is_active must be true or false");
  }

  if ("notes" in payload) {
    if (payload.notes !== null && typeof payload.notes !== "string") {
      errors.push("notes must be a string or null");
    }
  }

  if (errors.length > 0) {
    return { errors, value: null };
  }

  const value = {};
  for (const field of known) {
    value[field] = STRING_FIELDS.includes(field)
      ? payload[field].trim()
      : payload[field];
  }

  return { errors: [], value };
}

// ---------------------------------------------------------------------------
// SCRUM-18: search and filter potential venues
// ---------------------------------------------------------------------------

// Everything a coordinator may narrow the catalogue by. Anything else in the
// query string is refused rather than ignored, so a typo surfaces instead of
// silently returning the whole catalogue.
const SEARCH_FIELDS = [
  "city", "minCapacity", "facilities", "accessibility", "roomLayout", "date", "slots",
];

// A repeated query parameter arrives as an array, a single one as a string.
// Both mean the same thing here.
function toList(value) {
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

function validateVenueSearch(query) {
  const errors = [];
  const value = {};

  const unknown = Object.keys(query).filter((key) => !SEARCH_FIELDS.includes(key));
  if (unknown.length > 0) {
    errors.push(`Unknown filters: ${unknown.join(", ")}`);
  }

  if (query.city !== undefined && String(query.city).trim() !== "") {
    value.city = String(query.city).trim();
  }

  // Zero means "no minimum", the same as leaving the field blank, so the
  // catalogue's capacity input and this rule agree on what is allowed.
  if (query.minCapacity !== undefined && String(query.minCapacity).trim() !== "") {
    const capacity = Number(query.minCapacity);
    if (!Number.isInteger(capacity) || capacity < 0) {
      errors.push("minCapacity must be a whole number of zero or more");
    } else if (capacity > 0) {
      value.minCapacity = capacity;
    }
  }

  // SCRUM-18 AC2 and AC3: a venue must offer every feature asked for, not just
  // one of them, otherwise the shortlist is wider than the requirements.
  for (const field of ["facilities", "accessibility"]) {
    if (query[field] !== undefined) {
      const list = toList(query[field]);
      if (list.length > 0) value[field] = list;
    }
  }

  if (query.roomLayout !== undefined && String(query.roomLayout).trim() !== "") {
    value.roomLayout = String(query.roomLayout).trim();
  }

  // SCRUM-18 AC1: the date and the slots are one filter. Slots without a date
  // have nothing to be free on.
  const hasDate = query.date !== undefined && String(query.date).trim() !== "";
  const hasSlots = query.slots !== undefined && toList(query.slots).length > 0;

  if (hasDate) {
    const date = String(query.date).trim();
    if (!isValidDateString(date)) {
      errors.push("date must be a real date in YYYY-MM-DD format");
    } else {
      value.date = date;
    }
  }

  if (hasSlots) {
    const slots = toList(query.slots).map((slot) => slot.toLowerCase());
    const unknownSlots = slots.filter((slot) => !SLOTS.includes(slot));
    if (unknownSlots.length > 0) {
      errors.push(`slots must be any of: ${SLOTS.join(", ")}`);
    } else if (!hasDate) {
      errors.push("slots needs a date, because a slot is only free on a given day");
    } else {
      value.slots = [...new Set(slots)];
    }
  }

  // Naming slots means all of them must be open, because they were asked for.
  // A date on its own means free at some point that day, so any one slot is
  // enough: a venue booked in the morning is still a candidate for the evening.
  if (value.date) {
    value.slotMatch = value.slots ? "all" : "any";
    if (!value.slots) value.slots = [...SLOTS];
  }

  if (errors.length > 0) return { errors, value: null };
  return { errors: [], value };
}

module.exports = {
  validateVenueUpdate,
  validateOperatingHours,
  validateVenueSearch,
  UPDATABLE_FIELDS,
  SEARCH_FIELDS,
  DAYS,
};