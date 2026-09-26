// Lazy construction keeps sign-in available when venue storage is not configured.
const getSupabase = () => require("../../supabase");

// SCRUM-82, 83, 84: everything a Coordinator needs to assess a venue
const VENUE_FIELDS = [
  "id", "name", "address", "city", "country", "capacity",
  "facilities", "accessibility_features", "room_layouts",
  "operating_hours", "setup_minutes", "teardown_minutes",
  "turnaround_minutes", "notes", "is_active",
].join(", ");

async function listVenues({ city, minCapacity } = {}) {
  let query = getSupabase()
    .from("venues")
    .select(VENUE_FIELDS)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (city) query = query.ilike("city", city);
  if (Number.isFinite(minCapacity)) query = query.gte("capacity", minCapacity);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list venues: ${error.message}`);
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

// SCRUM-93: periods Venue Staff recorded as unavailable
async function listUnavailabilityInRange(venueId, from, to) {
  const { data, error } = await getSupabase()
    .from("venue_unavailability")
    .select("unavailable_date, slot, reason")
    .eq("venue_id", venueId)
    .gte("unavailable_date", from)
    .lte("unavailable_date", to);

  if (error) {
    throw new Error(`Failed to list unavailable periods: ${error.message}`);
  }
  return data;
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
  "submitted_at",
  "venue:venues!venue_id(id, name, city, country, capacity)",
  "event:events!event_id!inner(id, name, status, start_time, end_time)",
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

// SCRUM-85: the events a coordinator can pick from. Drafts are left out
// because their timing is not final (see validateAgainstEvent), and events
// that have already ended have nothing left to book.
async function listBookableEvents(coordinatorId) {
  const { data, error } = await getSupabase()
    .from("events")
    .select(EVENT_FIELDS)
    .eq("coordinator_id", coordinatorId)
      .in("status", ["ACCEPTED", "APPROVED"])
    .not("start_time", "is", null)
    .gte("end_time", new Date().toISOString())
    .order("start_time", { ascending: true });

  if (error) throw new Error(`Failed to list events: ${error.message}`);
  return data;
}

// Live slot rows for one venue on one day, with the event behind each request.
// Seed bookings have no request, so `request` comes back null for those.
async function listSlotRowsForDate(venueId, bookingDate) {
  const { data, error } = await getSupabase()
    .from("venue_bookings")
    .select(
      "booking_date, slot, status, event_name, request:venue_booking_requests!request_id(event_id)"
    )
    .eq("venue_id", venueId)
    .eq("booking_date", bookingDate)
    .in("status", ["pending", "confirmed"]);

  if (error) throw new Error(`Failed to list slot rows: ${error.message}`);
  return data;
}

// Calls the authenticated Postgres wrapper from migration 006,
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

async function listBookingRequests(scope) {
  let query = getSupabase()
    .from("venue_booking_requests")
    .select(BOOKING_REQUEST_FIELDS)
    .order("submitted_at", { ascending: false })
    .limit(BOOKING_REQUEST_LIST_LIMIT);
  query = applyBookingScope(query, scope);
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

module.exports = {
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
};
