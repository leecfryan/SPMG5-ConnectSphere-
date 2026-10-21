// SCRUM-146: Tentative venue hold with expiry.
// Two sections:
//   1. Unit tests for buildAvailabilityCalendar with holds (tentative status)
//   2. Integration tests — real Express app, stubbed service, fake identities

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildAvailabilityCalendar } = require("../../src/modules/venues/venues.availability");
const createApp = require("../../src/app");
const { once } = require("node:events");

// ---------------------------------------------------------------------------
// 1. buildAvailabilityCalendar unit tests — tentative status
// ---------------------------------------------------------------------------

const OPEN_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "08:00", close: "23:00" }])
);
const DATE = "2099-11-10"; // Monday

describe("buildAvailabilityCalendar with holds", () => {
  test("[TC-SCRUM-146-11] active hold on am → slot is tentative with event name as label", () => {
    const [day] = buildAvailabilityCalendar({
      operatingHours: OPEN_HOURS,
      bookings: [],
      unavailability: [],
      holds: [{ booking_date: DATE, slot: "am", event_name: "Charity Gala" }],
      from: DATE,
      to: DATE,
    });
    expect(day.slots.am).toEqual({ status: "tentative", label: "Charity Gala" });
    expect(day.slots.pm.status).toBe("available");
    expect(day.slots.night.status).toBe("available");
  });

  test("[TC-SCRUM-146-12] confirmed booking outranks hold — slot is booked not tentative", () => {
    const [day] = buildAvailabilityCalendar({
      operatingHours: OPEN_HOURS,
      bookings: [{ booking_date: DATE, slot: "am", status: "confirmed", event_name: "Senior Conference" }],
      unavailability: [],
      holds: [{ booking_date: DATE, slot: "am", event_name: "Charity Gala" }],
      from: DATE,
      to: DATE,
    });
    expect(day.slots.am).toEqual({ status: "booked", label: "Senior Conference" });
  });

  test("[TC-SCRUM-146-13] hold outranks pending request — slot is tentative not pending", () => {
    const [day] = buildAvailabilityCalendar({
      operatingHours: OPEN_HOURS,
      bookings: [{ booking_date: DATE, slot: "pm", status: "pending", event_name: "Tech Summit" }],
      unavailability: [],
      holds: [{ booking_date: DATE, slot: "pm", event_name: "Charity Gala" }],
      from: DATE,
      to: DATE,
    });
    expect(day.slots.pm).toEqual({ status: "tentative", label: "Charity Gala" });
  });

  test("[TC-SCRUM-146-14] no active holds passed → slot is available", () => {
    const [day] = buildAvailabilityCalendar({
      operatingHours: OPEN_HOURS,
      bookings: [],
      unavailability: [],
      holds: [],
      from: DATE,
      to: DATE,
    });
    expect(day.slots.am.status).toBe("available");
    expect(day.slots.pm.status).toBe("available");
    expect(day.slots.night.status).toBe("available");
  });

  test("[TC-SCRUM-146-14b] holds parameter absent → behaves as no holds", () => {
    const [day] = buildAvailabilityCalendar({
      operatingHours: OPEN_HOURS,
      bookings: [],
      unavailability: [],
      from: DATE,
      to: DATE,
    });
    expect(day.slots.am.status).toBe("available");
  });
});

// ---------------------------------------------------------------------------
// 2. Integration tests — hold endpoints and booking-request block
// ---------------------------------------------------------------------------

const venueId = "aaaaaaaa-1146-4000-8000-000000000001";
const futureDate = "2099-12-01";
const venue = {
  id: venueId, name: "Test Hall", is_active: true, capacity: 200,
  facilities: [], accessibility_features: [], room_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "08:00", close: "23:00" }])
  ),
  setup_minutes: 0, turnaround_minutes: 0,
};
const holdRows = [
  { id: "hh-1", booking_date: futureDate, slot: "am", event_name: "Charity Gala", requested_by: "staff-id", expires_at: "2099-12-01T06:00:00Z", created_at: "2099-11-01T00:00:00Z" },
  { id: "hh-2", booking_date: "2099-11-15", slot: "pm", event_name: "Expired Hold", requested_by: "staff-id", expires_at: "2099-11-15T00:00:00Z", created_at: "2099-11-01T00:00:00Z" },
];

const service = Object.fromEntries([
  "listVenues", "getVenueById", "updateVenue", "listBookingsInRange", "listUnavailabilityInRange",
  "listBookingsForVenuesOnDate", "listUnavailabilityForVenuesOnDate", "getEventById",
  "listBookableEvents", "listSlotRowsForDate", "submitBookingRequest", "getBookingRequestById",
  "listBookingRequests", "listActiveHoldsInRange", "listHolds", "createHold",
].map((name) => [name, vi.fn()]));

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: {
        user: token === "invalid" ? null : {
          id: "staff-id",
          app_metadata: { roles: token.split(",") },
          user_metadata: { roles: ["venue_staff"] },
        },
      },
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
  service.getVenueById.mockResolvedValue(venue);
  service.listActiveHoldsInRange.mockResolvedValue([]);
  service.listHolds.mockResolvedValue(holdRows);
  service.createHold.mockResolvedValue([holdRows[0]]);
  for (const name of ["listBookingsInRange", "listUnavailabilityInRange", "listSlotRowsForDate", "listBookingRequests"]) {
    service[name].mockResolvedValue([]);
  }
});

