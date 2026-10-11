// SCRUM-139 over real HTTP: the /api/internal gate, the events.safety.submit
// guard and its assigned-coordinator record check, and the status codes the
// safety-check actions answer with. Only the repository is faked.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const MISSING_ID = "aaaaaaaa-0009-0000-0000-000000000000";
const ASSIGNED = "coord-assigned";
const OTHER = "coord-other";

const BOOKED_VENUE = { booking_date: "2099-05-01", venue: { name: "Hall A" }, slots: [{ slot: "am", status: "confirmed" }] };
const PENDING_VENUE = { booking_date: "2099-05-02", venue: { name: "Hall B" }, slots: [{ slot: "am", status: "pending" }] };
const READY = { venueRequests: [BOOKED_VENUE], equipmentRequests: [{ equipment: { type: "Projector" }, status: "APPROVED" }] };
const NOT_READY = { venueRequests: [BOOKED_VENUE, PENDING_VENUE], equipmentRequests: [] };
const HALL_B_PENDING = { kind: "venue", label: "Hall B · 2099-05-02", reason: "Waiting for Venue Staff to decide." };

const repository = { findById: vi.fn(), transitionStatus: vi.fn(), findArrangements: vi.fn() };
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
  stored = { id: EVENT_ID, name: "Digital Literacy for Seniors", status: "APPROVED", coordinator_id: ASSIGNED };
  repository.findById.mockReset().mockImplementation(async (id) => (id === EVENT_ID ? { ...stored } : null));
  repository.transitionStatus.mockReset().mockImplementation(async (id, from, to, extra, coordinatorId) => {
    if (id !== EVENT_ID || stored.status !== from || stored.coordinator_id !== coordinatorId) return null;
    stored = { ...stored, ...extra, status: to };
    return { ...stored };
  });
  repository.findArrangements.mockReset().mockResolvedValue(READY);
});

function call(action, token = `${ASSIGNED}:event_coordinator`, id = EVENT_ID) {
  return fetch(`${base}/api/internal/events/${id}/${action}`, {
    method: action === "safety-readiness" ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      // Forged role claims in headers must change nothing.
      "x-user-role": "event_coordinator",
    },
  });
}

const ACTIONS = ["safety-readiness", "submit-safety-check", "withdraw-safety-check"];

test("SCRUM-139 AC2: readiness lists what is missing for an event that is not ready", async () => {
  repository.findArrangements.mockResolvedValue(NOT_READY);

  const response = await call("safety-readiness");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ready: false, missing: [HALL_B_PENDING] });
  expect(repository.findArrangements).toHaveBeenCalledWith(EVENT_ID);
});

test("SCRUM-139 AC1: readiness reports a fully arranged event as ready", async () => {
  const response = await call("safety-readiness");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ready: true, missing: [] });
});

test("SCRUM-139 AC1/AC2: submitting with missing arrangements is a 409 listing them, and changes nothing", async () => {
  repository.findArrangements.mockResolvedValue(NOT_READY);

  const response = await call("submit-safety-check");

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    message: "This event is not ready for the safety check. Finish the arrangements listed.",
    missing: [HALL_B_PENDING],
  });
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(stored.status).toBe("APPROVED");
});

test("SCRUM-139 AC3: a ready approved event moves to SAFETY_REVIEW for the calling coordinator only", async () => {
  const response = await call("submit-safety-check");

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("SAFETY_REVIEW");
  expect(repository.transitionStatus).toHaveBeenCalledWith(EVENT_ID, "APPROVED", "SAFETY_REVIEW", {}, ASSIGNED);
});

test.each(["SUBMITTED", "UNDER_REVIEW", "SAFETY_REVIEW", "CONFIRMED", "CANCELLED"])(
  "SCRUM-139 AC3 conflict: a %s event cannot be submitted, and nothing is written", async (status) => {
    stored.status = status;

    const response = await call("submit-safety-check");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "This event has changed since you opened it. Refresh to see its current status.",
    });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
    expect(stored.status).toBe(status);
  });

test("SCRUM-139 AC3 conflict: an event that changes between the check and the write is a 409", async () => {
  repository.transitionStatus.mockResolvedValue(null);

  const response = await call("submit-safety-check");

  expect(response.status).toBe(409);
  expect((await response.json()).message).toMatch(/has changed since you opened it/);
});

test("SCRUM-139 AC4: withdrawing moves SAFETY_REVIEW back to APPROVED", async () => {
  stored.status = "SAFETY_REVIEW";

  const response = await call("withdraw-safety-check");

  expect(response.status).toBe(200);
  expect((await response.json()).event.status).toBe("APPROVED");
  expect(repository.transitionStatus).toHaveBeenCalledWith(EVENT_ID, "SAFETY_REVIEW", "APPROVED", {}, ASSIGNED);
});

test("SCRUM-139 AC4 conflict: an event not under safety review cannot be withdrawn", async () => {
  const response = await call("withdraw-safety-check");

  expect(response.status).toBe(409);
  expect(stored.status).toBe("APPROVED");
});

test.each(["", "invalid"])("SCRUM-139: an unauthenticated caller (%j) reaches no safety-check action", async (token) => {
  for (const action of ACTIONS) expect((await call(action, token)).status).toBe(401);
});

test.each(["event_ops_manager", "event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown"])(
  "SCRUM-139: %s cannot read readiness, submit or withdraw", async (role) => {
    for (const action of ACTIONS) expect((await call(action, `${ASSIGNED}:${role}`)).status).toBe(403);
    expect(repository.findArrangements).not.toHaveBeenCalled();
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

test("SCRUM-139: a coordinator not assigned to the event can neither see its readiness nor change it", async () => {
  for (const action of ACTIONS) {
    const response = await call(action, `${OTHER}:event_coordinator`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "You do not have permission to access this information." });
  }
  expect(repository.findArrangements).not.toHaveBeenCalled();
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(stored.status).toBe("APPROVED");
});

test("SCRUM-139: an unknown or malformed event id gets the same 403, revealing nothing", async () => {
  expect((await call("submit-safety-check", undefined, MISSING_ID)).status).toBe(403);
  expect((await call("submit-safety-check", undefined, "not-a-uuid")).status).toBe(403);
  expect(repository.findById).toHaveBeenCalledTimes(1);
});

test("SCRUM-139 failure: the record check answers 503 when storage is down", async () => {
  repository.findById.mockRejectedValue(new Error("connection refused"));

  expect((await call("submit-safety-check")).status).toBe(503);
});

test.each(["safety-readiness", "submit-safety-check"])(
  "SCRUM-139 failure: %s answers a safe 500 when reading arrangements fails", async (action) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repository.findArrangements.mockRejectedValue(new Error("events.repository: findArrangements venue failed - secret detail"));

    const response = await call(action);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ message: "Something went wrong. Please try again." });
    expect(body).not.toContain("secret detail");
    expect(stored.status).toBe("APPROVED");
    console.error.mockRestore();
  });

test.each(["submit-safety-check", "withdraw-safety-check"])(
  "SCRUM-139: %s answers 404 when the event is deleted after the access check", async (action) => {
    repository.findById.mockResolvedValueOnce({ ...stored }).mockResolvedValue(null);
    repository.transitionStatus.mockResolvedValue(null);

    const response = await call(action);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "That event no longer exists." });
  });
