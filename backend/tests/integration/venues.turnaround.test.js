// SCRUM-134: Include setup and turnaround time in availability and conflict checks.
// Two sections:
//   1. Unit tests for committedSlots (pure function, no app needed)
//   2. Integration tests — real Express app, stubbed service, fake identities

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { committedSlots } = require("../../src/modules/venues/venues.availability");
const createApp = require("../../src/app");
const { once } = require("node:events");

// ---------------------------------------------------------------------------
// 1. committedSlots unit tests
// ---------------------------------------------------------------------------

describe("committedSlots", () => {
  test("[TC-SCRUM-134-01] no setup or turnaround returns only the requested slots", () => {
    expect(committedSlots(["am"], 0, 0)).toEqual(["am"]);
    expect(committedSlots(["am", "pm"], 0, 0)).toEqual(["am", "pm"]);
  });

  test("[TC-SCRUM-134-02] pm booking with 90 min setup spills into am slot", () => {
    // pm starts at 12:00; 90 min setup starts at 10:30 — inside am (08:00-12:00)
    expect(committedSlots(["pm"], 90, 0)).toEqual(["am", "pm"]);
  });

  test("[TC-SCRUM-134-03] am booking with 15 min turnaround spills into pm slot", () => {
    // am ends at 12:00; 15 min turnaround ends at 12:15 — inside pm (12:00-18:00)
    expect(committedSlots(["am"], 0, 15)).toEqual(["am", "pm"]);
  });

  test("[TC-SCRUM-134-01b] pm booking with setup AND turnaround covers all three slots", () => {
    // Marina Grand Ballroom: setup=120 (10:00 start), turnaround=60 (19:00 end)
    expect(committedSlots(["pm"], 120, 60)).toEqual(["am", "pm", "night"]);
  });

  test("[TC-SCRUM-134-01c] am booking with 0 turnaround does not include pm", () => {
    // am ends exactly at 12:00; pm starts at 12:00 — no overlap (strict less-than)
    expect(committedSlots(["am"], 0, 0)).toEqual(["am"]);
  });

  test("[TC-SCRUM-134-01d] night booking with 60 min turnaround stays within night (past midnight, no next slot)", () => {
    // night ends 23:00; +60 min = 00:00 next day — no slot covers that
    expect(committedSlots(["night"], 0, 60)).toEqual(["night"]);
  });

  test("[TC-SCRUM-134-01e] multi-slot am+pm booking with turnaround spills into night", () => {
    expect(committedSlots(["am", "pm"], 0, 30)).toEqual(["am", "pm", "night"]);
  });

  test("[TC-SCRUM-134-01f] empty input returns empty array", () => {
    expect(committedSlots([], 90, 60)).toEqual([]);
    expect(committedSlots(null, 90, 60)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Integration tests — API-level committed period conflict blocking
// ---------------------------------------------------------------------------

const venueId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const bookingDate = "2099-10-10"; // Friday — all venues open

// A venue with meaningful setup and turnaround so committed period spans adjacent slots
const venueWithBuffers = {
  id: venueId,
  name: "Buffer Hall",
  is_active: true,
  capacity: 200,
  facilities: ["Projector"],
  accessibility_features: ["Lift"],
  room_layouts: ["Theatre"],
  setup_minutes: 90,       // pm booking starts at 10:30 → am slot needed
  turnaround_minutes: 60,  // pm booking ends at 19:00 → night slot needed
  operating_hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
      day,
      { open: "08:00", close: "23:00" },
    ])
  ),
};

// A venue with 0 buffers, representing the legacy / no-buffer case
const venueNoBuffers = {
  ...venueWithBuffers,
  setup_minutes: 0,
  turnaround_minutes: 0,
};

const event = {
  id: eventId,
  name: "Assigned conference",
  status: "APPROVED",
  start_time: "2099-10-10T00:00:00Z",
  end_time: "2099-10-10T15:00:00Z",
};

const pmBody = {
  event_id: eventId,
  booking_date: bookingDate,
  slots: ["pm"],
  expected_attendees: 100,
  room_layout: "Theatre",
  required_facilities: [],
  accessibility_requirements: [],
};

const amBody = { ...pmBody, slots: ["am"] };

const service = Object.fromEntries(
  [
    "listVenues", "getVenueById", "updateVenue", "listBookingsInRange",
    "listUnavailabilityInRange", "listBookingsForVenuesOnDate",
    "listUnavailabilityForVenuesOnDate", "getEventById", "listBookableEvents",
    "listSlotRowsForDate", "submitBookingRequest", "getBookingRequestById",
    "listBookingRequests", "decideBookingRequest",
    "createUnavailabilityPeriod", "listUnavailabilityPeriods",
    "getUnavailabilityPeriodById", "updateUnavailabilityPeriod",
    "deleteUnavailabilityPeriod",
  ].map((name) => [name, vi.fn()])
);

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: {
        user:
          token === "invalid"
            ? null
            : {
                id: "verified-user",
                app_metadata: { roles: token.split(",") },
                user_metadata: {},
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
  service.getVenueById.mockResolvedValue(venueWithBuffers);
  service.listVenues.mockResolvedValue([venueWithBuffers]);
  service.getEventById.mockResolvedValue(event);
  service.listBookableEvents.mockResolvedValue([event]);
  for (const name of [
    "listBookingsInRange", "listUnavailabilityInRange", "listSlotRowsForDate",
    "listBookingRequests", "listBookingsForVenuesOnDate",
    "listUnavailabilityForVenuesOnDate",
  ]) {
    service[name].mockResolvedValue([]);
  }
  service.submitBookingRequest.mockResolvedValue(requestId);
  service.getBookingRequestById.mockResolvedValue({
    id: requestId, event, venue: venueWithBuffers,
    slots: [{ slot: "pm", status: "pending" }],
  });
});

function post(path, role, data) {
  return fetch(base + "/api/venues" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + role,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}
function get(path, role) {
  return fetch(base + "/api/venues" + path, {
    headers: { Authorization: "Bearer " + role },
  });
}

// ---------------------------------------------------------------------------
// AC2: blocked by buffer-slot conflict
// ---------------------------------------------------------------------------

test("[TC-SCRUM-134-04] pm booking blocked when am slot has confirmed booking (setup buffer)", async () => {
  // am is confirmed → setup period (10:30-12:00) falls inside am → 409
  service.listSlotRowsForDate.mockResolvedValue([
    { booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Other Event", request: null },
  ]);
  service.listUnavailabilityInRange.mockResolvedValue([]);

  const res = await post(`/${venueId}/booking-requests`, "event_coordinator", pmBody);
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.details.some((d) => d.includes("am") && d.includes("setup time"))).toBe(true);
});

test("[TC-SCRUM-134-05] pm booking blocked when night slot has confirmed booking (turnaround buffer)", async () => {
  // pm ends 18:00; +60 min turnaround → night slot (18:00-23:00) is needed → 409
  service.listSlotRowsForDate.mockResolvedValue([
    { booking_date: bookingDate, slot: "night", status: "confirmed", event_name: "Evening Gala", request: null },
  ]);
  service.listUnavailabilityInRange.mockResolvedValue([]);

  const res = await post(`/${venueId}/booking-requests`, "event_coordinator", pmBody);
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.details.some((d) => d.includes("night") && d.includes("turnaround time"))).toBe(true);
});

test("[TC-SCRUM-134-06] pm booking blocked when am is unavailable (setup buffer)", async () => {
  // am recorded as unavailable → setup buffer slot blocked → 409
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.listUnavailabilityInRange.mockResolvedValue([
    { unavailable_date: bookingDate, slot: "am", reason: "Maintenance" },
  ]);

  const res = await post(`/${venueId}/booking-requests`, "event_coordinator", pmBody);
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.details.some((d) => d.includes("am") && d.includes("setup time"))).toBe(true);
});

test("[TC-SCRUM-134-07] am booking blocked when pm is closed (turnaround buffer, partial operating hours)", async () => {
  // venue only open 08:00-12:00 → pm slot is closed → any turnaround from am is blocked
  const closedVenue = {
    ...venueWithBuffers,
    setup_minutes: 0,
    turnaround_minutes: 15,
    operating_hours: Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
        day,
        { open: "08:00", close: "12:00" },
      ])
    ),
  };
  service.getVenueById.mockResolvedValue(closedVenue);
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.listUnavailabilityInRange.mockResolvedValue([]);

  const res = await post(`/${venueId}/booking-requests`, "event_coordinator", amBody);
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.details.some((d) => d.includes("pm") && d.includes("turnaround time"))).toBe(true);
});

