// SCRUM-21: rules for submitting a venue booking request.
// Pure functions only, no express and no supabase imports, same reasoning as
// venues.validation.js and venues.availability.js.
//
// Checks run in layers, from cheapest to most expensive:
//   1. validateBookingRequestShape  the body alone, before any database call
//   2. validateAgainstVenue         SCRUM-87, the requirements fit this venue
//   3. validateAgainstEvent         SCRUM-86, the date fits the event timing
//   4. findSlotProblems             the slots are actually requestable that day

const { SLOTS, isValidDateString } = require("./venues.availability");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ADDITIONAL_REQUIREMENTS_MAX = 2000;

// All current venues are in Singapore and Kuala Lumpur, both UTC+8. Event times
// are stored as timestamps, so turning one into "which day is this" needs a
// timezone. Without one, an event starting at 07:00 in Singapore is still the
// previous day in UTC.
const VENUE_TIME_ZONE = "Asia/Singapore";

// Only the fields a requester may send. Anything else is rejected rather than
// silently ignored, same as validateVenueUpdate.
const ALLOWED_FIELDS = [
  "event_id",
  "booking_date",
  "slots",
  "expected_attendees",
  "room_layout",
  "required_facilities",
  "accessibility_requirements",
  "additional_requirements",
];

// Slots a request can be made on. "pending" is included on purpose: SCRUM-94
// says only a confirmed booking takes the slot, so two events may both ask for
// it and Venue Staff choose.
const REQUESTABLE_STATUSES = ["available", "pending"];

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

// "YYYY-MM-DD" for the calendar day this instant falls on in the given zone.
// en-CA is used only because it formats dates in that order.
function localDateInTimeZone(instant, timeZone) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validateBookingRequestShape(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { errors: ["Request body must be an object"], value: null };
  }

  const errors = [];

  const unknown = Object.keys(payload).filter(
    (key) => !ALLOWED_FIELDS.includes(key)
  );
  if (unknown.length > 0) {
    errors.push(`Unknown fields: ${unknown.join(", ")}`);
  }

  // SCRUM-85
  if (typeof payload.event_id !== "string" || !UUID_PATTERN.test(payload.event_id)) {
    errors.push("event_id must be a valid event id");
  }

  // SCRUM-86
  if (!isValidDateString(payload.booking_date)) {
    errors.push("booking_date must be a date in YYYY-MM-DD format");
  }

  if (!isStringArray(payload.slots) || payload.slots.length === 0) {
    errors.push("slots must be a non-empty list of am, pm, night");
  } else {
    const invalid = payload.slots.filter((slot) => !SLOTS.includes(slot));
    if (invalid.length > 0) {
      errors.push(`slots has unknown values: ${invalid.join(", ")}`);
    }
    if (hasDuplicates(payload.slots)) {
      errors.push("slots must not repeat");
    }
  }

  // SCRUM-87
  if (
    !Number.isInteger(payload.expected_attendees) ||
    payload.expected_attendees <= 0
  ) {
    errors.push("expected_attendees must be a whole number greater than zero");
  }

  if (typeof payload.room_layout !== "string" || payload.room_layout.trim() === "") {
    errors.push("room_layout is required");
  }

  for (const field of ["required_facilities", "accessibility_requirements"]) {
    if (payload[field] === undefined) continue;
    if (!isStringArray(payload[field])) {
      errors.push(`${field} must be a list of strings`);
    } else if (hasDuplicates(payload[field])) {
      errors.push(`${field} must not repeat`);
    }
  }

  const additional = payload.additional_requirements;
  if (additional !== undefined && additional !== null) {
    if (typeof additional !== "string") {
      errors.push("additional_requirements must be text or null");
    } else if (additional.length > ADDITIONAL_REQUIREMENTS_MAX) {
      errors.push(
        `additional_requirements must be ${ADDITIONAL_REQUIREMENTS_MAX} characters or fewer`
      );
    }
  }

  if (errors.length > 0) return { errors, value: null };

  const trimmedAdditional =
    typeof additional === "string" ? additional.trim() : "";

  // Slots are stored in am, pm, night order however the client sent them, so
  // the same request always reads the same way on review.
  return {
    errors: [],
    value: {
      event_id: payload.event_id,
      booking_date: payload.booking_date,
      slots: SLOTS.filter((slot) => payload.slots.includes(slot)),
      expected_attendees: payload.expected_attendees,
      room_layout: payload.room_layout.trim(),
      required_facilities: payload.required_facilities || [],
      accessibility_requirements: payload.accessibility_requirements || [],
      additional_requirements: trimmedAdditional === "" ? null : trimmedAdditional,
    },
  };
}

