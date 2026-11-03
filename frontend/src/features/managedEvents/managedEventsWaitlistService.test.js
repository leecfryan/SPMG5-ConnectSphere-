import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch }));

import {
  fetchCoordinatorWaitlist,
  fetchWaitlistAutoOfferSetting,
  promoteWaitlistEntry,
  updateWaitlistAutoOfferSetting,
} from "./managedEventsWaitlistService";

describe("managed-event waitlist service", () => {
  beforeEach(() => apiFetch.mockReset());

  test("loads the paginated coordinator view", async () => {
    apiFetch.mockResolvedValue({ waitlist: { entries: [], total: 0 } });

    await expect(fetchCoordinatorWaitlist("event-1", "token", { limit: 25, offset: 50 }))
      .resolves.toEqual({ entries: [], total: 0 });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/managed-events/event-1/waitlist?limit=25&offset=50",
      "token",
    );
  });

  test("loads and changes the automatic-offer setting", async () => {
    apiFetch
      .mockResolvedValueOnce({ setting: { enabled: true } })
      .mockResolvedValueOnce({ setting: { enabled: false } });

    await expect(fetchWaitlistAutoOfferSetting("event-1", "token"))
      .resolves.toEqual({ enabled: true });
    await expect(updateWaitlistAutoOfferSetting("event-1", false, "token"))
      .resolves.toEqual({ enabled: false });
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/managed-events/event-1/waitlist/settings",
      "token",
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/managed-events/event-1/waitlist/settings",
      "token",
      { method: "PATCH", body: { enabled: false } },
    );
  });

  test("promotes an attendee without sending a caller-selected actor id", async () => {
    apiFetch.mockResolvedValue({ result: { outcome: "registered_over_capacity" } });

    await expect(promoteWaitlistEntry("event-1", "entry-1", "token", "Accessibility"))
      .resolves.toEqual({ outcome: "registered_over_capacity" });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/managed-events/event-1/waitlist/entry-1/promote",
      "token",
      { method: "POST", body: { reason: "Accessibility" } },
    );
  });
});
