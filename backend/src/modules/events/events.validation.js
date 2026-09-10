// Field rules for an event request. Two gates:
//   validateDraft          - a draft may be almost empty; only `name` is required.
//   validateForSubmission  - a strict superset; everything US-14 needs to submit.
//
// Both return { ok: boolean, errors: [{ field, message }] }. `errors` lists EVERY
// problem, not just the first - the submit endpoint reports the full list.
//
// Validation reads, never mutates. Trimming and type coercion for storage is the
// service's job, not this file's.
//
// Field names track WRITABLE_COLS in events.repository.js. This file deliberately
// does not import that list: the repository pulls in the Supabase client, which
// throws at import time when SUPABASE_URL / SUPABASE_SECRET_KEY are unset, and
// these unit tests run without them.

const NAME_MAX = 200;
const TEXT_MAX = 2000;

// Free-text fields we store verbatim. Never required (US-12 ER-04: "where
// relevant"); the venue / equipment / registration features parse them later.
const OPTIONAL_TEXT_FIELDS = [
  "venue_requirements",
  "accessibility_needs",
  "equipment_needs",
  "other_comments",
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function err(field, message) {
  return { field, message };
}

function checkName(input, errors) {
  if (!isNonEmptyString(input.name)) {
    errors.push(err("name", "required"));
  } else if (input.name.trim().length > NAME_MAX) {
    errors.push(err("name", `must be ${NAME_MAX} characters or fewer`));
  }
}

function checkOptionalText(input, errors) {
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      errors.push(err(field, "must be text"));
    } else if (value.length > TEXT_MAX) {
      errors.push(err(field, `must be ${TEXT_MAX} characters or fewer`));
    }
  }
}

// Returns the field's value in epoch millis, or null when it was missing or
// unparseable - an error is pushed in both cases. Callers use that null to skip
// comparisons that would be meaningless against a value we could not read.
function checkRequiredTime(input, field, errors) {
  const value = input[field];
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

function asObject(input) {
  return input && typeof input === "object" ? input : {};
}

function validateDraft(input) {
  const data = asObject(input);
  const errors = [];
  checkName(data, errors);
  checkOptionalText(data, errors);
  return { ok: errors.length === 0, errors };
}

function validateForSubmission(input) {
  const data = asObject(input);
  const errors = [];

  checkName(data, errors);

  if (!isNonEmptyString(data.purpose)) errors.push(err("purpose", "required"));
  if (!isNonEmptyString(data.description)) {
    errors.push(err("description", "required"));
  }

  // start_time must be in the future. end_time only has to beat start_time - an
  // end after a future start is necessarily future itself, and checking it twice
  // would report one mistake under two field names.
  const startMillis = checkRequiredTime(data, "start_time", errors);
  if (startMillis !== null && startMillis <= Date.now()) {
    errors.push(err("start_time", "must be in the future"));
  }

  const endMillis = checkRequiredTime(data, "end_time", errors);
  if (startMillis !== null && endMillis !== null && endMillis <= startMillis) {
    errors.push(err("end_time", "must be after start_time"));
  }

  // expected_attendance: required, whole number > 0. No string coercion here -
  // the controller sends a real number.
  const attendance = data.expected_attendance;
  if (attendance === undefined || attendance === null) {
    errors.push(err("expected_attendance", "required"));
  } else if (
    typeof attendance !== "number" ||
    !Number.isInteger(attendance) ||
    attendance <= 0
  ) {
    errors.push(
      err("expected_attendance", "must be a whole number greater than zero"),
    );
  }

  checkOptionalText(data, errors);

  return { ok: errors.length === 0, errors };
}

module.exports = { validateDraft, validateForSubmission };
