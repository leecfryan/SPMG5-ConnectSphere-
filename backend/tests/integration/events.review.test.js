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
const MANAGER = "coordinator-lead-1";
// SCRUM-149: POSTPONED joins ACTIVE_STATUSES (cancel's own gate), but is
// excluded from POSTPONABLE_STATUSES (postpone's gate) so it can't be
// postponed twice.
const ACTIVE_STATUSES = ["CHANGES_REQUESTED", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "CONFIRMED", "POSTPONED"];
const POSTPONABLE_STATUSES = ["CHANGES_REQUESTED", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "CONFIRMED"];

const repository = { requestChanges: vi.fn(), findById: vi.fn(), transitionStatus: vi.fn(), cancel: vi.fn(), postpone: vi.fn() };
const equipmentService = { releaseReservationsForEvent: vi.fn() };
const releaseVenueBookingsForCancelledEvent = vi.fn();
const checkBookingsForNewDates = vi.fn();
const NO_NEW_DATE = { newStart: null, newEnd: null, moves: [] };
// SCRUM-38: approve re-validates venue bookings instead of releasing them.
const revalidateVenueBookings = vi.fn();
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
    venuesService: {
      releaseBookingsForCancelledEvent: releaseVenueBookingsForCancelledEvent, checkBookingsForNewDates,
      revalidateBookingsForEvent: revalidateVenueBookings,
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

// A tiny in-memory event that honours the same guards as the real conditional update.
beforeEach(() => {
  stored = { id: EVENT_ID, name: "Digital Literacy for Seniors", status: "SUBMITTED", coordinator_id: ASSIGNED };
  repository.requestChanges.mockReset().mockImplementation(async (id, coordinatorId, note) => {
    if (id !== stored.id || stored.status !== "UNDER_REVIEW" || stored.coordinator_id !== coordinatorId) return null;
    stored = { ...stored, status: "CHANGES_REQUESTED", clarification: note };
    return { ...stored };
  });
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
  // SCRUM-170: stands in for postpone_event, which records the postponement itself.
  repository.postpone.mockReset().mockImplementation(async (id, coordinatorId, reason) => {
    if (id !== EVENT_ID) return null;
    if (!POSTPONABLE_STATUSES.includes(stored.status)) return null;
    if (stored.coordinator_id !== coordinatorId) return null;
    stored = { ...stored, status: "POSTPONED", postponed_by: coordinatorId, postponed_at: new Date().toISOString(), postponement_reason: reason };
    return { ...stored };
  });
  equipmentService.releaseReservationsForEvent.mockReset()
    .mockResolvedValue({ released: [], equipmentReverted: [], equipmentSkipped: [] });
  releaseVenueBookingsForCancelledEvent.mockReset().mockResolvedValue([]);
  checkBookingsForNewDates.mockReset();
  revalidateVenueBookings.mockReset().mockResolvedValue({ checked: 0, flagged: [] });
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

test.each(["event_coordinator_lead", "event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown"])(
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

// Updated for SCRUM-38 (Option A, agreed 2026-11-01): approving a resubmission
// still releases equipment, but re-validates venue bookings instead of
// releasing them, so venues that still fit are kept. Only the venue
// expectation changed; the equipment and status expectations are SCRUM-37's.
test("[SCRUM-37] TC-37-19: approving a resubmission releases its equipment and re-validates its venues (SCRUM-38)", async () => {
  // Simulate a resubmission: a significant edit already changed start_time
  // and sent the event back for re-approval.
  stored = { ...stored, start_time: "2099-06-01T00:00:00.000Z" };
  await post("start-review");

  const response = await post("approve", undefined, { note: "The new date works fine" });

  expect(response.status).toBe(200);
  expect(stored.status).toBe("APPROVED");
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED);
  expect(revalidateVenueBookings).toHaveBeenCalledExactlyOnceWith(EVENT_ID);
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
});

// Updated for SCRUM-38 (Option A): same change as TC-37-19 - the venue step is
// now a re-validation, still a safe no-op when nothing has been arranged.
test("[SCRUM-37] TC-37-20: approving a first-time submission that never had arrangements is a safe no-op release and re-validation", async () => {
  await post("start-review");

  const response = await post("approve", undefined, { note: "All details supplied" });

  expect(response.status).toBe(200);
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED);
  expect(revalidateVenueBookings).toHaveBeenCalledExactlyOnceWith(EVENT_ID);
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
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

test("[SCRUM-37] TC-37-13: rejecting releases held arrangements and leaves the event's edited fields as-is (known limitation: no partial undo)", async () => {
  // Simulate a resubmission: a significant edit already changed
  // venue_requirements and sent the event back for re-approval.
  stored = { ...stored, venue_requirements: "Need a stage and PA system" };
  await post("start-review");

  const response = await post("reject", undefined, { note: "The new venue requirements are not feasible" });

  expect(response.status).toBe(200);
  expect(stored.status).toBe("REJECTED");
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED);
  expect(releaseVenueBookingsForCancelledEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID);
  // The known limitation: nothing restores the pre-edit value. Rejecting
  // ends the event; it does not undo the organiser's edit.
  expect(stored.venue_requirements).toBe("Need a stage and PA system");
});

test("[SCRUM-37] TC-37-14: rejecting a first-time submission that never had arrangements is a safe no-op release", async () => {
  await post("start-review");

  const response = await post("reject", undefined, { note: "Attendance numbers are missing" });

  expect(response.status).toBe(200);
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED);
  expect(releaseVenueBookingsForCancelledEvent).toHaveBeenCalledExactlyOnceWith(EVENT_ID);
});

test.each([{}, { note: "" }, { note: "   " }])(
  "SCRUM-98 boundary: rejecting without a reason (%j) is a 400 and changes nothing", async (body) => {
    await post("start-review");

    const response = await post("reject", undefined, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Give a reason for rejecting this request." });
    expect(stored.status).toBe("UNDER_REVIEW");
    // [SCRUM-37] a reject that never writes must never release either.
    expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
    expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
  });

test("SCRUM-99 boundary: an approval note that is not text is a 400", async () => {
  await post("start-review");

  expect((await post("approve", undefined, { note: 42 })).status).toBe(400);
  expect(stored.status).toBe("UNDER_REVIEW");
  // [SCRUM-37] an approve that never writes must never release either.
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
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

test("SCRUM-98/148/149 failure: without storage configured, the actions answer 503", async () => {
  const bare = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(bare, "listening");
  try {
    for (const action of ["start-review", "cancel", "postpone"]) {
      const response = await fetch(`http://127.0.0.1:${bare.address().port}/api/internal/events/${EVENT_ID}/${action}`,
        { method: "POST", headers: { Authorization: `Bearer ${ASSIGNED}:event_coordinator`, "Content-Type": "application/json" }, body: JSON.stringify({ reason: "x" }) });
      expect(response.status, action).toBe(503);
    }
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// SCRUM-148: cancel. Same router/controller/service as review above, with its
// own permission (events.cancel) and no single "from" status. SCRUM-171
// narrowed events.cancel to the assigned coordinator only - unlike
// events.postpone below, the coordinator lead no longer gets an unconditional
// bypass here.
// ---------------------------------------------------------------------------

test.each(["", "invalid"])("SCRUM-148: an unauthenticated caller (%j) cannot cancel", async (token) => {
  expect((await post("cancel", token, { reason: "x" })).status).toBe(401);
});

test.each(["event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown", "event_coordinator_lead"])(
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
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledWith(EVENT_ID, ASSIGNED);
  expect(releaseVenueBookingsForCancelledEvent).toHaveBeenCalledWith(EVENT_ID);
});

// SCRUM-171: previously 200 (the lead could cancel any event) - the lead's
// unconditional cancel access is now removed, so this is a 403 like any other
// non-assigned caller.
test("[TC-148-02] the coordinator lead cannot cancel an event not assigned to them", async () => {
  const response = await post("cancel", `${MANAGER}:event_coordinator_lead`, { reason: "Duplicate booking" });

  expect(response.status).toBe(403);
  expect(repository.cancel).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
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
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// SCRUM-149/170: postpone. Same router/controller/service shape as cancel, with
// its own permission (events.postpone) and its own stage gate
// (POSTPONABLE_STATUSES, not ACTIVE_STATUSES - an already-postponed event
// can't be postponed again). SCRUM-170 narrowed it to the assigned coordinator
// and moved the venue release into postpone_event, so the HTTP layer only
// sees the repository call and the equipment release; the release itself is
// proven by tests/sql (TC-SCRUM-170-01, -08).
// ---------------------------------------------------------------------------

test.each(["", "invalid"])("SCRUM-149: an unauthenticated caller (%j) cannot postpone", async (token) => {
  expect((await post("postpone", token, { reason: "x" })).status).toBe(401);
});

test.each(["event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown"])(
  "[TC-149-20] %s cannot postpone an event", async (role) => {
    expect((await post("postpone", `${ASSIGNED}:${role}`, { reason: "x" })).status).toBe(403);
    expect(repository.postpone).not.toHaveBeenCalled();
  });

test("[TC-149-03] a coordinator not assigned to the event cannot postpone it", async () => {
  const response = await post("postpone", `${OTHER}:event_coordinator`, { reason: "x" });

  expect(response.status).toBe(403);
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
});

// SCRUM-150 added the equipment release. SCRUM-170 moved the venue release into
// postpone_event, so the JavaScript venue release is no longer called here.
test("[TC-149-01][TC-SCRUM-170-01] the assigned coordinator postpones their own event with a trimmed reason; equipment is released", async () => {
  const before = Date.now();

  const response = await post("postpone", undefined, { reason: "  New date not yet known  " });

  expect(response.status).toBe(200);
  const { event } = await response.json();
  expect(event).toMatchObject({ status: "POSTPONED", postponed_by: ASSIGNED, postponement_reason: "New date not yet known" });
  expect(Date.parse(event.postponed_at)).toBeGreaterThanOrEqual(before - 1000);
  expect(repository.postpone).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED, "New date not yet known", NO_NEW_DATE);
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledWith(EVENT_ID, ASSIGNED);
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
  expect(checkBookingsForNewDates).not.toHaveBeenCalled();
});

// SCRUM-170 AC1 (PO confirmed 2026-11-02, superseding SCRUM-149 AC1): previously
// 200 - the lead could postpone any event.
test("[TC-149-02][TC-SCRUM-170-02] the coordinator lead cannot postpone an event, assigned to someone else or not", async () => {
  for (const coordinator of [ASSIGNED, MANAGER]) {
    stored.coordinator_id = coordinator;
    const response = await post("postpone", `${MANAGER}:event_coordinator_lead`, { reason: "Venue double-booked" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "You do not have permission to access this information." });
  }
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
});

test("[TC-SCRUM-170-02] a forged lead claim in the body does not skip the assignment check", async () => {
  const response = await post("postpone", `${OTHER}:event_coordinator`, { reason: "x", isCoordinatorLead: true, roles: ["event_coordinator_lead"] });

  expect(response.status).toBe(403);
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
});

test("[TC-149-05] a reassignment between the access check and the write is a 409, nothing recorded", async () => {
  repository.findById.mockImplementationOnce(async () => ({ ...stored }));
  repository.postpone.mockImplementationOnce(async () => {
    stored = { ...stored, coordinator_id: OTHER };
    return null;
  });

  const response = await post("postpone", undefined, { reason: "x" });

  expect(response.status).toBe(409);
  expect(stored).toMatchObject({ status: "SUBMITTED", coordinator_id: OTHER });
  expect(stored.postponed_by).toBeUndefined();
});

// The exhaustive stage list is proven once, precisely, by
// events.transition.test.js's unit test on the repository query - this is
// one representative case on each side of the boundary.
test("[TC-SCRUM-170-14] an event deleted after the access check is a 404 and nothing is released", async () => {
  repository.findById.mockImplementationOnce(async () => ({ ...stored })).mockImplementationOnce(async () => null);
  repository.postpone.mockResolvedValueOnce(null);

  const response = await post("postpone", undefined, { reason: "x" });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ message: "That event request no longer exists." });
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
});

test("[TC-149-19] postpone succeeds from an active stage (APPROVED) - companion to TC-149-12's refusal boundary", async () => {
  stored.status = "APPROVED";

  const response = await post("postpone", undefined, { reason: "x" });

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("POSTPONED");
});

test("[TC-149-12] postpone is refused from a terminal stage (COMPLETED)", async () => {
  stored.status = "COMPLETED";

  const response = await post("postpone", undefined, { reason: "x" });

  expect(response.status).toBe(409);
  expect(stored.status).toBe("COMPLETED");
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
});

test("[TC-149-12][TC-SCRUM-170-06] postponing an already-postponed event is a 409 that changes and releases nothing", async () => {
  stored = { ...stored, status: "POSTPONED", postponement_reason: "First reason" };
  const before = structuredClone(stored);

  const response = await post("postpone", undefined, { reason: "Second reason" });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ message: "This event request has changed since you opened it. Refresh to see its current status." });
  expect(stored).toEqual(before);
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
});

test("[TC-SCRUM-170-05] no replacement date is needed, and a date or status sent with the reason is ignored", async () => {
  stored = { ...stored, start_time: "2099-06-01T09:00:00Z" };

  const response = await post("postpone", undefined, { reason: "x", start_time: "2099-07-01T09:00:00Z", status: "APPROVED" });

  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: "POSTPONED", start_time: "2099-06-01T09:00:00Z" });
  expect(repository.postpone).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED, "x", NO_NEW_DATE);
});

// ---------------------------------------------------------------------------
// SCRUM-170 phase 2: postponing with a new date. The venue checks run first;
// only bookings that pass are moved, the rest are released by postpone_event.
// ---------------------------------------------------------------------------

const NEW_START = "2099-07-08T01:00:00.000Z";
const NEW_END = "2099-07-08T09:00:00.000Z";
const CHECKED = [
  { booking_id: "req-pass", venue_name: "Marina Hall", booking_date: "2099-07-01", new_booking_date: "2099-07-08", slots: ["am"], passed: true, reasons: [] },
  { booking_id: "req-fail", venue_name: "Garden Room", booking_date: "2099-07-01", new_booking_date: "2099-07-08", slots: ["pm"], passed: false, reasons: ["PM is already taken by another event (Reserved event)."] },
];

test("[TC-SCRUM-170-20][TC-SCRUM-170-21][TC-SCRUM-170-22] with a new date, the venues are checked first and only passing bookings are moved", async () => {
  stored = { ...stored, status: "APPROVED", start_time: "2099-07-01T01:00:00Z" };
  checkBookingsForNewDates.mockResolvedValueOnce(CHECKED);

  const response = await post("postpone", undefined, { reason: "Roof repairs", new_start_time: NEW_START, new_end_time: NEW_END });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.event.status).toBe("POSTPONED");
  expect(body.venue_recheck).toEqual(CHECKED);
  expect(checkBookingsForNewDates).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: EVENT_ID, start_time: "2099-07-01T01:00:00Z" }), NEW_START, NEW_END);
  expect(repository.postpone).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED, "Roof repairs", {
    newStart: NEW_START, newEnd: NEW_END, moves: [{ request_id: "req-pass", booking_date: "2099-07-08" }],
  });
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledWith(EVENT_ID, ASSIGNED);
});

