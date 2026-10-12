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
