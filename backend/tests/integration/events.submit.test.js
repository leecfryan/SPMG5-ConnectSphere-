// POST /api/events over real HTTP: router → controller → service → validation.
// Only the repository is faked, so this proves the status codes and response
// bodies the frontend depends on without touching Supabase.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS. Loading them with createRequire keeps
// them in Node's own module graph, so the object a test holds is the same one
// the source closes over; a plain ESM import would hand back a second copy and
// a spy set on it would never be seen by the code under test.
const require = createRequire(import.meta.url);
const express = require("express");
const { stubSupabase } = require("../helpers/stubSupabase");

stubSupabase();
const repository = require("../../src/modules/events/events.repository");
const eventsRoutes = require("../../src/routes/events.routes");
const { DEV_ORGANISER_ID } = require("../../src/modules/events/events.controller");

// Mirrors the middleware server.js applies; built here so no port is fixed and
// no .env is needed.
const app = express();
app.use(express.json());
app.use("/api/events", eventsRoutes);

let server;
let baseUrl;
beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

let createSubmitted;
beforeEach(() => {
  vi.restoreAllMocks();
  createSubmitted = vi
    .spyOn(repository, "createSubmitted")
    .mockImplementation(async (fields, organiserId) => ({
      id: "evt-1",
      status: "SUBMITTED",
      organiser_id: organiserId,
      ...fields,
    }));
});

function completeBody() {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return {
    name: "Annual Alumni Gala",
    purpose: "Reconnect alumni",
    description: "Dinner, awards and networking.",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    expected_attendance: "200",
  };
}

async function post(body) {
  const response = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const fieldsOf = (body) => body.errors.map((e) => e.field).sort();

test("SCRUM-51: 201 - a complete request comes back SUBMITTED", async () => {
  const { status, body } = await post(completeBody());

  expect(status).toBe(201);
  expect(body.event.status).toBe("SUBMITTED");
  expect(body.event.organiser_id).toBe(DEV_ORGANISER_ID);
});

// The HTTP half of SCRUM-46 / SCRUM-47: an organiser who fills the optional
// requirements gets them back on the created event, not silently dropped.
test("SCRUM-46/47: 201 - requirements fields are stored and returned", async () => {
  // Arrange
  const input = completeBody();
  input.venue_requirements = "Main hall, theatre layout for 200.";
  input.accessibility_needs = "Step-free access to the stage.";
  input.equipment_needs = "Projector and two radio mics.";
  input.other_comments = "Catering arrives an hour before doors.";

  // Act
  const { status, body } = await post(input);

  // Assert
  expect(status).toBe(201);
  expect(body.event.venue_requirements).toBe("Main hall, theatre layout for 200.");
  expect(body.event.accessibility_needs).toBe("Step-free access to the stage.");
  expect(body.event.equipment_needs).toBe("Projector and two radio mics.");
  expect(body.event.other_comments).toBe("Catering arrives an hour before doors.");
});

test("SCRUM-23: 400 - an empty body names every required field", async () => {
  const { status, body } = await post({});

  expect(status).toBe(400);
  expect(fieldsOf(body)).toEqual([
    "description",
    "end_time",
    "expected_attendance",
    "name",
    "purpose",
    "start_time",
  ]);
  expect(createSubmitted.mock.calls.length).toBe(0);
});

test("SCRUM-45: 400 - end before start is reported against end_time", async () => {
  const input = completeBody();
  input.end_time = new Date(
    new Date(input.start_time).getTime() - 60 * 60 * 1000,
  ).toISOString();
  const { status, body } = await post(input);

  expect(status).toBe(400);
  expect(body.errors).toEqual([
    { field: "end_time", message: "must be after start_time" },
  ]);
});

test("SCRUM-44: 400 - an over-long description is rejected", async () => {
  const input = completeBody();
  input.description = "x".repeat(2001);
  const { status, body } = await post(input);

  expect(status).toBe(400);
  expect(fieldsOf(body)).toEqual(["description"]);
});

test("SCRUM-25 design: 500 - a database failure returns a generic message, not the Supabase error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  createSubmitted.mockImplementation(async () => {
    throw new Error("events.repository: createSubmitted failed - secret detail");
  });
  const { status, body } = await post(completeBody());

  expect(status).toBe(500);
  expect(body.error).toBe("Could not submit the event request. Please try again.");
  expect(JSON.stringify(body)).not.toMatch(/secret detail/);
});

// --- boundary-value analysis -------------------------------------------------
// The unit tests prove the rules; these prove the HTTP contract does not move
// the boundary. A value the validator accepts must come back 201, not 400 — the
// case a frontend actually hits when an organiser fills a field to its limit.

test("SCRUM-45 boundary: 201 - attendance of 1 is accepted over HTTP", async () => {
  const input = completeBody();
  input.expected_attendance = "1";
  const { status, body } = await post(input);

  expect(status).toBe(201);
  expect(body.event.expected_attendance).toBe(1);
});

test("SCRUM-45 boundary: 400 - attendance of 0 is rejected over HTTP", async () => {
  const input = completeBody();
  input.expected_attendance = "0";
  const { status, body } = await post(input);

  expect(status).toBe(400);
  expect(fieldsOf(body)).toEqual(["expected_attendance"]);
  expect(createSubmitted.mock.calls.length).toBe(0);
});

test("SCRUM-44 boundary: 201 - a description of exactly 2000 characters is accepted", async () => {
  const input = completeBody();
  input.description = "x".repeat(2000);
  const { status, body } = await post(input);

  expect(status).toBe(201);
  expect(body.event.description.length).toBe(2000);
});

test("SCRUM-44 boundary: 201 - a name of exactly 200 characters is accepted", async () => {
  const input = completeBody();
  input.name = "x".repeat(200);
  const { status } = await post(input);

  expect(status).toBe(201);
});

test("SCRUM-44 boundary: 400 - a name of 201 characters is rejected", async () => {
  const input = completeBody();
  input.name = "x".repeat(201);
  const { status, body } = await post(input);

  expect(status).toBe(400);
  expect(fieldsOf(body)).toEqual(["name"]);
  expect(createSubmitted.mock.calls.length).toBe(0);
});

test("SCRUM-45 boundary: 400 - a start_time in the past is rejected", async () => {
  const input = completeBody();
  const start = new Date(Date.now() - 60 * 60 * 1000);
  input.start_time = start.toISOString();
  input.end_time = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
  const { status, body } = await post(input);

  expect(status).toBe(400);
  expect(fieldsOf(body)).toEqual(["start_time"]);
  expect(createSubmitted.mock.calls.length).toBe(0);
});

test("SCRUM-45 boundary: 400 - identical start and end times are rejected", async () => {
  const input = completeBody();
  input.end_time = input.start_time;
  const { status, body } = await post(input);

  expect(status).toBe(400);
  expect(body.errors).toEqual([
    { field: "end_time", message: "must be after start_time" },
  ]);
});
