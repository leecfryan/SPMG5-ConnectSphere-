// SCRUM-154: cancel_venue_booking_request and change_venue_booking_request
// against the real dev Supabase - the one proof the mocked suite
// (venueBookingChangeCancel.test.js) structurally cannot provide: AC1's
// cross-request scoping (does the SQL's own WHERE clause really leave a
// sibling request alone?) and AC4's transactional event_activity_log write
// (it happens inside the SQL function, invisible to a mocked service).
// Same live-DB pattern as venue-release-cancelled-event.test.js: real network
// calls, throwaway rows cleaned up in afterEach via cascade delete on events.
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
    await supabase.from("events").delete().in("id", createdEventIds); // cascades venue_booking_requests -> venue_bookings, and event_activity_log
    createdEventIds = [];
  }
  if (createdVenueIds.length) {
    await supabase.from("venues").delete().in("id", createdVenueIds);
    createdVenueIds = [];
  }
});

async function insertEvent() {
  const id = randomUUID();
  const { error } = await supabase.from("events").insert({
    id, name: "SCRUM-154 live test " + id.slice(0, 8), purpose: "test", description: "test",
    start_time: "2026-02-01T09:00:00Z", end_time: "2026-02-10T17:00:00Z", expected_attendance: 1,
    status: "APPROVED", organiser_id: technicalUserId,
  });
  if (error) throw new Error("events insert failed: " + error.message);
  createdEventIds.push(id);
  return id;
}

async function insertVenue() {
  const id = randomUUID();
  const { error } = await supabase.from("venues").insert({
    id, name: "SCRUM-154 test venue " + id.slice(0, 8), address: "1 Test Street", city: "Singapore", country: "Singapore", capacity: 50,
  });
  if (error) throw new Error("venues insert failed: " + error.message);
  createdVenueIds.push(id);
  return id;
}

async function insertBookingRequest({ eventId, venueId, bookingDate = "2026-02-01" }) {
  const id = randomUUID();
  const { error } = await supabase.from("venue_booking_requests").insert({
    id, venue_id: venueId, event_id: eventId, booking_date: bookingDate,
    expected_attendees: 10, room_layout: "Theatre",
  });
  if (error) throw new Error("venue_booking_requests insert failed: " + error.message);
  return id;
}

async function insertBooking({ requestId, venueId, status = "confirmed", slot = "am", bookingDate = "2026-02-01" }) {
  const id = randomUUID();
  const { error } = await supabase.from("venue_bookings").insert({
    id, venue_id: venueId, booking_date: bookingDate, slot, status,
    event_name: "SCRUM-154 live test", requested_by: "test-harness", request_id: requestId,
  });
  if (error) throw new Error("venue_bookings insert failed: " + error.message);
  return id;
}

async function bookingsForRequest(requestId) {
  const { data, error } = await supabase.from("venue_bookings").select("*").eq("request_id", requestId);
  if (error) throw error;
  return data;
}

async function requestRow(requestId) {
  const { data, error } = await supabase.from("venue_booking_requests").select("*").eq("id", requestId).maybeSingle();
  if (error) throw error;
  return data;
}

async function activityLogRows(eventId) {
  const { data, error } = await supabase.from("event_activity_log").select("*").eq("event_id", eventId).order("id");
  if (error) throw error;
  return data;
}

