// SCRUM-98/99 over real HTTP: the /api/internal gate, the events.decide guard
// and its assigned-coordinator record check, and the status codes the review
// actions answer with. Only the repository is faked.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const MISSING_ID = "aaaaaaaa-0009-0000-0000-000000000000";
const ASSIGNED = "coord-assigned";
const OTHER = "coord-other";

const repository = { findById: vi.fn(), transitionStatus: vi.fn() };
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
  server = createApp({ authClient, eventsRepository: repository }).listen(0, "127.0.0.1");
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
  expect(event).toMatchObject({ status: "APPROVED", decided_by: ASSIGNED, decision_note: "All details supplied" });
  expect(Date.parse(event.decided_at)).toBeGreaterThanOrEqual(before - 1000);
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
    status: "REJECTED", decided_by: ASSIGNED, decision_note: "Attendance numbers are missing",
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

test("SCRUM-98: status, decided_by and decided_at in the body are ignored; the server's values win", async () => {
  await post("start-review");

  const response = await post("approve", undefined, {
    status: "CONFIRMED", decided_by: OTHER, decided_at: "2000-01-01T00:00:00Z", coordinator_id: OTHER,
  });

  const { event } = await response.json();
  expect(event.status).toBe("APPROVED");
  expect(event.decided_by).toBe(ASSIGNED);
  expect(event.decided_at).not.toBe("2000-01-01T00:00:00Z");
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
  expect(stored.decided_by).toBeUndefined();
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

test("SCRUM-98 failure: without storage configured, the actions answer 503", async () => {
  const bare = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(bare, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${bare.address().port}/api/internal/events/${EVENT_ID}/start-review`,
      { method: "POST", headers: { Authorization: `Bearer ${ASSIGNED}:event_coordinator` } });
    expect(response.status).toBe(503);
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});
