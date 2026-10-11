// SCRUM-98/99/148 over real HTTP: the /api/internal gate, the events.decide
// and events.cancel guards and their record checks, and the status codes the
// review and cancel actions answer with. Only the repository (and, for
// cancel's AC3 release calls, the equipment/venue dependencies) are faked -
// the live-DB proof that the real release functions do what they say lives
// in equipment-release-cancelled-event.test.js and
// venue-release-cancelled-event.test.js.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const MISSING_ID = "aaaaaaaa-0009-0000-0000-000000000000";
const ASSIGNED = "coord-assigned";
const OTHER = "coord-other";
const MANAGER = "ops-manager-1";
const ACTIVE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"];

const repository = { findById: vi.fn(), transitionStatus: vi.fn(), cancel: vi.fn() };
const equipmentService = { releaseReservationsForCancelledEvent: vi.fn() };
const releaseVenueBookingsForCancelledEvent = vi.fn();
let stored;

// The token is "<user id>:<roles>", so each case states the identity it exercises.
const authClient = { auth: { getUser: async (token) => {
  if (token === "invalid") return { data: { user: null }, error: null };
  const [id, roles] = token.split(":");
  return { data: { user: {
    id, email: `${id}@example.com`, app_metadata: { roles: roles.split(",") },
    // Never read: roles come from admin-controlled app_metadata only.
    user_metadata: { roles: ["event_coordinator"] },
  } }, error: null };
} } };