describe("SCRUM-154 AC1/AC3/AC4 (live): cancelling one booking releases it and leaves siblings untouched", () => {
  test("[TC-SCRUM-154-LIVE-01] cancelling one of two venue bookings on an event only touches that one, and is logged", async () => {
    const eventId = await insertEvent();
    const venueA = await insertVenue();
    const venueB = await insertVenue();
    const requestA = await insertBookingRequest({ eventId, venueId: venueA });
    const requestB = await insertBookingRequest({ eventId, venueId: venueB });
    await insertBooking({ requestId: requestA, venueId: venueA, status: "confirmed", slot: "am" });
    await insertBooking({ requestId: requestB, venueId: venueB, status: "confirmed", slot: "pm" });

    const historyBefore = await activityLogRows(eventId);
    const released = await venuesService.cancelBookingRequest(requestA, technicalUserId);

    expect(released).toBe(1);
    const [rowsA, rowsB] = await Promise.all([bookingsForRequest(requestA), bookingsForRequest(requestB)]);
    expect(rowsA[0].status).toBe("cancelled");
    // AC1: the sibling request on a different venue is completely untouched.
    expect(rowsB[0].status).toBe("confirmed");

    const historyAfter = await activityLogRows(eventId);
    expect(historyAfter).toEqual(expect.arrayContaining(historyBefore));
    const log = historyAfter.filter(row => !historyBefore.some(previous => previous.id === row.id));
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("venue_booking.cancelled");
    expect(log[0].user_id).toBe(technicalUserId);
    expect(log[0].details.request_id).toBe(requestA);
  });

  test("[TC-SCRUM-154-LIVE-02] cancelling a request with no live rows is refused (NOT_LIVE), nothing logged", async () => {
    const eventId = await insertEvent();
    const venueId = await insertVenue();
    const requestId = await insertBookingRequest({ eventId, venueId });
    await insertBooking({ requestId, venueId, status: "cancelled", slot: "am" });

    const historyBefore = await activityLogRows(eventId);
    await expect(
      venuesService.cancelBookingRequest(requestId, technicalUserId)
    ).rejects.toMatchObject({ code: "P0003" });

    expect(await activityLogRows(eventId)).toEqual(historyBefore);
  });

  test("[TC-SCRUM-154-LIVE-03] cancelling a request id that does not exist is refused (REQUEST_NOT_FOUND)", async () => {
    await expect(
      venuesService.cancelBookingRequest(randomUUID(), technicalUserId)
    ).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("SCRUM-154 AC1/AC2/AC4 (live): changing one booking re-flags it and leaves siblings untouched", () => {
  test("[TC-SCRUM-154-LIVE-04] changing the date moves the booking's slots and leaves a sibling request alone", async () => {
    const eventId = await insertEvent();
    const venueA = await insertVenue();
    const venueB = await insertVenue();
    const requestA = await insertBookingRequest({ eventId, venueId: venueA, bookingDate: "2026-02-01" });
    const requestB = await insertBookingRequest({ eventId, venueId: venueB, bookingDate: "2026-02-01" });
    await insertBooking({ requestId: requestA, venueId: venueA, status: "confirmed", slot: "am", bookingDate: "2026-02-01" });
    await insertBooking({ requestId: requestB, venueId: venueB, status: "confirmed", slot: "pm", bookingDate: "2026-02-01" });

    const historyBefore = await activityLogRows(eventId);
    await venuesService.changeBookingRequest(requestA, technicalUserId, {
      booking_date: "2026-02-05", expected_attendees: 25, room_layout: "Banquet",
      required_facilities: ["Stage"], accessibility_requirements: [], additional_requirements: "Updated",
    });

    const [rowsA, rowsB, updatedRequestA] = await Promise.all([
      bookingsForRequest(requestA), bookingsForRequest(requestB), requestRow(requestA),
    ]);

    // Old slot cancelled, a fresh row inserted on the new date with the same slot.
    const oldRow = rowsA.find((r) => r.booking_date === "2026-02-01");
    const newRow = rowsA.find((r) => r.booking_date === "2026-02-05");
    expect(oldRow.status).toBe("cancelled");
    expect(newRow.status).toBe("pending");
    expect(newRow.slot).toBe("am");

    expect(updatedRequestA.booking_date).toBe("2026-02-05");
    expect(updatedRequestA.expected_attendees).toBe(25);
    expect(updatedRequestA.room_layout).toBe("Banquet");

    // AC1: the sibling request on a different venue, different booking entirely, is untouched.
    expect(rowsB[0].status).toBe("confirmed");
    expect(rowsB[0].booking_date).toBe("2026-02-01");

    const historyAfter = await activityLogRows(eventId);
    expect(historyAfter).toEqual(expect.arrayContaining(historyBefore));
    const log = historyAfter.filter(row => !historyBefore.some(previous => previous.id === row.id));
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("venue_booking.changed");
    expect(log[0].details.booking_date).toEqual({ from: "2026-02-01", to: "2026-02-05" });
  });

  test("[TC-SCRUM-154-LIVE-05] changing non-slot details on the same date flips the existing row in place, not a new one", async () => {
    const eventId = await insertEvent();
    const venueId = await insertVenue();
    const requestId = await insertBookingRequest({ eventId, venueId, bookingDate: "2026-02-01" });
    const bookingId = await insertBooking({ requestId, venueId, status: "confirmed", slot: "am", bookingDate: "2026-02-01" });

    await venuesService.changeBookingRequest(requestId, technicalUserId, {
      booking_date: "2026-02-01", expected_attendees: 40, room_layout: "Theatre",
      required_facilities: [], accessibility_requirements: [], additional_requirements: null,
    });

    const rows = await bookingsForRequest(requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(bookingId); // same row, not cancelled-and-reinserted
    expect(rows[0].status).toBe("pending");
  });

  test("[TC-SCRUM-154-LIVE-06] changing a request with no live rows is refused (NOT_LIVE)", async () => {
    const eventId = await insertEvent();
    const venueId = await insertVenue();
    const requestId = await insertBookingRequest({ eventId, venueId });
    await insertBooking({ requestId, venueId, status: "rejected", slot: "am" });

    await expect(
      venuesService.changeBookingRequest(requestId, technicalUserId, {
        booking_date: "2026-02-02", expected_attendees: 5, room_layout: "Theatre",
        required_facilities: [], accessibility_requirements: [], additional_requirements: null,
      })
    ).rejects.toMatchObject({ code: "P0003" });
  });
});
