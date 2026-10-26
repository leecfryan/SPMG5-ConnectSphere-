// Lazy construction keeps sign-in available when venue storage is not configured.
const getSupabase = () => require("../../supabase");
const { eachDateInRange, committedSlots } = require("./venues.availability");
const { PLANNING_STATUSES } = require("../events/lifecycle");
const { findBufferConflicts } = require("./venues.conflicts");
const { localDateInTimeZone, VENUE_TIME_ZONE } = require("./venues.bookingRequests.validation");

// SCRUM-82, 83, 84: everything a Coordinator needs to assess a venue
const VENUE_FIELDS = [
  "id", "name", "address", "city", "country", "capacity",
  "facilities", "accessibility_features", "room_layouts",
  "operating_hours", "setup_minutes", "teardown_minutes",
  "turnaround_minutes", "notes", "is_active",
].join(", ");

// SCRUM-18: every filter here narrows the catalogue by something stored on the
// venue itself. Date and slot availability is not one of those, because it
// depends on other tables; the controller applies it afterwards.
//
// `contains` is Postgres array containment, so a venue must offer *all* the
// requested facilities or accessibility features, not merely one of them.
async function listVenues({ city, minCapacity, facilities, accessibility, roomLayout } = {}) {
  let query = getSupabase()
    .from("venues")
    .select(VENUE_FIELDS)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (city) query = query.ilike("city", city);
  if (Number.isFinite(minCapacity)) query = query.gte("capacity", minCapacity);
  if (facilities?.length) query = query.contains("facilities", facilities);
  if (accessibility?.length) query = query.contains("accessibility_features", accessibility);
  if (roomLayout) query = query.contains("room_layouts", [roomLayout]);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list venues: ${error.message}`);
  return data;
}

// SCRUM-18: one query for the whole shortlist rather than a round trip per
// venue, so adding a date filter costs two queries however many venues match.
async function listBookingsForVenuesOnDate(venueIds, date) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select("venue_id, booking_date, slot, status, event_name")
    .in("venue_id", venueIds)
    .eq("booking_date", date)
    .in("status", ["pending", "confirmed"]);

  if (error) throw new Error(`Failed to list bookings: ${error.message}`);
  return data;
}

async function listUnavailabilityForVenuesOnDate(venueIds, date) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability")
    .select("venue_id, unavailable_date, slot, reason")
    .in("venue_id", venueIds)
    .eq("unavailable_date", date);

  if (error) {
    throw new Error(`Failed to list unavailable periods: ${error.message}`);
  }
  return data;
}

async function getVenueById(id) {
  const { data, error } = await getSupabase()
    .from("venues")
    .select(VENUE_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch venue: ${error.message}`);
  return data;
}

async function updateVenue(id, changes) {
  const { data, error } = await getSupabase()
    .from("venues")
    .update(changes)
    .eq("id", id)
    .select(VENUE_FIELDS)
    .maybeSingle();

  if (error) throw new Error(`Failed to update venue: ${error.message}`);
  return data;
}

// SCRUM-17 / SCRUM-92: the bookings the calendar draws. Rejected and cancelled
// bookings never reach the calendar, so they are filtered out here rather than
// in the view.
async function listBookingsInRange(venueId, from, to) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select("booking_date, slot, status, event_name")
    .eq("venue_id", venueId)
    .gte("booking_date", from)
    .lte("booking_date", to)
    .in("status", ["pending", "confirmed"]);

  if (error) throw new Error(`Failed to list bookings: ${error.message}`);
  return data;
}

