// SCRUM-138: checking each venue booking of an event independently.
//
// Same shape as venueDecisions.test.js: a real Express app with a stubbed venue
// service and fake verified identities, so routing, permission, validation and
// the per-venue orchestration are exercised without a database. The real SQL
// scope for the report's event lookup is proven separately in
// venues.storage.test.js against a stubbed Supabase client.

import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const eventId = "22222222-2222-4222-8222-222222222222";
const otherEventId = "99999999-9999-4999-8999-999999999999";
const requestId = "33333333-3333-4333-8333-333333333333";
const secondRequestId = "44444444-4444-4444-8444-444444444444";
const DATE = "2099-10-10";

const OPEN_ALWAYS = Object.fromEntries(
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [
    day,
    { open: "08:00", close: "23:00" },
  ]),
);

const bigVenue = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Marina Grand Ballroom",
  city: "Singapore",
  country: "Singapore",
  capacity: 120,
  facilities: ["Stage"],
  accessibility_features: [],
  room_layouts: ["Theatre"],
  operating_hours: OPEN_ALWAYS,
  setup_minutes: 0,
  turnaround_minutes: 0,
  is_active: true,
};

const smallVenue = {
  ...bigVenue,
  id: "11111111-1111-4111-8111-111111111112",
  name: "Orchard Seminar Room",
  capacity: 50,
};

const event = {
  id: eventId,
  name: "Assigned conference",
  status: "APPROVED",
  start_time: "2099-10-10T01:00:00Z",
  end_time: "2099-10-10T09:00:00Z",
  expected_attendance: 100,
  venue_requirements: "A stage",
  accessibility_needs: null,
};

const bookingRequest = (over = {}) => ({
  id: requestId,
  booking_date: DATE,
  expected_attendees: 100,
  room_layout: "Theatre",
  required_facilities: ["Stage"],
  accessibility_requirements: [],
  additional_requirements: null,
  purpose: "Annual conference",
  submitted_at: "2099-09-01T00:00:00Z",
  decided_at: null,
  decision_note: null,
  venue: {
    id: bigVenue.id,
    name: bigVenue.name,
    city: bigVenue.city,
    country: bigVenue.country,
    capacity: bigVenue.capacity,
  },
  event: {
    id: eventId,
    name: event.name,
    status: event.status,
    start_time: event.start_time,
    end_time: event.end_time,
  },
  slots: [{ slot: "am", status: "pending" }],
  ...over,
});

const atSmallVenue = (over = {}) => ({
  ...bookingRequest({
    id: secondRequestId,
    venue: {
      id: smallVenue.id,
      name: smallVenue.name,
      city: smallVenue.city,
      country: smallVenue.country,
      capacity: smallVenue.capacity,
    },
  }),
  ...over,
});

// A confirmed row for a different event, as it comes back from the slot query.
const heldByAnotherEvent = (slot, eventName) => ({
  booking_date: DATE,
  slot,
  status: "confirmed",
  event_name: eventName,
  request: { id: "55555555-5555-4555-8555-555555555555", event_id: otherEventId },
});

const service = Object.fromEntries(
  [
    "listVenues", "getVenueById", "updateVenue", "listBookingsInRange",
    "listUnavailabilityInRange", "getEventById", "getEventForCheckReport",
    "listBookableEvents", "listSlotRowsForDate", "submitBookingRequest",
    "getBookingRequestById", "listBookingRequests", "decideBookingRequest",
  ].map((name) => [name, vi.fn()]),
);

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: { user: token === "invalid" ? null : { id: "verified-user", app_metadata: { roles: token.split(",") } } },
      error: null,
    }),
  },
};

let server, base;