test.each([
  [{ new_start_time: NEW_START }, "Give both a new start and a new end, or leave both empty."],
  [{ new_end_time: NEW_END }, "Give both a new start and a new end, or leave both empty."],
  [{ new_start_time: "not a date", new_end_time: NEW_END }, "The new start and end must be valid dates and times."],
  [{ new_start_time: 20990708, new_end_time: NEW_END }, "The new start and end must be valid dates and times."],
  [{ new_start_time: NEW_START, new_end_time: 20990708 }, "The new start and end must be valid dates and times."],
  [{ new_start_time: "2000-01-01T00:00:00Z", new_end_time: NEW_END }, "The new start must be in the future."],
  [{ new_start_time: NEW_END, new_end_time: NEW_START }, "The new end must be after the new start."],
  [{ new_start_time: NEW_START, new_end_time: NEW_START }, "The new end must be after the new start."],
])("[TC-SCRUM-170-23] an incomplete or impossible new date (%j) is a 400 and nothing is checked or written", async (dates, message) => {
  const response = await post("postpone", undefined, { reason: "x", ...dates });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message });
  expect(checkBookingsForNewDates).not.toHaveBeenCalled();
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
});

test("[TC-SCRUM-170-23] empty new date fields mean no new date", async () => {
  const response = await post("postpone", undefined, { reason: "x", new_start_time: "", new_end_time: null });

  expect(response.status).toBe(200);
  expect(checkBookingsForNewDates).not.toHaveBeenCalled();
  expect(repository.postpone).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED, "x", NO_NEW_DATE);
});

