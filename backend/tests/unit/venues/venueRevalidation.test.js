// SCRUM-38: re-validating an event's venue bookings after the event changes.
// The booking checker is the real SCRUM-138 one; only the reads and the
// SCRUM-145 mark are faked, so these tests prove which bookings get flagged,
// with what reason, and that passing bookings are never written to.

import { describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { eventFitReasons } = require("../../../src/modules/venues/venueBookingChecks");
const { createBookingChecker, createVenueRevalidation } = require("../../../src/modules/venues/venueRevalidation");

const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const COORDINATOR_ID = "55555555-5555-4555-8555-555555555555";
const DATE = "2099-10-10";
const OPEN_ALWAYS = Object.fromEntries(
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [day, { open: "08:00", close: "23:00" }]),
);

// Singapore dates: 01:00Z on 10 Oct is 09:00 local, still 10 Oct.
const EVENT = {
  id: EVENT_ID, name: "Harbour fun run", start_time: `${DATE}T01:00:00Z`, end_time: `${DATE}T09:00:00Z`, expected_attendance: 80,
};

function venue(id, capacity, extra = {}) {
  return { id, name: `Hall ${id.slice(0, 1)}`, capacity, operating_hours: OPEN_ALWAYS, room_layouts: ["Theatre"], is_active: true, ...extra };
}

function booking(id, venueRow, extra = {}) {
  return {
    id, booking_date: DATE, expected_attendees: 10, room_layout: "Theatre", required_facilities: [], accessibility_requirements: [],
    is_affected: false, venue: { id: venueRow.id, name: venueRow.name, capacity: venueRow.capacity },
    event: { id: EVENT_ID, coordinator_id: COORDINATOR_ID }, slots: [{ slot: "am", status: "confirmed" }], ...extra,
  };
}

function setup({ event = EVENT, venues, bookings, slotRows = [], markFails = [] }) {
  const markVenueBookingAffected = vi.fn(async (id) => {
    if (markFails.includes(id)) throw new Error("mark failed");
    return id;
  });
  const listBookingRequests = vi.fn(async () => bookings);
  const logger = { error: vi.fn() };
  const checkOneBooking = createBookingChecker({
    getVenueById: async (id) => venues.find((row) => row.id === id) ?? null,
    listSlotRowsForDate: async () => slotRows,
    listUnavailabilityInRange: async () => [],
  });
  const { revalidateBookingsForEvent } = createVenueRevalidation({
    getEventForCheckReport: async () => event, listBookingRequests, markVenueBookingAffected, checkOneBooking, logger,
  });
  return { revalidateBookingsForEvent, markVenueBookingAffected, listBookingRequests, logger };
}