beforeAll(async () => {
  server = createApp({ authClient, venuesService: service }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.getEventForCheckReport.mockResolvedValue(event);
  service.listBookingRequests.mockResolvedValue([bookingRequest()]);
  service.getVenueById.mockImplementation(async (id) =>
    id === smallVenue.id ? smallVenue : id === bigVenue.id ? bigVenue : null
  );
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.listUnavailabilityInRange.mockResolvedValue([]);
});

function check(id = eventId, role = "event_coordinator") {
  return fetch(`${base}/api/venues/events/${id}/booking-checks`, {
    headers: role ? { Authorization: "Bearer " + role } : {},
  });
}

test("[SCRUM-138] Each booking on the event gets its own verdicts", async () => {
  service.listBookingRequests.mockResolvedValue([bookingRequest(), atSmallVenue()]);

  const response = await check();
  const { data } = await response.json();

  expect(response.status).toBe(200);
  expect(data.event_id).toBe(eventId);
  expect(data.event_name).toBe("Assigned conference");
  // One result per booking, ordered by venue name.
  expect(data.results.map((result) => result.venue_name)).toEqual([
    "Marina Grand Ballroom",
    "Orchard Seminar Room",
  ]);

  // The venue that fits passes every check on its own.
  expect(data.results[0].overall).toBe("passed");
  expect(data.results[0].suitability).toEqual({ passed: true, reasons: [] });
  expect(data.results[0].availability).toEqual({ passed: true, reasons: [] });
  expect(data.results[0].conflicts).toEqual({ passed: true, reasons: [] });

  // The venue that does not is named, with the reason, and only its own checks fail.
  expect(data.results[1].overall).toBe("failed");
  expect(data.results[1].suitability).toEqual({
    passed: false,
    reasons: ["expected_attendees (100) exceeds the venue capacity of 50"],
  });
  expect(data.results[1].availability.passed).toBe(true);
  expect(data.results[1].conflicts.passed).toBe(true);

  // Each venue was checked from its own data.
  expect(service.listSlotRowsForDate).toHaveBeenCalledWith(bigVenue.id, DATE);
  expect(service.listSlotRowsForDate).toHaveBeenCalledWith(smallVenue.id, DATE);
});

test("[SCRUM-138] A venue whose data cannot be read is reported alone", async () => {
  service.listBookingRequests.mockResolvedValue([bookingRequest(), atSmallVenue()]);
  service.getVenueById.mockImplementation(async (id) => {
    if (id === smallVenue.id) throw new Error("Failed to fetch venue: connection reset");
    return bigVenue;
  });

  const response = await check();
  const { data } = await response.json();

  // One venue failing is not the whole report failing, and it says which one.
  expect(response.status).toBe(200);
  expect(data.results[0].venue_name).toBe("Marina Grand Ballroom");
  expect(data.results[0].overall).toBe("passed");
  expect(data.results[1].venue_name).toBe("Orchard Seminar Room");
  expect(data.results[1].overall).toBe("not_checked");
  expect(data.results[1].note).toMatch(/could not be checked right now/i);
  expect(data.results[1].suitability).toEqual({ passed: null, reasons: [] });
});

test("[SCRUM-138] A slot another event holds fails conflicts for that venue only", async () => {
  // The second venue is a comfortable fit, so the only failing check is the clash.
  service.listBookingRequests.mockResolvedValue([
    bookingRequest(),
    atSmallVenue({ expected_attendees: 10 }),
  ]);
  service.listSlotRowsForDate.mockImplementation(async (id) =>
    id === smallVenue.id ? [heldByAnotherEvent("am", "Charity gala")] : []
  );

  const { results } = (await (await check()).json()).data;

  expect(results[0].venue_name).toBe("Marina Grand Ballroom");
  expect(results[0].overall).toBe("passed");
  expect(results[1].venue_name).toBe("Orchard Seminar Room");
  expect(results[1].overall).toBe("failed");
  expect(results[1].conflicts).toEqual({
    passed: false,
    reasons: ["AM is already taken by another event (Reserved event)."],
  });
  // A clash is not an availability problem for the venue itself.
  expect(results[1].availability.passed).toBe(true);
  expect(results[1].suitability.passed).toBe(true);
});

test("[SCRUM-138] Venue Staff see which event holds the clash; coordinators do not", async () => {
  service.listSlotRowsForDate.mockResolvedValue([heldByAnotherEvent("am", "Charity gala")]);

  const asStaff = (await (await check(eventId, "venue_staff")).json()).data;
  const asCoordinator = (await (await check(eventId, "event_coordinator")).json()).data;

  expect(asStaff.results[0].conflicts.reasons).toEqual([
    "AM is already taken by another event (Charity gala).",
  ]);
  expect(asCoordinator.results[0].conflicts.reasons).toEqual([
    "AM is already taken by another event (Reserved event).",
  ]);
});

test("[SCRUM-138] A recorded unavailability fails availability for that venue only", async () => {
  service.listBookingRequests.mockResolvedValue([
    bookingRequest(),
    atSmallVenue({ expected_attendees: 10 }),
  ]);
  service.listUnavailabilityInRange.mockImplementation(async (id) =>
    id === smallVenue.id
      ? [{ unavailable_date: DATE, slot: "am", reason: "Deep cleaning" }]
      : []
  );

  const { results } = (await (await check()).json()).data;

  expect(results[0].availability.passed).toBe(true);
  expect(results[1].availability).toEqual({
    passed: false,
    reasons: ["AM is recorded unavailable (Deep cleaning)."],
  });
  // The venue being closed for that period is not a clash with another event.
  expect(results[1].conflicts.passed).toBe(true);
});

test("[SCRUM-138] The event's own booking is not reported as its own conflict", async () => {
  // The event's own confirmed row for the slot being checked: the check must
  // build its calendar without it, and must not read it as a duplicate either.
  service.listSlotRowsForDate.mockResolvedValue([
    {
      booking_date: DATE,
      slot: "am",
      status: "confirmed",
      event_name: event.name,
      request: { id: requestId, event_id: eventId },
    },
  ]);

  const { results } = (await (await check()).json()).data;

  expect(results[0].overall).toBe("passed");
  expect(results[0].conflicts).toEqual({ passed: true, reasons: [] });
});

test("[SCRUM-138] A booking with nothing live is reported, not checked", async () => {
  service.listBookingRequests.mockResolvedValue([
    bookingRequest(),
    bookingRequest({
      id: secondRequestId,
      slots: [{ slot: "am", status: "rejected" }],
    }),
  ]);

  const { results } = (await (await check()).json()).data;

  expect(results[0].overall).toBe("passed");
  expect(results[1].overall).toBe("not_checked");
  expect(results[1].status).toBe("rejected");
  expect(results[1].note).toMatch(/rejected and is no longer live/i);
});

test("[SCRUM-138] A booking whose own row is incomplete is reported, not crashed", async () => {
  // A venue id the service does not know: the venue row is gone.
  const venueGone = bookingRequest({
    id: "88888888-8888-4888-8888-888888888888",
    venue: { id: "99999999-9999-4999-8999-999999999999", name: "Closed Hall" },
  });
  service.listBookingRequests.mockResolvedValue([
    bookingRequest(),
    bookingRequest({ id: secondRequestId, venue: null }),
    bookingRequest({ id: "66666666-6666-4666-8666-666666666666", booking_date: null }),
    venueGone,
  ]);

  const response = await check();
  const { results } = (await response.json()).data;

  expect(response.status).toBe(200);
  // The one complete booking is still checked...
  expect(results.filter((result) => result.overall === "passed")).toHaveLength(1);
  // ...and each incomplete row states its own reason instead of a verdict.
  expect(results.map((result) => result.note)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/no venue recorded/i),
      expect.stringMatching(/no date recorded/i),
      expect.stringMatching(/no longer exists/i),
    ]),
  );
  expect(results.filter((result) => result.overall === "not_checked")).toHaveLength(3);
});