test("[TC-SCRUM-170-14] an event deleted after the access check, while postponing with a new date, is a 404 with nothing checked", async () => {
  repository.findById.mockImplementationOnce(async () => ({ ...stored })).mockImplementationOnce(async () => null);

  const response = await post("postpone", undefined, { reason: "x", new_start_time: NEW_START, new_end_time: NEW_END });

  expect(response.status).toBe(404);
  expect(checkBookingsForNewDates).not.toHaveBeenCalled();
  expect(repository.postpone).not.toHaveBeenCalled();
});

test("[TC-SCRUM-170-25] when the venue checks cannot run, nothing is postponed or released (503)", async () => {
  checkBookingsForNewDates.mockRejectedValueOnce(new Error("venue storage down"));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await post("postpone", undefined, { reason: "x", new_start_time: NEW_START, new_end_time: NEW_END });

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ message: "We couldn't check the venues for the new date, so the event was not postponed. Please try again." });
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
  expect(stored.status).toBe("SUBMITTED");
  quiet.mockRestore();
});

test("[TC-SCRUM-170-24] postponing an already-postponed event with a new date is a 409 after the checks, and nothing moves", async () => {
  stored = { ...stored, status: "POSTPONED" };
  checkBookingsForNewDates.mockResolvedValueOnce([]);

  const response = await post("postpone", undefined, { reason: "again", new_start_time: NEW_START, new_end_time: NEW_END });

  expect(response.status).toBe(409);
  expect(stored.status).toBe("POSTPONED");
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
});

