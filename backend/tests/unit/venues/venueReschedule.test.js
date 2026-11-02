// SCRUM-170 phase 2: each live booking checked on the postponement's new date.
// Storage is faked; checkBooking, the calendar and the suitability rules are real.
import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRescheduleCheck } = require("../../../src/modules/venues/venueReschedule");

const EVENT = { id: "event-1", start_time: "2099-07-01T01:00:00Z" };
const OPEN_ALL_WEEK = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
  .map((day) => [day, { open: "08:00", close: "23:00" }]));
const VENUE = {
  id: "venue-1", name: "Marina Hall", capacity: 200, room_layouts: ["Theatre"], facilities: ["Projector"],
  accessibility_features: ["Lift"], operating_hours: OPEN_ALL_WEEK, setup_minutes: 0, turnaround_minutes: 0, is_active: true,
};

function request(overrides = {}) {
  return {
    id: "req-1", booking_date: "2099-07-01", expected_attendees: 80, room_layout: "Theatre",
    required_facilities: ["Projector"], accessibility_requirements: [], venue: { id: VENUE.id, name: VENUE.name },
    slots: [{ slot: "am", status: "confirmed" }, { slot: "pm", status: "confirmed" }], ...overrides,
  };
}

function setup({ requests = [request()], venue = VENUE, slotRows = [], unavailability = [] } = {}) {
  const storage = {
    listBookingRequests: vi.fn(async () => requests),
    getVenueById: vi.fn(async () => venue),
    listSlotRowsForDate: vi.fn(async () => slotRows),
    listUnavailabilityInRange: vi.fn(async () => unavailability),
  };
  return { storage, check: createRescheduleCheck(storage) };
}

test("[TC-SCRUM-170-21] a booking that still fits moves by the event's shift, keeping its slots, and passes", async () => {
  const { storage, check } = setup();

  const results = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(results).toEqual([{
    booking_id: "req-1", venue_name: "Marina Hall", booking_date: "2099-07-01", new_booking_date: "2099-07-08",
    slots: ["am", "pm"], passed: true, reasons: [],
  }]);
  expect(storage.listBookingRequests).toHaveBeenCalledWith({ allVenues: true }, "event-1");
  expect(storage.listSlotRowsForDate).toHaveBeenCalledWith("venue-1", "2099-07-08");
  expect(storage.listUnavailabilityInRange).toHaveBeenCalledWith("venue-1", "2099-07-08", "2099-07-08");
});

test("[TC-SCRUM-170-26] the shift is counted in Singapore time: an event at 07:00 SGT is still the same booking day", async () => {
  // 2099-07-01T23:00Z is 07:00 on 2 July in Singapore, so the event's day is 2 July, not 1 July.
  const { check } = setup({ requests: [request({ booking_date: "2099-07-02" })] });

  const [result] = await check({ ...EVENT, start_time: "2099-07-01T23:00:00Z" }, "2099-07-09T23:00:00.000Z", "2099-07-10T03:00:00.000Z");

  expect(result.new_booking_date).toBe("2099-07-10");
  expect(result.passed).toBe(true);
});

test("[TC-SCRUM-170-22] a slot another event holds on the new date fails as a clash, with that event masked", async () => {
  const { check } = setup({ slotRows: [
    { booking_date: "2099-07-08", slot: "pm", status: "confirmed", event_name: "Private Gala", request: { id: "other", event_id: "event-2" } },
  ] });

  const [result] = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(result.passed).toBe(false);
  expect(result.reasons).toEqual(["PM is already taken by another event (Reserved event)."]);
});

test("[TC-SCRUM-170-22] a slot recorded unavailable on the new date fails", async () => {
  const { check } = setup({ unavailability: [{ unavailable_date: "2099-07-08", slot: "am", reason: "Floor resurfacing" }] });

  const [result] = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(result.passed).toBe(false);
  expect(result.reasons).toEqual(["AM is recorded unavailable (Floor resurfacing)."]);
});

test("[TC-SCRUM-170-22] a venue that no longer suits the booking fails on suitability", async () => {
  const { check } = setup({ venue: { ...VENUE, capacity: 50 } });

  const [result] = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(result.passed).toBe(false);
  expect(result.reasons).toEqual(["expected_attendees (80) exceeds the venue capacity of 50"]);
});

test("[TC-SCRUM-170-22] a moved day outside the new event dates fails", async () => {
  // A two-day booking pattern squeezed into a one-day new event: the second day falls outside.
  const { check } = setup({ requests: [request({ id: "req-2", booking_date: "2099-07-02" })] });

  const [result] = await check({ ...EVENT, start_time: "2099-07-01T01:00:00Z" }, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(result.new_booking_date).toBe("2099-07-09");
  expect(result.reasons).toEqual(["2099-07-09 is outside the new event dates."]);
});

test("[TC-SCRUM-170-22] a venue that no longer exists fails without reading its calendar", async () => {
  const { storage, check } = setup({ venue: null });

  const [result] = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(result).toMatchObject({ passed: false, reasons: ["This venue no longer exists."], slots: ["am", "pm"] });
  expect(storage.listSlotRowsForDate).not.toHaveBeenCalled();
});

test("[TC-SCRUM-170-22] a booking with no venue recorded fails and is named as such", async () => {
  const { storage, check } = setup({ requests: [request({ venue: null })] });

  const [result] = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(result).toMatchObject({ venue_name: "Venue not recorded", passed: false, reasons: ["This venue no longer exists."] });
  expect(storage.getVenueById).not.toHaveBeenCalled();
});

test("[TC-SCRUM-170-27] bookings with nothing live are not checked, and this event's own rows are not its own clash", async () => {
  const { check } = setup({
    requests: [request(), request({ id: "req-dead", slots: [{ slot: "am", status: "cancelled" }, { slot: "pm", status: "rejected" }] })],
    slotRows: [{ booking_date: "2099-07-08", slot: "am", status: "confirmed", event_name: "Own", request: { id: "req-1", event_id: "event-1" } }],
  });

  const results = await check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z");

  expect(results.map((result) => result.booking_id)).toEqual(["req-1"]);
  expect(results[0].passed).toBe(true);
});

test("[TC-SCRUM-170-25] a storage failure is thrown, so the caller postpones nothing", async () => {
  const { storage, check } = setup();
  storage.listSlotRowsForDate.mockRejectedValueOnce(new Error("storage down"));

  await expect(check(EVENT, "2099-07-08T01:00:00.000Z", "2099-07-08T09:00:00.000Z")).rejects.toThrow("storage down");
});