// SCRUM-93: per-slot rows from the seed table. SCRUM-133: period records from the
// new table, expanded into the same row shape so buildAvailabilityCalendar reads both.
async function listUnavailabilityInRange(venueId, from, to) {
  const supabase = getSupabase();
  const [legacyResult, periodsResult] = await Promise.all([
    supabase
      .from("venue_unavailability")
      .select("unavailable_date, slot, reason")
      .eq("venue_id", venueId)
      .gte("unavailable_date", from)
      .lte("unavailable_date", to),
    supabase
      .from("venue_unavailability_periods")
      .select("start_date, end_date, slots, reason")
      .eq("venue_id", venueId)
      .lte("start_date", to)
      .gte("end_date", from),
  ]);

  if (legacyResult.error) throw new Error(`Failed to list unavailable periods: ${legacyResult.error.message}`);
  if (periodsResult.error) throw new Error(`Failed to list unavailability periods: ${periodsResult.error.message}`);

  const expanded = periodsResult.data.flatMap((period) =>
    eachDateInRange(period.start_date, period.end_date)
      .filter((date) => date >= from && date <= to)
      .flatMap((date) => period.slots.map((slot) => ({ unavailable_date: date, slot, reason: period.reason })))
  );

  return [...legacyResult.data, ...expanded];
}

// ---------------------------------------------------------------------------
// SCRUM-21: venue booking requests
// ---------------------------------------------------------------------------

// Columns read from public.events, which the event request feature owns. Kept
// to the fields a venue request actually needs, so a change elsewhere in that
// table cannot break this one.
const EVENT_FIELDS =
  "id, name, status, start_time, end_time, expected_attendance, venue_requirements, accessibility_needs";

// SCRUM-86 / SCRUM-88: everything Venue Staff need on one screen. The venue and
// event are joined in rather than copied into the request, so review always
// shows the current event timing.
//
// Each join names its foreign key column after the "!". venue_bookings links
// to both venues and venue_booking_requests, so without the hint Supabase can
// see two possible paths between those tables and refuse to pick one.
const BOOKING_REQUEST_FIELDS = [
  "id",
  "booking_date",
  "expected_attendees",
  "room_layout",
  "required_facilities",
  "accessibility_requirements",
  "additional_requirements",
  "purpose",
  "is_affected",
  "affected_at",
  "affected_reason",
  "replaces_booking_id",
  "submitted_at",
  "decided_at",
  "decision_note",
  "venue:venues!venue_id(id, name, city, country, capacity)",
  "event:events!event_id!inner(id, name, status, start_time, end_time, coordinator_id)",
  "slots:venue_bookings!request_id(slot, status)",
].join(", ");

