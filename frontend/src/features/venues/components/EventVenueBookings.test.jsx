// @vitest-environment jsdom
// SCRUM-138: the coordinator's way into the per-venue check, from their own
// event page. The component is presentational: the page that knows the session
// decides whether to offer the link, so these tests drive `canCheck` directly.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { MemoryRouter } from "react-router";
import EventVenueBookings from "./EventVenueBookings";

afterEach(cleanup);

const EVENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const BOOKINGS = [
  {
    id: "booking-1",
    purpose: "Annual conference",
    booking_date: "2099-10-10",
    venue: { name: "Marina Grand Ballroom", city: "Singapore", country: "Singapore" },
    slots: [{ slot: "am", status: "confirmed" }],
  },
];

function renderBookings({ bookings = BOOKINGS, eventId = EVENT_ID, canCheck = true } = {}) {
  return render(
    <MemoryRouter>
      <EventVenueBookings bookings={bookings} eventId={eventId} canCheck={canCheck} />
    </MemoryRouter>,
  );
}

test("[SCRUM-138-UI-009] a permitted caller with an event's bookings gets one link into the per-venue check", () => {
  renderBookings();

  expect(screen.getByText("Marina Grand Ballroom")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Check each venue booking" }).getAttribute("href")).toBe(
    `/venues/booking-requests?event=${EVENT_ID}`
  );
});

test("[SCRUM-138-UI-010] without the permission the venues are listed but no link is offered", () => {
  renderBookings({ canCheck: false });

  expect(screen.getByText("Marina Grand Ballroom")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Check each venue booking" })).toBeNull();
});

test("[SCRUM-138-UI-011] an event with no bookings offers nothing to check", () => {
  renderBookings({ bookings: [] });

  expect(screen.getByText("No venue bookings recorded.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Check each venue booking" })).toBeNull();
});

test("[SCRUM-138-UI-012] without an event id the list stands alone, with no link to build", () => {
  // The "My Events" list renders this inside its own link, where a second link
  // would be invalid, so it passes no event id.
  renderBookings({ eventId: null });

  expect(screen.getByText("Marina Grand Ballroom")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Check each venue booking" })).toBeNull();
});
