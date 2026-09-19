const repository = require("./events.repository");
const { validateForSubmission } = require("./events.validation");

const TIME_FIELDS = new Set(["start_time", "end_time"]);
const NUMBER_FIELDS = new Set(["expected_attendance"]);

function blank(value) {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function toTimestamp(value, field, errors) {
  const millis = new Date(value).getTime();
  if (Number.isNaN(millis)) {
    errors.push({ field, message: "must be a valid date/time" });
    return undefined;
  }
  return new Date(millis).toISOString();
}

// The column is an integer; NaN would reach Supabase as a type error and
// surface to the organiser as a 500 rather than as the field they mistyped.
function toCount(value, field, errors) {
  const count = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(count) || count <= 0) {
    errors.push({
      field,
      message: "must be a whole number greater than zero",
    });
    return undefined;
  }
  return count;
}

function normalise(input) {
  const source = input && typeof input === "object" ? input : {};
  const fields = {};
  const errors = [];

  for (const column of repository.WRITABLE_COLS) {
    const raw = source[column];
    if (raw === undefined) continue;
    if (blank(raw)) {
      fields[column] = null;
      continue;
    }
    if (TIME_FIELDS.has(column)) {
      fields[column] = toTimestamp(raw, column, errors);
    } else if (NUMBER_FIELDS.has(column)) {
      fields[column] = toCount(raw, column, errors);
    } else if (typeof raw === "string") {
      fields[column] = raw.trim();
    } else {
      // Left as-is so the validator reports the wrong type under its own rules.
      fields[column] = raw;
    }
  }

  return { fields, errors };
}

// US-14: the form submits straight to SUBMITTED. Phase one has no drafts;
// US-13 adds a draft path that runs validateDraft instead.
//
// Returns { ok: true, event } or { ok: false, errors } - the same errors shape
// events.validation.js produces, so the controller has one branch to write.
async function submitRequest(input, organiserId, eventRepository = repository) {
  const { fields, errors } = normalise(input);

  // A value normalise could not read is left undefined, which the validator
  // would also report as "required". One mistake, one message: the parse error
  // is the accurate one, so the validator's entry for that field is dropped.
  const unreadable = new Set(errors.map((problem) => problem.field));
  const validation = validateForSubmission(fields).errors.filter(
    (problem) => !unreadable.has(problem.field),
  );

  const problems = [...errors, ...validation];
  if (problems.length > 0) return { ok: false, errors: problems };

  const event = await eventRepository.createSubmitted(fields, organiserId);
  return { ok: true, event };
}

module.exports = { submitRequest };