async function getEventById(id, coordinatorId) {
  const { data, error } = await getSupabase()
    .from("events")
    .select(EVENT_FIELDS)
    .eq("coordinator_id", coordinatorId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch event: ${error.message}`);
  return data;
}

// SCRUM-138: the event behind a check report. Coordinators see their own events
// only — the same relationship the booking list scopes by — while Venue Staff
// review bookings across all locations.
async function getEventForCheckReport(id, scope) {
  let query = getSupabase().from("events").select(EVENT_FIELDS).eq("id", id);
  if (scope?.coordinatorId) query = query.eq("coordinator_id", scope.coordinatorId);
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(`Failed to fetch event: ${error.message}`);
  return data;
}

// SCRUM-85: the events a coordinator can pick from. Only approved events may be
// booked (SCRUM-99 AC1, see validateAgainstEvent), and events that have already
async function listBookableEvents(coordinatorId) {
  if (!coordinatorId) throw new Error("coordinatorId is required");
  const { data, error } = await getSupabase()
    .from("events")
    .select(EVENT_FIELDS)
    .eq("coordinator_id", coordinatorId)
    .in("status", PLANNING_STATUSES)
    .not("start_time", "is", null)
    .gte("end_time", new Date().toISOString())
    .order("start_time", { ascending: true });
  if (error) throw new Error(`Failed to list events: ${error.message}`);
  return data;
}

// Live slot rows for one venue on one day, with the event behind each request.
// Seed bookings have no request, so `request` comes back null for those.
// SCRUM-138: the request's own id comes back too, so a check can tell this
// booking's rows apart from another request of the same event.
async function listSlotRowsForDate(venueId, bookingDate) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select(
      "booking_date, slot, status, event_name, request:venue_booking_requests!request_id(id, event_id)"
    )
    .eq("venue_id", venueId)
    .eq("booking_date", bookingDate)
    .in("status", ["pending", "confirmed"]);

  if (error) throw new Error(`Failed to list slot rows: ${error.message}`);
  return data;
}

// Calls the authenticated Postgres wrapper submit_authenticated_venue_booking_request,
// which writes the request and its slot rows in a single transaction.
async function submitBookingRequest(venueId, eventName, value, requesterId) {
  const { data, error } = await getSupabase().rpc("submit_authenticated_venue_booking_request", {
    p_requested_by: requesterId,
    p_venue_id: venueId,
    p_event_id: value.event_id,
    p_event_name: eventName,
    p_booking_date: value.booking_date,
    p_slots: value.slots,
    p_expected_attendees: value.expected_attendees,
    p_room_layout: value.room_layout,
    p_required_facilities: value.required_facilities,
    p_accessibility_requirements: value.accessibility_requirements,
    p_additional_requirements: value.additional_requirements,
    p_purpose: value.purpose || null,
    p_replaces_booking_id: value.replaces_booking_id || null,
  });

  if (error) throw new Error(`Failed to submit booking request: ${error.message}`);
  return data;
}

async function getBookingRequestById(id, scope) {
  let query = getSupabase()
    .from("venue_booking_requests")
    .select(BOOKING_REQUEST_FIELDS)
    .eq("id", id);
  query = applyBookingScope(query, scope);
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(`Failed to fetch booking request: ${error.message}`);
  return data;
}

// SCRUM-88: capped so the review list cannot grow into an unbounded response.
// Paging can come later if a real venue ever has more than this outstanding.
const BOOKING_REQUEST_LIST_LIMIT = 200;

async function listBookingRequests(scope, eventId) {
  let query = getSupabase()
    .from("venue_booking_requests")
    .select(BOOKING_REQUEST_FIELDS)
    .order("submitted_at", { ascending: false })
    .limit(BOOKING_REQUEST_LIST_LIMIT);
  query = applyBookingScope(query, scope);
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query;

  if (error) throw new Error(`Failed to list booking requests: ${error.message}`);
  return data;
}

// This scope is built by the authenticated router, never from query/body input.
function applyBookingScope(query, scope) {
  if (scope?.allVenues === true) return query;
  if (scope?.coordinatorId) return query.eq("event.coordinator_id", scope.coordinatorId);
  throw new Error("Missing booking access scope");
}

// SCRUM-22: records the decision and applies it to every slot row in one
// transaction. Returns null when no such request exists.
//
// Approving can fail on the confirmed-slot exclusion constraint from 003 if
// another request already holds a slot. Postgres reports that as 23P01, which
// the controller turns into a 409 rather than a 500.
async function decideBookingRequest(requestId, decision, note, decidedBy) {
  const { data, error } = await getSupabase().rpc("decide_venue_booking_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_decided_by: decidedBy,
    p_note: note,
  });

  if (error) {
    const conflict = new Error(`Failed to decide booking request: ${error.message}`);
    conflict.code = error.code;
    throw conflict;
  }
  return data;
}

// SCRUM-154 AC2/AC4: changes one booking's date and non-slot details, and
// re-flags it to pending, logging the change, in one transaction. Slots are
// not a param here - out of scope by decision; a date change carries the
// booking's existing slots over to the new date unchanged (the SQL function
// reads them itself, the caller never supplies them). Unlike decideBookingRequest
// this throws rather than returning null on a missing or non-live request,
// because the controller has to tell those two cases apart (404 vs 409) and a
// bare null cannot carry which one happened - see change_venue_booking_request's
// REQUEST_NOT_FOUND (P0002) and NOT_LIVE (P0003) errcodes.
async function changeBookingRequest(requestId, userId, value) {
  const { data, error } = await getSupabase().rpc("change_venue_booking_request", {
    p_request_id: requestId,
    p_user_id: userId,
    p_booking_date: value.booking_date,
    p_expected_attendees: value.expected_attendees,
    p_room_layout: value.room_layout,
    p_required_facilities: value.required_facilities,
    p_accessibility_requirements: value.accessibility_requirements,
    p_additional_requirements: value.additional_requirements,
  });

  if (error) {
    const mapped = new Error(`Failed to change booking request: ${error.message}`);
    mapped.code = error.code;
    throw mapped;
  }
  return data;
}

// SCRUM-154 AC1/AC3/AC4: cancels one booking's live slots and logs it, without
// touching the event's other venue bookings. Same error-code shape as
// changeBookingRequest above.
async function cancelBookingRequest(requestId, userId) {
  const { data, error } = await getSupabase().rpc("cancel_venue_booking_request", {
    p_request_id: requestId,
    p_user_id: userId,
  });

  if (error) {
    const mapped = new Error(`Failed to cancel booking request: ${error.message}`);
    mapped.code = error.code;
    throw mapped;
  }
  return data;
}

// SCRUM-148 AC3: cross-lane addition, approved by the Venue owner and kept to
// this one function. Releases every pending/confirmed venue_bookings row tied
// to the cancelled event's booking request(s), across however many venues the
// event used, in one call - see cancel_venue_booking_requests_for_event (SQL
// in SCRUM-148's task note). Idempotent: an already-cancelled row is excluded,
// so re-running this for the same event is a no-op.
async function releaseBookingsForCancelledEvent(eventId) {
  const { data, error } = await getSupabase().rpc("cancel_venue_booking_requests_for_event", {
    p_event_id: eventId,
  });
  if (error) throw new Error(`Failed to release venue bookings: ${error.message}`);
  return data;
}

// SCRUM-37 reviewer feedback: a safety net for any CANCELLED or REJECTED
// event whose synchronous venue release (review.service.js's
// releaseArrangements, or cancel()'s own call) didn't run or didn't
// complete. Mirrors equipment's releaseReservationsForTerminalEvents
// (equipment.controller.js) - both statuses are terminal, so neither can
// ever legitimately hold a live booking, unlike APPROVED, which is
// deliberately left alone. Swept before every venue read.
async function releaseBookingsForTerminalEvents() {
  const { data, error } = await getSupabase().from("events").select("id").in("status", ["CANCELLED", "REJECTED"]);
  if (error) throw new Error(`Failed to list releasable events: ${error.message}`);
  for (const event of data) {
    await releaseBookingsForCancelledEvent(event.id);
  }
}
// ---------------------------------------------------------------------------
// SCRUM-146: venue holds
// ---------------------------------------------------------------------------

// SCRUM-146: rows where status='hold' and expires_at is in the future, for the
// availability calendar and booking-request conflict check.
async function listActiveHoldsInRange(venueId, from, to) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select("booking_date, slot, event_name")
    .eq("venue_id", venueId)
    .eq("status", "hold")
    .gte("booking_date", from)
    .lte("booking_date", to)
    .gt("expires_at", new Date().toISOString());

  if (error) throw new Error(`Failed to list active holds: ${error.message}`);
  return data;
}

// SCRUM-146 AC5: all hold rows including expired — for the hold history list.
async function listHolds(venueId) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select("id, booking_date, slot, event_name, requested_by, expires_at, created_at")
    .eq("venue_id", venueId)
    .eq("status", "hold")
    .order("booking_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list holds: ${error.message}`);
  return data;
}

