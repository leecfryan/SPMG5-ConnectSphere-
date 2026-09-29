const { validateVenueUpdate } = require("./venues.validation");
const {
  VENUE_TIME_ZONE,
  localDateInTimeZone,
  validateBookingRequestShape,
  validateAgainstVenue,
  validateAgainstEvent,
  findSlotProblems,
  findConfirmedSlotConflicts,
  deriveRequestStatus,
  validateDecision,
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

function createVenuesController(service) {
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
    decideBookingRequest,
  } = service;

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
  // Router enforces venues.read; creating bookings separately requires bookings.request.
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
      const events = await listBookableEvents(req.user.id);
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
        getEventById(value.event_id, req.user.id),
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
      // on venue_bookings stops the slot ever being confirmed
      // twice.
      const requestId = await submitBookingRequest(id, event.name, value, req.user.id);

      // SCRUM-88: return the request exactly as Venue Staff will see it
      const created = await getBookingRequestById(requestId, req.bookingScope || { coordinatorId: req.user.id });
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

      const requests = (await listBookingRequests(req.bookingScope)).map(withStatus);
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

      const request = await getBookingRequestById(requestId, req.bookingScope || { coordinatorId: req.user.id });
      if (!request) {
        return res.status(404).json({ error: "Booking request not found" });
      }

      res.status(200).json({ data: withStatus(request) });
    } catch (err) {
      next(err);
    }
  }

  // SCRUM-20: what the reviewer is told when the database refuses an approval.
  // Used only when the specific clash cannot be established.
  const CONFLICT_FALLBACK =
    "One of these slots is already confirmed for a different request. Refresh the list to see current availability.";

  // SCRUM-20: name the slots that clash and what holds them. Read after the
  // refusal rather than before it, so this reports what is actually committed
  // now instead of what was true a moment earlier.
  async function describeSlotConflicts(requestId, scope) {
    try {
      const request = await getBookingRequestById(requestId, scope);
      if (!request || !request.venue || !request.event) return [CONFLICT_FALLBACK];

      const slotRows = await listSlotRowsForDate(
        request.venue.id,
        request.booking_date
      );
      const conflicts = findConfirmedSlotConflicts(
        (request.slots || []).map((row) => row.slot),
        slotRows,
        request.event.id
      );

      if (conflicts.length === 0) return [CONFLICT_FALLBACK];

      return conflicts.map(
        (conflict) =>
          `${conflict.slot} on ${request.booking_date} is already confirmed for "${conflict.event_name}"`
      );
    } catch {
      // Explaining the clash must never turn a 409 into a 500. The refusal
      // itself already stands, so a failure here falls back to the plain
      // message rather than losing the answer.
      return [CONFLICT_FALLBACK];
    }
  }

  // SCRUM-22: Venue Staff approve or reject a pending booking request.
  // The router gates this with bookings.decide, so only Venue Staff get here.
  async function patchBookingRequestDecision(req, res, next) {
    try {
      const { requestId } = req.params;

      if (!UUID_PATTERN.test(requestId)) {
        return res.status(400).json({ error: "Invalid booking request id" });
      }

      const { errors, value } = validateDecision(req.body);
      if (errors.length > 0) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      let decided;
      try {
        decided = await decideBookingRequest(
          requestId,
          value.decision,
          value.note,
          req.user.id
        );
      } catch (err) {
        // 23P01 is the confirmed-slot exclusion constraint on venue_bookings:
        // another request already holds one of these slots. That is an answer
        // for the reviewer, not a server fault, so it is a 409 (SCRUM-20).
        if (err.code !== "23P01") throw err;
        // SCRUM-20: the request stays pending and nothing is written, because
        // the database rejected the whole statement.
        return res.status(409).json({
          error: "Slot already confirmed for another booking",
          details: await describeSlotConflicts(requestId, req.bookingScope),
        });
      }

      if (!decided) {
        return res.status(404).json({ error: "Booking request not found" });
      }

      // Read back through the same scope rule the review list uses, so the
      // response is exactly what this reviewer is allowed to see.
      const request = await getBookingRequestById(requestId, req.bookingScope);
      res.status(200).json({ data: withStatus(request) });
    } catch (err) {
      next(err);
    }
  }

  return {
    getVenues,
    getVenue,
    patchVenue,
    getVenueAvailability,
    getBookableEvents,
    postBookingRequest,
    getBookingRequests,
    getBookingRequest,
    patchBookingRequestDecision,
  };

}

module.exports = createVenuesController;