// SCRUM-87: requirements are only "relevant" if this venue can meet them. The
// options come from the catalogue data shown in SCRUM-15.
function validateAgainstVenue(value, venue) {
  const errors = [];

  if (value.expected_attendees > venue.capacity) {
    errors.push(
      `expected_attendees (${value.expected_attendees}) exceeds the venue capacity of ${venue.capacity}`
    );
  }

  const layouts = venue.room_layouts || [];
  if (!layouts.includes(value.room_layout)) {
    errors.push(
      `room_layout "${value.room_layout}" is not offered here. Options: ${layouts.join(", ") || "none recorded"}`
    );
  }

  const facilities = venue.facilities || [];
  const missingFacilities = value.required_facilities.filter(
    (item) => !facilities.includes(item)
  );
  if (missingFacilities.length > 0) {
    errors.push(
      `required_facilities not available at this venue: ${missingFacilities.join(", ")}`
    );
  }

  const accessibility = venue.accessibility_features || [];
  const missingAccessibility = value.accessibility_requirements.filter(
    (item) => !accessibility.includes(item)
  );
  if (missingAccessibility.length > 0) {
    errors.push(
      `accessibility_requirements not available at this venue: ${missingAccessibility.join(", ")}`
    );
  }

  return errors;
}

// SCRUM-86: the requested day must be one the event actually runs on, and must
// not already be over. `today` is passed in rather than read here, so the
// function stays pure and a test can pin the date.
function validateAgainstEvent(value, event, today) {
  const errors = [];

  // A draft is still being written by the organiser. Its timing is not final,
  // so there is nothing stable for Venue Staff to assess yet.
  if (event.status === "DRAFT") {
    errors.push("The event is still a draft. Submit the event before requesting a venue");
    return errors;
  }

  if (!event.start_time || !event.end_time) {
    errors.push("The event has no start and end time yet, so there is no timing to assess");
    return errors;
  }

  const eventStartDate = localDateInTimeZone(event.start_time, VENUE_TIME_ZONE);
  const eventEndDate = localDateInTimeZone(event.end_time, VENUE_TIME_ZONE);

  if (value.booking_date < today) {
    errors.push(`booking_date ${value.booking_date} is in the past`);
  }

  // "YYYY-MM-DD" strings compare correctly as plain strings
  if (value.booking_date < eventStartDate || value.booking_date > eventEndDate) {
    errors.push(
      eventStartDate === eventEndDate
        ? `booking_date ${value.booking_date} is not the event date (${eventStartDate})`
        : `booking_date ${value.booking_date} is outside the event dates (${eventStartDate} to ${eventEndDate})`
    );
  }

  return errors;
}

// Checks the requested slots against that day's calendar, built by the same
// buildAvailabilityCalendar the SCRUM-17 calendar uses, so the two can never
// disagree about whether a slot is free.
//
//   conflicts   slot is closed, recorded unavailable, or already confirmed
//   duplicates  this same event already has a live request on this slot
function findSlotProblems(value, calendarDay, existingSlotRows, eventId) {
  const conflicts = [];
  const duplicates = [];

  for (const slot of value.slots) {
    const cell = calendarDay.slots[slot];
    if (!REQUESTABLE_STATUSES.includes(cell.status)) {
      const reason =
        cell.status === "closed"
          ? "outside operating hours"
          : `${cell.status}: ${cell.label}`;
      conflicts.push(`${slot} is not requestable (${reason})`);
    }

    const alreadyRequested = existingSlotRows.some(
      (row) => row.slot === slot && row.request && row.request.event_id === eventId
    );
    if (alreadyRequested) {
      duplicates.push(`${slot} is already requested for this event`);
    }
  }

  return { conflicts, duplicates };
}

// A request spans one or more slot rows, and Venue Staff will eventually decide
// on them. Until then they share a status. "mixed" exists so a partial decision
// later is shown honestly instead of being flattened to one word.
function deriveRequestStatus(slotRows) {
  const statuses = [...new Set((slotRows || []).map((row) => row.status))];
  if (statuses.length === 0) return "unknown";
  if (statuses.length === 1) return statuses[0];
  return "mixed";
}

module.exports = {
  VENUE_TIME_ZONE,
  ALLOWED_FIELDS,
  localDateInTimeZone,
  validateBookingRequestShape,
  validateAgainstVenue,
  validateAgainstEvent,
  findSlotProblems,
  deriveRequestStatus,
};
