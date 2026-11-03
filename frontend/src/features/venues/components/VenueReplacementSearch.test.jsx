// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthContext } from "../../auth/useAuth";

const api = vi.hoisted(() => ({
  searchReplacementVenues: vi.fn(),
  submitBookingRequest: vi.fn(),
}));

vi.mock("../../../lib/api", () => api);

import VenueReplacementSearch from "./VenueReplacementSearch";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const requestId = "11111111-1111-4111-8111-111111111111";
const originalBooking = {
  bookingId: requestId,
  eventId: "22222222-2222-4222-8222-222222222222",
  eventName: "Annual conference",
  venueName: "Closed Hall",
  bookingDate: "2099-10-10",
  slots: ["am"],
  expectedAttendees: 100,
  roomLayout: "Theatre",
  requiredFacilities: ["Projector"],
  accessibilityRequirements: ["Lift"],
  purpose: "Annual conference",
  affectedReason: "Emergency maintenance",
};

function renderSearch() {
  return render(
    <AuthContext.Provider value={{ token: "test-token" }}>
      <MemoryRouter initialEntries={[`/venues/booking-requests/${requestId}/replacement`]}>
        <Routes>
          <Route path="/venues/booking-requests/:requestId/replacement" element={<VenueReplacementSearch />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

test("[SCRUM-145-UI-003] the coordinator sees preserved requirements and requests a candidate through the normal flow", async () => {
  api.searchReplacementVenues.mockResolvedValue({
    originalBooking,
    candidateVenues: [{ venueId: "33333333-3333-4333-8333-333333333333", name: "Replacement Hall", city: "Singapore", capacity: 150 }],
  });
  api.submitBookingRequest.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" });

  renderSearch();

  expect(await screen.findByRole("heading", { name: "Find a replacement venue" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Annual conference" })).toBeTruthy();
  expect(screen.getByText("Closed Hall")).toBeTruthy();
  expect(screen.getByText(/2099-10-10.*am/)).toBeTruthy();
  expect(screen.getByText("Why it is affected: Emergency maintenance")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Replacement Hall" })).toBeTruthy();
  expect(screen.getByText("Meets the original event requirements.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Request this venue" }));

  await waitFor(() => expect(api.submitBookingRequest).toHaveBeenCalledWith(
    "33333333-3333-4333-8333-333333333333",
    {
      event_id: originalBooking.eventId,
      booking_date: originalBooking.bookingDate,
      slots: originalBooking.slots,
      expected_attendees: originalBooking.expectedAttendees,
      room_layout: originalBooking.roomLayout,
      required_facilities: originalBooking.requiredFacilities,
      accessibility_requirements: originalBooking.accessibilityRequirements,
      purpose: originalBooking.purpose,
      replaces_booking_id: originalBooking.bookingId,
    },
    "test-token",
  ));
});

test("[SCRUM-145-UI-005] no candidates gives the coordinator a clear release and replanning next step", async () => {
  api.searchReplacementVenues.mockResolvedValue({ originalBooking, candidateVenues: [] });

  renderSearch();

  expect(await screen.findByRole("heading", { name: "No suitable venue found" })).toBeTruthy();
  expect(screen.getByText("You can release this booking and consider replanning the event.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to affected booking" }).getAttribute("href")).toBe(
    `/events/managed/${originalBooking.eventId}`,
  );
});