test("[TC-149-11] a POSTPONED event can still be cancelled", async () => {
  stored.status = "POSTPONED";

  const response = await post("cancel", undefined, { reason: "Giving up on this one" });

  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: "CANCELLED", cancellation_reason: "Giving up on this one" });
});

test.each([{}, { reason: "" }])("[TC-149-04] postpone without a reason (%j) is a 400, nothing recorded", async (body) => {
  const response = await post("postpone", undefined, body);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message: "Give a reason for postponing this event." });
  expect(repository.postpone).not.toHaveBeenCalled();
});

test("[TC-149-04] a whitespace-only reason is treated as blank", async () => {
  const response = await post("postpone", undefined, { reason: "   " });

  expect(response.status).toBe(400);
  expect(repository.postpone).not.toHaveBeenCalled();
});

test("SCRUM-149: status, postponed_by and postponed_at in the body are ignored; the server's values win", async () => {
  const response = await post("postpone", undefined, {
    reason: "x", status: "CONFIRMED", postponed_by: OTHER, postponed_at: "2000-01-01T00:00:00Z",
  });

  const { event } = await response.json();
  expect(event.status).toBe("POSTPONED");
  expect(event.postponed_by).toBe(ASSIGNED);
  expect(event.postponed_at).not.toBe("2000-01-01T00:00:00Z");
});

