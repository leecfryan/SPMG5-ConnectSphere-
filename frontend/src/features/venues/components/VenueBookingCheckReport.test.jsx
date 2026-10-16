// @vitest-environment jsdom
// SCRUM-138: the per-venue report itself. Fixed props, so this pins the card
// contract — one card per venue, each with its own verdicts and reasons.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import VenueBookingCheckReport from "./VenueBookingCheckReport";

afterEach(cleanup);

const passed = { passed: true, reasons: [] };
const unchecked = { passed: null, reasons: [] };

const REPORT = {
  event_id: "22222222-2222-4222-8222-222222222222",
  event_name: "Assigned conference",
  results: [
    {
      booking_id: "booking-a",
      venue_name: "Marina Grand Ballroom",
      booking_date: "2099-10-10",
      slots: ["am", "pm", "night"],
      status: "confirmed",
      overall: "passed",
      note: null,
      suitability: passed,
      availability: passed,
      conflicts: passed,
    },
    {
      booking_id: "booking-b",
      venue_name: "Orchard Seminar Room",
      booking_date: "2099-10-10",
      slots: ["am"],
      status: "pending",
      overall: "failed",
      note: null,
      suitability: { passed: false, reasons: ["expected_attendees (100) exceeds the venue capacity of 50"] },
      availability: passed,
      conflicts: { passed: false, reasons: ["AM is already taken by another event (Reserved event)."] },
    },
    {
      booking_id: "booking-c",
      venue_name: "Riverside Hall",
      booking_date: "2099-10-11",
      slots: ["pm"],
      status: "rejected",
      overall: "not_checked",
      note: "This booking is rejected and is no longer live, so it was not checked.",
      suitability: unchecked,
      availability: unchecked,
      conflicts: unchecked,
    },
  ],
};

const cardFor = (venueName) => screen.getByRole("heading", { name: venueName }).closest("article");

test("[SCRUM-138-UI-006] each venue gets its own card, its own verdicts and its own reasons", () => {
  render(<VenueBookingCheckReport report={REPORT} />);

  // The venue that passes reads as passed, with no reasons invented for it:
  // one verdict for the booking plus one per check, and no reason list.
  const marina = within(cardFor("Marina Grand Ballroom"));
  expect(marina.getAllByText("Passed")).toHaveLength(4);
  expect(marina.getByText("AM, PM, Night")).toBeTruthy();
  expect(cardFor("Marina Grand Ballroom").querySelector(".v-bcheck-reasons")).toBeNull();

  // The venue that fails is named, and only its failing checks carry reasons.
  const orchard = within(cardFor("Orchard Seminar Room"));
  // The booking verdict plus the two failing checks.
  expect(orchard.getAllByText("Failed")).toHaveLength(3);
  expect(orchard.getByText("expected_attendees (100) exceeds the venue capacity of 50")).toBeTruthy();
  expect(orchard.getByText("AM is already taken by another event (Reserved event).")).toBeTruthy();
  // Its checks are listed one by one, so the reader can see which failed.
  expect(orchard.getByText("Suitability")).toBeTruthy();
  expect(orchard.getByText("Availability")).toBeTruthy();
  expect(orchard.getByText("Conflicts")).toBeTruthy();
  expect(orchard.getByText("Passed")).toBeTruthy();
});

test("[SCRUM-138-UI-007] a booking that was not checked says why instead of showing verdicts", () => {
  render(<VenueBookingCheckReport report={REPORT} />);

  const riverside = within(cardFor("Riverside Hall"));
  expect(riverside.getByText("Not checked")).toBeTruthy();
  expect(riverside.getByText(/rejected and is no longer live/i)).toBeTruthy();
  expect(riverside.queryByText("Suitability")).toBeNull();
});

test("[SCRUM-138-UI-008] an event with no bookings says so rather than showing an empty report", () => {
  render(<VenueBookingCheckReport report={{ ...REPORT, results: [] }} />);

  expect(screen.getByText("No bookings to check.")).toBeTruthy();
  expect(screen.queryByText("Marina Grand Ballroom")).toBeNull();
});
