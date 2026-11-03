// Live-Supabase fixtures for SCRUM-144 (confirm an event): a throwaway venue with
// two booking requests (one confirmed slot, one pending), on top of the
// equipment fixtures' accounts, event and equipment unit. Every row is real and
// teardown() deletes exactly what was created - this is the shared dev database.
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
const { randomUUID } = require("node:crypto");
const supabase = require("../../../backend/src/supabase");
const { setupEquipment } = require("./live-equipment-fixtures");

const BOOKING_DATE = "2099-10-10";

async function insert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  return data;
}

// Venue booking rows are written directly: this suite proves the schema, and the
// Venue lane's own request and decision flow is covered by its own tests.
async function bookingRequest(venueId, eventId, coordinatorId, slotStatus) {
  const request = await insert("venue_booking_requests", {
    venue_id: venueId, event_id: eventId, booking_date: BOOKING_DATE,
    expected_attendees: 10, room_layout: "Theatre", requested_by: coordinatorId,
  });
  await insert("venue_bookings", {
    venue_id: venueId, booking_date: BOOKING_DATE, slot: slotStatus === "confirmed" ? "am" : "pm",
    status: slotStatus, event_name: "E2E SCRUM-144", requested_by: coordinatorId, request_id: request.id,
  });
  return request.id;
}

async function setupConfirmation() {
  const equipment = await setupEquipment();
  const venue = await insert("venues", {
    name: "E2E SCRUM-144 Hall " + randomUUID().slice(0, 8), address: "1 Test Street", city: "Singapore",
    country: "Singapore", capacity: 50,
  });
  const bookedRequestId = await bookingRequest(venue.id, equipment.eventId, equipment.coordinator.id, "confirmed");
  const pendingRequestId = await bookingRequest(venue.id, equipment.eventId, equipment.coordinator.id, "pending");

  async function teardown() {
    // Deleting the venue cascades to its booking requests and booking rows.
    await supabase.from("venues").delete().eq("id", venue.id);
    await equipment.teardown();
  }

  return { ...equipment, venueId: venue.id, bookedRequestId, pendingRequestId, teardown };
}

async function readEssential(table, id) {
  const { data, error } = await supabase.from(table).select("is_essential").eq("id", id).single();
  if (error) throw new Error(`read ${table}.is_essential failed: ${error.message}`);
  return data.is_essential;
}

async function readEventStatus(id) {
  const { data, error } = await supabase.from("events").select("status").eq("id", id).single();
  if (error) throw new Error("read events.status failed: " + error.message);
  return data.status;
}

module.exports = { setupConfirmation, readEssential, readEventStatus };
