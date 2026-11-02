// SCRUM-170: when a postponement gives a new date, each of the event's live
// bookings is checked on that date before anything is written. A booking keeps
// its slots and moves by the same number of days as the event, counted in the
// venues' time zone. The checks are SCRUM-138's (suitability, availability and
// clashes), plus the moved date having to fall inside the new event dates.
// Read-only: postpone_event moves the bookings that pass and releases the rest.

const { buildAvailabilityCalendar } = require("./venues.availability");
const { checkBooking, liveSlotNames } = require("./venueBookingChecks");
const { localDateInTimeZone, VENUE_TIME_ZONE } = require("./venues.bookingRequests.validation");

const DAY_MS = 24 * 60 * 60 * 1000;

const localDate = (instant) => localDateInTimeZone(instant, VENUE_TIME_ZONE);

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS);
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function createRescheduleCheck({ listBookingRequests, getVenueById, listSlotRowsForDate, listUnavailabilityInRange }) {
  async function checkOne(request, event, newDate, firstDay, lastDay) {
    const outcome = (slots, reasons) => ({
      booking_id: request.id,
      venue_name: request.venue?.name ?? "Venue not recorded",
      booking_date: request.booking_date,
      new_booking_date: newDate,
      slots,
      passed: reasons.length === 0,
      reasons,
    });
    const venue = request.venue?.id && await getVenueById(request.venue.id);
    if (!venue) return outcome(liveSlotNames(request), ["This venue no longer exists."]);

    const [slotRows, unavailability] = await Promise.all([
      listSlotRowsForDate(venue.id, newDate),
      listUnavailabilityInRange(venue.id, newDate, newDate),
    ]);
    // The coordinator reads this, so other events stay masked (SCRUM-138), and
    // this event's own rows are not its own obstacle.
    const [calendarDay] = buildAvailabilityCalendar({
      operatingHours: venue.operating_hours,
      bookings: slotRows
        .filter((row) => row.request?.event_id !== event.id)
        .map((row) => ({ ...row, event_name: "Reserved event" })),
      unavailability,
      from: newDate,
      to: newDate,
    });
    const result = checkBooking({ ...request, booking_date: newDate }, venue, calendarDay, slotRows, event.id);
    const reasons = ["suitability", "availability", "conflicts"].flatMap((check) => result[check].reasons);
    if (newDate < firstDay || newDate > lastDay) reasons.push(`${newDate} is outside the new event dates.`);
    return outcome(result.slots, reasons);
  }

  // Throws when storage cannot be read: the caller then postpones nothing, so a
  // booking is never released only because it could not be checked.
  return async function checkBookingsForNewDates(event, newStart, newEnd) {
    const days = daysBetween(localDate(event.start_time), localDate(newStart));
    const firstDay = localDate(newStart);
    const lastDay = localDate(newEnd);
    const live = (await listBookingRequests({ allVenues: true }, event.id))
      .filter((request) => liveSlotNames(request).length > 0);
    const results = [];
    for (const request of live) {
      results.push(await checkOne(request, event, shiftDate(request.booking_date, days), firstDay, lastDay));
    }
    return results;
  };
}

module.exports = { createRescheduleCheck };
