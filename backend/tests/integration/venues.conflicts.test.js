// SCRUM-135: Flag bookings that conflict after a setup/turnaround change.
// Two sections:
//   1. Unit tests for findBufferConflicts (pure function, no app needed)
//   2. Integration tests — real Express app, stubbed service, fake identities

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { findBufferConflicts } = require("../../src/modules/venues/venues.conflicts");
const createApp = require("../../src/app");
const { once } = require("node:events");

// ---------------------------------------------------------------------------
// 1. findBufferConflicts unit tests
// ---------------------------------------------------------------------------

const reqId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherReqId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const date = "2099-10-10";

describe("findBufferConflicts", () => {
  test("[TC-SCRUM-135-01] no buffer expansion returns empty map", () => {
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      { request_id: otherReqId, booking_date: date, slot: "am", status: "confirmed", event_name: "Other Event" },
    ];
    const result = findBufferConflicts(requests, bookings, 0, 0);
    expect(result.size).toBe(0);
  });

  test("[TC-SCRUM-135-02] setup 90min: pm booking, am occupied by confirmed → setup conflict", () => {
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      { request_id: otherReqId, booking_date: date, slot: "am", status: "confirmed", event_name: "Morning Session" },
    ];
    const result = findBufferConflicts(requests, bookings, 90, 0);
    expect(result.size).toBe(1);
    const [conflict] = result.get(reqId);
    expect(conflict.slot).toBe("am");
    expect(conflict.type).toBe("setup");
    expect(conflict.conflicting_with).toBe("Morning Session");
    expect(conflict.reason).toContain("setup time");
  });

  test("[TC-SCRUM-135-03] turnaround 60min: pm booking, night occupied by pending hold → turnaround conflict", () => {
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      { request_id: otherReqId, booking_date: date, slot: "night", status: "pending", event_name: "Evening Hold" },
    ];
    const result = findBufferConflicts(requests, bookings, 0, 60);
    expect(result.size).toBe(1);
    const [conflict] = result.get(reqId);
    expect(conflict.slot).toBe("night");
    expect(conflict.type).toBe("turnaround");
    expect(conflict.conflicting_with).toBe("Evening Hold");
  });

  test("[TC-SCRUM-135-04] buffer slot expanded but empty — no conflict", () => {
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
    ];
    const result = findBufferConflicts(requests, bookings, 90, 60);
    expect(result.size).toBe(0);
  });

  test("[TC-SCRUM-135-08] no confirmed requests → empty map", () => {
    const result = findBufferConflicts([], [], 90, 60);
    expect(result.size).toBe(0);
  });

  test("[TC-SCRUM-135-09] input booking objects are not mutated", () => {
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const slots = ["pm"];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      { request_id: otherReqId, booking_date: date, slot: "am", status: "confirmed", event_name: "Other" },
    ];
    findBufferConflicts(requests, bookings, 90, 0);
    expect(slots).toEqual(["pm"]);
    expect(bookings[0].status).toBe("confirmed");
  });

  test("[TC-SCRUM-135-16] only the request with a buffer conflict appears in the map", () => {
    const clearReqId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const requests = [
      { request_id: reqId, booking_date: date, slots: ["pm"] },
      { request_id: clearReqId, booking_date: date, slots: ["am"] },
    ];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      { request_id: clearReqId, booking_date: date, slot: "am", status: "confirmed", event_name: "Morning" },
      // am is occupied by clearReqId itself, not another request — no conflict for it
      { request_id: otherReqId, booking_date: date, slot: "am", status: "confirmed", event_name: "Other" },
    ];
    // pm with setup=90 needs am; am is occupied by otherReqId → conflict for reqId
    // am with setup=90 would need nothing before it (no earlier slot); no setup conflict
    const result = findBufferConflicts(requests, bookings, 90, 0);
    expect(result.has(reqId)).toBe(true);
    expect(result.has(clearReqId)).toBe(false);
  });

  test("[TC-SCRUM-135-17] active hold in buffer slot is treated as an occupier", () => {
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      // SCRUM-146: hold row has no request_id; status="hold"
      { request_id: null, booking_date: date, slot: "am", status: "hold", event_name: "Charity Gala" },
    ];
    const result = findBufferConflicts(requests, bookings, 90, 0);
    expect(result.has(reqId)).toBe(true);
    const [conflict] = result.get(reqId);
    expect(conflict.slot).toBe("am");
    expect(conflict.type).toBe("setup");
    expect(conflict.conflicting_with).toBe("Charity Gala");
  });

  test("prefers confirmed occupier over pending when both hold the same buffer slot", () => {
    const pendingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const requests = [{ request_id: reqId, booking_date: date, slots: ["pm"] }];
    const bookings = [
      { request_id: reqId, booking_date: date, slot: "pm", status: "confirmed", event_name: "My Event" },
      { request_id: pendingId, booking_date: date, slot: "am", status: "pending", event_name: "Pending One" },
      { request_id: otherReqId, booking_date: date, slot: "am", status: "confirmed", event_name: "Confirmed One" },
    ];
    const result = findBufferConflicts(requests, bookings, 90, 0);
    const [conflict] = result.get(reqId);
    expect(conflict.conflicting_with).toBe("Confirmed One");
  });
});

