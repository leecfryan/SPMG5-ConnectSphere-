// SCRUM-133: validation for unavailability period create and update requests.
const { SLOTS, isValidDateString } = require("./venues.availability");

function validateUnavailabilityCreate(body) {
  const errors = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { errors: ["Request body must be an object"], value: null };
  }
  const { start_date, end_date, slots, reason } = body;

  if (!isValidDateString(start_date)) errors.push("Valid start date is required (YYYY-MM-DD)");
  if (!isValidDateString(end_date)) errors.push("Valid end date is required (YYYY-MM-DD)");
  if (isValidDateString(start_date) && isValidDateString(end_date) && end_date < start_date) {
    errors.push("End date must not be before start date");
  }

  if (!Array.isArray(slots) || slots.length === 0) {
    errors.push("At least one time slot must be selected");
  } else {
    const invalid = slots.filter((s) => !SLOTS.includes(s));
    if (invalid.length > 0) {
      errors.push(`Invalid time slots: ${invalid.join(", ")}. Choose from: ${SLOTS.join(", ")}`);
    }
  }

  if (typeof reason !== "string" || reason.trim() === "") {
    errors.push("Reason is required");
  }

  if (errors.length > 0) return { errors, value: null };
  return {
    errors: [],
    value: { start_date, end_date, slots: [...new Set(slots)], reason: reason.trim() },
  };
}

function validateUnavailabilityUpdate(body) {
  const errors = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { errors: ["Request body must be an object"], value: null };
  }

  const UPDATABLE = ["start_date", "end_date", "slots", "reason"];
  const unknown = Object.keys(body).filter((k) => !UPDATABLE.includes(k));
  if (unknown.length > 0) errors.push(`Unknown fields: ${unknown.join(", ")}`);

  if (Object.keys(body).filter((k) => UPDATABLE.includes(k)).length === 0) {
    errors.push("At least one field is required");
  }

  if ("start_date" in body && !isValidDateString(body.start_date)) {
    errors.push("Valid start date is required (YYYY-MM-DD)");
  }
  if ("end_date" in body && !isValidDateString(body.end_date)) {
    errors.push("Valid end date is required (YYYY-MM-DD)");
  }
  // Cross-field check when both are submitted; when only one is submitted the
  // controller checks against the existing record after fetching it.
  if ("start_date" in body && "end_date" in body &&
      isValidDateString(body.start_date) && isValidDateString(body.end_date) &&
      body.end_date < body.start_date) {
    errors.push("End date must not be before start date");
  }

  if ("slots" in body) {
    if (!Array.isArray(body.slots) || body.slots.length === 0) {
      errors.push("At least one time slot must be selected");
    } else {
      const invalid = body.slots.filter((s) => !SLOTS.includes(s));
      if (invalid.length > 0) {
        errors.push(`Invalid time slots: ${invalid.join(", ")}. Choose from: ${SLOTS.join(", ")}`);
      }
    }
  }

  if ("reason" in body && (typeof body.reason !== "string" || body.reason.trim() === "")) {
    errors.push("Reason is required");
  }

  if (errors.length > 0) return { errors, value: null };

  const value = {};
  if ("start_date" in body) value.start_date = body.start_date;
  if ("end_date" in body) value.end_date = body.end_date;
  if ("slots" in body) value.slots = [...new Set(body.slots)];
  if ("reason" in body) value.reason = body.reason.trim();
  return { errors: [], value };
}

module.exports = { validateUnavailabilityCreate, validateUnavailabilityUpdate };
