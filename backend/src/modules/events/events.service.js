const repository = require("./events.repository");
const { validateDraft, validateForSubmission } = require("./events.validation");

const TIME_FIELDS = new Set([
  "start_time",
  "end_time",
  "registration_start",
  "registration_end",
]);
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

// A value normalise could not read is left undefined, which the validator
// would also report as "required". One mistake, one message: the parse error
// is the accurate one, so the validator's entry for that field is dropped.
function problemsWith(errors, validation) {
  const unreadable = new Set(errors.map((problem) => problem.field));
  return [...errors, ...validation.errors.filter((problem) => !unreadable.has(problem.field))];
}

// The writable columns of a stored draft, so a partial edit is checked
// against the whole draft it produces.
function draftFields(draft) {
  return Object.fromEntries(repository.WRITABLE_COLS.map((column) => [column, draft[column]]));
}

// Submitting from the form without a draft goes straight to SUBMITTED.
//
// Returns { ok: true, event } or { ok: false, errors } - the same errors shape
// events.validation.js produces, so the controller has one branch to write.
async function submitRequest(input, organiserId, eventRepository = repository) {
  const { fields, errors } = normalise(input);
  const problems = problemsWith(errors, validateForSubmission(fields));
  if (problems.length > 0) return { ok: false, errors: problems };

  const event = await eventRepository.createSubmitted(fields, organiserId);
  return { ok: true, event };
}

// SCRUM-147 AC1/AC2: a draft needs only a name; the submission rules wait
// until the organiser submits it.
async function saveDraft(input, organiserId, eventRepository = repository) {
  const { fields, errors } = normalise(input);
  const problems = problemsWith(errors, validateDraft(fields));
  if (problems.length > 0) return { ok: false, reason: "invalid", errors: problems };
  return { ok: true, event: await eventRepository.createDraft(fields, organiserId) };
}

// SCRUM-147 AC3: continue editing. A draft that is not the caller's, or is no
// longer a draft, is "not found" (AC4: its existence is not revealed).
async function updateDraft(id, input, organiserId, eventRepository = repository) {
  const draft = await eventRepository.findOwnDraft(id, organiserId);
  if (!draft) return { ok: false, reason: "not_found" };
  const { fields, errors } = normalise(input);
  const problems = problemsWith(errors, validateDraft({ ...draftFields(draft), ...fields }));
  if (problems.length > 0) return { ok: false, reason: "invalid", errors: problems };
  const event = await eventRepository.updateDraft(id, organiserId, fields);
  return event ? { ok: true, event } : { ok: false, reason: "conflict" };
}

// SCRUM-147 AC2/AC3: the full submission rules run on the draft as it will be
// submitted - what is stored plus the form's latest edits. A refusal writes
// nothing, so the draft stays a draft.
async function submitDraft(id, input, organiserId, eventRepository = repository) {
  const draft = await eventRepository.findOwnDraft(id, organiserId);
  if (!draft) return { ok: false, reason: "not_found" };
  const { fields, errors } = normalise(input);
  const problems = problemsWith(errors, validateForSubmission({ ...draftFields(draft), ...fields }));
  if (problems.length > 0) return { ok: false, reason: "invalid", errors: problems };
  const event = await eventRepository.markSubmitted(id, organiserId, fields);
  return event ? { ok: true, event } : { ok: false, reason: "conflict" };
}

module.exports = { submitRequest, saveDraft, updateDraft, submitDraft, normalise };
