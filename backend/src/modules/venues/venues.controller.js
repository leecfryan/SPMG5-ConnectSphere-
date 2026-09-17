const {
  listVenues,
  getVenueById,
  updateVenue,
  listBookingsInRange,
  listUnavailabilityInRange,
  getEventById,
  listBookableEvents,
  listSlotRowsForDate,
  submitBookingRequest,
  getBookingRequestById,
  listBookingRequests,
} = require("./venues.service");
const { validateVenueUpdate } = require("./venues.validation");
const {
  VENUE_TIME_ZONE,
  localDateInTimeZone,
  validateBookingRequestShape,
  validateAgainstVenue,
  validateAgainstEvent,
  findSlotProblems,
  deriveRequestStatus,
} = require("./venues.bookingRequests.validation");
const {
  SLOTS,
  MAX_RANGE_DAYS,
  isValidDateString,
  addDays,
  daysBetween,
  buildAvailabilityCalendar,
} = require("./venues.availability");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getVenues(req, res, next) {
  try {
    const { city, minCapacity } = req.query;

    if (minCapacity !== undefined && Number.isNaN(Number(minCapacity))) {
      return res.status(400).json({ error: "minCapacity must be a number" });
    }

    const venues = await listVenues({
      city,
      minCapacity: minCapacity === undefined ? undefined : Number(minCapacity),
    });

    res.status(200).json({ data: venues });
  } catch (err) {
    next(err);
  }
}

async function getVenue(req, res, next) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid venue id" });
    }

    const venue = await getVenueById(id);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    res.status(200).json({ data: venue });
  } catch (err) {
    next(err);
  }
}

async function patchVenue(req, res, next) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid venue id" });
    }

    const { errors, value } = validateVenueUpdate(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const existing = await getVenueById(id);
    if (!existing) {
      return res.status(404).json({ error: "Venue not found" });
    }

    const venue = await updateVenue(id, value);
    res.status(200).json({ data: venue });
  } catch (err) {
    next(err);
  }
}

// SCRUM-17: view venue availability calendar.
// Read only, so no requireRole guard. Creating bookings is SCRUM-21.
const DEFAULT_RANGE_DAYS = 14;

function validationFailed(res, detail) {
  return res.status(400).json({ error: "Validation failed", details: [detail] });
}

