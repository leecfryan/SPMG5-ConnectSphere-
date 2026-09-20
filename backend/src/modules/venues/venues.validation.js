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

module.exports = { validateVenueUpdate, validateOperatingHours, UPDATABLE_FIELDS, DAYS };