test("[SCRUM-138] The report is ordered by booking date, then venue", async () => {
  const laterDate = "2099-10-11";
  const marinaLater = { ...bookingRequest(), booking_date: laterDate };
  const orchardEarlier = { ...atSmallVenue(), booking_date: DATE };
  const marinaEarlier = { ...bookingRequest(), booking_date: DATE };
  service.listBookingRequests.mockResolvedValue([marinaLater, orchardEarlier, marinaEarlier]);

  const { results } = (await (await check()).json()).data;

  expect(results.map((result) => `${result.booking_date} ${result.venue_name}`)).toEqual([
    `${DATE} Marina Grand Ballroom`,
    `${DATE} Orchard Seminar Room`,
    `${laterDate} Marina Grand Ballroom`,
  ]);
});

test("[SCRUM-138] The check runs no write and leaves every booking as it was", async () => {
  service.listBookingRequests.mockResolvedValue([bookingRequest(), atSmallVenue()]);
  const before = structuredClone(await service.listBookingRequests());

  const { results } = (await (await check()).json()).data;

  // Nothing was written by any path this controller can reach.
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
  expect(service.decideBookingRequest).not.toHaveBeenCalled();
  expect(service.updateVenue).not.toHaveBeenCalled();

  // Every booking still reports the status its stored slots actually have, and
  // the checked slots were not rewritten in place.
  expect(results.map((result) => result.status)).toEqual(["pending", "pending"]);
  const after = await service.listBookingRequests();
  expect(after).toEqual(before);
});

