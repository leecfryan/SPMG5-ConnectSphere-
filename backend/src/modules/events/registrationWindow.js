const REGISTRATION_WINDOW_FIELDS = ["registration_start", "registration_end"];

function normaliseRegistrationWindow(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fields = {};
  const errors = [];

  for (const field of REGISTRATION_WINDOW_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (value === null || (typeof value === "string" && value.trim() === "")) {
      fields[field] = null;
      continue;
    }
    if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
      errors.push({ field, message: "must be a valid date/time" });
      continue;
    }
    fields[field] = new Date(value).toISOString();
  }

  return { fields, errors };
}

function validateRegistrationWindow(values) {
  const errors = [];
  const start = values.registration_start;
  const end = values.registration_end;

  if (start != null && end != null) {
    const startMillis = new Date(start).getTime();
    const endMillis = new Date(end).getTime();
    if (Number.isNaN(startMillis)) {
      errors.push({ field: "registration_start", message: "must be a valid date/time" });
    }
    if (Number.isNaN(endMillis)) {
      errors.push({ field: "registration_end", message: "must be a valid date/time" });
    }
    if (!Number.isNaN(startMillis) && !Number.isNaN(endMillis) && endMillis <= startMillis) {
      errors.push({ field: "registration_end", message: "must be after registration_start" });
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  REGISTRATION_WINDOW_FIELDS,
  normaliseRegistrationWindow,
  validateRegistrationWindow,
};
