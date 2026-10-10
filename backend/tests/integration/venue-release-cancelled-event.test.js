// SCRUM-148 AC3 (venue half): releaseBookingsForCancelledEvent is the one
// cross-lane addition the Venue owner approved for this story - see its task
// note. Same live-DB pattern as equipment-release-cancelled-event.test.js:
// real network calls to the dev Supabase project, throwaway rows cleaned up
// in afterEach. Events and venue booking requests/bookings are deleted via
// cascade (on delete cascade on both FKs), so deleting the throwaway event is
// enough to also remove its requests and slot rows.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.resolve(process.cwd(), "../.env"), quiet: true });

const venuesService = require("../../src/modules/venues/venues.service");
const supabase = require("../../src/supabase");

let technicalUserId;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const technical = data.users.find((u) => u.email === "technical.demo@example.com");
  if (!technical) throw new Error("Seed user technical.demo@example.com not found - run `npm run seed:users` first.");
  technicalUserId = technical.id;
});

let createdEventIds = [];
let createdVenueIds = [];

afterEach(async () => {
  if (createdEventIds.length) {
    await supabase.from("events").delete().in("id", createdEventIds); // cascades venue_booking_requests -> venue_bookings
    createdEventIds = [];
  }
  if (createdVenueIds.length) {
    await supabase.from("venues").delete().in("id", createdVenueIds);
    createdVenueIds = [];
  }
});

async function insertEvent({ status = "CANCELLED" } = {}) {
  const id = randomUUID();
  const { error } = await supabase.from("events").insert({
    id, name: "SCRUM-148 venue release test " + id.slice(0, 8), purpose: "test", description: "test",
    start_time: "2026-02-01T09:00:00Z", end_time: "2026-02-01T17:00:00Z", expected_attendance: 1,
    status, organiser_id: technicalUserId,
  });
  if (error) throw new Error("events insert failed: " + error.message);
  createdEventIds.push(id);
  return id;
}

async function insertVenue() {
  const id = randomUUID();
  const { error } = await supabase.from("venues").insert({
    id, name: "SCRUM-148 test venue " + id.slice(0, 8), address: "1 Test Street", city: "Singapore", country: "Singapore", capacity: 50,
  });
  if (error) throw new Error("venues insert failed: " + error.message);
  createdVenueIds.push(id);
  return id;
}

async function insertBookingRequest({ eventId, venueId, bookingDate = "2026-02-01" }) {
  const id = randomUUID();
  const { error } = await supabase.from("venue_booking_requests").insert({
    id, venue_id: venueId, event_id: eventId, booking_date: bookingDate,
    expected_attendees: 1, room_layout: "Theatre",
  });
  if (error) throw new Error("venue_booking_requests insert failed: " + error.message);
  return id;
}

async function insertBooking({ requestId, venueId, status = "pending", slot = "am", bookingDate = "2026-02-01" }) {
  const id = randomUUID();
  const { error } = await supabase.from("venue_bookings").insert({
    id, venue_id: venueId, booking_date: bookingDate, slot, status,
    event_name: "SCRUM-148 venue release test", requested_by: "test-harness", request_id: requestId,
  });
  if (error) throw new Error("venue_bookings insert failed: " + error.message);
  return id;
}

async function bookingStatus(id) {
  const { data, error } = await supabase.from("venue_bookings").select("status").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.status;
}

describe("SCRUM-148 AC3 (venue): cancelling an event releases its venue bookings", () => {
  test("[TC-148-14] pending and confirmed bookings across more than one venue are both released", async () => {
    const eventId = await insertEvent();
    const venueA = await insertVenue();
    const venueB = await insertVenue();
    const requestA = await insertBookingRequest({ eventId, venueId: venueA });
    const requestB = await insertBookingRequest({ eventId, venueId: venueB });
    const pendingBooking = await insertBooking({ requestId: requestA, venueId: venueA, status: "pending" });
    const confirmedBooking = await insertBooking({ requestId: requestB, venueId: venueB, status: "confirmed" });

    const released = await venuesService.releaseBookingsForCancelledEvent(eventId);

    expect(released.sort()).toEqual([confirmedBooking, pendingBooking].sort());
    expect(await bookingStatus(pendingBooking)).toBe("cancelled");
    expect(await bookingStatus(confirmedBooking)).toBe("cancelled");
  });

  test("[TC-148-15] an already-cancelled booking and a different event's booking are untouched; re-running is a no-op", async () => {
    const eventId = await insertEvent();
    const otherEventId = await insertEvent({ status: "APPROVED" });
    const venue = await insertVenue();
    const request = await insertBookingRequest({ eventId, venueId: venue });
    const otherRequest = await insertBookingRequest({ eventId: otherEventId, venueId: venue });
    const alreadyCancelled = await insertBooking({ requestId: request, venueId: venue, status: "cancelled", slot: "pm" });
    const otherEventBooking = await insertBooking({ requestId: otherRequest, venueId: venue, status: "confirmed", slot: "night" });

    const released = await venuesService.releaseBookingsForCancelledEvent(eventId);

    expect(released).toEqual([]);
    expect(await bookingStatus(alreadyCancelled)).toBe("cancelled");
    expect(await bookingStatus(otherEventBooking)).toBe("confirmed");

    // Re-running changes nothing further and does not error.
    const second = await venuesService.releaseBookingsForCancelledEvent(eventId);
    expect(second).toEqual([]);
  });

  test("[TC-148] a cancelled event with no venue bookings at all returns an empty list", async () => {
    const eventId = await insertEvent();

    const released = await venuesService.releaseBookingsForCancelledEvent(eventId);

    expect(released).toEqual([]);
  });
});
