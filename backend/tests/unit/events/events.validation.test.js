import { test, expect } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS. Loading them with createRequire keeps
// them in Node's own module graph, so the object a test holds is the same one
// the source closes over; a plain ESM import would hand back a second copy and
// a spy set on it would never be seen by the code under test.
const require = createRequire(import.meta.url);

const {
  validateDraft,
  validateForSubmission,
} = require("../../../src/modules/events/events.validation");

const fieldsOf = (result) => result.errors.map((e) => e.field).sort();

// A valid, complete submission payload. Tests clone it and break one thing.
function completeInput() {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return {
    name: "Annual Alumni Gala",
    purpose: "Reconnect alumni and raise scholarship funds",
    description: "An evening of dinner, awards and networking for 200 guests.",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    expected_attendance: 200,
  };
}

test("fixture guard: completeInput passes submission", () => {
  expect(validateForSubmission(completeInput())).toEqual({ ok: true, errors: [] });
});

// --- validateDraft ---------------------------------------------------------

test("US-13 (deferred): a name alone is enough for a draft", () => {
  expect(validateDraft({ name: "Untitled event" })).toEqual({
    ok: true,
    errors: [],
  });
});

test("US-13 (deferred): a draft still requires a name", () => {
  for (const bad of [
    undefined,
    null,
    {},
    { name: "" },
    { name: "   " },
    { name: 42 },
    { name: null },
  ]) {
    const result = validateDraft(bad);
    expect(result.ok, `${JSON.stringify(bad)} should fail`).toBe(false);
    expect(fieldsOf(result)).toContain("name");
  }
});

test("US-13 (deferred): an over-long draft name is rejected", () => {
  const result = validateDraft({ name: "x".repeat(201) });
  expect(result.ok).toBe(false);
  expect(fieldsOf(result)).toContain("name");
});

test("US-13 (deferred): purpose and description are not required for a draft", () => {
  expect(validateDraft({ name: "ok" }).ok).toBe(true);
});

test("US-13 (deferred): a draft needs neither start_time nor end_time", () => {
  expect(validateDraft({ name: "Untitled event" }).ok).toBe(true);
});

test("US-13 (deferred): a non-string optional field is rejected", () => {
  const result = validateDraft({ name: "ok", venue_requirements: { rooms: 2 } });
  expect(result.ok).toBe(false);
  expect(fieldsOf(result)).toContain("venue_requirements");
});

test("US-13 (deferred): null / undefined optional fields are ignored", () => {
  const result = validateDraft({
    name: "ok",
    equipment_needs: null,
    other_comments: undefined,
  });
  expect(result.ok).toBe(true);
});

// --- validateForSubmission -----------------------------------------------------

test("SCRUM-23: a null or non-object request lists every required field", () => {
  for (const bad of [undefined, null, "nope", 7]) {
    expect(fieldsOf(validateForSubmission(bad))).toEqual([
      "description",
      "end_time",
      "expected_attendance",
      "name",
      "purpose",
      "start_time",
    ]);
  }
});

test("SCRUM-23: each required field missing on its own is reported", () => {
  for (const field of [
    "name",
    "purpose",
    "description",
    "start_time",
    "end_time",
    "expected_attendance",
  ]) {
    const input = completeInput();
    delete input[field];
    const result = validateForSubmission(input);
    expect(result.ok, `${field} missing should fail`).toBe(false);
    expect(fieldsOf(result), `${field} should be in errors`).toContain(field);
  }
});

test("SCRUM-44: whitespace-only text fails the same as empty", () => {
  const input = completeInput();
  input.purpose = "   ";
  input.description = "\n\t";
  expect(fieldsOf(validateForSubmission(input))).toEqual([
    "description",
    "purpose",
  ]);
});

test("SCRUM-45: start_time must be a real, future date", () => {
  const past = completeInput();
  past.start_time = new Date(Date.now() - 1000).toISOString();
  expect(fieldsOf(validateForSubmission(past))).toContain("start_time");

  const nonsense = completeInput();
  nonsense.start_time = "tomorrow";
  expect(fieldsOf(validateForSubmission(nonsense))).toContain("start_time");

  const blank = completeInput();
  blank.start_time = "";
  expect(fieldsOf(validateForSubmission(blank))).toContain("start_time");
});

