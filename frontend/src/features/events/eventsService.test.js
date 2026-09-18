// The submit path as the browser runs it: field values in, a JSON POST out, and
// one of three shapes back. `fetch` is the only thing faked, so these prove the
// contract eventsService holds with the API without a server or a DOM.
//
// Test names lead with the story key, matching the backend suite, so the
// reporter's output doubles as the traceability report.

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { EVENT_LIMITS, submitEventRequest } from "./eventsService";

// A response only has to answer .status and .json() for the service.
const jsonResponse = (status, payload) => ({ status, json: async () => payload });
const brokenResponse = (status) => ({
  status,
  json: async () => {
    throw new SyntaxError("Unexpected token < in JSON");
  },
});

// A valid submission, as the form holds it: every value a string, and the two
// timestamps in the format <input type="datetime-local"> produces — no zone.
function formFields() {
  return {
    name: "Annual Alumni Gala",
    purpose: "Reconnect alumni",
    description: "Dinner, awards and networking.",
    start_time: "2026-09-20T10:00",
    end_time: "2026-09-20T13:00",
    expected_attendance: "200",
  };
}

// The body the service actually sent, parsed back out of the fetch call.
const sentBody = () => JSON.parse(fetch.mock.calls[0][1].body);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- fixture guard -----------------------------------------------------------

// Every timestamp assertion below is written against UTC+8. If the pinned zone
// in vite.config.js ever stops taking effect, this fails first and names the
// reason, instead of the conversion tests failing for a reason that looks like
// a bug in the service.
test("fixture guard: the suite runs in the pinned UTC+8 time zone", () => {
  expect(new Date("2026-09-20T10:00").toISOString()).toBe("2026-09-20T02:00:00.000Z");
});

// --- happy path --------------------------------------------------------------

test("SCRUM-51: a 201 returns the created event with no errors", async () => {
  const event = { id: "evt-1", name: "Annual Alumni Gala", status: "SUBMITTED" };
  fetch.mockResolvedValue(jsonResponse(201, { event }));

  const result = await submitEventRequest(formFields());

  expect(result).toEqual({ event, errors: [], message: "" });
});