// SCRUM-146: one row per slot, all in one insert so the hold is atomic.
// SCRUM-162: coordinator_id links the hold to the coordinator whose event it is,
// so they (and only they) can convert it later.
async function createHold(venueId, { event_name, event_id, booking_date, slots, expires_at, coordinator_id }, heldBy) {
  const rows = slots.map((slot) => ({
    venue_id: venueId,
    booking_date,
    slot,
    status: "hold",
    event_name,
    event_id: event_id || null,
    requested_by: heldBy,
    expires_at,
    coordinator_id,
  }));

  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .insert(rows)
    .select("id, booking_date, slot, event_name, requested_by, expires_at, created_at");

  if (error) throw new Error(`Failed to create hold: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// SCRUM-162: fetch specific hold rows by ID for conversion validation.
// Filters to active (expires_at > now()), status='hold', and not yet linked
// to a request so the same hold cannot be double-converted.
async function getActiveHoldsByIds(holdIds) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select("id, venue_id, booking_date, slot, event_name, event_id, expires_at, request_id, coordinator_id")
    .in("id", holdIds)
    .eq("status", "hold")
    .gt("expires_at", new Date().toISOString())
    .is("request_id", null);
  if (error) throw new Error(`Failed to fetch hold rows: ${error.message}`);
  return data;
}

// SCRUM-162: set request_id on hold rows so decide_venue_booking_request can
// cancel them atomically when the booking request is approved.
async function linkHoldsToRequest(holdIds, requestId) {
  const { error } = await getSupabase()
    .from("venue_bookings")
    .update({ request_id: requestId })
    .in("id", holdIds)
    .eq("status", "hold");
  if (error) throw new Error(`Failed to link hold rows to request: ${error.message}`);
}

// SCRUM-162: returns active unlinked holds for the venue that belong to this
// coordinator (by coordinator_id), matched to the coordinator's approved events
// by event_id. Grouped by (event_id, booking_date) so one card covers all slots.
async function listEligibleHoldsForCoordinator(venueId, coordinatorId) {
  const [events, holdRows] = await Promise.all([
    listBookableEvents(coordinatorId),
    getSupabase()
      .from("venue_bookings")
      .select("id, booking_date, slot, event_name, event_id, expires_at")
      .eq("venue_id", venueId)
      .eq("status", "hold")
      .eq("coordinator_id", coordinatorId)
      .gt("expires_at", new Date().toISOString())
      .is("request_id", null)
      .order("booking_date", { ascending: true }),
  ]);

  if (holdRows.error) throw new Error(`Failed to list holds: ${holdRows.error.message}`);

  const eventsById = new Map(events.map((e) => [e.id, e]));

  const groups = new Map();
  for (const hold of holdRows.data) {
    const event = hold.event_id ? eventsById.get(hold.event_id) : null;
    if (!event) continue;
    // SCRUM-162: only include holds whose booking_date falls within the event's
    // date range — the same check validateAgainstEvent applies on conversion.
    if (event.start_time && event.end_time) {
      const eventStartDate = localDateInTimeZone(event.start_time, VENUE_TIME_ZONE);
      const eventEndDate = localDateInTimeZone(event.end_time, VENUE_TIME_ZONE);
      if (hold.booking_date < eventStartDate || hold.booking_date > eventEndDate) continue;
    }
    const key = `${hold.event_id}|${hold.booking_date}`;
    if (!groups.has(key)) {
      groups.set(key, { event, booking_date: hold.booking_date, slots: [] });
    }
    groups.get(key).slots.push({ id: hold.id, slot: hold.slot, expires_at: hold.expires_at });
  }

  return Array.from(groups.values());
}

// SCRUM-162: events with an assigned coordinator that venue staff can select
// when placing a hold. Restricted to APPROVED/CONFIRMED so a hold can only be
// placed for an event that is eligible for booking — the conversion step would
// reject anything outside PLANNING_STATUSES anyway.
async function listEventsWithCoordinator() {
  const { data, error } = await getSupabase()
    .from("events")
    .select(EVENT_FIELDS + ", coordinator_id")
    .not("coordinator_id", "is", null)
    .in("status", PLANNING_STATUSES)
    .not("start_time", "is", null)
    .gte("end_time", new Date().toISOString())
    .order("start_time", { ascending: true });
  if (error) throw new Error(`Failed to list events: ${error.message}`);
  return data;
}

// SCRUM-133: venue unavailability periods
// ---------------------------------------------------------------------------

const PERIOD_FIELDS =
  "id, venue_id, start_date, end_date, slots, reason, created_by, created_at, updated_at";

async function createUnavailabilityPeriod(venueId, { start_date, end_date, slots, reason }, createdBy) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability_periods")
    .insert({ venue_id: venueId, start_date, end_date, slots, reason, created_by: createdBy })
    .select(PERIOD_FIELDS)
    .single();
  if (error) throw new Error(`Failed to create unavailability period: ${error.message}`);
  return data;
}

async function listUnavailabilityPeriods(venueId) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability_periods")
    .select(PERIOD_FIELDS)
    .eq("venue_id", venueId)
    .order("start_date", { ascending: true });
  if (error) throw new Error(`Failed to list unavailability periods: ${error.message}`);
  return data;
}

async function getUnavailabilityPeriodById(periodId, venueId) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability_periods")
    .select(PERIOD_FIELDS)
    .eq("id", periodId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch unavailability period: ${error.message}`);
  return data;
}

