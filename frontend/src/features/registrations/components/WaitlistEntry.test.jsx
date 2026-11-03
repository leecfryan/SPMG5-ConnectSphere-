// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import WaitlistEntry from "./WaitlistEntry";
import { withdrawFromWaitlist } from "../waitlistService";

vi.mock("../waitlistService", () => ({
  withdrawFromWaitlist: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("My Registrations withdraw removes the caller's waitlist entry and reloads the list", async () => {
  const onWithdrawn = vi.fn();
  withdrawFromWaitlist.mockResolvedValue(null);
  render(
    <AuthContext.Provider value={{ token: "attendee-token" }}>
      <WaitlistEntry
        entry={{ id: "entry-1", event_id: "event-1", event: { name: "Workshop" } }}
        onWithdrawn={onWithdrawn}
      />
    </AuthContext.Provider>,
  );

  expect(screen.getByText("Workshop")).toBeInTheDocument();
  expect(screen.getByText("Waitlist")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

  await waitFor(() => expect(withdrawFromWaitlist).toHaveBeenCalledWith(
    "event-1",
    "attendee-token",
  ));
  expect(onWithdrawn).toHaveBeenCalledOnce();
});

test("withdraw disables the control while the request is in flight", async () => {
  let finishRequest;
  withdrawFromWaitlist.mockReturnValue(new Promise((resolve) => {
    finishRequest = resolve;
  }));
  render(
    <AuthContext.Provider value={{ token: "attendee-token" }}>
      <WaitlistEntry entry={{ id: "entry-1", event_id: "event-1", event: { name: "Workshop" } }} />
    </AuthContext.Provider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
  expect(screen.getByRole("button", { name: "Withdrawing…" })).toBeDisabled();
  finishRequest();
  await waitFor(() => expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled());
});
