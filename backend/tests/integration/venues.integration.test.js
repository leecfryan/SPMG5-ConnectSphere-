import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");
const venueId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const bookingDate = "2099-10-10";
const venue = { id: venueId, name: "Across locations", is_active: true, capacity: 200,
  facilities: ["Projector"], accessibility_features: ["Lift"], room_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { open: "08:00", close: "23:00" }])) };
const event = { id: eventId, name: "Assigned conference", status: "ACCEPTED", start_time: "2099-10-10T00:00:00Z", end_time: "2099-10-10T15:00:00Z" };
const body = { event_id: eventId, booking_date: bookingDate, slots: ["am"], expected_attendees: 100,
  room_layout: "Theatre", required_facilities: ["Projector"], accessibility_requirements: ["Lift"] };
const service = Object.fromEntries(["listVenues", "getVenueById", "updateVenue", "listBookingsInRange", "listUnavailabilityInRange",
  "getEventById", "listBookableEvents", "listSlotRowsForDate", "submitBookingRequest", "getBookingRequestById", "listBookingRequests"].map((name) => [name, vi.fn()]));
const authClient = { auth: { getUser: async (token) => ({ data: { user: token === "invalid" ? null : {
  id: "verified-user", app_metadata: { roles: token.split(",") }, user_metadata: { roles: ["venue_staff"] },
} }, error: null }) } };
let server, base;
beforeAll(async () => {
  server = createApp({ authClient, venuesService: service }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.listVenues.mockResolvedValue([venue]);
  service.getVenueById.mockResolvedValue(venue);
  service.updateVenue.mockImplementation(async (_id, changes) => ({ ...venue, ...changes }));
  service.getEventById.mockResolvedValue(event);
  service.listBookableEvents.mockResolvedValue([event]);
  for (const name of ["listBookingsInRange", "listUnavailabilityInRange", "listSlotRowsForDate", "listBookingRequests"]) service[name].mockResolvedValue([]);
  service.submitBookingRequest.mockResolvedValue(requestId);
  service.getBookingRequestById.mockResolvedValue({ id: requestId, event, venue, slots: [{ slot: "am", status: "pending" }] });
});
function send(path = "", role = "venue_staff", method = "GET", data) {
  return fetch(base + "/api/venues" + path, { method, headers: {
    ...(role ? { Authorization: "Bearer " + role } : {}), "Content-Type": "application/json", "x-user-role": "Coordinator",
  }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}

test("[ACCESS-VENUE-001] Availability hides event names from coordinators but preserves occupied slots", async () => {
  service.listBookingsInRange.mockResolvedValue([{ booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Another coordinator private event" }]);
  const path = `/${venueId}/availability?from=${bookingDate}&to=${bookingDate}`;
  const coordinator = await send(path, "event_coordinator");
  expect(coordinator.status).toBe(200);
  const text = await coordinator.text();
  expect(text).toContain("booked");
  expect(text).not.toContain("Another coordinator private event");
  const staff = await send(path, "venue_staff,technical_support_staff");
  expect(await staff.text()).toContain("Another coordinator private event");
});

test.each(["DRAFT", "SUBMITTED", "REJECTED"])("[ACCESS-VENUE-002] %s events cannot request venues", async status => {
  service.getEventById.mockResolvedValue({ ...event, status });
  expect((await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", body)).status).toBe(400);
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});

test.each(["", "invalid", "attendee", "event_organiser", "technical_support_staff", "event_ops_manager", "unknown"])(
  "[VENUE-AUTH-001] Invalid or unrelated identity %s cannot access any venue endpoint, even with a forged role header", async (role) => {
    for (const [path, method] of [["", "GET"], [`/${venueId}`, "GET"], [`/${venueId}/availability`, "GET"],
      ["/booking-events", "GET"], ["/booking-requests", "GET"], [`/booking-requests/${requestId}`, "GET"],
      [`/${venueId}`, "PATCH"], [`/${venueId}/booking-requests`, "POST"]]) {
      expect((await send(path, role, method, method === "GET" ? undefined : body)).status).toBe(!role || role === "invalid" ? 401 : 403);
    }
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });
test.each(["venue_staff", "event_coordinator"])("[SCRUM-15] %s can browse and filter venue information across locations", async (role) => {
  const response = await send("?city=Singapore&minCapacity=50", role);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual([venue]);
  expect(service.listVenues).toHaveBeenCalledWith({ city: "Singapore", minCapacity: 50 });
});
test.each(["venue_staff", "event_coordinator"])("[SCRUM-16] %s edits operating information without modifying unrelated venue fields", async (role) => {
  const response = await send(`/${venueId}`, role, "PATCH", { setup_minutes: 45 });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ name: venue.name, setup_minutes: 45 });
  expect(service.updateVenue).toHaveBeenCalledWith(venueId, { setup_minutes: 45 });
});
test("[SCRUM-17] Calendar preserves confirmed, pending, unavailable and open slots", async () => {
  service.listBookingsInRange.mockResolvedValue([{ booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Booked" },
    { booking_date: bookingDate, slot: "pm", status: "pending", event_name: "Requested" }]);
  service.listUnavailabilityInRange.mockResolvedValue([{ unavailable_date: bookingDate, slot: "night", reason: "Maintenance" }]);
  const response = await send(`/${venueId}/availability?from=${bookingDate}&to=${bookingDate}`);
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.days[0].slots).toMatchObject({ am: { status: "booked" }, pm: { status: "pending" }, night: { status: "unavailable" } });
});
test("[VENUE-SCOPE-001] Event options and new booking ownership use verified identity", async () => {
  expect((await send("/booking-events", "event_coordinator")).status).toBe(200);
  expect(service.listBookableEvents).toHaveBeenCalledWith("verified-user");
  const response = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", body);
  expect(response.status).toBe(201);
  expect((await response.json()).data.status).toBe("pending");
  expect(service.getEventById).toHaveBeenCalledWith(eventId, "verified-user");
  expect(service.submitBookingRequest).toHaveBeenCalledWith(venueId, event.name, expect.not.objectContaining({ requested_by: expect.anything() }), "verified-user");
});
test("[VENUE-SCOPE-002] An event outside the coordinator's assignment cannot be booked", async () => {
  service.getEventById.mockResolvedValue(null);
  expect((await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", body)).status).toBe(404);
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});
test.each([["venue_staff", { allVenues: true }], ["event_coordinator", { coordinatorId: "verified-user" }]])(
  "[VENUE-SCOPE-003] %s reviews only its server-established booking scope", async (role, scope) => {
    expect((await send("/booking-requests?allVenues=true&coordinatorId=forged", role)).status).toBe(200);
    expect(service.listBookingRequests).toHaveBeenCalledWith(scope);
    expect((await send(`/booking-requests/${requestId}`, role)).status).toBe(200);
    expect(service.getBookingRequestById).toHaveBeenCalledWith(requestId, scope);
  });
test("[VENUE-AUTH-002] Venue Staff can review but cannot submit coordinator booking requests", async () => {
  expect((await send("/booking-events")).status).toBe(403);
  expect((await send(`/${venueId}/booking-requests`, "venue_staff", "POST", body)).status).toBe(403);
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});
test("[SCRUM-21] Invalid requirements and confirmed-slot conflicts cannot create requests", async () => {
  expect((await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", { ...body, expected_attendees: 201 })).status).toBe(400);
  service.listSlotRowsForDate.mockResolvedValue([{ booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Taken" }]);
  expect((await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", body)).status).toBe(409);
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});
test("[VENUE-CONFIG-001] Missing venue storage leaves sign-in intact and returns a controlled error", async () => {
  const unconfigured = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(unconfigured, "listening");
  const url = `http://127.0.0.1:${unconfigured.address().port}`;
  const headers = { Authorization: "Bearer venue_staff" };
  try {
    expect((await fetch(url + "/api/auth/me", { headers })).status).toBe(200);
    expect((await fetch(url + "/api/venues", { headers })).status).toBe(503);
    expect((await fetch(url + "/api/venues")).status).toBe(401);
  } finally { await new Promise((resolve) => unconfigured.close(resolve)); }
});

test("[VENUE-INPUT-001] Forged ownership and role fields are rejected before storage writes", async () => {
  expect((await send(`/${venueId}`, "venue_staff", "PATCH", { setup_minutes: 45, roles: ["admin"] })).status).toBe(400);
  expect((await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", { ...body, requested_by: "forged" })).status).toBe(400);
  expect(service.updateVenue).not.toHaveBeenCalled();
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});
