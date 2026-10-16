// SCRUM-138: suitability, availability and conflict checks for one event's
// venue bookings, each booking assessed on its own. Pure functions: no express
// and no supabase imports, same reasoning as venues.availability.js.
//
// The checks reuse the submission flow's own rules so a booking cannot pass
// here and then be refused at submission (or the reverse) for a reason this
// module never mentions:
//   suitability  validateAgainstVenue (SCRUM-87): the booking's requirements
//                against the venue's current catalogue
//   availability the same calendar cells findSlotProblems reads, built by
//                buildAvailabilityCalendar (SCRUM-17/93/94)
//   conflicts    a slot another event holds, or one already requested for
//                this event at this venue
// findSlotProblems itself is not called: it answers with display strings for
// the submission 409, while this story needs each outcome classified as
// availability or conflict. Both read the same REQUESTABLE_STATUSES rule and
// the same calendar output, so they cannot disagree about what is free.

const { SLOTS, committedSlots } = require("./venues.availability");
const {
  validateAgainstVenue,
  deriveRequestStatus,
} = require("./venues.bookingRequests.validation");

// A booking is live while any of its slots is still pending or confirmed.
// Rejected and cancelled slots carry no arrangement left to check.
const LIVE_SLOT_STATUSES = Object.freeze(["pending", "confirmed"]);

const SLOT_LABELS = Object.freeze({ am: "AM", pm: "PM", night: "Night" });

function liveSlotNames(booking) {
  return SLOTS.filter((slot) =>
    (booking.slots || []).some(
      (row) => row.slot === slot && LIVE_SLOT_STATUSES.includes(row.status),
    )
  );
}

function bookingShape(booking) {
  return {
    booking_id: booking.id,
    venue_id: booking.venue?.id ?? null,
    venue_name: booking.venue?.name ?? "Venue not recorded",
    booking_date: booking.booking_date ?? null,
    slots: SLOTS.filter((slot) =>
      (booking.slots || []).some((row) => row.slot === slot),
    ),
    status: deriveRequestStatus(booking.slots),
  };
}

// Bookings with nothing live, and bookings whose venue could not be loaded,
// are reported with their reason instead of a verdict. They stay in the
// report so the coordinator sees every booking of the event (AC2).
function notCheckedResult(booking, note) {
  return {
    ...bookingShape(booking),
    overall: "not_checked",
    note,
    suitability: { passed: null, reasons: [] },
    availability: { passed: null, reasons: [] },
    conflicts: { passed: null, reasons: [] },
  };
}

// The three checks for one live booking. `calendarDay` is that booking date's
// row from buildAvailabilityCalendar, built by the caller with this event's
// own rows excluded: a slot the event already holds is not its own obstacle.
// `slotRows` are that day's live rows, used only to spot the same event
// requesting the same slot twice; the booking's own rows are not duplicates
// of themselves.
function checkBooking(booking, venue, calendarDay, slotRows, eventId) {
  const checkedSlots = liveSlotNames(booking);
  if (checkedSlots.length === 0) {
    return notCheckedResult(
      booking,
      `This booking is ${deriveRequestStatus(booking.slots)} and is no longer live, so it was not checked.`,
    );
  }

  // 1. Suitability: SCRUM-87's rule, unchanged.
  const suitabilityReasons = validateAgainstVenue(booking, venue);

  // 2 and 3. One pass over the calendar, recording each blocked slot under
  // the check it belongs to: the venue's own hours or a recorded
  // unavailability are availability, another event's booking is a conflict.
  const availabilityReasons = [];
  const conflictReasons = [];

  const record = (slot, purpose) => {
    const cell = calendarDay.slots[slot];
    const label = SLOT_LABELS[slot];
    if (cell.status === "closed") {
      availabilityReasons.push(`${label} is outside the venue's operating hours${purpose}.`);
    } else if (cell.status === "unavailable") {
      availabilityReasons.push(`${label} is recorded unavailable (${cell.label})${purpose}.`);
    } else if (cell.status === "booked") {
      conflictReasons.push(`${label} is already taken by another event (${cell.label})${purpose}.`);
    }
  };

  for (const slot of checkedSlots) record(slot, "");

  // SCRUM-134's committed-period rule: setup and turnaround extend the
  // booking into slots it does not request, and those must be free too.
  const buffers = committedSlots(
    checkedSlots,
    venue.setup_minutes,
    venue.turnaround_minutes,
  ).filter((slot) => !checkedSlots.includes(slot));
  const firstRequested = Math.min(...checkedSlots.map((slot) => SLOTS.indexOf(slot)));
  for (const slot of buffers) {
    const purpose =
      SLOTS.indexOf(slot) < firstRequested
        ? ", needed for the event's setup time"
        : ", needed for the event's turnaround time";
    record(slot, purpose);
  }

  for (const slot of checkedSlots) {
    const duplicated = (slotRows || []).some(
      (row) =>
        row.slot === slot &&
        row.request &&
        row.request.event_id === eventId &&
        row.request.id !== booking.id,
    );
    if (duplicated) {
      conflictReasons.push(`${SLOT_LABELS[slot]} is already requested for this event at this venue.`);
    }
  }

  if (venue.is_active === false) {
    availabilityReasons.push("This venue is no longer active for bookings.");
  }

  const suitability = {
    passed: suitabilityReasons.length === 0,
    reasons: suitabilityReasons,
  };
  const availability = {
    passed: availabilityReasons.length === 0,
    reasons: availabilityReasons,
  };
  const conflicts = {
    passed: conflictReasons.length === 0,
    reasons: conflictReasons,
  };

  return {
    ...bookingShape(booking),
    venue_id: venue.id,
    venue_name: venue.name,
    // The slots actually checked, not every row: a mixed booking's cancelled
    // periods were decided already and are not re-checked.
    slots: checkedSlots,
    overall:
      suitability.passed && availability.passed && conflicts.passed
        ? "passed"
        : "failed",
    note: null,
    suitability,
    availability,
    conflicts,
  };
}

module.exports = {
  LIVE_SLOT_STATUSES,
  liveSlotNames,
  notCheckedResult,
  checkBooking,
};
