const { test } = require("node:test");
const assert = require("node:assert/strict");

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
  assert.deepEqual(validateForSubmission(completeInput()), { ok: true, errors: [] });
});

// --- validateDraft ---------------------------------------------------------

test("draft: a name alone is enough", () => {
  assert.deepEqual(validateDraft({ name: "Untitled event" }), {
    ok: true,
    errors: [],
  });
});

test("draft: name is required", () => {
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
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("name"));
  }
});

test("draft: over-long name is rejected", () => {
  const result = validateDraft({ name: "x".repeat(201) });
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("name"));
});

test("draft: purpose and description are not required", () => {
  assert.equal(validateDraft({ name: "ok" }).ok, true);
});

test("draft: a draft needs neither start_time nor end_time", () => {
  assert.equal(validateDraft({ name: "Untitled event" }).ok, true);
});

test("draft: a non-string optional field is rejected", () => {
  const result = validateDraft({ name: "ok", venue_requirements: { rooms: 2 } });
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("venue_requirements"));
});

test("draft: null / undefined optional fields are ignored", () => {
  const result = validateDraft({
    name: "ok",
    equipment_needs: null,
    other_comments: undefined,
  });
  assert.equal(result.ok, true);
});

// --- validateForSubmission -----------------------------------------------------

test("submission: null / non-object input lists every required field", () => {
  for (const bad of [undefined, null, "nope", 7]) {
    assert.deepEqual(fieldsOf(validateForSubmission(bad)), [
      "description",
      "end_time",
      "expected_attendance",
      "name",
      "purpose",
      "start_time",
    ]);
  }
});

test("submission: each required field missing on its own is reported", () => {
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
    assert.equal(result.ok, false, `${field} missing should fail`);
    assert.ok(fieldsOf(result).includes(field), `${field} should be in errors`);
  }
});

test("submission: whitespace-only text fails the same as empty", () => {
  const input = completeInput();
  input.purpose = "   ";
  input.description = "\n\t";
  assert.deepEqual(fieldsOf(validateForSubmission(input)), [
    "description",
    "purpose",
  ]);
});

test("submission: start_time must be a real, future date", () => {
  const past = completeInput();
  past.start_time = new Date(Date.now() - 1000).toISOString();
  assert.ok(fieldsOf(validateForSubmission(past)).includes("start_time"));

  const nonsense = completeInput();
  nonsense.start_time = "tomorrow";
  assert.ok(fieldsOf(validateForSubmission(nonsense)).includes("start_time"));

  const blank = completeInput();
  blank.start_time = "";
  assert.ok(fieldsOf(validateForSubmission(blank)).includes("start_time"));
});

test("submission: end_time must be a real date strictly after start_time", () => {
  const before = completeInput();
  before.end_time = new Date(
    new Date(before.start_time).getTime() - 60 * 60 * 1000,
  ).toISOString();
  assert.ok(fieldsOf(validateForSubmission(before)).includes("end_time"));

  const identical = completeInput();
  identical.end_time = identical.start_time;
  assert.ok(fieldsOf(validateForSubmission(identical)).includes("end_time"));

  const nonsense = completeInput();
  nonsense.end_time = "later that evening";
  assert.ok(fieldsOf(validateForSubmission(nonsense)).includes("end_time"));

  const blank = completeInput();
  blank.end_time = "";
  assert.ok(fieldsOf(validateForSubmission(blank)).includes("end_time"));
});

// Guards the `startMillis !== null` half of the comparison: one bad timestamp
// should fault one field, not smear an error across both.
test("submission: an unreadable start_time does not also fault end_time", () => {
  const nonsense = completeInput();
  nonsense.start_time = "tomorrow";
  assert.deepEqual(fieldsOf(validateForSubmission(nonsense)), ["start_time"]);

  const missing = completeInput();
  delete missing.start_time;
  assert.deepEqual(fieldsOf(validateForSubmission(missing)), ["start_time"]);
});

test("submission: a past start_time still reports an end_time that precedes it", () => {
  const input = completeInput();
  input.start_time = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  input.end_time = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.deepEqual(fieldsOf(validateForSubmission(input)), [
    "end_time",
    "start_time",
  ]);
});

test("submission: expected_attendance must be a whole number > 0", () => {
  for (const bad of [0, -5, 12.5, "30", null, undefined, NaN]) {
    const input = completeInput();
    input.expected_attendance = bad;
    const result = validateForSubmission(input);
    assert.equal(result.ok, false, `attendance ${String(bad)} should fail`);
    assert.ok(fieldsOf(result).includes("expected_attendance"));
  }
});

test("submission: optional text within cap passes, over cap fails", () => {
  const ok = completeInput();
  ok.venue_requirements = "Projector, two mics, staging for 200.";
  ok.accessibility_needs = "Step-free access to the stage.";
  ok.other_comments = "Catering arrives an hour before doors.";
  assert.equal(validateForSubmission(ok).ok, true);

  const tooLong = completeInput();
  tooLong.equipment_needs = "a".repeat(2001);
  assert.ok(fieldsOf(validateForSubmission(tooLong)).includes("equipment_needs"));
});

test("submission: unknown extra fields are ignored", () => {
  const input = completeInput();
  input.colour_scheme = "teal";
  input.organiser_id = "set-by-the-service-not-validated-here";
  assert.equal(validateForSubmission(input).ok, true);
});

test("submission: valid Date objects are accepted for both timestamps", () => {
  const input = completeInput();
  input.start_time = new Date(Date.now() + 60 * 60 * 1000);
  input.end_time = new Date(Date.now() + 2 * 60 * 60 * 1000);
  assert.equal(validateForSubmission(input).ok, true);
});
