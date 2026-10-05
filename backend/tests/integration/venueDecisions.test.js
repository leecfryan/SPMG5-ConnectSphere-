// SCRUM-22: Venue Staff decide a venue booking request.
// Same shape as venues.integration.test.js: a real Express app with a stubbed
// venue service and fake verified identities, so the routing, permission and
// validation layers are exercised without a database.
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const requestId = "33333333-3333-4333-8333-333333333333";
const venue = { id: "11111111-1111-4111-8111-111111111111", name: "Across locations", capacity: 200 };
const event = { id: "22222222-2222-4222-8222-222222222222", name: "Assigned conference", status: "APPROVED" };

const decided = (status, note = null) => ({
  id: requestId,
  booking_date: "2099-10-10",
  expected_attendees: 100,
  room_layout: "Theatre",
  required_facilities: [],
  accessibility_requirements: [],
  additional_requirements: null,
  submitted_at: "2099-10-01T00:00:00Z",
  decided_at: "2099-10-02T00:00:00Z",
  decision_note: note,
  venue,
  event,
  slots: [{ slot: "am", status }],
});

const service = Object.fromEntries(
  ["listVenues", "getVenueById", "updateVenue", "listBookingsInRange", "listUnavailabilityInRange",
    "getEventById", "listBookableEvents", "listSlotRowsForDate", "submitBookingRequest",
    "getBookingRequestById", "listBookingRequests", "decideBookingRequest"].map((name) => [name, vi.fn()])
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
  service.decideBookingRequest.mockResolvedValue(requestId);
  service.getBookingRequestById.mockResolvedValue(decided("confirmed"));
});

