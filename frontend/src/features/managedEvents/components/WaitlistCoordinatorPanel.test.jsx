// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const managedWaitlistApi = vi.hoisted(() => ({
  fetchCoordinatorWaitlist: vi.fn(),
  fetchWaitlistAutoOfferSetting: vi.fn(),
  promoteWaitlistEntry: vi.fn(),
  updateWaitlistAutoOfferSetting: vi.fn(),
}));

vi.mock("../managedEventsWaitlistService", () => managedWaitlistApi);

import WaitlistCoordinatorPanel from "./WaitlistCoordinatorPanel";

const QUEUE = {
  entries: [
    {
      id: "entry-1",
      attendeeId: "attendee-1",
      displayName: "Queue Member",
      position: 1,
      joinedAt: "2026-09-01T00:00:00Z",
      state: "queued",
      effectiveDeadline: null,
      override: null,
      eligible: true,
    },
    {
      id: "entry-2",
      attendeeId: "attendee-2",
      displayName: "Registered Member",
      position: 2,
      joinedAt: "2026-09-02T00:00:00Z",
      state: "offered",
      effectiveDeadline: "2026-10-13T00:00:00Z",
      override: null,
      eligible: false,
    },
  ],
  total: 2,
  queued: 1,
  offered: 1,
  autoOfferEnabled: true,
  serverTime: "2026-10-12T03:00:00Z",
  limit: 50,
  offset: 0,
};

beforeEach(() => {
  managedWaitlistApi.fetchCoordinatorWaitlist.mockResolvedValue(QUEUE);
  managedWaitlistApi.fetchWaitlistAutoOfferSetting.mockResolvedValue({ enabled: true });
  managedWaitlistApi.promoteWaitlistEntry.mockReset();
  managedWaitlistApi.updateWaitlistAutoOfferSetting.mockResolvedValue({ enabled: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("shows queue order, offer deadline and display name without attendee contact or form data", async () => {
  render(<WaitlistCoordinatorPanel eventId="event-1" token="token" />);

  expect(await screen.findByText("Queue Member")).toBeTruthy();
  expect(screen.getByText("Registered Member")).toBeTruthy();
  const queueRows = screen.getAllByRole("listitem");
  expect(queueRows[0].textContent).toContain("Queue Member");
  expect(queueRows[1].textContent).toContain("Registered Member");
  expect(screen.getByText(/Offered until/)).toBeTruthy();
  expect(screen.queryByText(/@/)).toBeNull();
  expect(screen.queryByText(/phone|registration answer/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Promote Queue Member" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Promote Registered Member" })).toBeNull();
});

test("confirms and updates the automatic-offer setting", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  const user = userEvent.setup();
  render(<WaitlistCoordinatorPanel eventId="event-1" token="token" />);

  const toggle = await screen.findByRole("checkbox", { name: "Automatically offer available places" });
  await user.click(toggle);

  expect(globalThis.confirm).toHaveBeenCalled();
  expect(managedWaitlistApi.updateWaitlistAutoOfferSetting).toHaveBeenCalledWith(
    "event-1",
    false,
    "token",
  );
});

test("expected capacity conflict is shown to the coordinator without console error logging", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  managedWaitlistApi.promoteWaitlistEntry.mockRejectedValueOnce(
    Object.assign(new Error("The selected attendee was registered over capacity."), {
      status: 409,
      code: "registered_over_capacity",
    }),
  );
  const user = userEvent.setup();
  render(<WaitlistCoordinatorPanel eventId="event-1" token="token" />);

  await user.click(await screen.findByRole("button", { name: "Promote Queue Member" }));

  expect((await screen.findByRole("alert")).textContent)
    .toContain("The selected attendee was registered over capacity.");
  expect(consoleError).not.toHaveBeenCalled();
});
