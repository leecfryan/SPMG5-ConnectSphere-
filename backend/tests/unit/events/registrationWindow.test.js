import { beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");

stubSupabase();
const repository = require("../../../src/modules/events/events.repository");
const service = require("../../../src/modules/events/events.service");
const { validateRegistrationWindow } =
  require("../../../src/modules/events/registrationWindow");

const EVENT_FIELDS = {
  name: "Window event",
  purpose: "Test window support",
  description: "Window field normalization",
  start_time: "2030-01-01T10:00:00.000Z",
  end_time: "2030-01-01T12:00:00.000Z",
  expected_attendance: "10",
};

test("registration-window columns are included in the event write allowlist", () => {
  expect(repository.WRITABLE_COLS).toContain("registration_start");
  expect(repository.WRITABLE_COLS).toContain("registration_end");
});

let createSubmitted;

beforeEach(() => {
  vi.restoreAllMocks();
  createSubmitted = vi.spyOn(repository, "createSubmitted").mockImplementation(
    async (fields) => ({ id: "event-window", ...fields }),
  );
});

test("optional registration window fields are normalized and reach the event repository", async () => {
  const result = await service.submitRequest({
    ...EVENT_FIELDS,
    registration_start: "2030-01-01T08:00:00Z",
    registration_end: "2030-01-02T14:00:00Z",
  }, "organiser");

  expect(result.ok).toBe(true);
  const [fields] = createSubmitted.mock.calls[0];
  expect(fields.registration_start).toBe("2030-01-01T08:00:00.000Z");
  expect(fields.registration_end).toBe("2030-01-02T14:00:00.000Z");
});

test("the shared validator permits a missing boundary and rejects an end not after start", () => {
  expect(validateRegistrationWindow({
    registration_start: "2030-01-01T10:00:00.000Z",
    registration_end: null,
  })).toEqual({ ok: true, errors: [] });

  expect(validateRegistrationWindow({
    registration_start: "2030-01-01T10:00:00.000Z",
    registration_end: "2030-01-01T10:00:00.000Z",
  })).toEqual({
    ok: false,
    errors: [{
      field: "registration_end",
      message: "must be after registration_start",
    }],
  });
});

test("an inverted registration window is rejected before event creation", async () => {
  const result = await service.submitRequest({
    ...EVENT_FIELDS,
    registration_start: "2030-01-02T10:00:00Z",
    registration_end: "2030-01-01T10:00:00Z",
  }, "organiser");

  expect(result.ok).toBe(false);
  expect(result.errors).toContainEqual({
    field: "registration_end",
    message: "must be after registration_start",
  });
  expect(createSubmitted).not.toHaveBeenCalled();
});

test("an unreadable registration timestamp produces one field error", async () => {
  const result = await service.submitRequest({
    ...EVENT_FIELDS,
    registration_start: "not a date",
  }, "organiser");

  expect(result.errors.filter((error) => error.field === "registration_start")).toEqual([
    { field: "registration_start", message: "must be a valid date/time" },
  ]);
});