test("SCRUM-45: end_time must be a real date strictly after start_time", () => {
  const before = completeInput();
  before.end_time = new Date(
    new Date(before.start_time).getTime() - 60 * 60 * 1000,
  ).toISOString();
  expect(fieldsOf(validateForSubmission(before))).toContain("end_time");

  const identical = completeInput();
  identical.end_time = identical.start_time;
  expect(fieldsOf(validateForSubmission(identical))).toContain("end_time");

  const nonsense = completeInput();
  nonsense.end_time = "later that evening";
  expect(fieldsOf(validateForSubmission(nonsense))).toContain("end_time");

  const blank = completeInput();
  blank.end_time = "";
  expect(fieldsOf(validateForSubmission(blank))).toContain("end_time");
});

// Guards the `startMillis !== null` half of the comparison: one bad timestamp
// should fault one field, not smear an error across both.
test("SCRUM-45 design: an unreadable start_time does not also fault end_time", () => {
  const nonsense = completeInput();
  nonsense.start_time = "tomorrow";
  expect(fieldsOf(validateForSubmission(nonsense))).toEqual(["start_time"]);

  const missing = completeInput();
  delete missing.start_time;
  expect(fieldsOf(validateForSubmission(missing))).toEqual(["start_time"]);
});

test("SCRUM-45 design: a past start_time still reports an end_time that precedes it", () => {
  const input = completeInput();
  input.start_time = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  input.end_time = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  expect(fieldsOf(validateForSubmission(input))).toEqual([
    "end_time",
    "start_time",
  ]);
});

test("SCRUM-45: expected_attendance must be a whole number > 0", () => {
  for (const bad of [0, -5, 12.5, "30", null, undefined, NaN]) {
    const input = completeInput();
    input.expected_attendance = bad;
    const result = validateForSubmission(input);
    expect(result.ok, `attendance ${String(bad)} should fail`).toBe(false);
    expect(fieldsOf(result)).toContain("expected_attendance");
  }
});

test("SCRUM-46/47: optional text within cap passes, over cap fails", () => {
  const ok = completeInput();
  ok.venue_requirements = "Projector, two mics, staging for 200.";
  ok.accessibility_needs = "Step-free access to the stage.";
  ok.other_comments = "Catering arrives an hour before doors.";
  expect(validateForSubmission(ok).ok).toBe(true);

  const tooLong = completeInput();
  tooLong.equipment_needs = "a".repeat(2001);
  expect(fieldsOf(validateForSubmission(tooLong))).toContain("equipment_needs");
});

test("SCRUM-44 design: purpose and description are capped at 2000 characters", () => {
  const atCap = completeInput();
  atCap.purpose = "p".repeat(2000);
  atCap.description = "d".repeat(2000);
  expect(validateForSubmission(atCap).ok).toBe(true);

  const overCap = completeInput();
  overCap.purpose = "p".repeat(2001);
  overCap.description = "d".repeat(2001);
  expect(fieldsOf(validateForSubmission(overCap))).toEqual([
    "description",
    "purpose",
  ]);
});

test("SCRUM-23 design: unknown extra fields are ignored", () => {
  const input = completeInput();
  input.colour_scheme = "teal";
  input.organiser_id = "set-by-the-service-not-validated-here";
  expect(validateForSubmission(input).ok).toBe(true);
});

test("SCRUM-45: valid Date objects are accepted for both timestamps", () => {
  const input = completeInput();
  input.start_time = new Date(Date.now() + 60 * 60 * 1000);
  input.end_time = new Date(Date.now() + 2 * 60 * 60 * 1000);
  expect(validateForSubmission(input).ok).toBe(true);
});

// --- boundary-value analysis -------------------------------------------------
// Week 4 rule: "just below, exactly at, and just above" every threshold at which
// the expected behaviour changes. The cases above prove the failing side of most
// rules; these prove the value that must still be ACCEPTED, which is where an
// off-by-one actually hurts an organiser.

test("SCRUM-44 boundary: name at 199 / 200 / 201 characters", () => {
  for (const validate of [validateDraft, validateForSubmission]) {
    const at = (length) => {
      const input = completeInput();
      input.name = "x".repeat(length);
      return validate(input);
    };

    expect(at(199).ok, "199 is below the cap and must pass").toBe(true);
    expect(at(200).ok, "200 is exactly the cap and must pass").toBe(true);

    const over = at(201);
    expect(over.ok, "201 is over the cap and must fail").toBe(false);
    expect(fieldsOf(over)).toContain("name");
  }
});