function decide(body, role = "venue_staff", id = requestId) {
  return fetch(`${base}/api/venues/booking-requests/${id}/decision`, {
    method: "PATCH",
    headers: {
      ...(role ? { Authorization: "Bearer " + role } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("[SCRUM-22] Venue Staff approve a pending request and every slot is confirmed", async () => {
  const response = await decide({ decision: "confirmed" });

  expect(response.status).toBe(200);
  expect((await response.json()).data.status).toBe("confirmed");
  expect(service.decideBookingRequest).toHaveBeenCalledWith(
    requestId, "confirmed", null, "verified-user"
  );
});

test("[SCRUM-22] Rejecting records the reason and changes no booking", async () => {
  service.getBookingRequestById.mockResolvedValue(decided("rejected", "Held for another event"));

  const response = await decide({ decision: "rejected", note: "  Held for another event  " });

  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.status).toBe("rejected");
  expect(data.decision_note).toBe("Held for another event");
  // The note is trimmed, and the reviewer identity comes from the session
  expect(service.decideBookingRequest).toHaveBeenCalledWith(
    requestId, "rejected", "Held for another event", "verified-user"
  );
  // A rejection must not rebook anything: that is the coordinator's job
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
  expect(service.updateVenue).not.toHaveBeenCalled();
});

test.each(["", "invalid", "event_coordinator", "event_organiser", "attendee", "technical_support_staff", "event_ops_manager"])(
  "[VENUE-DECIDE-001] %s cannot decide a booking request",
  async (role) => {
    const response = await decide({ decision: "confirmed" }, role);

    expect(response.status).toBe(!role || role === "invalid" ? 401 : 403);
    expect(service.decideBookingRequest).not.toHaveBeenCalled();
  }
);

test("[VENUE-DECIDE-002] Malformed decisions are rejected before any write", async () => {
  for (const body of [
    {},
    { decision: "maybe" },
    { decision: "pending" },
    { decision: "confirmed", note: 42 },
    { decision: "confirmed", note: "x".repeat(2001) },
    { decision: "confirmed", decided_by: "forged" },
  ]) {
    expect((await decide(body)).status).toBe(400);
  }
  expect(service.decideBookingRequest).not.toHaveBeenCalled();
});

test("[VENUE-DECIDE-003] A missing or malformed request id is handled, not assumed", async () => {
  expect((await decide({ decision: "confirmed" }, "venue_staff", "not-a-uuid")).status).toBe(400);

  service.decideBookingRequest.mockResolvedValue(null);
  expect((await decide({ decision: "confirmed" })).status).toBe(404);
});

test("[VENUE-DECIDE-004] A slot already confirmed elsewhere returns a conflict, not a server error", async () => {
  // 23P01 is the exclusion constraint from 003_yc_create_venue_bookings.sql
  const clash = new Error("conflicting key value violates exclusion constraint");
  clash.code = "23P01";
  service.decideBookingRequest.mockRejectedValue(clash);

  const response = await decide({ decision: "confirmed" });

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/already confirmed/i);
});

// ---------------------------------------------------------------------------
// SCRUM-20: block conflicting venue booking
//
// The block itself is the confirmed-slot exclusion constraint in Postgres, so
// these tests are about the two things the backend is responsible for: saying
// which slot clashed, and refusing to let anyone approve past it.
// ---------------------------------------------------------------------------

const otherEventId = "99999999-9999-4999-8999-999999999999";

const stillPending = (slots) => ({
  ...decided("pending"),
  decided_at: null,
  slots: slots.map((slot) => ({ slot, status: "pending" })),
});

const heldByAnotherEvent = (slot, eventName) => ({
  booking_date: "2099-10-10",
  slot,
  status: "confirmed",
  event_name: eventName,
  request: { event_id: otherEventId },
});

// The database refuses the whole statement, which is what actually blocks it.
function databaseRefusesTheApproval() {
  const clash = new Error("conflicting key value violates exclusion constraint");
  clash.code = "23P01";
  service.decideBookingRequest.mockRejectedValue(clash);
}

test("[SCRUM-20] A refused approval names the slot that clashes and what holds it", async () => {
  service.getBookingRequestById.mockResolvedValue(stillPending(["am", "pm"]));
  service.listSlotRowsForDate.mockResolvedValue([heldByAnotherEvent("am", "Charity gala")]);
  databaseRefusesTheApproval();

  const response = await decide({ decision: "confirmed" });
  const { error, details } = await response.json();

  expect(response.status).toBe(409);
  expect(error).toMatch(/already confirmed/i);
  // The clash is identified down to the slot and the event holding it, and the
  // free pm slot is not reported as a problem.
  expect(details).toEqual(['am on 2099-10-10 is already confirmed for "Charity gala"']);
  expect(service.listSlotRowsForDate).toHaveBeenCalledWith(venue.id, "2099-10-10");
});

test("[SCRUM-20] A slot already held by this request's own event is not a clash", async () => {
  service.getBookingRequestById.mockResolvedValue(stillPending(["am"]));
  service.listSlotRowsForDate.mockResolvedValue([
    { booking_date: "2099-10-10", slot: "am", status: "confirmed", event_name: event.name, request: { event_id: event.id } },
  ]);
  databaseRefusesTheApproval();

  const { details } = await (await decide({ decision: "confirmed" })).json();

  expect(details[0]).toMatch(/Refresh the list/);
});

test("[SCRUM-20] An approval cannot be forced through by an override or a priority", async () => {
  databaseRefusesTheApproval();

  for (const body of [
    { decision: "confirmed", override: true },
    { decision: "confirmed", force: true },
    { decision: "confirmed", priority: "VIP" },
    { decision: "confirmed", note: "Requester is the Dean", override: "yes" },
  ]) {
    expect((await decide(body)).status).toBe(400);
  }

  // Importance is not a field anywhere in this flow, so nothing reached the
  // database to be overridden in the first place.
  expect(service.decideBookingRequest).not.toHaveBeenCalled();
});

test("[SCRUM-20] Non-conflicting requests continue through the booking process", async () => {
  const response = await decide({ decision: "confirmed" });

  expect(response.status).toBe(200);
  expect((await response.json()).data.status).toBe("confirmed");
  expect(service.decideBookingRequest).toHaveBeenCalledWith(
    requestId, "confirmed", null, "verified-user"
  );
});

test("[SCRUM-20] Explaining the clash never turns the refusal into a server error", async () => {
  databaseRefusesTheApproval();
  service.getBookingRequestById.mockRejectedValue(new Error("Failed to fetch booking request"));

  const response = await decide({ decision: "confirmed" });

  expect(response.status).toBe(409);
  expect((await response.json()).details[0]).toMatch(/Refresh the list/);
});

// ---------------------------------------------------------------------------
// SCRUM-102: reject a booking with a reason and suggested alternative
//
// SCRUM-22 left the reason optional because its own AC said staff *may* give
// one. These tests hold the new rule: a rejection without a reason is refused,
// an approval without one is not.
// ---------------------------------------------------------------------------

const ALTERNATIVE =
  "Marina is already held for the gala that morning. Orchard Seminar Room 3 is free AM on the same date and seats 80.";

test("[SCRUM-102] A rejection with no reason is refused and nothing is decided", async () => {
  const response = await decide({ decision: "rejected" });

  expect(response.status).toBe(400);
  expect((await response.json()).details.join(" ")).toMatch(/note is required when rejecting/i);
  expect(service.decideBookingRequest).not.toHaveBeenCalled();
});

test("[SCRUM-102] An empty or whitespace-only reason does not count as a reason", async () => {
  for (const body of [
    { decision: "rejected", note: null },
    { decision: "rejected", note: "" },
    { decision: "rejected", note: "   " },
    { decision: "rejected", note: "\n\t " },
  ]) {
    expect((await decide(body)).status).toBe(400);
  }

  expect(service.decideBookingRequest).not.toHaveBeenCalled();
});

test("[SCRUM-102] A rejection carrying a reason and a suggested alternative is recorded", async () => {
  service.getBookingRequestById.mockResolvedValue(decided("rejected", ALTERNATIVE));

  const response = await decide({ decision: "rejected", note: `  ${ALTERNATIVE}  ` });
  const { data } = await response.json();

  expect(response.status).toBe(200);
  expect(data.status).toBe("rejected");
  // The suggested alternative travels in the same note, trimmed but otherwise
  // untouched, so nothing the reviewer wrote is lost.
  expect(service.decideBookingRequest).toHaveBeenCalledWith(
    requestId, "rejected", ALTERNATIVE, "verified-user"
  );
  expect(data.decision_note).toBe(ALTERNATIVE);
});

test("[SCRUM-102] The requesting coordinator reads the reason under their own scope", async () => {
  service.getBookingRequestById.mockResolvedValue(decided("rejected", ALTERNATIVE));

  const listed = await fetch(`${base}/api/venues/booking-requests/${requestId}`, {
    headers: { Authorization: "Bearer event_coordinator" },
  });
  const { data } = await listed.json();

  expect(listed.status).toBe(200);
  expect(data.decision_note).toBe(ALTERNATIVE);
  // Scope comes from the session, so a coordinator only ever reads their own.
  expect(service.getBookingRequestById).toHaveBeenCalledWith(
    requestId, { coordinatorId: "verified-user" }
  );
});

test("[SCRUM-102] Approving still needs no reason", async () => {
  const response = await decide({ decision: "confirmed" });

  expect(response.status).toBe(200);
  expect(service.decideBookingRequest).toHaveBeenCalledWith(
    requestId, "confirmed", null, "verified-user"
  );
});