// ---------------------------------------------------------------------------
// 2. Integration tests — API-level behaviour
// ---------------------------------------------------------------------------

const venueId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

const venueBase = {
  id: venueId,
  name: "Buffer Hall",
  is_active: true,
  capacity: 200,
  facilities: ["Projector"],
  accessibility_features: [],
  room_layouts: ["Theatre"],
  setup_minutes: 0,
  turnaround_minutes: 0,
  operating_hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "08:00", close: "23:00" }])
  ),
};

const flaggedRequest = {
  id: requestId,
  booking_date: "2099-10-10",
  expected_attendees: 50,
  room_layout: "Theatre",
  required_facilities: [],
  accessibility_requirements: [],
  additional_requirements: null,
  submitted_at: "2026-01-01T00:00:00Z",
  decided_at: null,
  decision_note: null,
  venue: { id: venueId, name: "Buffer Hall", city: "Singapore", country: "Singapore", capacity: 200 },
  event: { id: eventId, name: "Conference", status: "APPROVED", start_time: "2099-10-10T08:00:00Z", end_time: "2099-10-10T18:00:00Z" },
  slots: [{ slot: "pm", status: "confirmed" }],
  conflict_flags: [{ slot: "am", type: "setup", conflicting_with: "Morning Session", reason: "am is needed for setup time but is occupied by \"Morning Session\"" }],
};

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
    "recheckConflictsAfterUpdate", "listConflictingRequests",
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
  service.getVenueById.mockResolvedValue(venueBase);
  service.updateVenue.mockResolvedValue(venueBase);
  service.recheckConflictsAfterUpdate.mockResolvedValue(undefined);
  service.listConflictingRequests.mockResolvedValue([]);
  for (const name of [
    "listBookingsInRange", "listUnavailabilityInRange", "listSlotRowsForDate",
    "listBookingRequests", "listBookingsForVenuesOnDate", "listUnavailabilityForVenuesOnDate",
  ]) {
    service[name].mockResolvedValue([]);
  }
});

