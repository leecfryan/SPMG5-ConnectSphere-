// SCRUM-138: unit tests for the pure per-venue check module. The calendar days
// are built with the real buildAvailabilityCalendar, so these tests exercise
// the check against the same calendar the SCRUM-17 page and the submission
// flow use.

import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  LIVE_SLOT_STATUSES,
  liveSlotNames,
  notCheckedResult,
  checkBooking,
} = require("../../../src/modules/venues/venueBookingChecks");
const { buildAvailabilityCalendar } = require("../../../src/modules/venues/venues.availability");

const VENUE_ID = "11111111-1111-4111-8111-111111111111";
const BOOKING_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const DATE = "2099-10-10";

const OPEN_ALWAYS = Object.fromEntries(
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [
    day,
    { open: "08:00", close: "23:00" },
  ]),
);

function buildDay({ operatingHours, bookings = [], unavailability = [] } = {}) {
  return buildAvailabilityCalendar({
    operatingHours: operatingHours ?? OPEN_ALWAYS,
    bookings,
    unavailability,
    from: DATE,
    to: DATE,
  })[0];
}

function venue(overrides = {}) {
  return {
    id: VENUE_ID,
    name: "Marina Grand Ballroom",
    capacity: 120,
    room_layouts: ["Theatre"],
    facilities: ["Stage"],
    accessibility_features: ["Wheelchair ramp"],
    setup_minutes: 0,
    turnaround_minutes: 0,
    is_active: true,
    ...overrides,
  };
}

function booking(overrides = {}) {
  return {
    id: BOOKING_ID,
    booking_date: DATE,
    expected_attendees: 100,
    room_layout: "Theatre",
    required_facilities: ["Stage"],
    accessibility_requirements: [],
    slots: [{ slot: "am", status: "pending" }],
    ...overrides,
  };
}

const confirmedByOtherEvent = (slot) => ({
  booking_date: DATE,
  slot,
  status: "confirmed",
  event_name: "Another event",
});

