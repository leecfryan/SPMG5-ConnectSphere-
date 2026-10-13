import { afterEach, expect, test, vi } from "vitest";
import { getWaitlistPosition } from "./waitlistService";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("waitlist state lookup treats an attendee without an entry as an empty state", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({
      entry: null,
      position: null,
      effective_deadline: null,
      server_time: null,
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(getWaitlistPosition("event-1", "attendee-token")).resolves.toEqual({
    entry: null,
    position: null,
    effective_deadline: null,
    server_time: null,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/waitlist/event-1/state",
    expect.objectContaining({ method: "GET", cache: "no-store" }),
  );
});
