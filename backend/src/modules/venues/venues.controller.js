const {
  listVenues,
  getVenueById,
  updateVenue,
  listBookingsInRange,
  listUnavailabilityInRange,
} = require("./venues.service");
const { validateVenueUpdate } = require("./venues.validation");
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

module.exports = { getVenues, getVenue, patchVenue, getVenueAvailability };
