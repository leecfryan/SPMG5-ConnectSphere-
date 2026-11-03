import { afterEach, expect, test, vi } from "vitest";
import { submitEventRequest } from "./eventsService";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("registration datetime-local fields are converted to UTC in the event request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    status: 201,
    json: async () => ({ event: { id: "event-1" } }),
  }));
  const fields = {
    registration_start: "2026-09-20T10:00",
    registration_end: "2026-09-20T11:00",
  };

  await submitEventRequest(fields, "token");

  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.registration_start).toBe("2026-09-20T02:00:00.000Z");
  expect(body.registration_end).toBe("2026-09-20T03:00:00.000Z");
  expect(fields.registration_start).toBe("2026-09-20T10:00");
});