describe("liveSlotNames", () => {
  test("[SCRUM-138] only pending and confirmed slots are live", () => {
    expect(LIVE_SLOT_STATUSES).toEqual(["pending", "confirmed"]);
    expect(
      liveSlotNames(
        booking({
          slots: [
            { slot: "am", status: "cancelled" },
            { slot: "pm", status: "confirmed" },
            { slot: "night", status: "pending" },
          ],
        }),
      ),
    ).toEqual(["pm", "night"]);
  });

  test("[SCRUM-138] a booking with no slots, or only dead slots, has nothing live", () => {
    expect(liveSlotNames(booking({ slots: [] }))).toEqual([]);
    expect(liveSlotNames(booking({ slots: null }))).toEqual([]);
    expect(
      liveSlotNames(
        booking({
          slots: [
            { slot: "am", status: "rejected" },
            { slot: "pm", status: "cancelled" },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("checkBooking", () => {
  test("[SCRUM-138] a live booking that fits reports every check passed", () => {
    const result = checkBooking(booking(), venue(), buildDay(), [], EVENT_ID);

    expect(result.overall).toBe("passed");
    expect(result.venue_name).toBe("Marina Grand Ballroom");
    expect(result.suitability).toEqual({ passed: true, reasons: [] });
    expect(result.availability).toEqual({ passed: true, reasons: [] });
    expect(result.conflicts).toEqual({ passed: true, reasons: [] });
  });

  test("[SCRUM-138] requirements the venue cannot meet fail suitability and name the numbers", () => {
    const result = checkBooking(
      booking({ expected_attendees: 200 }),
      venue({ capacity: 120 }),
      buildDay(),
      [],
      EVENT_ID,
    );

    expect(result.overall).toBe("failed");
    expect(result.suitability.passed).toBe(false);
    expect(result.suitability.reasons).toEqual([
      "expected_attendees (200) exceeds the venue capacity of 120",
    ]);
    expect(result.availability.passed).toBe(true);
    expect(result.conflicts.passed).toBe(true);
  });

  test("[SCRUM-138] a missing facility fails suitability and names the facility", () => {
    const result = checkBooking(
      booking({ required_facilities: ["Stage", "Kitchen"] }),
      venue({ facilities: ["Stage"] }),
      buildDay(),
      [],
      EVENT_ID,
    );

    expect(result.suitability.passed).toBe(false);
    expect(result.suitability.reasons).toEqual([
      "required_facilities not available at this venue: Kitchen",
    ]);
  });

  test("[SCRUM-138] a slot another event holds is a conflict, not an availability failure", () => {
    const result = checkBooking(
      booking(),
      venue(),
      buildDay({ bookings: [confirmedByOtherEvent("am")] }),
      [],
      EVENT_ID,
    );

    expect(result.overall).toBe("failed");
    expect(result.availability.passed).toBe(true);
    expect(result.conflicts.passed).toBe(false);
    expect(result.conflicts.reasons).toEqual([
      "AM is already taken by another event (Another event).",
    ]);
  });

  test("[SCRUM-138] a recorded unavailability fails availability and keeps its reason", () => {
    const result = checkBooking(
      booking(),
      venue(),
      buildDay({
        unavailability: [
          { unavailable_date: DATE, slot: "am", reason: "Deep cleaning" },
        ],
      }),
      [],
      EVENT_ID,
    );

    expect(result.conflicts.passed).toBe(true);
    expect(result.availability.passed).toBe(false);
    expect(result.availability.reasons).toEqual([
      "AM is recorded unavailable (Deep cleaning).",
    ]);
  });

  test("[SCRUM-138] a slot outside the venue's operating hours fails availability", () => {
    const closedSaturdays = { ...OPEN_ALWAYS, sat: { closed: true } };
    const result = checkBooking(
      booking(),
      venue(),
      buildDay({ operatingHours: closedSaturdays }),
      [],
      EVENT_ID,
    );

    expect(result.availability.passed).toBe(false);
    expect(result.availability.reasons).toEqual([
      "AM is outside the venue's operating hours.",
    ]);
  });

  test("[SCRUM-138] an occupied setup buffer is reported against this booking", () => {
    // pm starts at 12:00; 120 minutes of setup reaches into the am slot.
    const result = checkBooking(
      booking({ slots: [{ slot: "pm", status: "pending" }] }),
      venue({ setup_minutes: 120 }),
      buildDay({ bookings: [confirmedByOtherEvent("am")] }),
      [],
      EVENT_ID,
    );

    expect(result.conflicts.passed).toBe(false);
    expect(result.conflicts.reasons).toEqual([
      "AM is already taken by another event (Another event), needed for the event's setup time.",
    ]);
  });

  test("[SCRUM-138] an occupied turnaround buffer is reported against this booking", () => {
    // am ends at 12:00; 30 minutes of turnaround reaches into the pm slot.
    const result = checkBooking(
      booking(),
      venue({ turnaround_minutes: 30 }),
      buildDay({ bookings: [confirmedByOtherEvent("pm")] }),
      [],
      EVENT_ID,
    );

    expect(result.conflicts.reasons).toEqual([
      "PM is already taken by another event (Another event), needed for the event's turnaround time.",
    ]);
  });

  test("[SCRUM-138] the booking's own rows are neither a conflict nor a duplicate", () => {
    const ownRows = [
      {
        booking_date: DATE,
        slot: "am",
        status: "confirmed",
        event_name: "This event",
        request: { id: BOOKING_ID, event_id: EVENT_ID },
      },
    ];

    // The caller excludes own rows from the calendar; the duplicate rule must
    // ignore them separately.
    const result = checkBooking(booking(), venue(), buildDay(), ownRows, EVENT_ID);

    expect(result.conflicts.passed).toBe(true);
    expect(result.overall).toBe("passed");
  });

  test("[SCRUM-138] the same event's other request on the slot is a duplicate conflict", () => {
    const rows = [
      {
        booking_date: DATE,
        slot: "am",
        status: "pending",
        event_name: "This event",
        request: { id: OTHER_REQUEST_ID, event_id: EVENT_ID },
      },
    ];

    const result = checkBooking(booking(), venue(), buildDay(), rows, EVENT_ID);

    expect(result.conflicts.passed).toBe(false);
    expect(result.conflicts.reasons).toEqual([
      "AM is already requested for this event at this venue.",
    ]);
  });

  test("[SCRUM-138] an inactive venue fails availability for this booking alone", () => {
    const result = checkBooking(
      booking(),
      venue({ is_active: false }),
      buildDay(),
      [],
      EVENT_ID,
    );

    expect(result.overall).toBe("failed");
    expect(result.availability.reasons).toEqual([
      "This venue is no longer active for bookings.",
    ]);
  });

  test("[SCRUM-138] a mixed booking checks only the slots that are still live", () => {
    const result = checkBooking(
      booking({
        slots: [
          { slot: "am", status: "cancelled" },
          { slot: "pm", status: "confirmed" },
        ],
      }),
      venue(),
      buildDay({ bookings: [confirmedByOtherEvent("am")] }),
      [],
      EVENT_ID,
    );

    expect(result.slots).toEqual(["pm"]);
    expect(result.conflicts.passed).toBe(true);
    expect(result.overall).toBe("passed");
  });
});

describe("notCheckedResult", () => {
  test("[SCRUM-138] a booking with no live slots reports not checked with its status", () => {
    const result = checkBooking(
      booking({
        slots: [
          { slot: "am", status: "rejected" },
          { slot: "pm", status: "rejected" },
        ],
      }),
      venue(),
      buildDay(),
      [],
      EVENT_ID,
    );

    expect(result.overall).toBe("not_checked");
    expect(result.note).toBe(
      "This booking is rejected and is no longer live, so it was not checked.",
    );
    expect(result.suitability).toEqual({ passed: null, reasons: [] });
    expect(result.availability).toEqual({ passed: null, reasons: [] });
    expect(result.conflicts).toEqual({ passed: null, reasons: [] });
  });

  test("[SCRUM-138] a booking whose slot rows could not be read is reported without slots", () => {
    const result = notCheckedResult(
      booking({ slots: null }),
      "This booking could not be checked right now.",
    );

    expect(result.overall).toBe("not_checked");
    expect(result.slots).toEqual([]);
    expect(result.status).toBe("unknown");
  });

  test("[SCRUM-138] an unloadable venue keeps the booking and its venue name in the report", () => {
    const result = notCheckedResult(
      booking({ slots: [{ slot: "am", status: "pending" }] }),
      "This venue could not be checked right now.",
    );

    expect(result.overall).toBe("not_checked");
    expect(result.venue_name).toBe("Venue not recorded");
    expect(result.slots).toEqual(["am"]);
    expect(result.note).toBe("This venue could not be checked right now.");
  });
});
