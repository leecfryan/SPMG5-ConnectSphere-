// SCRUM-154: a coordinator changes or cancels one venue booking on a
// multi-venue event without touching the event's other venue bookings.
// Same shape as venueDecisions.test.js: a real Express app with a stubbed
// venue service and fake verified identities, so routing, permission and
// validation are exercised without a database. The atomic SQL functions
// themselves (change_venue_booking_request, cancel_venue_booking_request) -
// including the single-transaction event_activity_log insert (AC4) and the
// cross-request scoping (AC1) - are proven by the live-DB test once the
// schema is applied; these tests prove everything Node is responsible for.
//
// Change is scoped to date and non-slot details (attendees, room layout,
// facilities, accessibility, additional requirements) - slot selection is out
// of scope by decision. A date change carries the booking's existing slots
// over to the new date unchanged; only a date move triggers an availability
// check at all.
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const venueId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const bookingDate = "2099-10-10";

const venue = {
  id: venueId, name: "Across locations", is_active: true, capacity: 200,
  facilities: ["Projector"], accessibility_features: ["Lift"], room_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { open: "08:00", close: "23:00" }])),
};
const event = { id: eventId, name: "Assigned conference", status: "APPROVED", start_time: "2099-10-01T00:00:00Z", end_time: "2099-10-20T00:00:00Z" };

const changeBody = {
  booking_date: bookingDate, expected_attendees: 100,
  room_layout: "Theatre", required_facilities: ["Projector"], accessibility_requirements: ["Lift"],
  additional_requirements: null,
};

function existingRequest({ slots = [{ slot: "am", status: "confirmed" }], eventStatus = "APPROVED" } = {}) {
  return {
    id: requestId, booking_date: bookingDate, expected_attendees: 100, room_layout: "Theatre",
    required_facilities: ["Projector"], accessibility_requirements: ["Lift"], additional_requirements: null,
    submitted_at: "2099-09-01T00:00:00Z", decided_at: "2099-09-02T00:00:00Z", decision_note: null,
    venue, event: { ...event, status: eventStatus }, slots,
  };
}

const service = Object.fromEntries(
  ["getVenueById", "listUnavailabilityInRange", "listSlotRowsForDate", "listActiveHoldsInRange",
    "getBookingRequestById", "changeBookingRequest", "cancelBookingRequest"].map((name) => [name, vi.fn()])
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
  service.getVenueById.mockResolvedValue(venue);
  service.listUnavailabilityInRange.mockResolvedValue([]);
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.listActiveHoldsInRange.mockResolvedValue([]);
  service.getBookingRequestById.mockResolvedValue(existingRequest());
  service.changeBookingRequest.mockResolvedValue(requestId);
  service.cancelBookingRequest.mockResolvedValue(1);
});

