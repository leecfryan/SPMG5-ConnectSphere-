// Live-Supabase fixtures for SCRUM-162 (hold-to-booking conversion).
// Proves decide_venue_booking_request cancels hold rows before confirming
// booking rows so the exclusion constraint on confirmed slots never fires.
// Every row is real and teardown() deletes exactly what was created.
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
const { randomUUID } = require("node:crypto");
const supabase = require("../../../backend/src/supabase");

const BOOKING_DATE = "2099-11-01";
const SLOT = "am";

async function insert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  return data;
}

async function createAccount(roles) {
  const email = `pw-hconv-${randomUUID()}@example.test`;
  const password = randomUUID() + "-Aa1!";
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { roles },
    user_metadata: { full_name: "Playwright Hold Conv" },
  });
  if (error) throw new Error("createAccount failed: " + error.message);
  return { id: data.user.id, email, password };
}

async function getAccessToken(account) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) throw new Error("getAccessToken failed: " + await response.text());
  const { access_token } = await response.json();
  if (!access_token) throw new Error("getAccessToken: no access token returned");
  return access_token;
}

// Sets up: one venue, one APPROVED event, one pending booking request,
// and one hold row for the same slot — exactly the state the coordinator
// reaches after submitting a hold conversion. The hold row has request_id
// set (as linkHoldsToRequest does) so decide_venue_booking_request can find it.
async function setupHoldConversion() {
  const accounts = [];
  let venue, event, request, holdRow;

  try {
    const organiser = await createAccount(["event_organiser"]);
    const coordinator = await createAccount(["event_coordinator"]);
    const venueStaff = await createAccount(["venue_staff"]);
    accounts.push(organiser, coordinator, venueStaff);

    venue = await insert("venues", {
      name: "E2E Hold Conv " + randomUUID().slice(0, 8),
      address: "1 Test Street", city: "Singapore", country: "Singapore",
      capacity: 50, is_active: true,
      operating_hours: {
        mon: { open: "08:00", close: "23:00" }, tue: { open: "08:00", close: "23:00" },
        wed: { open: "08:00", close: "23:00" }, thu: { open: "08:00", close: "23:00" },
        fri: { open: "08:00", close: "23:00" }, sat: { open: "08:00", close: "23:00" },
        sun: { open: "08:00", close: "23:00" },
      },
    });

    event = await insert("events", {
      name: "E2E Hold Conv Event", status: "APPROVED",
      start_time: BOOKING_DATE + "T00:00:00Z", end_time: BOOKING_DATE + "T23:00:00Z",
      expected_attendance: 30, purpose: "E2E test",
      organiser_id: organiser.id, coordinator_id: coordinator.id,
    });

    request = await insert("venue_booking_requests", {
      venue_id: venue.id, event_id: event.id, booking_date: BOOKING_DATE,
      expected_attendees: 30, room_layout: "Theatre", requested_by: coordinator.id,
    });

    // Pending booking row — created when the coordinator submits the conversion
    await insert("venue_bookings", {
      venue_id: venue.id, booking_date: BOOKING_DATE, slot: SLOT,
      status: "pending", event_name: event.name,
      requested_by: coordinator.id, request_id: request.id,
    });

    // Hold row for the same slot, linked to the same request — as linkHoldsToRequest does
    holdRow = await insert("venue_bookings", {
      venue_id: venue.id, booking_date: BOOKING_DATE, slot: SLOT,
      status: "hold", event_name: event.name,
      coordinator_id: coordinator.id, event_id: event.id,
      expires_at: "2099-12-01T00:00:00Z",
      requested_by: venueStaff.id, request_id: request.id,
    });

    async function teardown() {
      await supabase.from("venue_bookings").delete().eq("request_id", request.id);
      await supabase.from("venue_booking_requests").delete().eq("id", request.id);
      await supabase.from("events").delete().eq("id", event.id);
      await supabase.from("venues").delete().eq("id", venue.id);
      await Promise.all(accounts.map((a) => supabase.auth.admin.deleteUser(a.id)));
    }

    return { organiser, coordinator, venueStaff, venue, event, request, holdRow, teardown };
  } catch (err) {
    if (request) {
      await supabase.from("venue_bookings").delete().eq("request_id", request.id);
      await supabase.from("venue_booking_requests").delete().eq("id", request.id);
    }
    if (event) await supabase.from("events").delete().eq("id", event.id);
    if (venue) await supabase.from("venues").delete().eq("id", venue.id);
    await Promise.all(accounts.map((a) => supabase.auth.admin.deleteUser(a.id)));
    throw err;
  }
}

module.exports = { setupHoldConversion, getAccessToken };