describe("[SCRUM-38] eventFitReasons: does the booking still fit the changed event?", () => {
  test("TC-SCRUM-38-01: a booking inside the event's dates with enough capacity has no reason", () => {
    expect(eventFitReasons({ booking_date: DATE }, EVENT, 100)).toEqual([]);
  });

  test("TC-SCRUM-38-02: a booking date before or after the event's new dates is flagged", () => {
    expect(eventFitReasons({ booking_date: "2099-10-09" }, EVENT, 100)).toEqual([
      "2099-10-09 is outside the event's dates (2099-10-10 to 2099-10-10).",
    ]);
    expect(eventFitReasons({ booking_date: "2099-10-11" }, EVENT, 100)[0]).toMatch(/outside the event's dates/);
  });

  test("TC-SCRUM-38-03: attendance equal to the booked capacity passes; one more is over capacity", () => {
    expect(eventFitReasons({ booking_date: DATE }, { ...EVENT, expected_attendance: 80 }, 80)).toEqual([]);
    expect(eventFitReasons({ booking_date: DATE }, { ...EVENT, expected_attendance: 81 }, 80)).toEqual([
      "Over capacity: the venues booked on 2099-10-10 hold 80, fewer than the 81 people now expected.",
    ]);
  });

  test("TC-SCRUM-38-05: nothing recorded to compare against gives no reason", () => {
    expect(eventFitReasons({ booking_date: DATE }, { ...EVENT, start_time: null, end_time: null, expected_attendance: null }, 10)).toEqual([]);
  });
});

describe("[SCRUM-38] revalidateBookingsForEvent", () => {
  test("TC-SCRUM-38-04: two venues on the same date are judged together, so their combined capacity counts", async () => {
    const a = venue("a1111111-1111-4111-8111-111111111111", 50);
    const b = venue("b1111111-1111-4111-8111-111111111111", 40);
    const { revalidateBookingsForEvent, markVenueBookingAffected } = setup({
      venues: [a, b], bookings: [booking("aaaaaaaa-0001-4000-8000-000000000001", a), booking("aaaaaaaa-0002-4000-8000-000000000002", b)],
    });

    expect(await revalidateBookingsForEvent(EVENT_ID)).toEqual({ checked: 2, flagged: [] });
    expect(markVenueBookingAffected).not.toHaveBeenCalled();
  });

  test("TC-SCRUM-38-06: only the failing booking is flagged, with its venue and reason; the passing one is not written to", async () => {
    const fits = venue("a1111111-1111-4111-8111-111111111111", 200);
    const tooSmall = venue("b1111111-1111-4111-8111-111111111111", 20);
    const passing = booking("aaaaaaaa-0001-4000-8000-000000000001", fits);
    const failing = booking("aaaaaaaa-0002-4000-8000-000000000002", tooSmall, { booking_date: "2099-10-11", expected_attendees: 30 });
    const { revalidateBookingsForEvent, markVenueBookingAffected } = setup({ venues: [fits, tooSmall], bookings: [passing, failing] });

    const result = await revalidateBookingsForEvent(EVENT_ID);

    expect(result.checked).toBe(2);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0]).toMatchObject({ booking_id: failing.id, venue_name: tooSmall.name });
    expect(result.flagged[0].reason).toMatch(/^After the event changed: /);
    expect(result.flagged[0].reason).toMatch(/outside the event's dates/);
    expect(result.flagged[0].reason).toMatch(/Over capacity: the venues booked on 2099-10-11 hold 20/);
    expect(markVenueBookingAffected).toHaveBeenCalledExactlyOnceWith(failing.id, COORDINATOR_ID, result.flagged[0].reason);
  });

  test("TC-SCRUM-38-07: already-affected, cancelled and rejected bookings are skipped and never re-marked", async () => {
    const small = venue("b1111111-1111-4111-8111-111111111111", 5);
    const { revalidateBookingsForEvent, markVenueBookingAffected } = setup({
      venues: [small],
      bookings: [
        booking("aaaaaaaa-0001-4000-8000-000000000001", small, { is_affected: true }),
        booking("aaaaaaaa-0002-4000-8000-000000000002", small, { slots: [{ slot: "am", status: "cancelled" }] }),
        booking("aaaaaaaa-0003-4000-8000-000000000003", small, { slots: [{ slot: "am", status: "rejected" }] }),
      ],
    });

    expect(await revalidateBookingsForEvent(EVENT_ID)).toEqual({ checked: 0, flagged: [] });
    expect(markVenueBookingAffected).not.toHaveBeenCalled();
  });

  test("TC-SCRUM-38-08: a booking that cannot be marked is logged and the others are still checked", async () => {
    const small = venue("b1111111-1111-4111-8111-111111111111", 5);
    const first = booking("aaaaaaaa-0001-4000-8000-000000000001", small);
    const second = booking("aaaaaaaa-0002-4000-8000-000000000002", small, { slots: [{ slot: "pm", status: "pending" }] });
    const { revalidateBookingsForEvent, markVenueBookingAffected, logger } = setup({ venues: [small], bookings: [first, second], markFails: [first.id] });

    const result = await revalidateBookingsForEvent(EVENT_ID);

    expect(markVenueBookingAffected).toHaveBeenCalledTimes(2);
    expect(result.flagged.map((row) => row.booking_id)).toEqual([second.id]);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  test("TC-SCRUM-38-09: a clash names the other event as \"Reserved event\", never its real name", async () => {
    const hall = venue("a1111111-1111-4111-8111-111111111111", 200);
    const mine = booking("aaaaaaaa-0001-4000-8000-000000000001", hall);
    const otherEventRow = { booking_date: DATE, slot: "am", status: "confirmed", event_name: "Secret board meeting", request: { id: "other-request", event_id: "other-event" } };
    const { revalidateBookingsForEvent } = setup({ venues: [hall], bookings: [mine], slotRows: [otherEventRow] });

    const { flagged } = await revalidateBookingsForEvent(EVENT_ID);

    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toContain("Reserved event");
    expect(flagged[0].reason).not.toContain("Secret board meeting");
  });

  test("[SCRUM-38] a booking whose venue no longer exists cannot be checked, so it is skipped rather than flagged", async () => {
    const gone = venue("a1111111-1111-4111-8111-111111111111", 200);
    const { revalidateBookingsForEvent, markVenueBookingAffected } = setup({
      venues: [], bookings: [booking("aaaaaaaa-0001-4000-8000-000000000001", gone)],
    });

    expect(await revalidateBookingsForEvent(EVENT_ID)).toEqual({ checked: 1, flagged: [] });
    expect(markVenueBookingAffected).not.toHaveBeenCalled();
  });

  test("[SCRUM-38] an event with no live bookings, or that no longer exists, checks nothing", async () => {
    const empty = setup({ venues: [], bookings: [] });
    expect(await empty.revalidateBookingsForEvent(EVENT_ID)).toEqual({ checked: 0, flagged: [] });
    const gone = setup({ event: null, venues: [], bookings: [] });
    expect(await gone.revalidateBookingsForEvent(EVENT_ID)).toEqual({ checked: 0, flagged: [] });
    expect(gone.listBookingRequests).not.toHaveBeenCalled();
  });
});