test("[TC-149-10] nothing is postponed or released when the reason is missing", async () => {
  await post("postpone", undefined, {});

  expect(repository.postpone).not.toHaveBeenCalled();
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
});

test("[TC-SCRUM-170-11] a storage failure is a safe 500 with nothing saved or released", async () => {
  repository.postpone.mockRejectedValueOnce(new Error("events.repository: postpone failed - private detail"));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await post("postpone", undefined, { reason: "x" });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ message: "Something went wrong. Please try again." });
  expect(stored.status).toBe("SUBMITTED");
  expect(equipmentService.releaseReservationsForEvent).not.toHaveBeenCalled();
  quiet.mockRestore();
});

// SCRUM-170 replaces TC-149-18's characterization (a venue-release failure was
// a 500 after the status had already been saved). The venue release now
// commits with the status, and the one release left in JavaScript (equipment)
// is logged, so the coordinator is told the truth: the event is postponed.
test("[TC-149-18][TC-SCRUM-170-11] an equipment-release failure after the postponement is saved is logged, not a 500", async () => {
  equipmentService.releaseReservationsForEvent.mockRejectedValueOnce(new Error("equipment storage down"));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await post("postpone", undefined, { reason: "x" });

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("POSTPONED");
  expect(quiet).toHaveBeenCalledWith(`postpone ${EVENT_ID}: equipment release failed:`, "equipment storage down");
  quiet.mockRestore();
});

