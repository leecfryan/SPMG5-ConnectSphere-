// SCRUM-162: Convert a tentative venue hold into a booking request.
// Two sections:
//   1. Unit tests — buildAvailabilityCalendar with hold + pending (AC2)
//   2. Integration tests — real Express app, stubbed service, fake identities

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildAvailabilityCalendar } = require("../../src/modules/venues/venues.availability");
const createApp = require("../../src/app");
const { once } = require("node:events");

// ---------------------------------------------------------------------------
// 1. Unit — calendar precedence while a converted hold is pending (AC2)
// ---------------------------------------------------------------------------

const OPEN_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "08:00", close: "23:00" }])
);
const DATE = "2099-11-10"; // Monday

describe("buildAvailabilityCalendar hold + pending — SCRUM-162 AC2", () => {
  test("[TC-SCRUM-162-07] active hold plus pending request on same slot → slot stays tentative", () => {
    const [day] = buildAvailabilityCalendar({
      operatingHours: OPEN_HOURS,
      bookings: [{ booking_date: DATE, slot: "am", status: "pending", event_name: "Charity Gala" }],
      unavailability: [],
      holds: [{ booking_date: DATE, slot: "am", event_name: "Charity Gala" }],
      from: DATE,
      to: DATE,
    });
    // hold (tentative) outranks the new pending request — other coordinators remain blocked
    expect(day.slots.am.status).toBe("tentative");
    expect(day.slots.pm.status).toBe("available");
  });
});

// ---------------------------------------------------------------------------
// 2. Integration — eligible holds endpoint and hold conversion booking path
// ---------------------------------------------------------------------------

const venueId = "aaaaaaaa-1162-4000-8000-000000000001";
const futureDate = "2099-12-01";
// authClient returns this id for any token other than "invalid"
const coordinatorId = "staff-id";

const venue = {
  id: venueId, name: "Test Hall", is_active: true, capacity: 200,
  facilities: [], accessibility_features: [], room_layouts: ["Theatre"],
  operating_hours: OPEN_HOURS,
  setup_minutes: 0, turnaround_minutes: 0,
};

const ALL_SERVICE_METHODS = [
  "listVenues", "getVenueById", "updateVenue", "listBookingsInRange", "listUnavailabilityInRange",
  "listBookingsForVenuesOnDate", "listUnavailabilityForVenuesOnDate", "getEventById",
  "getEventForCheckReport", "listBookableEvents", "listSlotRowsForDate", "submitBookingRequest",
  "getBookingRequestById", "listBookingRequests", "decideBookingRequest", "changeBookingRequest",
  "cancelBookingRequest", "createUnavailabilityPeriod", "listUnavailabilityPeriods",
  "getUnavailabilityPeriodById", "updateUnavailabilityPeriod", "deleteUnavailabilityPeriod",
  "recheckConflictsAfterUpdate", "listConflictingRequests", "listAffectedBookingRequests",
  "listActiveHoldsInRange", "listHolds", "createHold",
  "getActiveHoldsByIds", "linkHoldsToRequest", "listEligibleHoldsForCoordinator", "listEventsWithCoordinator",
  "searchReplacementVenues", "markVenueBookingAffected", "releaseAffectedVenueBooking",
];

const service = Object.fromEntries(ALL_SERVICE_METHODS.map((name) => [name, vi.fn()]));

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: {
        user: token === "invalid" ? null : {
          id: coordinatorId,
          app_metadata: { roles: token.split(",") },
          user_metadata: { roles: [] },
        },
      },
      error: null,
    }),
  },
};

const dataClient = {
  auth: { admin: {
    listUsers: vi.fn().mockResolvedValue({
      data: { users: [
        { id: coordinatorId, app_metadata: { roles: ["event_coordinator"] }, user_metadata: { full_name: "Test Coordinator" }, email: "coord@test.com" },
      ]},
      error: null,
    }),
  }},
};