function change(body, role = "event_coordinator", id = requestId) {
  return fetch(`${base}/api/venues/booking-requests/${id}`, {
    method: "PATCH",
    headers: { ...(role ? { Authorization: "Bearer " + role } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cancel(role = "event_coordinator", id = requestId) {
  return fetch(`${base}/api/venues/booking-requests/${id}/cancel`, {
    method: "PATCH",
    headers: role ? { Authorization: "Bearer " + role } : {},
  });
}

// ---------------------------------------------------------------------------
// AC1: changing or cancelling one booking only ever touches that one request.
// The event's other bookings live in other venue_booking_requests rows and
// are never read or written by either handler - the scoping proof itself
// (the SQL WHERE clause only matching this request_id) is VENUE-DB-006/008's
// job; this proves the controller never asks the service for anything beyond
// the one id in the URL.
// ---------------------------------------------------------------------------

test("[TC-SCRUM-154-01] Cancelling one booking calls the service with only that request's id", async () => {
  const response = await cancel();

  expect(response.status).toBe(200);
  expect(service.cancelBookingRequest).toHaveBeenCalledWith(requestId, "verified-user");
  expect(service.cancelBookingRequest).toHaveBeenCalledTimes(1);
});

test("[TC-SCRUM-154-02] Changing one booking calls the service with only that request's id", async () => {
  const response = await change(changeBody);

  expect(response.status).toBe(200);
  expect(service.changeBookingRequest).toHaveBeenCalledWith(requestId, "verified-user", expect.objectContaining(changeBody));
  expect(service.changeBookingRequest).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// AC2: a changed booking is re-flagged and checked again.
// ---------------------------------------------------------------------------

test("[TC-SCRUM-154-03] Changing non-slot details on the same date sends the full merged value, and runs no availability check", async () => {
  service.getBookingRequestById
    .mockResolvedValueOnce(existingRequest()) // read before the change
    .mockResolvedValueOnce(existingRequest({ slots: [{ slot: "am", status: "pending" }] })); // read back after

  const response = await change({ ...changeBody, expected_attendees: 120 });
  const { data } = await response.json();

  expect(response.status).toBe(200);
  expect(data.status).toBe("pending");
  expect(service.changeBookingRequest).toHaveBeenCalledWith(
    requestId, "verified-user", expect.objectContaining({ expected_attendees: 120 })
  );
  // The date did not move, so there is nothing new to check availability for.
  expect(service.listSlotRowsForDate).not.toHaveBeenCalled();
});

test("[TC-SCRUM-154-06] Changing the booking date checks the booking's existing slots on the new date, and carries them over", async () => {
  const response = await change({ ...changeBody, booking_date: "2099-10-12" });

  expect(response.status).toBe(200);
  expect(service.listSlotRowsForDate).toHaveBeenCalledWith(venueId, "2099-10-12");
  expect(service.changeBookingRequest).toHaveBeenCalledWith(
    requestId, "verified-user", expect.objectContaining({ booking_date: "2099-10-12" })
  );
  // Slots are never part of the payload - the SQL function reads them itself.
  expect(service.changeBookingRequest.mock.calls[0][2]).not.toHaveProperty("slots");
});

test("[TC-SCRUM-154-08] Moving the date onto a slot another live request already holds there is refused before any write", async () => {
  service.listSlotRowsForDate.mockResolvedValue([
    { booking_date: "2099-10-12", slot: "am", status: "confirmed", event_name: "Other event", request: { id: "other-request", event_id: "other-event" } },
  ]);

  const response = await change({ ...changeBody, booking_date: "2099-10-12" });

  expect(response.status).toBe(409);
  expect(service.changeBookingRequest).not.toHaveBeenCalled();
});

test("[TC-SCRUM-154-09] Keeping the same date never runs an availability check at all", async () => {
  // If this ran, it would wrongly look like a conflict with the booking's own
  // row - proving instead that the check is skipped entirely when the date
  // does not move.
  service.listSlotRowsForDate.mockResolvedValue([
    { booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Assigned conference", request: { id: requestId, event_id: eventId } },
  ]);

  const response = await change(changeBody);

  expect(response.status).toBe(200);
  expect(service.listSlotRowsForDate).not.toHaveBeenCalled();
  expect(service.changeBookingRequest).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// AC3: a cancelled booking's period is released.
// ---------------------------------------------------------------------------

test("[TC-SCRUM-154-10] Cancelling a confirmed booking returns the now-cancelled booking", async () => {
  service.getBookingRequestById
    .mockResolvedValueOnce(existingRequest())
    .mockResolvedValueOnce(existingRequest({ slots: [{ slot: "am", status: "cancelled" }] }));

  const response = await cancel();
  const { data } = await response.json();

  expect(response.status).toBe(200);
  expect(data.status).toBe("cancelled");
});

// ---------------------------------------------------------------------------
// Terminal bookings: neither action is re-appliable once nothing is live.
// ---------------------------------------------------------------------------

test.each([
  ["cancel", () => cancel()],
  ["change", () => change(changeBody)],
])("[TC-SCRUM-154-11] %s on a request with no live rows is refused, not silently accepted", async (_label, run) => {
  const notLive = new Error("NOT_LIVE");
  notLive.code = "P0003";
  service.changeBookingRequest.mockRejectedValue(notLive);
  service.cancelBookingRequest.mockRejectedValue(notLive);

  const response = await run();

  expect(response.status).toBe(409);
});

// ---------------------------------------------------------------------------
// Access control: coordinator-only, and only the assigned coordinator.
// ---------------------------------------------------------------------------

test.each(["", "invalid", "venue_staff", "event_organiser", "attendee", "technical_support_staff", "event_coordinator_lead"])(
  "[TC-SCRUM-154-13] %s cannot change or cancel a venue booking",
  async (role) => {
    const changeResponse = await change(changeBody, role);
    const cancelResponse = await cancel(role);

    const expected = !role || role === "invalid" ? 401 : 403;
    expect(changeResponse.status).toBe(expected);
    expect(cancelResponse.status).toBe(expected);
    expect(service.changeBookingRequest).not.toHaveBeenCalled();
    expect(service.cancelBookingRequest).not.toHaveBeenCalled();
  }
);

test("[TC-SCRUM-154-13] A coordinator not assigned to this event's booking gets the same 404 as a missing one", async () => {
  // bookingScope filters the query itself; a request outside the coordinator's
  // own events never comes back, same as getBookingRequest's existing 404.
  service.getBookingRequestById.mockResolvedValue(null);

  const changeResponse = await change(changeBody);
  const cancelResponse = await cancel();

  expect(changeResponse.status).toBe(404);
  expect(cancelResponse.status).toBe(404);
  expect(service.changeBookingRequest).not.toHaveBeenCalled();
  expect(service.cancelBookingRequest).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Status boundary: frozen outside PLANNING_STATUSES.
// ---------------------------------------------------------------------------

test.each(["SAFETY_REVIEW", "COMPLETED", "CANCELLED", "REJECTED", "POSTPONED", "SUBMITTED", "UNDER_REVIEW", "DRAFT"])(
  "[TC-SCRUM-154-14] Neither action is allowed while the event is %s",
  async (status) => {
    service.getBookingRequestById.mockResolvedValue(existingRequest({ eventStatus: status }));

    const changeResponse = await change(changeBody);
    const cancelResponse = await cancel();

    expect(changeResponse.status).toBe(409);
    expect(cancelResponse.status).toBe(409);
    expect(service.changeBookingRequest).not.toHaveBeenCalled();
    expect(service.cancelBookingRequest).not.toHaveBeenCalled();
  }
);

test.each(["APPROVED", "CONFIRMED"])("[TC-SCRUM-154-14] Both actions are allowed while the event is %s", async (status) => {
  service.getBookingRequestById.mockResolvedValue(existingRequest({ eventStatus: status }));

  expect((await change(changeBody)).status).toBe(200);
  expect((await cancel()).status).toBe(200);
});

// ---------------------------------------------------------------------------
// Failure: malformed or missing ids, and fields outside this story's scope.
// ---------------------------------------------------------------------------

test("[TC-SCRUM-154-15] A malformed request id is rejected before any lookup", async () => {
  expect((await change(changeBody, "event_coordinator", "not-a-uuid")).status).toBe(400);
  expect((await cancel("event_coordinator", "not-a-uuid")).status).toBe(400);
  expect(service.getBookingRequestById).not.toHaveBeenCalled();
});

test("[TC-SCRUM-154-15] A request id the service cannot find once reached the database is a 404, not a 500", async () => {
  const notFound = new Error("REQUEST_NOT_FOUND");
  notFound.code = "P0002";
  service.changeBookingRequest.mockRejectedValue(notFound);
  service.cancelBookingRequest.mockRejectedValue(notFound);

  expect((await change(changeBody)).status).toBe(404);
  expect((await cancel()).status).toBe(404);
});

test("[TC-SCRUM-154-15] Unknown fields - slots, purpose and event_id - are refused rather than silently accepted", async () => {
  for (const extra of [{ slots: ["am"] }, { purpose: "Should not be here" }, { event_id: eventId }]) {
    const response = await change({ ...changeBody, ...extra });
    expect(response.status).toBe(400);
  }
  expect(service.changeBookingRequest).not.toHaveBeenCalled();
});