test("[SCRUM-117-API-001] assigned coordinator returns a request with a trimmed message and unchanged responsibility", async () => {
  stored.status = "UNDER_REVIEW";
  const before = structuredClone(stored);
  const response = await post("request-changes", undefined, { note: "  Clarify attendance.  ", coordinator_id: OTHER, status: "APPROVED" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ event: { ...before, status: "CHANGES_REQUESTED", clarification: "Clarify attendance." } });
  expect(repository.requestChanges).toHaveBeenCalledExactlyOnceWith(EVENT_ID, ASSIGNED, "Clarify attendance.");
  const saved = structuredClone(stored);
  expect((await post("request-changes", undefined, { note: "Repeated" })).status).toBe(409);
  expect(stored).toEqual(saved);
});

test.each(["", "invalid", OTHER + ":event_coordinator", MANAGER + ":event_coordinator_lead", "org:event_organiser"])(
  "[SCRUM-117-API-002] caller %s cannot return another responsibility's request", async token => {
    stored.status = "UNDER_REVIEW";
    const before = structuredClone(stored);
    const response = await post("request-changes", token, { note: "Forged" });
    expect(response.status).toBe(!token || token === "invalid" ? 401 : 403);
    expect(repository.requestChanges).not.toHaveBeenCalled();
    expect(stored).toEqual(before);
  });

test.each([undefined, "", "   ", 4, {}, []])("[SCRUM-117-API-003] invalid message %j writes nothing", async note => {
  stored.status = "UNDER_REVIEW";
  const before = structuredClone(stored);
  expect((await post("request-changes", undefined, { note })).status).toBe(400);
  expect(repository.requestChanges).not.toHaveBeenCalled();
  expect(stored).toEqual(before);
});

test.each(["DRAFT", "SUBMITTED", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "COMPLETED", "CANCELLED", "REJECTED", "POSTPONED"])(
  "[SCRUM-117-API-004] returning from %s is refused without changing the request", async status => {
    stored.status = status;
    const before = structuredClone(stored);
    expect((await post("request-changes", undefined, { note: "Clarify" })).status).toBe(409);
    expect(stored).toEqual(before);
  });

test("[SCRUM-117-API-005] assignment changing between guard and write refuses the return", async () => {
  stored.status = "UNDER_REVIEW";
  repository.requestChanges.mockImplementationOnce(async () => { stored.coordinator_id = OTHER; return null; });
  expect((await post("request-changes", undefined, { note: "Clarify" })).status).toBe(409);
  expect(stored.status).toBe("UNDER_REVIEW");
  expect(stored.clarification).toBeUndefined();
});

test("[SCRUM-117-API-006] RPC failure is safe and records no success", async () => {
  stored.status = "UNDER_REVIEW";
  const before = structuredClone(stored);
  repository.requestChanges.mockRejectedValueOnce(new Error("private storage error"));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await post("request-changes", undefined, { note: "Clarify" });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private storage");
    expect(stored).toEqual(before);
  } finally { quiet.mockRestore(); }
});

// SCRUM-171: previously both roles got 200 for cancel too - the lead's
// unconditional cancel access is now removed, so this splits from one shared
// case (cancel and postpone together) into cancel's own (assigned coordinator
// only) and postpone's own (both, unchanged).
test("[SCRUM-117-API-007] the assigned coordinator may cancel a returned request; the lead may not", async () => {
  stored.status = "CHANGES_REQUESTED";
  const denied = await post("cancel", MANAGER + ":event_coordinator_lead", { reason: "Plans changed" });
  expect(denied.status).toBe(403);
  expect(stored.status).toBe("CHANGES_REQUESTED");

  const response = await post("cancel", ASSIGNED + ":event_coordinator", { reason: "Plans changed" });
  expect(response.status).toBe(200);
  expect(stored.status).toBe("CANCELLED");
  expect(stored.coordinator_id).toBe(ASSIGNED);
});

// SCRUM-170 AC1: previously the lead could postpone a returned request too.
test("[SCRUM-117-API-007] the assigned coordinator may postpone a returned request; the lead may not", async () => {
  stored.status = "CHANGES_REQUESTED";
  const denied = await post("postpone", MANAGER + ":event_coordinator_lead", { reason: "Plans changed" });
  expect(denied.status).toBe(403);
  expect(stored.status).toBe("CHANGES_REQUESTED");

  const response = await post("postpone", ASSIGNED + ":event_coordinator", { reason: "Plans changed" });
  expect(response.status).toBe(200);
  expect(stored.status).toBe("POSTPONED");
  expect(stored.coordinator_id).toBe(ASSIGNED);
});
