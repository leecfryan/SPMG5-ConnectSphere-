const { test, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { stubSupabase } = require("../../helpers/stubSupabase");

stubSupabase();
const repository = require("../../../src/modules/events/events.repository");
const service = require("../../../src/modules/events/events.service");

const ORGANISER = "org-1";
const fieldsOf = (result) => result.errors.map((e) => e.field).sort();

// What the form sends: every value a string, as a browser gives it.
function formInput() {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return {
    name: "  Annual Alumni Gala  ",
    purpose: "Reconnect alumni",
    description: "Dinner, awards and networking.",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    expected_attendance: "200",
    venue_requirements: "",
  };
}

let createSubmitted;
beforeEach(() => {
  mock.restoreAll();
  createSubmitted = mock.method(repository, "createSubmitted", async (fields) => ({
    id: "evt-1",
    status: "SUBMITTED",
    ...fields,
  }));
});

test("SCRUM-49: a complete request is submitted with cleaned-up fields", async () => {
  const result = await service.submitRequest(formInput(), ORGANISER);

  assert.equal(result.ok, true);
  assert.equal(result.event.status, "SUBMITTED");
  assert.equal(createSubmitted.mock.callCount(), 1);

  const [fields, organiserId] = createSubmitted.mock.calls[0].arguments;
  assert.equal(organiserId, ORGANISER);
  assert.equal(fields.name, "Annual Alumni Gala"); // trimmed
  assert.equal(fields.expected_attendance, 200); // string → integer
  assert.equal(fields.venue_requirements, null); // blank optional → null
});

// SCRUM-46 / SCRUM-47 are "can provide" criteria: accepting the field is only
// half of it, the value has to survive to the row. Without this, dropping a
// column from WRITABLE_COLS would silently stop persisting it and every other
// test would still pass.
test("SCRUM-46/47: populated requirements fields reach the repository intact", async () => {
  // Arrange
  const input = formInput();
  input.venue_requirements = "  Main hall, theatre layout for 200.  ";
  input.accessibility_needs = "Step-free access to the stage.";
  input.equipment_needs = "Projector and two radio mics.";
  input.other_comments = "Catering arrives an hour before doors.";

  // Act
  const result = await service.submitRequest(input, ORGANISER);

  // Assert
  assert.equal(result.ok, true);
  const [fields] = createSubmitted.mock.calls[0].arguments;
  assert.equal(fields.venue_requirements, "Main hall, theatre layout for 200."); // trimmed
  assert.equal(fields.accessibility_needs, "Step-free access to the stage.");
  assert.equal(fields.equipment_needs, "Projector and two radio mics.");
  assert.equal(fields.other_comments, "Catering arrives an hour before doors.");
});

// The column is timestamptz. `toTimestamp` normalises whatever the form sends
// into ISO before it reaches the row; a non-ISO input proves it converts rather
// than passing the string through.
test("SCRUM-45: both timestamps reach the repository as ISO strings", async () => {
  // Arrange
  const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const input = formInput();
  input.start_time = start.toUTCString(); // "Tue, 01 Dec 2026 09:00:00 GMT"
  input.end_time = end.toUTCString();

  // Act
  const result = await service.submitRequest(input, ORGANISER);

  // Assert
  assert.equal(result.ok, true);
  const [fields] = createSubmitted.mock.calls[0].arguments;
  assert.equal(fields.start_time, new Date(start.toUTCString()).toISOString());
  assert.equal(fields.end_time, new Date(end.toUTCString()).toISOString());
  assert.match(fields.start_time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("SCRUM-23: an incomplete request lists every missing field and saves nothing", async () => {
  const result = await service.submitRequest({ name: "Gala" }, ORGANISER);

  assert.equal(result.ok, false);
  assert.deepEqual(fieldsOf(result), [
    "description",
    "end_time",
    "expected_attendance",
    "purpose",
    "start_time",
  ]);
  assert.equal(createSubmitted.mock.callCount(), 0);
});

test("SCRUM-23 design: an empty or non-object body is rejected, not thrown", async () => {
  for (const bad of [undefined, null, "nope"]) {
    const result = await service.submitRequest(bad, ORGANISER);
    assert.equal(result.ok, false);
    assert.ok(fieldsOf(result).includes("name"));
  }
  assert.equal(createSubmitted.mock.callCount(), 0);
});

test("SCRUM-45 design: an unreadable date is reported once, with the parse message", async () => {
  const input = formInput();
  input.start_time = "next tuesday";
  const result = await service.submitRequest(input, ORGANISER);

  assert.deepEqual(result.errors, [
    { field: "start_time", message: "must be a valid date/time" },
  ]);
});

test("SCRUM-45 design: non-numeric attendance is reported once", async () => {
  const input = formInput();
  input.expected_attendance = "lots";
  const result = await service.submitRequest(input, ORGANISER);

  assert.deepEqual(fieldsOf(result), ["expected_attendance"]);
});

test("SCRUM-45: start in the past and end before start are both reported", async () => {
  const input = formInput();
  input.start_time = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  input.end_time = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = await service.submitRequest(input, ORGANISER);

  assert.deepEqual(fieldsOf(result), ["end_time", "start_time"]);
  assert.equal(createSubmitted.mock.callCount(), 0);
});

test("SCRUM-25 design: status, owner and coordinator in the body never reach the repository", async () => {
  const input = {
    ...formInput(),
    status: "APPROVED",
    organiser_id: "someone-else",
    coordinator_id: "self-assigned",
    submitted_at: "1999-01-01T00:00:00.000Z",
  };
  await service.submitRequest(input, ORGANISER);

  const [fields, organiserId] = createSubmitted.mock.calls[0].arguments;
  assert.equal(organiserId, ORGANISER);
  for (const key of ["status", "organiser_id", "coordinator_id", "submitted_at"]) {
    assert.equal(key in fields, false, `${key} should be dropped`);
  }
});

test("SCRUM-25 design: a repository failure propagates for the controller to handle", async () => {
  createSubmitted.mock.mockImplementation(async () => {
    throw new Error("events.repository: createSubmitted failed - boom");
  });
  await assert.rejects(service.submitRequest(formInput(), ORGANISER), /boom/);
});

// --- boundary-value analysis -------------------------------------------------
// The service normalises BEFORE validating, so its boundaries are not the
// validator's. A browser sends every field as a string; these prove the edge
// values survive trimming and coercion and arrive at the repository correctly.

test("SCRUM-45 boundary: attendance of \"1\" is the smallest accepted value", async () => {
  const input = formInput();
  input.expected_attendance = "1";
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, true);
  const [fields] = createSubmitted.mock.calls[0].arguments;
  assert.equal(fields.expected_attendance, 1);
  assert.equal(typeof fields.expected_attendance, "number");
});

test("SCRUM-45 boundary: attendance of \"0\" is rejected and nothing is saved", async () => {
  const input = formInput();
  input.expected_attendance = "0";
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, false);
  assert.deepEqual(fieldsOf(result), ["expected_attendance"]);
  assert.equal(createSubmitted.mock.callCount(), 0);
});

test("SCRUM-45 boundary: a padded attendance string is still read as its number", async () => {
  const input = formInput();
  input.expected_attendance = "  1  ";
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, true);
  assert.equal(createSubmitted.mock.calls[0].arguments[0].expected_attendance, 1);
});

test("SCRUM-44 boundary: a name of exactly 200 characters reaches the repository", async () => {
  const input = formInput();
  input.name = `  ${"x".repeat(200)}  `;
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, true);
  assert.equal(createSubmitted.mock.calls[0].arguments[0].name, "x".repeat(200));
});

test("SCRUM-44 boundary: a name of 201 characters is rejected and nothing is saved", async () => {
  const input = formInput();
  input.name = "x".repeat(201);
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, false);
  assert.deepEqual(fieldsOf(result), ["name"]);
  assert.equal(createSubmitted.mock.callCount(), 0);
});

// Trimming happens first, so padding that would push a 2000-character field over
// the cap is removed before the rule is applied. The same raw string fails
// validateForSubmission on its own — the layers disagree by design, and this is
// the test that records which one the organiser actually meets.
test("SCRUM-44 boundary: a 2000-character description padded with spaces is trimmed, then passes", async () => {
  const input = formInput();
  input.description = `  ${"x".repeat(2000)}  `;
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, true);
  assert.equal(createSubmitted.mock.calls[0].arguments[0].description.length, 2000);
});

test("SCRUM-44 boundary: a description of 2001 characters is rejected after trimming", async () => {
  const input = formInput();
  input.description = `  ${"x".repeat(2001)}  `;
  const result = await service.submitRequest(input, ORGANISER);

  assert.equal(result.ok, false);
  assert.deepEqual(fieldsOf(result), ["description"]);
  assert.equal(createSubmitted.mock.callCount(), 0);
});
