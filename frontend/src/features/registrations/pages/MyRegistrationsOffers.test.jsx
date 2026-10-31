// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AuthContext } from "../../auth/useAuth";
import MyRegistrationsPage from "./MyRegistrationsPage";
import { useRegistrations } from "../hooks/useRegistrations";
import {
  acceptWaitlistOffer,
  declineWaitlistOffer,
} from "../waitlistService";

vi.mock("../hooks/useRegistrations", () => ({
  useRegistrations: vi.fn(),
}));

vi.mock("../waitlistService", () => ({
  acceptWaitlistOffer: vi.fn(),
  declineWaitlistOffer: vi.fn(),
  updateWaitlistDetails: vi.fn(),
}));

const OFFER = {
  id: "offer-1",
  event_id: "event-1",
  registration_data: {},
  effective_deadline: new Date(Date.now() + 86400000).toISOString(),
  server_time: new Date().toISOString(),
  event: { name: "Community Dinner", registration_fields: [] },
};

function renderPage(reload) {
  useRegistrations.mockReturnValue({
    registrations: [],
    offers: [OFFER],
    waitlist: [],
    error: "",
    loading: false,
    reload,
  });
  return render(
    <AuthContext.Provider value={{ token: "attendee-token" }}>
      <MemoryRouter><MyRegistrationsPage /></MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("My Registrations displays an offer and refreshes after acceptance", async () => {
  const reload = vi.fn();
  acceptWaitlistOffer.mockResolvedValue({});
  renderPage(reload);

  expect(screen.getByText("Community Dinner")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

test("My Registrations refreshes after an offer is declined", async () => {
  const reload = vi.fn();
  declineWaitlistOffer.mockResolvedValue(null);
  renderPage(reload);

  fireEvent.click(screen.getByRole("button", { name: "Decline offer" }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});


test("Status filters narrow registrations while time-sensitive waitlist offers remain available", () => {
  const reload = vi.fn();
  useRegistrations.mockReturnValue({ registrations: [
    { id: "pending-reg", status: "pending", events: { name: "Pending workshop" } },
    { id: "confirmed-reg", status: "confirmed", events: { name: "Confirmed workshop" } },
  ], offers: [OFFER], waitlist: [], error: "", loading: false, reload });
  render(<AuthContext.Provider value={{ token: "attendee-token" }}><MemoryRouter><MyRegistrationsPage /></MemoryRouter></AuthContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Confirmed", exact: true }));
  expect(screen.queryByRole("link", { name: /Pending workshop/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Confirmed workshop/ })).toBeVisible();
  expect(screen.getByRole("button", { name: "Accept offer" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Withdrawn", exact: true }));
  expect(screen.getByRole("status")).toHaveTextContent("No withdrawn registrations");
  expect(screen.getByRole("button", { name: "Accept offer" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All registrations" }));
  expect(screen.getByRole("link", { name: /Pending workshop/ })).toBeVisible();
});