function patch(path, role, data) {
  return fetch(base + "/api/venues" + path, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + role, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
function get(path, role) {
  return fetch(base + "/api/venues" + path, {
    headers: { Authorization: "Bearer " + role },
  });
}

// ---------------------------------------------------------------------------
// AC1: setup/turnaround change triggers recheck
// ---------------------------------------------------------------------------

test("[TC-SCRUM-135-05] PATCH setup_minutes change triggers conflict recheck with updated venue", async () => {
  const oldVenue = { ...venueBase, setup_minutes: 0 };
  const newVenue = { ...venueBase, setup_minutes: 90 };
  service.getVenueById.mockResolvedValue(oldVenue);
  service.updateVenue.mockResolvedValue(newVenue);

  const res = await patch(`/${venueId}`, "venue_staff", { setup_minutes: 90 });
  expect(res.status).toBe(200);
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledOnce();
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledWith(venueId, newVenue);
});

test("[TC-SCRUM-135-06] PATCH turnaround_minutes change triggers conflict recheck", async () => {
  const oldVenue = { ...venueBase, turnaround_minutes: 0 };
  const newVenue = { ...venueBase, turnaround_minutes: 60 };
  service.getVenueById.mockResolvedValue(oldVenue);
  service.updateVenue.mockResolvedValue(newVenue);

  const res = await patch(`/${venueId}`, "venue_staff", { turnaround_minutes: 60 });
  expect(res.status).toBe(200);
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledOnce();
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledWith(venueId, newVenue);
});

test("[TC-SCRUM-135-07] PATCH both setup and turnaround change triggers recheck exactly once", async () => {
  const oldVenue = { ...venueBase, setup_minutes: 0, turnaround_minutes: 0 };
  const newVenue = { ...venueBase, setup_minutes: 90, turnaround_minutes: 60 };
  service.getVenueById.mockResolvedValue(oldVenue);
  service.updateVenue.mockResolvedValue(newVenue);

  const res = await patch(`/${venueId}`, "venue_staff", { setup_minutes: 90, turnaround_minutes: 60 });
  expect(res.status).toBe(200);
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledOnce();
});

test("[TC-SCRUM-135-10] PATCH non-buffer field does not trigger conflict recheck", async () => {
  service.updateVenue.mockResolvedValue({ ...venueBase, notes: "Updated notes" });

  const res = await patch(`/${venueId}`, "venue_staff", { notes: "Updated notes" });
  expect(res.status).toBe(200);
  expect(service.recheckConflictsAfterUpdate).not.toHaveBeenCalled();
});

test("[TC-SCRUM-135-11] PATCH setup_minutes with unchanged value does not trigger recheck", async () => {
  // old and new are both 0
  service.updateVenue.mockResolvedValue(venueBase);

  const res = await patch(`/${venueId}`, "venue_staff", { setup_minutes: 0 });
  expect(res.status).toBe(200);
  expect(service.recheckConflictsAfterUpdate).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// AC4: Staff can view flagged bookings
// ---------------------------------------------------------------------------

test("[TC-SCRUM-135-12] GET /booking-conflicts as venue_staff returns flagged requests with conflict detail", async () => {
  service.listConflictingRequests.mockResolvedValue([flaggedRequest]);

  const res = await get(`/${venueId}/booking-conflicts`, "venue_staff");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  const item = body.data[0];
  expect(item.conflict_flags).toBeDefined();
  expect(item.conflict_flags[0].type).toBe("setup");
  expect(item.conflict_flags[0].conflicting_with).toBe("Morning Session");
  expect(item.booking_date).toBe("2099-10-10");
  // Recheck runs on every GET so expired/released holds are cleared first.
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledOnce();
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledWith(venueId, venueBase);
});

test("[TC-SCRUM-135-13] GET /booking-conflicts as event_coordinator returns 403", async () => {
  const res = await get(`/${venueId}/booking-conflicts`, "event_coordinator");
  expect(res.status).toBe(403);
  expect(service.listConflictingRequests).not.toHaveBeenCalled();
});

test("[TC-SCRUM-135-14] GET /booking-conflicts for non-existent venue returns 404", async () => {
  service.getVenueById.mockResolvedValue(null);
  const res = await get(`/${venueId}/booking-conflicts`, "venue_staff");
  expect(res.status).toBe(404);
  expect(service.recheckConflictsAfterUpdate).not.toHaveBeenCalled();
});

test("[TC-SCRUM-135-15] GET /booking-conflicts with no flags returns empty array", async () => {
  service.listConflictingRequests.mockResolvedValue([]);
  const res = await get(`/${venueId}/booking-conflicts`, "venue_staff");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toEqual([]);
  expect(service.recheckConflictsAfterUpdate).toHaveBeenCalledOnce();
});
