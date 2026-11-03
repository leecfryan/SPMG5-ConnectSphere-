let clientOverride;
const getSupabase = () => {
  if (clientOverride) return clientOverride;
  const supabaseModule = require("../../supabase");
  if (typeof supabaseModule === "function") return supabaseModule();
  if (supabaseModule.default) {
    return typeof supabaseModule.default === "function"
      ? supabaseModule.default()
      : supabaseModule.default;
  }
  return supabaseModule;
};

function setSupabaseClientForTests(client) {
  clientOverride = client;
}

const VENUE_FIELDS = [
  "id", "name", "address", "city", "country", "capacity",
  "facilities", "accessibility_features", "room_layouts",
  "operating_hours", "setup_minutes", "teardown_minutes",
  "turnaround_minutes", "notes", "is_active",
].join(", ");

const BOOKING_FIELDS = [
  "id",
  "venue_id",
  "event_id",
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
  "venue:venues!venue_id(id, name, city, country)",
  "event:events!event_id!inner(id, name, status, coordinator_id, expected_attendance, venue_requirements, accessibility_needs)",
  "slots:venue_bookings!request_id(slot, status)",
].join(", ");

function replacementError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function slotNames(booking) {
  return (booking.slots || [])
    .filter((slot) => ["pending", "confirmed"].includes(slot.status))
    .map((slot) => slot.slot);
}

function overlaps(left, right) {
  return left.some((slot) => right.includes(slot));
}

async function getAffectedBooking(bookingId) {
  const { data, error } = await getSupabase()
    .from("venue_booking_requests")
    .select(BOOKING_FIELDS)
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch affected booking: ${error.message}`);
  return data;
}

async function listReplacementCandidates(booking, filters) {
  let query = getSupabase()
    .from("venues")
    .select(VENUE_FIELDS)
    .eq("is_active", true)
    .neq("id", booking.venue_id)
    .order("name", { ascending: true });

  if (Number.isInteger(filters.minCapacity) && typeof query.gte === "function") {
    query = query.gte("capacity", filters.minCapacity);
  }
  if (filters.facilities?.length && typeof query.contains === "function") {
    query = query.contains("facilities", filters.facilities);
  }
  if (filters.accessibility?.length && typeof query.contains === "function") {
    query = query.contains("accessibility_features", filters.accessibility);
  }
  if (filters.roomLayout && typeof query.contains === "function") {
    query = query.contains("room_layouts", [filters.roomLayout]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list replacement venues: ${error.message}`);
  return data || [];
}

async function listExistingEventBookings(booking) {
  const { data, error } = await getSupabase()
    .from("venue_booking_requests")
    .select("venue_id, slots:venue_bookings!request_id(slot, status)")
    .eq("event_id", booking.event_id)
    .eq("booking_date", booking.booking_date)
    .order("id", { ascending: true });

  if (error) throw new Error(`Failed to list event venue bookings: ${error.message}`);
  return data || [];
}

async function listUnavailableSlots(venueIds, bookingDate) {
  if (venueIds.length === 0) return [];
  const [bookingsResult, unavailableResult] = await Promise.all([
    getSupabase()
      .from("venue_bookings")
      .select("venue_id, slot, status")
      .in("venue_id", venueIds)
      .eq("booking_date", bookingDate)
      .in("status", ["pending", "confirmed", "hold"])
      .order("slot", { ascending: true }),
    getSupabase()
      .from("venue_unavailability")
      .select("venue_id, slot")
      .in("venue_id", venueIds)
      .eq("unavailable_date", bookingDate)
      .order("slot", { ascending: true }),
  ]);

  if (bookingsResult.error) {
    throw new Error(`Failed to list replacement booking conflicts: ${bookingsResult.error.message}`);
  }
  if (unavailableResult.error) {
    throw new Error(`Failed to list replacement unavailability: ${unavailableResult.error.message}`);
  }
  return [...(bookingsResult.data || []), ...(unavailableResult.data || [])];
}

async function searchReplacementVenues(bookingId, coordinatorId, overrides = {}) {
  const booking = await getAffectedBooking(bookingId);
  if (!booking) throw replacementError("Booking not found", 404);
  if (booking.event?.coordinator_id && booking.event.coordinator_id !== coordinatorId) {
    throw replacementError("Not your event", 403);
  }
  if (booking.is_affected === false) {
    throw replacementError("This booking is not affected", 409);
  }

  const originalSlots = slotNames(booking);
  const filters = {
    minCapacity: overrides.minCapacity ?? booking.expected_attendees,
    facilities: overrides.facilities ?? booking.required_facilities ?? [],
    accessibility: overrides.accessibility ?? booking.accessibility_requirements ?? [],
    roomLayout: overrides.roomLayout ?? booking.room_layout,
  };
  const [venues, eventBookings] = await Promise.all([
    listReplacementCandidates(booking, filters),
    listExistingEventBookings(booking),
  ]);
  const eventVenueIds = new Set(
    eventBookings
      .filter((row) => row.venue_id !== booking.venue_id)
      .filter((row) => overlaps(originalSlots, slotNames(row)))
      .map((row) => row.venue_id)
  );
  const unavailable = await listUnavailableSlots(
    venues.map((venue) => venue.id),
    booking.booking_date
  );
  const unavailableByVenue = new Map();
  for (const row of unavailable) {
    const slots = unavailableByVenue.get(row.venue_id) || [];
    slots.push(row.slot);
    unavailableByVenue.set(row.venue_id, slots);
  }

  const candidateVenues = venues
    .filter((venue) => !eventVenueIds.has(venue.id))
    .filter((venue) => !overlaps(originalSlots, unavailableByVenue.get(venue.id) || []))
    .map((venue) => ({
      venueId: venue.id,
      name: venue.name,
      city: venue.city,
      country: venue.country,
      capacity: venue.capacity,
      availableSlots: originalSlots,
      matches: {
        capacityFit: venue.capacity >= booking.expected_attendees,
        facilitiesFit: (booking.required_facilities || []).every((item) => (venue.facilities || []).includes(item)),
        accessibilityFit: (booking.accessibility_requirements || []).every((item) => (venue.accessibility_features || []).includes(item)),
        layoutFit: (venue.room_layouts || []).includes(booking.room_layout),
      },
    }));

  return {
    originalBooking: {
      bookingId: booking.id,
      eventId: booking.event_id,
      eventName: booking.event?.name,
      venueId: booking.venue_id,
      venueName: booking.venue?.name,
      bookingDate: booking.booking_date,
      slots: originalSlots,
      expectedAttendees: booking.expected_attendees,
      roomLayout: booking.room_layout,
      requiredFacilities: booking.required_facilities || [],
      accessibilityRequirements: booking.accessibility_requirements || [],
      purpose: booking.purpose,
      affectedReason: booking.affected_reason,
      affectedAt: booking.affected_at,
    },
    candidateVenues,
  };
}

async function markVenueBookingAffected(bookingId, userId, reason, isVenueStaff = false) {
  if (!reason || !reason.trim()) throw new Error("Reason required");
  const result = await getSupabase().rpc("mark_venue_booking_affected", {
    p_booking_id: bookingId,
    p_user_id: userId,
    p_reason: reason,
    p_is_venue_staff: isVenueStaff,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function releaseAffectedVenueBooking(bookingId, coordinatorId) {
  const result = await getSupabase().rpc("release_affected_venue_booking", {
    p_booking_id: bookingId,
    p_coordinator_id: coordinatorId,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

module.exports = {
  searchReplacementVenues,
  markVenueBookingAffected,
  releaseAffectedVenueBooking,
  setSupabaseClientForTests,
};