test("SCRUM-25: the request is a JSON POST to /api/events", async () => {
  fetch.mockResolvedValue(jsonResponse(201, { event: { id: "evt-1" } }));

  await submitEventRequest(formFields());

  expect(fetch.mock.calls.length).toBe(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/events");
  expect(options.method).toBe("POST");
  expect(options.headers).toEqual({ "Content-Type": "application/json" });
  expect(sentBody().name).toBe("Annual Alumni Gala");
});

// --- negative ----------------------------------------------------------------

test("SCRUM-23: a 400 passes the validator's field errors straight through", async () => {
  const errors = [
    { field: "name", message: "is required" },
    { field: "end_time", message: "must be after start_time" },
  ];
  fetch.mockResolvedValue(jsonResponse(400, { errors }));

  const result = await submitEventRequest(formFields());

  expect(result).toEqual({ event: null, errors, message: "" });
});

test("SCRUM-25 design: a 500 surfaces the server's message against no field", async () => {
  fetch.mockResolvedValue(
    jsonResponse(500, { error: "Could not submit the event request. Please try again." }),
  );

  const result = await submitEventRequest(formFields());

  expect(result.event).toBe(null);
  expect(result.errors).toEqual([]);
  expect(result.message).toBe("Could not submit the event request. Please try again.");
});

// A proxy error or an HTML error page returns a body json() cannot parse. The
// organiser must still get a message rather than an unhandled rejection.
test("SCRUM-25 design: a response that is not JSON falls back to a generic message", async () => {
  fetch.mockResolvedValue(brokenResponse(502));

  const result = await submitEventRequest(formFields());

  expect(result.event).toBe(null);
  expect(result.message).toBe("Could not submit the event request. Please try again.");
});

test("SCRUM-25 design: a network failure is reported as a connection problem", async () => {
  fetch.mockRejectedValue(new TypeError("Failed to fetch"));

  const result = await submitEventRequest(formFields());

  expect(result).toEqual({
    event: null,
    errors: [],
    message: "Unable to connect. Check your connection and try again.",
  });
});

// Both guard the same thing: the status alone is not trusted. A 201 with no row
// would otherwise hand the page an undefined event to render.
test("SCRUM-25 design: a 201 without an event in the body is treated as a failure", async () => {
  fetch.mockResolvedValue(jsonResponse(201, {}));

  const result = await submitEventRequest(formFields());

  expect(result.event).toBe(null);
  expect(result.message).toBe("Could not submit the event request. Please try again.");
});

test("SCRUM-23 design: a 400 without an errors array falls through to the message", async () => {
  fetch.mockResolvedValue(jsonResponse(400, { error: "Malformed request" }));

  const result = await submitEventRequest(formFields());

  expect(result.errors).toEqual([]);
  expect(result.message).toBe("Malformed request");
});

// --- boundary: withZonedTimes ------------------------------------------------
// datetime-local has no zone. Sent as typed, the server would read "10:00" in
// its own zone (UTC in Docker) and store the event eight hours out. Nothing
// errors when this breaks — the request still succeeds, at the wrong time —
// so these are the assertions that catch it.

test("SCRUM-45: datetime-local values are converted to ISO in the browser's zone", async () => {
  fetch.mockResolvedValue(jsonResponse(201, { event: { id: "evt-1" } }));

  await submitEventRequest(formFields());

  expect(sentBody().start_time).toBe("2026-09-20T02:00:00.000Z");
  expect(sentBody().end_time).toBe("2026-09-20T05:00:00.000Z");
});

test("SCRUM-45 design: an unreadable date/time is sent untouched so the server names the field", async () => {
  fetch.mockResolvedValue(jsonResponse(400, { errors: [] }));
  const fields = { ...formFields(), start_time: "next tuesday" };

  await submitEventRequest(fields);

  expect(sentBody().start_time).toBe("next tuesday");
  // The readable field beside it is still converted.
  expect(sentBody().end_time).toBe("2026-09-20T05:00:00.000Z");
});

test("SCRUM-45 boundary: an empty time field is sent empty, not as an epoch date", async () => {
  fetch.mockResolvedValue(jsonResponse(400, { errors: [] }));
  const fields = { ...formFields(), start_time: "", end_time: "" };

  await submitEventRequest(fields);

  expect(sentBody().start_time).toBe("");
  expect(sentBody().end_time).toBe("");
});

test("SCRUM-45 boundary: a value already in ISO survives the round trip unchanged", async () => {
  fetch.mockResolvedValue(jsonResponse(201, { event: { id: "evt-1" } }));
  const fields = { ...formFields(), start_time: "2026-09-20T02:00:00.000Z" };

  await submitEventRequest(fields);

  expect(sentBody().start_time).toBe("2026-09-20T02:00:00.000Z");
});

test("SCRUM-45 design: only the two time fields are rewritten", async () => {
  fetch.mockResolvedValue(jsonResponse(201, { event: { id: "evt-1" } }));
  const fields = formFields();

  await submitEventRequest(fields);

  const body = sentBody();
  expect(body.name).toBe(fields.name);
  expect(body.purpose).toBe(fields.purpose);
  expect(body.description).toBe(fields.description);
  expect(body.expected_attendance).toBe("200");
});

// The organiser's object must not be mutated: the form keeps rendering from the
// same state after a failed submit, and a rewritten start_time would show up in
// the input as an ISO string the datetime-local control cannot display.
test("SCRUM-45 design: the caller's fields object is not mutated", async () => {
  fetch.mockResolvedValue(jsonResponse(201, { event: { id: "evt-1" } }));
  const fields = formFields();

  await submitEventRequest(fields);

  expect(fields.start_time).toBe("2026-09-20T10:00");
});

// --- limits ------------------------------------------------------------------

test("SCRUM-44: EVENT_LIMITS mirrors the backend caps and is frozen", () => {
  expect(EVENT_LIMITS).toEqual({ name: 200, text: 2000 });
  expect(() => {
    EVENT_LIMITS.name = 10;
  }).toThrow();
});
