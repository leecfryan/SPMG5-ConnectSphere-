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
const event = { id: eventId, name: "Assigned conference", status: "APPROVED", start_time: "2099-10-10T00:00:00Z", end_time: "2099-10-10T15:00:00Z" };
const body = { event_id: eventId, booking_date: bookingDate, slots: ["am"], expected_attendees: 100,
  room_layout: "Theatre", required_facilities: ["Projector"], accessibility_requirements: ["Lift"] };
const service = Object.fromEntries(["listVenues", "getVenueById", "updateVenue", "listBookingsInRange", "listUnavailabilityInRange",
  "listBookingsForVenuesOnDate", "listUnavailabilityForVenuesOnDate", "getEventById", "listBookableEvents", "listSlotRowsForDate", "submitBookingRequest", "getBookingRequestById", "listBookingRequests"].map((name) => [name, vi.fn()]));
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
  for (const name of ["listBookingsInRange", "listUnavailabilityInRange", "listSlotRowsForDate", "listBookingRequests", "listBookingsForVenuesOnDate", "listUnavailabilityForVenuesOnDate"]) service[name].mockResolvedValue([]);
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

test.each(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REJECTED"])("[ACCESS-VENUE-002] %s events cannot request venues", async status => {
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
test("[SCRUM-20] A confirmed booking reduces availability, blocks a clashing request and leaves other slots bookable", async () => {
  const taken = { booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Taken" };
  service.listBookingsInRange.mockResolvedValue([taken]);
  const calendar = await send(`/${venueId}/availability?from=${bookingDate}&to=${bookingDate}`);
  expect((await calendar.json()).data.days[0].slots).toMatchObject({ am: { status: "booked" }, pm: { status: "available" } });
  service.listSlotRowsForDate.mockResolvedValue([taken]);
  const clash = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", body);
  expect(clash.status).toBe(409);
  expect((await clash.json()).details.join(" ")).toMatch(/am/);
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
  expect((await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", { ...body, slots: ["pm"] })).status).toBe(201);
  expect(service.submitBookingRequest).toHaveBeenCalledTimes(1);
});
test("[SCRUM-102] A rejected request stays in the booking history with its reason, while its slot is freed", async () => {
  const reason = "Held for the gala. Orchard Seminar Room 3 is free that morning.";
  const rejected = { id: requestId, event, venue, booking_date: bookingDate, decision_note: reason, slots: [{ slot: "am", status: "rejected" }] };
  service.listBookingRequests.mockResolvedValue([rejected]);
  service.getBookingRequestById.mockResolvedValue(rejected);
  const listed = await send("/booking-requests?status=rejected", "event_coordinator");
  expect(listed.status).toBe(200);
  const [only] = (await listed.json()).data;
  expect(only).toMatchObject({ id: requestId, status: "rejected", decision_note: reason });
  expect((await (await send(`/booking-requests/${requestId}`, "event_coordinator")).json()).data.decision_note).toBe(reason);
  // Rejecting frees the slot without erasing the record: the request is still
  // listed above, but only pending and confirmed bookings reach the calendar.
  const calendar = await send(`/${venueId}/availability?from=${bookingDate}&to=${bookingDate}`);
  expect((await calendar.json()).data.days[0].slots.am.status).toBe("available");
});
// SCRUM-18: search and filter potential venues. The stored filters are the
// database's job; the date filter runs the SCRUM-17 calendar over the shortlist.
const otherVenue = { ...venue, id: "44444444-4444-4444-8444-444444444444", name: "Second venue" };
test("[SCRUM-18] Capacity, location, accessibility, facilities and layout all narrow the catalogue", async () => {
  const response = await send("/?city=Singapore&minCapacity=50&facilities=Projector&accessibility=Lift&roomLayout=Theatre", "event_coordinator");
  expect(response.status).toBe(200);
  expect(service.listVenues).toHaveBeenCalledWith({
    city: "Singapore", minCapacity: 50, facilities: ["Projector"], accessibility: ["Lift"], roomLayout: "Theatre",
  });
});
test("[SCRUM-18] Several facilities must all be offered, not just one of them", async () => {
  expect((await send("/?facilities=Projector,Stage", "event_coordinator")).status).toBe(200);
  expect(service.listVenues).toHaveBeenCalledWith({ facilities: ["Projector", "Stage"] });
});
test("[SCRUM-18] A date keeps only venues whose requested slots are still open", async () => {
  service.listVenues.mockResolvedValue([venue, otherVenue]);
  service.listBookingsForVenuesOnDate.mockResolvedValue([
    { venue_id: venueId, booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Taken" },
    { venue_id: otherVenue.id, booking_date: bookingDate, slot: "am", status: "pending", event_name: "Requested" },
  ]);
  service.listUnavailabilityForVenuesOnDate.mockResolvedValue([]);
  const response = await send(`/?date=${bookingDate}&slots=am`, "event_coordinator");
  expect(response.status).toBe(200);
  // A confirmed booking takes the slot; a pending request does not (SCRUM-21).
  expect((await response.json()).data.map((row) => row.id)).toEqual([otherVenue.id]);
  expect(service.listBookingsForVenuesOnDate).toHaveBeenCalledWith([venueId, otherVenue.id], bookingDate);
});
test("[SCRUM-18] A blocked period and closed hours both remove a venue from the results", async () => {
  const closedOnThatDay = { ...otherVenue, operating_hours: { ...venue.operating_hours, sat: { closed: true } } };
  service.listVenues.mockResolvedValue([venue, closedOnThatDay]);
  service.listBookingsForVenuesOnDate.mockResolvedValue([]);
  service.listUnavailabilityForVenuesOnDate.mockResolvedValue([
    { venue_id: venueId, unavailable_date: bookingDate, slot: "pm", reason: "Maintenance" },
  ]);
  // 2099-10-10 is a Saturday, so the second venue is closed all day.
  const response = await send(`/?date=${bookingDate}&slots=pm`, "event_coordinator");
  expect((await response.json()).data).toEqual([]);
});
test("[SCRUM-18] A date with no slots keeps a venue that is free for part of the day", async () => {
  service.listVenues.mockResolvedValue([venue, otherVenue]);
  service.listBookingsForVenuesOnDate.mockResolvedValue([
    { venue_id: venueId, booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Taken" },
    ...["am", "pm", "night"].map((slot) => ({ venue_id: otherVenue.id, booking_date: bookingDate, slot, status: "confirmed", event_name: "Full day" })),
  ]);
  service.listUnavailabilityForVenuesOnDate.mockResolvedValue([]);
  // A bare date asks about the day, so one open slot is enough: a venue booked
  // in the morning is still a candidate for the evening. Only a venue with
  // nothing left drops out.
  const { data } = await (await send(`/?date=${bookingDate}`, "event_coordinator")).json();
  expect(data.map((row) => row.id)).toEqual([venueId]);
});
test("[SCRUM-18] Naming slots requires all of them, which a bare date does not", async () => {
  service.listVenues.mockResolvedValue([venue]);
  service.listBookingsForVenuesOnDate.mockResolvedValue([
    { venue_id: venueId, booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Taken" },
  ]);
  service.listUnavailabilityForVenuesOnDate.mockResolvedValue([]);
  // The same venue and the same day: kept for a bare date, dropped once the
  // taken slot is actually asked for.
  expect((await (await send(`/?date=${bookingDate}`, "event_coordinator")).json()).data).toHaveLength(1);
  expect((await (await send(`/?date=${bookingDate}&slots=am,pm`, "event_coordinator")).json()).data).toEqual([]);
});
test("[SCRUM-18] A minimum capacity of zero means no minimum, matching the catalogue's input", async () => {
  const response = await send("/?minCapacity=0", "event_coordinator");
  expect(response.status).toBe(200);
  // Zero is what the capacity input allows at its lowest, so it must not be an
  // error. It simply does not filter.
  expect(service.listVenues).toHaveBeenCalledWith({});
});
test("[SCRUM-18] Malformed filters are refused instead of silently returning everything", async () => {
  for (const query of ["?minCapacity=lots", "?minCapacity=-5", "?date=2099-02-31", "?date=10-10-2099", "?slots=am&", "?slots=breakfast&date=2099-10-10", "?sortBy=price"]) {
    expect((await send("/" + query, "event_coordinator")).status).toBe(400);
  }
  expect(service.listVenues).not.toHaveBeenCalled();
});
test("[SCRUM-18] Searching narrows but does not rank, and never reaches the date tables needlessly", async () => {
  service.listVenues.mockResolvedValue([otherVenue, venue]);
  const { data } = await (await send("/?city=Singapore", "event_coordinator")).json();
  // Order is whatever the catalogue returns, and no score or rank is added:
  // searching identifies candidates, it does not assess them.
  expect(data.map((row) => row.id)).toEqual([otherVenue.id, venueId]);
  expect(data.every((row) => !("score" in row) && !("rank" in row))).toBe(true);
  expect(service.listBookingsForVenuesOnDate).not.toHaveBeenCalled();
});
// SCRUM-19: assess a shortlisted venue against the coordinator's own event.
const suitability = (query, role = "event_coordinator") => send(`/${venueId}/suitability?${query}`, role);
test("[SCRUM-19] A venue meeting every recorded requirement is assessed suitable", async () => {
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: 150, venue_requirements: "Projector and a raised platform", accessibility_needs: "Lift access required" });
  const response = await suitability(`event_id=${eventId}`);
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toMatchObject({ venue_id: venueId, event_id: eventId, verdict: "suitable", unmet_count: 0 });
  expect(data.checks).toHaveLength(3);
  expect(data.checks.every((check) => check.met === true)).toBe(true);
  // The event is read through the coordinator-scoped lookup, never by id alone.
  expect(service.getEventById).toHaveBeenCalledWith(eventId, "verified-user");
});
test("[SCRUM-19] Attendance above capacity makes a venue unsuitable", async () => {
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: 201, venue_requirements: null, accessibility_needs: null });
  const { data } = await (await suitability(`event_id=${eventId}`)).json();
  expect(data).toMatchObject({ verdict: "unsuitable", unmet_count: 1 });
  expect(data.checks[0]).toMatchObject({ requirement: "Expected attendance", needed: "201 people", available: "Capacity 200", met: false });
});
test("[SCRUM-19] A required facility the venue lacks makes it unsuitable and is named", async () => {
  // The vocabulary is what the catalogue offers, so "Ice rink" is recognised
  // as a facility because some other venue has one, and this venue does not.
  service.listVenues.mockResolvedValue([venue, { ...venue, id: otherVenue.id, facilities: ["Ice rink"] }]);
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: 10, venue_requirements: "Projector, and an Ice rink for the finale", accessibility_needs: null });
  const { data } = await (await suitability(`event_id=${eventId}`)).json();
  expect(data).toMatchObject({ verdict: "unsuitable", unmet_count: 1 });
  // The met requirement is still listed, so the coordinator sees the whole
  // comparison rather than only what failed.
  expect(data.checks.map((check) => [check.needed, check.met])).toEqual([
    ["10 people", true], ["Projector", true], ["Ice rink", false],
  ]);
});
test("[SCRUM-19] An accessibility need the venue cannot meet also makes it unsuitable", async () => {
  service.listVenues.mockResolvedValue([venue, { ...venue, id: otherVenue.id, accessibility_features: ["Hearing loop"] }]);
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: 10, venue_requirements: null, accessibility_needs: "Hearing loop needed" });
  const { data } = await (await suitability(`event_id=${eventId}`)).json();
  expect(data).toMatchObject({ verdict: "unsuitable", unmet_count: 1 });
});
test("[SCRUM-19] Requirements are read from free text, not treated as a list of characters", async () => {
  // The events lane stores venue_requirements and accessibility_needs as free
  // text (docs/event-requests.md). Reading them as an array produced one check
  // per character, which is how this was caught in the browser.
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: 10, venue_requirements: "Projector, plus a stage", accessibility_needs: null });
  const { data } = await (await suitability(`event_id=${eventId}`)).json();
  expect(data.checks).toHaveLength(2);
  expect(data.checks[1]).toMatchObject({ requirement: "Facility", needed: "Projector", met: true });
});
test("[SCRUM-19] Only whole words count as a requirement, and unknown wording is reported", async () => {
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: 10, venue_requirements: "Somewhere backstage for the choir", accessibility_needs: null });
  const { data } = await (await suitability(`event_id=${eventId}`)).json();
  // "backstage" contains "stage" but is not a request for the Stage facility,
  // and nothing else in the text is a name the catalogue knows, so the text is
  // reported as unmatched rather than passed or failed.
  expect(data).toMatchObject({ verdict: "suitable", unmet_count: 0, unknown_count: 1 });
  expect(data.checks[1]).toMatchObject({ needed: "Somewhere backstage for the choir", available: "Could not be matched automatically", met: null });
});
test("[SCRUM-19] A requirement the event never recorded is reported, not counted as met", async () => {
  service.getEventById.mockResolvedValue({ ...event, expected_attendance: null, venue_requirements: null, accessibility_needs: null });
  const { data } = await (await suitability(`event_id=${eventId}`)).json();
  // Nothing recorded cannot fail, but staying silent would imply it passed.
  expect(data).toMatchObject({ verdict: "suitable", unmet_count: 0, unknown_count: 1 });
  expect(data.checks[0]).toMatchObject({ needed: "Not recorded on this event", met: null });
});
test("[SCRUM-19] An event that is not the coordinator's own cannot be assessed", async () => {
  service.getEventById.mockResolvedValue(null);
  expect((await suitability(`event_id=${eventId}`)).status).toBe(404);
});
test("[SCRUM-19] A missing or malformed id is refused before any lookup", async () => {
  expect((await suitability("")).status).toBe(400);
  expect((await suitability("event_id=not-a-uuid")).status).toBe(400);
  expect((await send(`/not-a-uuid/suitability?event_id=${eventId}`, "event_coordinator")).status).toBe(400);
  expect(service.getEventById).not.toHaveBeenCalled();
});
test.each(["", "invalid", "venue_staff", "attendee", "event_organiser", "technical_support_staff", "event_ops_manager"])(
  "[SCRUM-19] %s cannot assess a venue against someone's event", async (role) => {
    expect((await suitability(`event_id=${eventId}`, role)).status).toBe(!role || role === "invalid" ? 401 : 403);
    expect(service.getEventById).not.toHaveBeenCalled();
  }
);
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