let server, base;
beforeAll(async () => {
  server = createApp({ authClient, venuesService: service, dataClient }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.getVenueById.mockResolvedValue(venue);
  service.listActiveHoldsInRange.mockResolvedValue([]);
  service.getActiveHoldsByIds.mockResolvedValue([]);
  service.linkHoldsToRequest.mockResolvedValue();
  service.listEligibleHoldsForCoordinator.mockResolvedValue([]);
  for (const name of ["listSlotRowsForDate", "listUnavailabilityInRange"]) {
    service[name].mockResolvedValue([]);
  }
});

function send(path, role = "event_coordinator", method = "GET", data) {
  return fetch(`${base}/api/venues${path}`, {
    method,
    headers: { Authorization: `Bearer ${role}`, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

// ---------------------------------------------------------------------------
// GET /:id/holds/eligible
// ---------------------------------------------------------------------------

test("[TC-SCRUM-162-01] GET /holds/eligible as coordinator returns 200 with matched groups", async () => {
  const holdGroup = {
    event: { id: "bbbbbbbb-1162-4000-8000-000000000010", name: "Charity Gala" },
    booking_date: futureDate,
    slots: [{ id: "cccccccc-1162-4000-8000-000000000011", slot: "am", expires_at: "2099-12-01T06:00:00Z" }],
  };
  service.listEligibleHoldsForCoordinator.mockResolvedValue([holdGroup]);

  const res = await send(`/${venueId}/holds/eligible`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0].event.name).toBe("Charity Gala");
  expect(service.listEligibleHoldsForCoordinator).toHaveBeenCalledWith(venueId, coordinatorId);
});

test("[TC-SCRUM-162-02] GET /holds/eligible as venue_staff → 403", async () => {
  const res = await send(`/${venueId}/holds/eligible`, "venue_staff");
  expect(res.status).toBe(403);
  expect(service.listEligibleHoldsForCoordinator).not.toHaveBeenCalled();
});

test("[TC-SCRUM-162-03] GET /holds/eligible returns empty array when no holds match", async () => {
  // service returns [] — expired or unmatched holds excluded in the service layer
  const res = await send(`/${venueId}/holds/eligible`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// POST /:id/booking-requests with hold_ids (hold conversion path)
// ---------------------------------------------------------------------------

test("[TC-SCRUM-162-04] POST /booking-requests with expired hold_ids → 409", async () => {
  const eventId = "dddddddd-1162-4000-8000-000000000004";
  const holdId = "eeeeeeee-1162-4000-8000-000000000005";
  service.getEventById.mockResolvedValue({
    id: eventId, name: "Charity Gala", status: "APPROVED",
    start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z",
  });
  // hold is expired — getActiveHoldsByIds finds nothing (fewer rows than requested)
  service.getActiveHoldsByIds.mockResolvedValue([]);

  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId, booking_date: futureDate, slots: ["am"],
    expected_attendees: 50, room_layout: "Theatre",
    required_facilities: [], accessibility_requirements: [],
    hold_ids: [holdId],
  });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/expired|no longer available/i);
  expect(service.linkHoldsToRequest).not.toHaveBeenCalled();
});

test("[TC-SCRUM-162-05] POST /booking-requests with valid hold_ids converts tentative slot → 201", async () => {
  const eventId = "ffffffff-1162-4000-8000-000000000006";
  const requestId = "aabbccdd-1162-4000-8000-000000000007";
  const holdId = "aabbccdd-1162-4000-8000-000000000008";

  service.getEventById.mockResolvedValue({
    id: eventId, name: "Charity Gala", status: "APPROVED",
    start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z",
  });
  service.getActiveHoldsByIds.mockResolvedValue([{
    id: holdId, venue_id: venueId, booking_date: futureDate,
    slot: "am", event_name: "Charity Gala", event_id: eventId, coordinator_id: coordinatorId,
  }]);
  // hold makes the slot tentative on the calendar — the conversion path overrides it to available
  service.listActiveHoldsInRange.mockResolvedValue([
    { booking_date: futureDate, slot: "am", event_name: "Charity Gala" },
  ]);
  service.submitBookingRequest.mockResolvedValue(requestId);
  service.getBookingRequestById.mockResolvedValue({
    id: requestId,
    event: { id: eventId, name: "Charity Gala", status: "APPROVED", start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z" },
    venue, slots: [{ slot: "am", status: "pending" }],
  });

  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId, booking_date: futureDate, slots: ["am"],
    expected_attendees: 50, room_layout: "Theatre",
    required_facilities: [], accessibility_requirements: [],
    hold_ids: [holdId],
  });
  expect(res.status).toBe(201);
  expect(service.linkHoldsToRequest).toHaveBeenCalledWith([holdId], requestId);
});

test("[TC-SCRUM-162-06] POST /booking-requests with hold_ids from different event → 409", async () => {
  const eventId = "aabbccdd-1162-4000-8000-000000000009";
  const otherEventId = "aabbccdd-1162-4000-8000-000000000029";
  const holdId = "aabbccdd-1162-4000-8000-000000000019";

  service.getEventById.mockResolvedValue({
    id: eventId, name: "Tech Summit", status: "APPROVED",
    start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z",
  });
  // hold is linked to a different event by event_id
  service.getActiveHoldsByIds.mockResolvedValue([{
    id: holdId, venue_id: venueId, booking_date: futureDate,
    slot: "am", event_name: "Charity Gala", event_id: otherEventId,
  }]);

  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId, booking_date: futureDate, slots: ["am"],
    expected_attendees: 50, room_layout: "Theatre",
    required_facilities: [], accessibility_requirements: [],
    hold_ids: [holdId],
  });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/match.*event|event.*match/i);
  expect(service.linkHoldsToRequest).not.toHaveBeenCalled();
});

test("[TC-SCRUM-162-09] POST /booking-requests with hold owned by different coordinator → 409", async () => {
  const eventId = "aabbccdd-1162-4000-8000-000000000020";
  const holdId = "aabbccdd-1162-4000-8000-000000000021";
  const otherCoordinatorId = "bbbbbbbb-1162-4000-8000-000000000099";

  service.getEventById.mockResolvedValue({
    id: eventId, name: "Charity Gala", status: "APPROVED",
    start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z",
  });
  // hold belongs to a different coordinator
  service.getActiveHoldsByIds.mockResolvedValue([{
    id: holdId, venue_id: venueId, booking_date: futureDate,
    slot: "am", event_name: "Charity Gala", event_id: eventId, coordinator_id: otherCoordinatorId,
  }]);

  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId, booking_date: futureDate, slots: ["am"],
    expected_attendees: 50, room_layout: "Theatre",
    required_facilities: [], accessibility_requirements: [],
    hold_ids: [holdId],
  });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/coordinator/i);
  expect(service.linkHoldsToRequest).not.toHaveBeenCalled();
});

test("[TC-SCRUM-162-10] GET /coordinators as venue_staff returns coordinator list", async () => {
  const res = await send("/coordinators", "venue_staff");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0].id).toBe(coordinatorId);
  expect(body.data[0].name).toBe("Test Coordinator");
});

test("[TC-SCRUM-162-11] GET /coordinators as event_coordinator → 403", async () => {
  const res = await send("/coordinators", "event_coordinator");
  expect(res.status).toBe(403);
});