test("[SCRUM-138] An event with no bookings reports an empty list", async () => {
  service.listBookingRequests.mockResolvedValue([]);

  const response = await check();
  const { data } = await response.json();

  expect(response.status).toBe(200);
  expect(data).toEqual({ event_id: eventId, event_name: "Assigned conference", results: [] });
});

test("[SCRUM-138] Coordinators are scoped to their own event; Venue Staff see every location", async () => {
  expect((await check(eventId, "event_coordinator")).status).toBe(200);
  expect(service.getEventForCheckReport).toHaveBeenCalledWith(eventId, {
    coordinatorId: "verified-user",
  });
  expect(service.listBookingRequests).toHaveBeenCalledWith(
    { coordinatorId: "verified-user" },
    eventId
  );

  expect((await check(eventId, "venue_staff")).status).toBe(200);
  expect(service.getEventForCheckReport).toHaveBeenCalledWith(eventId, { allVenues: true });
});

test("[SCRUM-138] Another coordinator's event is not found, exactly like a missing one", async () => {
  // The scoped lookup answers null for an event that is not theirs.
  service.getEventForCheckReport.mockResolvedValue(null);

  const response = await check();

  expect(response.status).toBe(404);
  expect((await response.json()).error).toBe("Event not found");
  // The scope reached the query rather than being decided after the read.
  expect(service.getEventForCheckReport).toHaveBeenCalledWith(eventId, {
    coordinatorId: "verified-user",
  });
});

test("[SCRUM-138] A malformed event id is refused before any read", async () => {
  const response = await check("not-a-uuid");

  expect(response.status).toBe(400);
  expect(service.getEventForCheckReport).not.toHaveBeenCalled();
  expect(service.listBookingRequests).not.toHaveBeenCalled();
});

test.each(["", "invalid"])(
  "[VENUE-CHECK-001] %s cannot read the check report",
  async (role) => {
    const response = await check(eventId, role);

    expect(response.status).toBe(401);
    expect(service.getEventForCheckReport).not.toHaveBeenCalled();
  }
);

test.each([
  "attendee",
  "event_organiser",
  "event_coordinator_lead",
  "safety_officer",
  "technical_support_staff",
])("[VENUE-CHECK-002] %s cannot read the check report", async (role) => {
  const response = await check(eventId, role);

  expect(response.status).toBe(403);
  expect(service.getEventForCheckReport).not.toHaveBeenCalled();
});

test("[SCRUM-138] Missing venue storage answers 503, not a crash", async () => {
  const bare = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(bare, "listening");
  const bareBase = `http://127.0.0.1:${bare.address().port}`;

  try {
    const response = await fetch(`${bareBase}/api/venues/events/${eventId}/booking-checks`, {
      headers: { Authorization: "Bearer event_coordinator" },
    });
    expect(response.status).toBe(503);
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});
