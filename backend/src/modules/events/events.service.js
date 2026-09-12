const repository = require("./events.repository");
const { validateDraft } = require("./events.validation");

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
      // Left as-is so validateDraft reports the wrong type under its own rules.
      fields[column] = raw;
    }
  }

  return { fields, errors };
}

// Returns { ok: true, event } or { ok: false, errors } - the same errors shape
// events.validation.js produces, so the controller has one branch to write.
async function createDraft(input, organiserId) {
  const { fields, errors } = normalise(input);
  const validation = validateDraft(fields);
  const problems = [...errors, ...validation.errors];
  if (problems.length > 0) return { ok: false, errors: problems };

  const event = await repository.create(fields, organiserId);
  return { ok: true, event };
}

module.exports = { createDraft };