async function getVenueAvailability(req, res, next) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid venue id" });
    }

    // "Today" is taken in UTC so it lines up with the plain date columns in
    // Postgres. See the note in venues.availability.js.
    const today = new Date().toISOString().slice(0, 10);

    const from = req.query.from === undefined ? today : req.query.from;
    if (!isValidDateString(from)) {
      return validationFailed(res, "from must be a date in YYYY-MM-DD format");
    }

    // The default window is a fortnight from the start date. Resolved only
    // after `from` is known good, otherwise the date maths runs on garbage.
    const to =
      req.query.to === undefined
        ? addDays(from, DEFAULT_RANGE_DAYS - 1)
        : req.query.to;
    if (!isValidDateString(to)) {
      return validationFailed(res, "to must be a date in YYYY-MM-DD format");
    }

    if (daysBetween(from, to) < 0) {
      return validationFailed(res, "to must not be before from");
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      return validationFailed(
        res,
        `Date range must be ${MAX_RANGE_DAYS} days or fewer`
      );
    }

    const venue = await getVenueById(id);
    if (!venue) return res.status(404).json({ error: "Venue not found" });

    const [bookings, unavailability] = await Promise.all([
      listBookingsInRange(id, from, to),
      listUnavailabilityInRange(id, from, to),
    ]);

    // SCRUM-92, 93, 94, 95 are all decided inside this pure function
    const days = buildAvailabilityCalendar({
      operatingHours: venue.operating_hours,
      bookings,
      unavailability,
      from,
      to,
    });

    res.status(200).json({
      data: {
        venue_id: venue.id,
        venue_name: venue.name,
        from,
        to,
        slots: SLOTS,
        days,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// SCRUM-21: submit venue booking request
// ---------------------------------------------------------------------------

// Adds the request status, which is derived from its slot rows rather than
// stored twice (see deriveRequestStatus).
function withStatus(request) {
  return { ...request, status: deriveRequestStatus(request.slots) };
}

// SCRUM-85: the events a coordinator may attach a venue request to.
// Lives under /api/venues rather than /api/events so this branch does not
// collide with the events router on feature/eventRequest.
async function getBookableEvents(req, res, next) {
  try {
    const events = await listBookableEvents();
    res.status(200).json({ data: events });
  } catch (err) {
    next(err);
  }
}

async function postBookingRequest(req, res, next) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid venue id" });
    }

    // 1. The body on its own, before spending any database calls on it
    const { errors, value } = validateBookingRequestShape(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    // SCRUM-85: both ends of the association must exist
    const [venue, event] = await Promise.all([
      getVenueById(id),
      getEventById(value.event_id),
    ]);
    if (!venue || !venue.is_active) {
      return res.status(404).json({ error: "Venue not found" });
    }
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // 2 and 3. SCRUM-87 requirements fit the venue, SCRUM-86 date fits the event.
    // Reported together so the requester fixes everything in one go.
    const today = localDateInTimeZone(new Date(), VENUE_TIME_ZONE);
    const contextErrors = [
      ...validateAgainstVenue(value, venue),
      ...validateAgainstEvent(value, event, today),
    ];
    if (contextErrors.length > 0) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: contextErrors });
    }

    // 4. The slots against that day's calendar. 409 rather than 400: the
    // request is well formed, it just clashes with what is already booked.
    const [slotRows, unavailability] = await Promise.all([
      listSlotRowsForDate(id, value.booking_date),
      listUnavailabilityInRange(id, value.booking_date, value.booking_date),
    ]);
    const [calendarDay] = buildAvailabilityCalendar({
      operatingHours: venue.operating_hours,
      bookings: slotRows,
      unavailability,
      from: value.booking_date,
      to: value.booking_date,
    });

    const { conflicts, duplicates } = findSlotProblems(
      value,
      calendarDay,
      slotRows,
      value.event_id
    );
    if (conflicts.length > 0 || duplicates.length > 0) {
      return res.status(409).json({
        error: "Requested slots are not available",
        details: [...conflicts, ...duplicates],
      });
    }

    // This check is for a helpful error message, not for safety. A slot could
    // still be confirmed for someone else between this line and the insert.
    // That is fine: this request is only pending, and the exclusion constraint
    // from 003_yc_create_venue_bookings.sql stops the slot ever being confirmed
    // twice.
    const requestId = await submitBookingRequest(id, event.name, value);

    // SCRUM-88: return the request exactly as Venue Staff will see it
    const created = await getBookingRequestById(requestId);
    res.status(201).json({ data: withStatus(created) });
  } catch (err) {
    next(err);
  }
}

const REQUEST_STATUS_FILTERS = ["pending", "confirmed", "rejected", "cancelled", "mixed"];

// SCRUM-88: submitted requests available to Venue Staff for review
async function getBookingRequests(req, res, next) {
  try {
    const { status } = req.query;

    if (status !== undefined && !REQUEST_STATUS_FILTERS.includes(status)) {
      return validationFailed(
        res,
        `status must be one of: ${REQUEST_STATUS_FILTERS.join(", ")}`
      );
    }

    const requests = (await listBookingRequests()).map(withStatus);
    const filtered =
      status === undefined
        ? requests
        : requests.filter((request) => request.status === status);

    res.status(200).json({ data: filtered });
  } catch (err) {
    next(err);
  }
}

async function getBookingRequest(req, res, next) {
  try {
    const { requestId } = req.params;

    if (!UUID_PATTERN.test(requestId)) {
      return res.status(400).json({ error: "Invalid booking request id" });
    }

    const request = await getBookingRequestById(requestId);
    if (!request) {
      return res.status(404).json({ error: "Booking request not found" });
    }

    res.status(200).json({ data: withStatus(request) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVenues,
  getVenue,
  patchVenue,
  getVenueAvailability,
  getBookableEvents,
  postBookingRequest,
  getBookingRequests,
  getBookingRequest,
};
