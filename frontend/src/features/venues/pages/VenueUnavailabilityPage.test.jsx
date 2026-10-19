// @vitest-environment jsdom
// SCRUM-136: affected bookings shown after creating an unavailability period.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import VenueUnavailabilityPage from "./VenueUnavailabilityPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ token: "venue_staff" }),
}));
vi.mock("../venueUnavailabilityService");

import {
  fetchUnavailabilityPeriods,
  createUnavailabilityPeriod,
} from "../venueUnavailabilityService";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const VENUE = { id: "11111111-1111-4111-8111-111111111111", name: "Integration Hall" };

const PERIOD = {
  id: "44444444-4444-4444-4444-444444444444",
  venue_id: VENUE.id,
  start_date: "2099-11-01",
  end_date: "2099-11-01",
  slots: ["am"],
  reason: "Maintenance",
};

const AFFECTED_REQUEST = {
  id: "55555555-5555-4555-8555-555555555555",
  booking_date: "2099-11-01",
  event: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Annual Conference",
    status: "APPROVED",
    start_time: "2099-11-01T00:00:00Z",
    end_time: "2099-11-01T12:00:00Z",
    coordinator_id: "33333333-3333-4333-8333-333333333333",
  },
  venue: VENUE,
  slots: [{ slot: "am", status: "confirmed" }],
};

// Opens the create form and clicks submit. The header "Add period" and the form
// submit share the same label; each click finds the only button with that name
// at that point in the render cycle.
async function openFormAndSubmit() {
  await screen.findByText("No unavailability periods recorded.");
  fireEvent.click(screen.getByRole("button", { name: "Add period" })); // header → create mode
  fireEvent.click(screen.getByRole("button", { name: "Add period" })); // form submit
}

test("[TC-SCRUM-136-UI-01] affected bookings are shown after period creation with overlapping confirmed booking", async () => {
  fetchUnavailabilityPeriods.mockResolvedValue({ data: [] });
  createUnavailabilityPeriod.mockResolvedValue({ data: PERIOD, affected: [AFFECTED_REQUEST] });

  render(<VenueUnavailabilityPage venue={VENUE} onBack={() => {}} />);
  await openFormAndSubmit();

  expect(await screen.findByText(/Period added — Maintenance/)).toBeTruthy();
  expect(screen.getByText(/1 confirmed booking overlap this period/)).toBeTruthy();
  expect(screen.getByText("Annual Conference")).toBeTruthy();
  expect(screen.getByText(/2099-11-01/)).toBeTruthy();
  expect(screen.getByText(/AM/)).toBeTruthy();
  expect(screen.getByText(/Contact the assigned coordinator/)).toBeTruthy();
  expect(screen.getByText(/bookings below have not been changed/)).toBeTruthy();
});

test("[TC-SCRUM-136-UI-02] no affected bookings: returns to list without showing affected panel", async () => {
  fetchUnavailabilityPeriods.mockResolvedValue({ data: [] });
  createUnavailabilityPeriod.mockResolvedValue({ data: PERIOD, affected: [] });

  render(<VenueUnavailabilityPage venue={VENUE} onBack={() => {}} />);
  await openFormAndSubmit();

  await waitFor(() => {
    expect(screen.queryByText(/confirmed booking/)).toBeNull();
  });
  expect(screen.queryByText("Annual Conference")).toBeNull();
});

test("[TC-SCRUM-136-UI-03] Done button returns to the period list after viewing affected bookings", async () => {
  fetchUnavailabilityPeriods.mockResolvedValue({ data: [] });
  createUnavailabilityPeriod.mockResolvedValue({ data: PERIOD, affected: [AFFECTED_REQUEST] });

  render(<VenueUnavailabilityPage venue={VENUE} onBack={() => {}} />);
  await openFormAndSubmit();

  await screen.findByText("Annual Conference");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  await waitFor(() => {
    expect(screen.queryByText("Annual Conference")).toBeNull();
  });
  // Period appears in the list after returning
  expect(screen.getByText("Maintenance")).toBeTruthy();
});

test("[TC-SCRUM-136-UI-04] plural wording used for multiple affected bookings", async () => {
  fetchUnavailabilityPeriods.mockResolvedValue({ data: [] });
  const second = {
    ...AFFECTED_REQUEST,
    id: "66666666-6666-4666-8666-666666666666",
    event: { ...AFFECTED_REQUEST.event, name: "Workshop" },
  };
  createUnavailabilityPeriod.mockResolvedValue({ data: PERIOD, affected: [AFFECTED_REQUEST, second] });

  render(<VenueUnavailabilityPage venue={VENUE} onBack={() => {}} />);
  await openFormAndSubmit();

  expect(await screen.findByText(/Period added — Maintenance/)).toBeTruthy();
  expect(screen.getByText(/2 confirmed bookings overlap this period/)).toBeTruthy();
  expect(screen.getByText("Annual Conference")).toBeTruthy();
  expect(screen.getByText("Workshop")).toBeTruthy();
});