function send(path, role = "venue_staff", method = "GET", data) {
  return fetch(`${base}/api/venues${path}`, {
    method,
    headers: { Authorization: `Bearer ${role}`, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

const validHoldBody = {
  event_id: "aaaaaaaa-0000-4000-8000-000000000099",
  event_name: "Charity Gala",
  booking_date: futureDate,
  slots: ["am"],
  expires_at: "2099-12-01T06:00:00.000Z",
  coordinator_id: "aaaaaaaa-0000-4000-8000-000000000001",
};

test("[TC-SCRUM-146-01] POST /holds happy path returns 201 with hold records", async () => {
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", validHoldBody);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(Array.isArray(body.data)).toBe(true);
  expect(service.createHold).toHaveBeenCalledWith(venueId, validHoldBody, "staff-id");
});

test("[TC-SCRUM-146-02] POST /holds as event_coordinator returns 403", async () => {
  const res = await send(`/${venueId}/holds`, "event_coordinator", "POST", validHoldBody);
  expect(res.status).toBe(403);
  expect(service.createHold).not.toHaveBeenCalled();
});

test("[TC-SCRUM-146-03] POST /holds with expires_at in the past returns 400", async () => {
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", {
    ...validHoldBody,
    expires_at: "2020-01-01T00:00:00.000Z",
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.details).toContain("expires_at must be in the future");
  expect(service.createHold).not.toHaveBeenCalled();
});

test("[TC-SCRUM-146-04] POST /holds with expires_at one hour ago returns 400", async () => {
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", {
    ...validHoldBody,
    expires_at: oneHourAgo,
  });
  expect(res.status).toBe(400);
  expect(service.createHold).not.toHaveBeenCalled();
});

test("[TC-SCRUM-146-05] GET /holds returns all holds including expired", async () => {
  const res = await send(`/${venueId}/holds`, "venue_staff");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(2);
  expect(body.data.some((h) => h.event_name === "Expired Hold")).toBe(true);
});

test("[TC-SCRUM-146-06] GET /holds as event_coordinator returns 403", async () => {
  const res = await send(`/${venueId}/holds`, "event_coordinator");
  expect(res.status).toBe(403);
  expect(service.listHolds).not.toHaveBeenCalled();
});

test("[TC-SCRUM-146-07] POST /holds venue not found returns 404", async () => {
  service.getVenueById.mockResolvedValue(null);
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", validHoldBody);
  expect(res.status).toBe(404);
  expect(service.createHold).not.toHaveBeenCalled();
});

test("[TC-SCRUM-146-08] POST /holds missing event_name returns 400", async () => {
  const { event_name: _omit, ...noName } = validHoldBody;
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", noName);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.details).toContain("event_name is required");
});

test("[TC-SCRUM-146-09] booking request blocked when active hold covers the slot", async () => {
  const eventId = "bbbbbbbb-1146-4000-8000-000000000002";
  service.getEventById.mockResolvedValue({
    id: eventId, name: "My Conf", status: "APPROVED",
    start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z",
  });
  // active hold occupies am on futureDate
  service.listActiveHoldsInRange.mockResolvedValue([
    { booking_date: futureDate, slot: "am", event_name: "Charity Gala" },
  ]);

  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId,
    booking_date: futureDate,
    slots: ["am"],
    expected_attendees: 50,
    room_layout: "Theatre",
    required_facilities: [],
    accessibility_requirements: [],
  });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.details.some((d) => /am/.test(d))).toBe(true);
});

test("[TC-SCRUM-162-08] POST /holds missing coordinator_id returns 400", async () => {
  const { coordinator_id: _omit, ...noCoordinator } = validHoldBody;
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", noCoordinator);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.details).toContain("coordinator_id must be a valid user UUID");
  expect(service.createHold).not.toHaveBeenCalled();
});

test("[TC-SCRUM-146-10] booking request succeeds when hold is expired (not in active list)", async () => {
  const eventId = "cccccccc-1146-4000-8000-000000000003";
  const requestId = "dddddddd-1146-4000-8000-000000000004";
  service.getEventById.mockResolvedValue({
    id: eventId, name: "My Conf", status: "APPROVED",
    start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z",
  });
  // listActiveHoldsInRange returns empty — expired hold excluded
  service.listActiveHoldsInRange.mockResolvedValue([]);
  service.submitBookingRequest.mockResolvedValue(requestId);
  service.getBookingRequestById.mockResolvedValue({
    id: requestId,
    event: { id: eventId, name: "My Conf", status: "APPROVED", start_time: "2099-12-01T00:00:00Z", end_time: "2099-12-01T23:00:00Z" },
    venue, slots: [{ slot: "am", status: "pending" }],
  });

  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId,
    booking_date: futureDate,
    slots: ["am"],
    expected_attendees: 50,
    room_layout: "Theatre",
    required_facilities: [],
    accessibility_requirements: [],
  });
  expect(res.status).toBe(201);
});

test("[TC-SCRUM-146-15] POST /holds with invalid slot value returns 400", async () => {
  const res = await send(`/${venueId}/holds`, "venue_staff", "POST", {
    ...validHoldBody,
    slots: ["morning"],
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.details.some((d) => /slots/.test(d))).toBe(true);
});