let server, base;
beforeAll(async () => {
  server = createApp({
    authClient, eventsRepository: repository,
    equipmentDependencies: { equipmentService },
    venuesService: { releaseBookingsForCancelledEvent: releaseVenueBookingsForCancelledEvent },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

// A tiny in-memory event that honours the same guards as the real conditional update.
beforeEach(() => {
  stored = { id: EVENT_ID, name: "Digital Literacy for Seniors", status: "SUBMITTED", coordinator_id: ASSIGNED };
  repository.findById.mockReset().mockImplementation(async (id) => (id === EVENT_ID ? { ...stored } : null));
  repository.transitionStatus.mockReset().mockImplementation(async (id, from, to, extra, coordinatorId) => {
    if (id !== EVENT_ID || stored.status !== from || stored.coordinator_id !== coordinatorId) return null;
    stored = { ...stored, ...extra, status: to };
    return { ...stored };
  });
  repository.cancel.mockReset().mockImplementation(async (id, extra, coordinatorId) => {
    if (id !== EVENT_ID) return null;
    if (!ACTIVE_STATUSES.includes(stored.status)) return null;
    if (coordinatorId && stored.coordinator_id !== coordinatorId) return null;
    stored = { ...stored, ...extra, status: "CANCELLED" };
    return { ...stored };
  });
  equipmentService.releaseReservationsForCancelledEvent.mockReset()
    .mockResolvedValue({ released: [], equipmentReverted: [], equipmentSkipped: [] });
  releaseVenueBookingsForCancelledEvent.mockReset().mockResolvedValue([]);
});

function post(action, token = `${ASSIGNED}:event_coordinator`, body, id = EVENT_ID) {
  return fetch(`${base}/api/internal/events/${id}/${action}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      // Forged role claims in headers must change nothing.
      "x-user-role": "event_coordinator",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ACTIONS = ["start-review", "approve", "reject"];

test.each(["", "invalid"])("SCRUM-98: an unauthenticated caller (%j) reaches no review action", async (token) => {
  for (const action of ACTIONS) expect((await post(action, token, { note: "x" })).status).toBe(401);
});

test.each(["event_ops_manager", "event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown"])(
  "SCRUM-98 AC4: %s cannot start, approve or reject a review", async (role) => {
    for (const action of ACTIONS) expect((await post(action, `${ASSIGNED}:${role}`, { note: "x" })).status).toBe(403);
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

test("SCRUM-98 AC4: a coordinator not assigned to the event cannot record anything on it", async () => {
  for (const action of ACTIONS) {
    const response = await post(action, `${OTHER}:event_coordinator`, { note: "x" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "You do not have permission to access this information." });
  }
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
});

test("SCRUM-98 AC4: an unknown or malformed event id gets the same 403, revealing nothing", async () => {
  expect((await post("start-review", undefined, undefined, MISSING_ID)).status).toBe(403);
  expect((await post("start-review", undefined, undefined, "not-a-uuid")).status).toBe(403);
  expect(repository.findById).toHaveBeenCalledTimes(1);
});

test("SCRUM-98 AC2: the assigned coordinator starts review and the event is UNDER_REVIEW", async () => {
  const response = await post("start-review");

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("UNDER_REVIEW");
});

test("SCRUM-98 AC2 conflict: starting review twice is a 409 and changes nothing", async () => {
  await post("start-review");
  const response = await post("start-review");

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    message: "This event request has changed since you opened it. Refresh to see its current status.",
  });
  expect(stored.status).toBe("UNDER_REVIEW");
});

test("SCRUM-99 AC1/SCRUM-98 AC3: approving records APPROVED, the approver and the time", async () => {
  await post("start-review");
  const before = Date.now();

  const response = await post("approve", undefined, { note: "All details supplied" });

  expect(response.status).toBe(200);
  const { event } = await response.json();
  expect(event).toMatchObject({ status: "APPROVED", approved_rejected_by: ASSIGNED, approval_rejection_remark: "All details supplied" });
  expect(Date.parse(event.approved_rejected_at)).toBeGreaterThanOrEqual(before - 1000);
});

test("SCRUM-99 AC1 conflict: an event that is not under review cannot be approved", async () => {
  const response = await post("approve");

  expect(response.status).toBe(409);
  expect(stored.status).toBe("SUBMITTED");
});

test("SCRUM-99 conflict: an approved event cannot be approved or rejected again", async () => {
  await post("start-review");
  await post("approve");

  expect((await post("approve")).status).toBe(409);
  expect((await post("reject", undefined, { note: "Changed my mind" })).status).toBe(409);
  expect(stored.status).toBe("APPROVED");
});

test("SCRUM-98 AC3: rejecting with a reason records REJECTED, the reviewer and the reason", async () => {
  await post("start-review");

  const response = await post("reject", undefined, { note: "Attendance numbers are missing" });

  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({
    status: "REJECTED", approved_rejected_by: ASSIGNED, approval_rejection_remark: "Attendance numbers are missing",
  });
});

test.each([{}, { note: "" }, { note: "   " }])(
  "SCRUM-98 boundary: rejecting without a reason (%j) is a 400 and changes nothing", async (body) => {
    await post("start-review");

    const response = await post("reject", undefined, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Give a reason for rejecting this request." });
    expect(stored.status).toBe("UNDER_REVIEW");
  });

test("SCRUM-99 boundary: an approval note that is not text is a 400", async () => {
  await post("start-review");

  expect((await post("approve", undefined, { note: 42 })).status).toBe(400);
  expect(stored.status).toBe("UNDER_REVIEW");
});

test("SCRUM-98: status, approved_rejected_by and approved_rejected_at in the body are ignored; the server's values win", async () => {
  await post("start-review");

  const response = await post("approve", undefined, {
    status: "CONFIRMED", approved_rejected_by: OTHER, approved_rejected_at: "2000-01-01T00:00:00Z", coordinator_id: OTHER,
  });

  const { event } = await response.json();
  expect(event.status).toBe("APPROVED");
  expect(event.approved_rejected_by).toBe(ASSIGNED);
  expect(event.approved_rejected_at).not.toBe("2000-01-01T00:00:00Z");
  expect(event.coordinator_id).toBe(ASSIGNED);
});

test("SCRUM-98 AC4 conflict: an event reassigned after the access check records no outcome", async () => {
  await post("start-review");
  // The record check sees the caller as assigned; the manager reassigns before the write.
  repository.findById.mockImplementationOnce(async () => ({ ...stored }));
  repository.transitionStatus.mockImplementationOnce(async () => {
    stored = { ...stored, coordinator_id: OTHER };
    return null;
  });

  const response = await post("approve");

  expect(response.status).toBe(409);
  expect(stored).toMatchObject({ status: "UNDER_REVIEW", coordinator_id: OTHER });
  expect(stored.approved_rejected_by).toBeUndefined();
});

test("SCRUM-98: an event deleted after the access check is a 404", async () => {
  repository.findById.mockImplementationOnce(async () => ({ ...stored })).mockImplementationOnce(async () => null);
  repository.transitionStatus.mockImplementationOnce(async () => null);

  expect((await post("start-review")).status).toBe(404);
});

test("SCRUM-98 failure: a storage error on the write is a safe 500", async () => {
  repository.transitionStatus.mockRejectedValueOnce(new Error("events.repository: transitionStatus failed - boom"));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await post("start-review");

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ message: "Something went wrong. Please try again." });
  quiet.mockRestore();
});

test("SCRUM-98 failure: a storage error during the access check is a 503 and nothing is written", async () => {
  repository.findById.mockRejectedValueOnce(new Error("boom"));

  const response = await post("start-review");

  expect(response.status).toBe(503);
  expect(repository.transitionStatus).not.toHaveBeenCalled();
});

test("SCRUM-98/148 failure: without storage configured, the actions answer 503", async () => {
  const bare = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(bare, "listening");
  try {
    for (const action of ["start-review", "cancel"]) {
      const response = await fetch(`http://127.0.0.1:${bare.address().port}/api/internal/events/${EVENT_ID}/${action}`,
        { method: "POST", headers: { Authorization: `Bearer ${ASSIGNED}:event_coordinator`, "Content-Type": "application/json" }, body: JSON.stringify({ reason: "x" }) });
      expect(response.status, action).toBe(503);
    }
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// SCRUM-148: cancel. Same router/controller/service as review above, with a
// different permission (events.cancel: assigned coordinator OR ops manager,
// unlike events.decide's coordinator-only) and no single "from" status.
// ---------------------------------------------------------------------------

test.each(["", "invalid"])("SCRUM-148: an unauthenticated caller (%j) cannot cancel", async (token) => {
  expect((await post("cancel", token, { reason: "x" })).status).toBe(401);
});

test.each(["event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown"])(
  "[TC-148-04] %s cannot cancel an event", async (role) => {
    expect((await post("cancel", `${ASSIGNED}:${role}`, { reason: "x" })).status).toBe(403);
    expect(repository.cancel).not.toHaveBeenCalled();
  });

test("[TC-148-03] a coordinator not assigned to the event cannot cancel it", async () => {
  const response = await post("cancel", `${OTHER}:event_coordinator`, { reason: "x" });

  expect(response.status).toBe(403);
  expect(repository.cancel).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
});

test("[TC-148-01] the assigned coordinator cancels their own event; release runs synchronously", async () => {
  const before = Date.now();

  const response = await post("cancel", undefined, { reason: "Venue flooded" });

  expect(response.status).toBe(200);
  const { event } = await response.json();
  expect(event).toMatchObject({ status: "CANCELLED", cancelled_by: ASSIGNED, cancellation_reason: "Venue flooded" });
  expect(Date.parse(event.cancelled_at)).toBeGreaterThanOrEqual(before - 1000);
  expect(equipmentService.releaseReservationsForCancelledEvent).toHaveBeenCalledWith(EVENT_ID, ASSIGNED);
  expect(releaseVenueBookingsForCancelledEvent).toHaveBeenCalledWith(EVENT_ID);
});

test("[TC-148-02] the ops manager cancels an event not assigned to them", async () => {
  const response = await post("cancel", `${MANAGER}:event_ops_manager`, { reason: "Duplicate booking" });

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("CANCELLED");
  // No coordinatorId is passed for an ops-manager caller - they may cancel any event.
  expect(repository.cancel).toHaveBeenCalledWith(EVENT_ID, expect.objectContaining({ cancelled_by: MANAGER }), undefined);
});

test("[TC-148-05] a reassignment between the access check and the write is a 409, nothing recorded", async () => {
  repository.findById.mockImplementationOnce(async () => ({ ...stored }));
  repository.cancel.mockImplementationOnce(async () => {
    stored = { ...stored, coordinator_id: OTHER };
    return null;
  });

  const response = await post("cancel", undefined, { reason: "x" });

  expect(response.status).toBe(409);
  expect(stored).toMatchObject({ status: "SUBMITTED", coordinator_id: OTHER });
  expect(stored.cancelled_by).toBeUndefined();
});

// The exhaustive stage list (exactly the four ACTIVE_STATUSES, no more, no
// less) is already proven once, precisely, by events.transition.test.js's
// unit test on the repository query. One representative case on each side of
// the boundary is enough to prove the HTTP wiring uses that same filter.
test("[TC-148-06] cancel succeeds from an active stage (APPROVED)", async () => {
  stored.status = "APPROVED";

  const response = await post("cancel", undefined, { reason: "x" });

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("CANCELLED");
});

test("[TC-148-07] cancel is refused from a terminal stage (COMPLETED)", async () => {
  stored.status = "COMPLETED";

  const response = await post("cancel", undefined, { reason: "x" });

  expect(response.status).toBe(409);
  expect(stored.status).toBe("COMPLETED");
  expect(equipmentService.releaseReservationsForCancelledEvent).not.toHaveBeenCalled();
});

test.each([{}, { reason: "" }])("[TC-148-08] cancel without a reason (%j) is a 400, nothing recorded", async (body) => {
  const response = await post("cancel", undefined, body);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message: "Give a reason for cancelling this event." });
  expect(repository.cancel).not.toHaveBeenCalled();
});

test("[TC-148-09] a whitespace-only reason is treated as blank", async () => {
  const response = await post("cancel", undefined, { reason: "   " });

  expect(response.status).toBe(400);
  expect(repository.cancel).not.toHaveBeenCalled();
});

test("SCRUM-148: status, cancelled_by and cancelled_at in the body are ignored; the server's values win", async () => {
  const response = await post("cancel", undefined, {
    reason: "x", status: "CONFIRMED", cancelled_by: OTHER, cancelled_at: "2000-01-01T00:00:00Z",
  });

  const { event } = await response.json();
  expect(event.status).toBe("CANCELLED");
  expect(event.cancelled_by).toBe(ASSIGNED);
  expect(event.cancelled_at).not.toBe("2000-01-01T00:00:00Z");
});

test("SCRUM-148 failure: a storage error on the write is a safe 500", async () => {
  repository.cancel.mockRejectedValueOnce(new Error("events.repository: cancel failed - boom"));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await post("cancel", undefined, { reason: "x" });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ message: "Something went wrong. Please try again." });
  quiet.mockRestore();
});
