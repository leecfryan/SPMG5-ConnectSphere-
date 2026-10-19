// Live-Supabase venue replacement fixtures for tests/e2e (real dev database, no
// fakes/mocks). Mirrors the shape of the retired
// tests/playwright/support/venue-storage.cjs, but every
// account/event/venue/booking row created here is real, and every test that uses
// these fixtures must clean up exactly what it creates - this is a shared dev
// database, not a disposable one.
//
// Throwaway accounts (not the coordinator.demo/venue.staff/organiser.seed accounts)
// are used for anything that needs a *specific* role for a single test.
//
// Relies on the SCRUM-145 manual SQL having been applied to the Supabase project:
//   - is_affected, affected_at, affected_reason, replaces_booking_id columns on
//     venue_booking_requests
//   - Partial unique index for single open replacement per affected booking
//   - mark_venue_booking_affected(...) RPC
//   - release_affected_venue_booking(...) RPC
//   - Extended submit_authenticated_venue_booking_request(...) with p_replaces_booking_id
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
const { randomUUID } = require("node:crypto");
const supabase = require("../../../backend/src/supabase");

async function createAccount(roles, fullName = "Playwright E2E Venue") {
  const email = `pw-vrep-${randomUUID()}@example.test`;
  const password = randomUUID() + "-Aa1!";
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { roles },
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error("createAccount failed: " + error.message);
  return { id: data.user.id, email, password };
}

async function deleteAccount(id) {
  await supabase.auth.admin.deleteUser(id);
}

async function createVenue({ name = "E2E Test Venue", capacity = 200, is_active = true }) {
  const id = randomUUID();
  const { error } = await supabase.from("venues").insert({
    id, name, capacity, is_active,
    facilities: ["Projector"],
    accessibility_features: ["Lift"],
    room_layouts: ["Theatre"],
    operating_hours: { mon: { open: "08:00", close: "23:00" }, tue: { open: "08:00", close: "23:00" }, wed: { open: "08:00", close: "23:00" }, thu: { open: "08:00", close: "23:00" }, fri: { open: "08:00", close: "23:00" }, sat: { open: "08:00", close: "23:00" }, sun: { open: "08:00", close: "23:00" } },
    setup_minutes: 15, teardown_minutes: 15, turnaround_minutes: 15,
    notes: "E2E test venue",
  });
  if (error) throw new Error("createVenue failed: " + error.message);
  return { id, name, capacity, is_active };
}

async function deleteVenue(id) {
  await supabase.from("venues").delete().eq("id", id);
}

async function createEvent({ organiserId, coordinatorId, name = "E2E Venue Replacement Test" }) {
  const id = randomUUID();
  const { error } = await supabase.from("events").insert({
    id, name, status: "APPROVED",
    start_time: "2099-10-10T00:00:00Z", end_time: "2099-10-10T15:00:00Z",
    expected_attendance: 100, purpose: "E2E test",
    organiser_id: organiserId, coordinator_id: coordinatorId,
  });
  if (error) throw new Error("createEvent failed: " + error.message);
  return id;
}

async function deleteEvent(id) {
  await supabase.from("events").delete().eq("id", id);
}

async function createBookingRequest({ venueId, eventId, coordinatorId, bookingDate = "2099-10-10", slots = ["am", "pm"], expectedAttendees = 150, roomLayout = "Theatre", requiredFacilities = ["Stage", "AV system"] }) {
  const id = randomUUID();
  const { error } = await supabase.from("venue_booking_requests").insert({
    id, venue_id: venueId, event_id: eventId, booking_date: bookingDate,
    expected_attendees: expectedAttendees, room_layout: roomLayout,
    required_facilities: requiredFacilities, slots,
    status: "pending", requested_by: coordinatorId,
  });
  if (error) throw new Error("createBookingRequest failed: " + error.message);
  return { id };
}

async function deleteBookingRequest(id) {
  await supabase.from("venue_booking_requests").delete().eq("id", id);
}

async function markBookingAffected({ bookingId, reason = "E2E test venue maintenance" }) {
  const { data, error } = await supabase.rpc("mark_venue_booking_affected", {
    p_booking_id: bookingId,
    p_user_id: null, // will be set by RPC if venue_staff, or coordinator owns it
    p_reason: reason,
    p_is_venue_staff: false,
  });
  if (error) throw new Error("markBookingAffected failed: " + error.message);
  return data;
}

async function releaseBookingAffected({ bookingId, coordinatorId }) {
  const { data, error } = await supabase.rpc("release_affected_venue_booking", {
    p_booking_id: bookingId,
    p_coordinator_id: coordinatorId,
  });
  if (error) throw new Error("releaseBookingAffected failed: " + error.message);
  return data;
}

function freshBookingId() {
  return "vrep-" + randomUUID().slice(0, 8);
}

// One organiser, one coordinator, one venue, one booking request -
// the common shape every venue replacement e2e test needs.
// Call teardown() in the test's cleanup.
async function setupVenueReplacement() {
  const [organiser, coordinator, venueStaff, outsider] = await Promise.all([
    await createAccount(["event_organiser"]),
    await createAccount(["event_coordinator"]),
    await createAccount(["venue_staff"]),
    await createAccount(["event_coordinator"]), // different coordinator
  ]);

  const venue = await createVenue({ name: "E2E Marina Venue", capacity: 200 });
  const event = await createEvent({ organiserId: organiser.id, coordinatorId: coordinator.id });

  // Create a booking request for the event on the venue
  const booking = await createBookingRequest({
    venueId: venue.id, eventId: event.id, coordinatorId: coordinator.id,
  });

  async function teardown() {
    await deleteBookingRequest(booking.id);
    await deleteEvent(event.id);
    await deleteVenue(venue.id);
    await Promise.all([organiser, coordinator, venueStaff, outsider].map((a) => deleteAccount(a.id)));
  }

  return { organiser, coordinator, venueStaff, outsider, venue, event, booking, teardown };
}

module.exports = {
  createAccount, deleteAccount, createVenue, deleteVenue, createEvent, deleteEvent,
  createBookingRequest, deleteBookingRequest, markBookingAffected, releaseBookingAffected,
  freshBookingId, setupVenueReplacement,
};