async function updateUnavailabilityPeriod(periodId, venueId, changes) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability_periods")
    .update(changes)
    .eq("id", periodId)
    .eq("venue_id", venueId)
    .select(PERIOD_FIELDS)
    .maybeSingle();
  if (error) throw new Error(`Failed to update unavailability period: ${error.message}`);
  return data;
}

async function deleteUnavailabilityPeriod(periodId, venueId) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability_periods")
    .delete()
    .eq("id", periodId)
    .eq("venue_id", venueId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Failed to delete unavailability period: ${error.message}`);
  return data;
}

// SCRUM-135: all confirmed + pending bookings at a venue from a given date
// onwards, with request_id so they can be grouped per request.
async function listFutureVenueBookings(venueId, fromDate) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select("request_id, booking_date, slot, status, event_name")
    .eq("venue_id", venueId)
    .gte("booking_date", fromDate)
    .in("status", ["confirmed", "pending"]);
  if (error) throw new Error(`Failed to list venue bookings: ${error.message}`);
  return data;
}

// SCRUM-135: clears all conflict flags for the venue's requests then writes the
// new ones. Called whenever setup_minutes or turnaround_minutes changes.
async function recheckConflictsAfterUpdate(venueId, venue) {
  const today = new Date().toISOString().slice(0, 10);
  const bookings = await listFutureVenueBookings(venueId, today);

  // SCRUM-146: active holds occupy buffer slots in the same way confirmed
  // bookings do, so include them as potential occupiers.
  const { data: holdRows, error: holdError } = await getSupabase()
    .from("venue_bookings")
    .select("booking_date, slot, event_name")
    .eq("venue_id", venueId)
    .eq("status", "hold")
    .gte("booking_date", today)
    .gt("expires_at", new Date().toISOString());
  if (holdError) throw new Error(`Failed to list active holds for conflict check: ${holdError.message}`);

  const allBookings = [
    ...bookings,
    ...holdRows.map((h) => ({ ...h, request_id: null, status: "hold" })),
  ];

  const confirmedByRequest = new Map();
  for (const b of bookings) {
    if (b.status !== "confirmed" || !b.request_id) continue;
    if (!confirmedByRequest.has(b.request_id)) {
      confirmedByRequest.set(b.request_id, {
        request_id: b.request_id,
        booking_date: b.booking_date,
        slots: [],
      });
    }
    confirmedByRequest.get(b.request_id).slots.push(b.slot);
  }

  const conflictMap = findBufferConflicts(
    [...confirmedByRequest.values()],
    allBookings,
    venue.setup_minutes,
    venue.turnaround_minutes
  );

  const supabase = getSupabase();

  // clear stale flags for this venue before writing the new set
  const { error: clearError } = await supabase
    .from("venue_booking_requests")
    .update({ conflict_flags: null })
    .eq("venue_id", venueId)
    .not("conflict_flags", "is", null);
  if (clearError) throw new Error(`Failed to clear conflict flags: ${clearError.message}`);

  for (const [requestId, conflicts] of conflictMap) {
    const { error } = await supabase
      .from("venue_booking_requests")
      .update({ conflict_flags: conflicts })
      .eq("id", requestId);
    if (error) throw new Error(`Failed to set conflict flags: ${error.message}`);
  }
}

// SCRUM-135: returns all booking requests at the venue that have an active
// conflict flag, with their slot rows and standard request fields.
async function listConflictingRequests(venueId) {
  const { data, error } = await getSupabase()
    .from("venue_booking_requests")
    .select(BOOKING_REQUEST_FIELDS + ", conflict_flags")
    .eq("venue_id", venueId)
    .not("conflict_flags", "is", null)
    .order("booking_date", { ascending: true });
  if (error) throw new Error(`Failed to list conflicting requests: ${error.message}`);
  return data;
}

// SCRUM-136: confirmed booking requests whose committed slots (including setup /
// turnaround buffer) overlap the slots of a newly created unavailability period.
// Only confirmed slot rows are checked — pending requests are not yet scheduled.
// AC4: no data is modified; this is a read-only query.
async function listAffectedBookingRequests(venueId, period, venue) {
  const { data, error } = await getSupabase()
    .from("venue_booking_requests")
    .select(BOOKING_REQUEST_FIELDS)
    .eq("venue_id", venueId)
    .gte("booking_date", period.start_date)
    .lte("booking_date", period.end_date);
  if (error) throw new Error(`Failed to list booking requests in range: ${error.message}`);

  const periodSlotSet = new Set(period.slots);

  return data.filter((request) => {
    const confirmedSlots = request.slots
      .filter((s) => s.status === "confirmed")
      .map((s) => s.slot);
    if (confirmedSlots.length === 0) return false;
    const expanded = committedSlots(confirmedSlots, venue.setup_minutes, venue.turnaround_minutes);
    return expanded.some((slot) => periodSlotSet.has(slot));
  });
}

module.exports = {
  listVenues,
  listBookingsForVenuesOnDate,
  listUnavailabilityForVenuesOnDate,
  getVenueById,
  updateVenue,
  listBookingsInRange,
  listUnavailabilityInRange,
  getEventById,
  getEventForCheckReport,
  listBookableEvents,
  listSlotRowsForDate,
  submitBookingRequest,
  getBookingRequestById,
  listBookingRequests,
  decideBookingRequest,
  changeBookingRequest,
  cancelBookingRequest,
  releaseBookingsForCancelledEvent,
  releaseBookingsForTerminalEvents,
  createUnavailabilityPeriod,
  listUnavailabilityPeriods,
  getUnavailabilityPeriodById,
  updateUnavailabilityPeriod,
  deleteUnavailabilityPeriod,
  listFutureVenueBookings,
  recheckConflictsAfterUpdate,
  listConflictingRequests,
  listAffectedBookingRequests,
  listActiveHoldsInRange,
  listHolds,
  createHold,
  getActiveHoldsByIds,
  linkHoldsToRequest,
  listEligibleHoldsForCoordinator,
  listEventsWithCoordinator,
  markVenueBookingAffected: require("./venueReplacement.service").markVenueBookingAffected,
  releaseAffectedVenueBooking: require("./venueReplacement.service").releaseAffectedVenueBooking,
  searchReplacementVenues: require("./venueReplacement.service").searchReplacementVenues,
};
