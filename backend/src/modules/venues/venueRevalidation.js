// SCRUM-38: re-validate an event's venue bookings after the event's own details
// change. The checks are SCRUM-138's, unchanged, plus eventFitReasons for the
// event's new dates and attendance. A booking that fails is marked affected
// through SCRUM-145's mark_venue_booking_affected, so its card shows the reason
// and offers the existing replacement search; a booking that passes is not
// written to at all.
//
// Deliberately absent: equipment (released as before), clearing an affected
// flag when a later check passes (no unmark function exists), and choosing when
// to run - the caller that applies an event change decides that (SCRUM-165).

const { isValidDateString, buildAvailabilityCalendar } = require("./venues.availability");
const { checkBooking, notCheckedResult, liveSlotNames, eventFitReasons } = require("./venueBookingChecks");

// One booking's SCRUM-138 verdict. Moved here from venues.controller.js so the
// booking-checks endpoint and the re-validation share one implementation.
function createBookingChecker({ getVenueById, listSlotRowsForDate, listUnavailabilityInRange }) {
  return async function checkOneBooking(request, scope) {
    const venueId = request.venue?.id;
    if (!venueId) {
      return notCheckedResult(request, "This booking has no venue recorded, so it could not be checked.");
    }
    if (!isValidDateString(request.booking_date)) {
      return notCheckedResult(request, "This booking has no date recorded, so it could not be checked.");
    }

    const venue = await getVenueById(venueId);
    if (!venue) {
      return notCheckedResult(request, "This venue no longer exists, so the booking could not be checked.");
    }

    const [slotRows, unavailability] = await Promise.all([
      listSlotRowsForDate(venue.id, request.booking_date),
      listUnavailabilityInRange(venue.id, request.booking_date, request.booking_date),
    ]);

    const maskNames = scope?.allVenues !== true;
    const [calendarDay] = buildAvailabilityCalendar({
      operatingHours: venue.operating_hours,
      bookings: slotRows
        .filter((row) => row.request?.event_id !== request.event?.id)
        .map((row) => (maskNames ? { ...row, event_name: "Reserved event" } : row)),
      unavailability,
      from: request.booking_date,
      to: request.booking_date,
    });

    return checkBooking(request, venue, calendarDay, slotRows, request.event?.id);
  };
}

function failedReasons(result) {
  return ["suitability", "availability", "conflicts"].flatMap((check) => result[check].passed === false ? result[check].reasons : []);
}

function createVenueRevalidation({ getEventForCheckReport, listBookingRequests, markVenueBookingAffected, checkOneBooking, logger = console }) {
  async function revalidateBookingsForEvent(eventId) {
    // Internal call: no caller's scope applies, the same as the booking list below.
    const event = await getEventForCheckReport(eventId, { allVenues: true });
    if (!event) return { checked: 0, flagged: [] };

    // Already-affected bookings are waiting on the coordinator's replacement or
    // release; re-marking them would only overwrite the reason they were given.
    const live = (await listBookingRequests({ allVenues: true }, eventId))
      .filter((request) => !request.is_affected && liveSlotNames(request).length > 0);
    if (live.length === 0) return { checked: 0, flagged: [] };

    // The coordinator owns these bookings and reads the reasons, so the checks
    // run in their scope: other events stay masked as "Reserved event"
    // (SCRUM-138), and the mark passes mark_venue_booking_affected's own
    // coordinator check.
    const coordinatorId = live[0].event?.coordinator_id;
    const scope = { coordinatorId };
    const capacityByDate = new Map();
    for (const request of live) {
      capacityByDate.set(request.booking_date, (capacityByDate.get(request.booking_date) ?? 0) + (request.venue?.capacity ?? 0));
    }

    const flagged = [];
    for (const request of live) {
      // Each booking on its own: one venue that cannot be checked or marked
      // must not stop the others (SCRUM-138's rule).
      try {
        const result = await checkOneBooking(request, scope);
        if (result.overall === "not_checked") continue;
        const reasons = [...failedReasons(result), ...eventFitReasons(request, event, capacityByDate.get(request.booking_date))];
        if (reasons.length === 0) continue;
        const reason = `After the event changed: ${reasons.join(" ")}`;
        await markVenueBookingAffected(request.id, coordinatorId, reason);
        flagged.push({ booking_id: request.id, venue_name: result.venue_name, reason });
      } catch (error) {
        logger.error(`SCRUM-38 re-validation of booking ${request.id} failed:`, error.message);
      }
    }
    return { checked: live.length, flagged };
  }

  return { revalidateBookingsForEvent };
}

module.exports = { createBookingChecker, createVenueRevalidation };