// ---------------------------------------------------------------------------
// AC3: allowed when committed period is clear
// ---------------------------------------------------------------------------

test("[TC-SCRUM-134-08] pm booking allowed when am and night are both available (committed period clear)", async () => {
  // All slots free — committed period (am + pm + night) has no conflicts
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.listUnavailabilityInRange.mockResolvedValue([]);

  const res = await post(`/${venueId}/booking-requests`, "event_coordinator", pmBody);
  expect(res.status).toBe(201);
});

test("[TC-SCRUM-134-09] venue with 0 setup/turnaround, am is booked, pm booking still allowed", async () => {
  // No buffers → committed period is exactly the pm slot → am booking does not block pm
  service.getVenueById.mockResolvedValue(venueNoBuffers);
  service.listSlotRowsForDate.mockResolvedValue([
    { booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Morning Session", request: null },
  ]);
  service.listUnavailabilityInRange.mockResolvedValue([]);

  const res = await post(`/${venueId}/booking-requests`, "event_coordinator", pmBody);
  expect(res.status).toBe(201);
});

// ---------------------------------------------------------------------------
// AC4: same rule in catalogue search (filterByAvailability)
// ---------------------------------------------------------------------------

test("[TC-SCRUM-134-10] catalogue search excludes venue when committed period for requested slot is blocked", async () => {
  // Search for pm slot; venue has setup=90 so am is part of committed period;
  // am is confirmed → venue should be excluded from results
  service.listBookingsForVenuesOnDate.mockResolvedValue([
    { venue_id: venueId, booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Blocked" },
  ]);
  service.listUnavailabilityForVenuesOnDate.mockResolvedValue([]);

  const res = await get(`?date=${bookingDate}&slots=pm`, "event_coordinator");
  expect(res.status).toBe(200);
  const { data } = await res.json();
  expect(data).toHaveLength(0);
});

test("[TC-SCRUM-134-11] catalogue search includes venue when committed period for requested slot is clear", async () => {
  // All slots available for this venue — committed period is clear
  service.listBookingsForVenuesOnDate.mockResolvedValue([]);
  service.listUnavailabilityForVenuesOnDate.mockResolvedValue([]);

  const res = await get(`?date=${bookingDate}&slots=pm`, "event_coordinator");
  expect(res.status).toBe(200);
  const { data } = await res.json();
  expect(data).toHaveLength(1);
  expect(data[0].id).toBe(venueId);
});