// checkName measures name.trim().length, so padding does not count towards the
// cap. checkRequiredText / checkOptionalText measure the raw length instead —
// see the trailing-whitespace case below, which documents that asymmetry.
test("SCRUM-44 boundary: a 200-character name still passes with surrounding whitespace", () => {
  const input = completeInput();
  input.name = `  ${"x".repeat(200)}  `;
  expect(validateForSubmission(input).ok).toBe(true);
});

test("SCRUM-45 boundary: expected_attendance of 1 is accepted", () => {
  const input = completeInput();
  input.expected_attendance = 1;
  expect(validateForSubmission(input)).toEqual({ ok: true, errors: [] });
});

test("SCRUM-45 boundary: expected_attendance of 0 is the first rejected value", () => {
  const input = completeInput();
  input.expected_attendance = 0;
  const result = validateForSubmission(input);
  expect(result.ok).toBe(false);
  expect(fieldsOf(result)).toEqual(["expected_attendance"]);
});

test("SCRUM-44 boundary: purpose and description at 1999 / 2000 / 2001 characters", () => {
  for (const field of ["purpose", "description"]) {
    const at = (length) => {
      const input = completeInput();
      input[field] = "x".repeat(length);
      return validateForSubmission(input);
    };

    expect(at(1999).ok, `${field} 1999 must pass`).toBe(true);
    expect(at(2000).ok, `${field} 2000 must pass`).toBe(true);

    const over = at(2001);
    expect(over.ok, `${field} 2001 must fail`).toBe(false);
    expect(fieldsOf(over)).toEqual([field]);
  }
});

test("SCRUM-46/47 boundary: every optional text field at 1999 / 2000 / 2001 characters", () => {
  for (const field of [
    "venue_requirements",
    "accessibility_needs",
    "equipment_needs",
    "other_comments",
  ]) {
    const at = (length) => {
      const input = completeInput();
      input[field] = "x".repeat(length);
      return validateForSubmission(input);
    };

    expect(at(1999).ok, `${field} 1999 must pass`).toBe(true);
    expect(at(2000).ok, `${field} 2000 must pass`).toBe(true);

    const over = at(2001);
    expect(over.ok, `${field} 2001 must fail`).toBe(false);
    expect(fieldsOf(over)).toEqual([field]);
  }
});

// The cap is applied to the raw string, so trailing spaces push a 2000-character
// description over. Asserted so the inconsistency with `name` is a recorded
// decision rather than a surprise; if the team would rather trim first, this is
// the test that changes.
test("SCRUM-44 boundary: description of 2000 characters plus whitespace exceeds the cap", () => {
  const input = completeInput();
  input.description = `${"x".repeat(2000)}  `;
  expect(fieldsOf(validateForSubmission(input))).toEqual(["description"]);
});

test("SCRUM-45 boundary: start_time exactly now is in the past, one minute ahead is not", () => {
  const exactlyNow = completeInput();
  exactlyNow.start_time = new Date(Date.now()).toISOString();
  // Time only moves forward between construction and evaluation, so `now` is
  // always already past by the time the rule runs. Deterministic, not racy.
  expect(fieldsOf(validateForSubmission(exactlyNow))).toContain("start_time");

  const justAhead = completeInput();
  const start = new Date(Date.now() + 60 * 1000);
  justAhead.start_time = start.toISOString();
  justAhead.end_time = new Date(start.getTime() + 60 * 1000).toISOString();
  expect(validateForSubmission(justAhead).ok).toBe(true);
});

test("SCRUM-45 boundary: end_time one millisecond after start_time is accepted", () => {
  const input = completeInput();
  const start = new Date(Date.now() + 60 * 60 * 1000);
  input.start_time = start.toISOString();
  input.end_time = new Date(start.getTime() + 1).toISOString();
  expect(validateForSubmission(input).ok).toBe(true);
});

// US-13 keeps the same optional-text cap as submission: a request captured early
// must not become unsavable later because a free-text field was allowed to grow.
test("US-13 (deferred) boundary: draft optional text at 2000 / 2001 characters", () => {
  for (const field of [
    "venue_requirements",
    "accessibility_needs",
    "equipment_needs",
    "other_comments",
  ]) {
    expect(validateDraft({ name: "Untitled event", [field]: "x".repeat(2000) }).ok, `${field} 2000 must pass`).toBe(true);
    const over = validateDraft({
      name: "Untitled event",
      [field]: "x".repeat(2001),
    });
    expect(over.ok, `${field} 2001 must fail`).toBe(false);
    expect(fieldsOf(over)).toEqual([field]);
  }
});
