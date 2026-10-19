// SCRUM-139 over real HTTP: the /api/internal gate, the events.safety.submit
// guard and its assigned-coordinator record check, and the status codes the
// safety-check actions answer with. Only the repository is faked.
// SCRUM-144 adds confirm and the essential flag, behind events.decide.

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
const REQUEST_ID = "cccccccc-0001-0000-0000-000000000000";
const HALL_B_PENDING = { kind: "venue", label: "Hall B · 2099-05-02", reason: "Waiting for Venue Staff to decide." };

const repository = { findById: vi.fn(), transitionStatus: vi.fn(), findArrangements: vi.fn(), setArrangementEssential: vi.fn() };
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
  repository.setArrangementEssential.mockReset().mockImplementation(async (_kind, requestId, _eventId, isEssential) =>
    (requestId === REQUEST_ID ? { id: requestId, is_essential: isEssential } : null));
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
  expect(await response.json()).toEqual({ ready: false, missing: [HALL_B_PENDING], optional: [] });
  expect(repository.findArrangements).toHaveBeenCalledWith(EVENT_ID);
});

test("SCRUM-139 AC1: readiness reports a fully arranged event as ready", async () => {
  const response = await call("safety-readiness");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ready: true, missing: [], optional: [] });
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

test.each(["event_coordinator_lead", "event_organiser", "venue_staff", "technical_support_staff", "attendee", "unknown"])(
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

// SCRUM-144: confirm and the essential flag.
const ASSIGNED_TOKEN = `${ASSIGNED}:event_coordinator`;
const confirm = (token = ASSIGNED_TOKEN, id = EVENT_ID) => call("confirm", token, id);
function mark(body, { token = ASSIGNED_TOKEN, kind = "equipment", requestId = REQUEST_ID, id = EVENT_ID } = {}) {
  return fetch(`${base}/api/internal/events/${id}/arrangements/${kind}/${requestId}`, {
    method: "PATCH",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const OPTIONAL_MIC = { equipment: { type: "Microphone" }, status: "PENDING", id: REQUEST_ID, is_essential: false };

test("SCRUM-144 AC1: the assigned coordinator confirms an event in preparation with nothing essential outstanding", async () => {
  stored.status = "PREPARATION";

  const response = await confirm();

  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ id: EVENT_ID, status: "CONFIRMED" });
  expect(repository.transitionStatus).toHaveBeenCalledExactlyOnceWith(EVENT_ID, "PREPARATION", "CONFIRMED", {}, ASSIGNED);
});

test.each(["APPROVED", "SAFETY_REVIEW", "CONFIRMED", "CANCELLED", "POSTPONED"])(
  "SCRUM-144 AC1: an event in %s (no safety pass, or already confirmed) cannot be confirmed", async (status) => {
    stored.status = status;

    const response = await confirm();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "This event has changed since you opened it. Refresh to see its current status." });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

test("SCRUM-144 AC2/AC3: an essential venue still pending blocks confirmation and is listed; nothing is written", async () => {
  stored.status = "PREPARATION";
  repository.findArrangements.mockResolvedValue(NOT_READY);

  const response = await confirm();

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    message: "This event cannot be confirmed yet. Finish the essential arrangements listed.",
    missing: [HALL_B_PENDING],
  });
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(stored.status).toBe("PREPARATION");
});

test("SCRUM-144 AC4: a non-essential outstanding request does not block confirmation, and readiness lists it as optional", async () => {
  stored.status = "PREPARATION";
  repository.findArrangements.mockResolvedValue({ venueRequests: [BOOKED_VENUE], equipmentRequests: [OPTIONAL_MIC] });

  const readiness = await (await call("safety-readiness")).json();
  const response = await confirm();

  expect(readiness).toEqual({ ready: true, missing: [], optional: [
    { kind: "equipment", id: REQUEST_ID, label: "Microphone", reason: "Waiting for Technical Support Staff to reserve it." },
  ] });
  expect(response.status).toBe(200);
  expect(stored.status).toBe("CONFIRMED");
});

test("SCRUM-144 conflict: a lost race (status changed between check and write) is a 409", async () => {
  stored.status = "PREPARATION";
  repository.transitionStatus.mockResolvedValue(null);

  expect((await confirm()).status).toBe(409);
});

test.each(["APPROVED", "PREPARATION"])("SCRUM-144 AC4: the assigned coordinator marks a request non-essential while the event is %s", async (status) => {
  stored.status = status;

  const response = await mark({ is_essential: false, status: "CONFIRMED" });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ arrangement: { id: REQUEST_ID, is_essential: false } });
  expect(repository.setArrangementEssential).toHaveBeenCalledExactlyOnceWith("equipment", REQUEST_ID, EVENT_ID, false);
  expect(stored.status).toBe(status);
});

test.each(["SAFETY_REVIEW", "CONFIRMED", "CANCELLED"])("SCRUM-144 AC4: the flag cannot change while the event is %s", async (status) => {
  stored.status = status;

  const response = await mark({ is_essential: false });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ message: "Arrangements can only be marked while the event is in planning or preparation." });
  expect(repository.setArrangementEssential).not.toHaveBeenCalled();
});

test.each([
  ["a missing flag", {}, {}],
  ["a flag that is not true or false", { is_essential: "no" }, {}],
  ["an unknown arrangement kind", { is_essential: false }, { kind: "catering" }],
])("SCRUM-144 AC4: %s is a 400 and nothing is written", async (_label, body, options) => {
  const response = await mark(body, options);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message: "Choose whether this arrangement is essential." });
  expect(repository.setArrangementEssential).not.toHaveBeenCalled();
});

test("SCRUM-144 AC4: a malformed request id is a 400, and a request of another event is a 404", async () => {
  const malformed = await mark({ is_essential: false }, { requestId: "not-a-uuid" });
  const elsewhere = await mark({ is_essential: false }, { requestId: "cccccccc-0009-0000-0000-000000000000" });

  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ message: "That arrangement reference is not valid." });
  expect(elsewhere.status).toBe(404);
  expect(await elsewhere.json()).toEqual({ message: "That arrangement is not part of this event." });
});

test("SCRUM-144 access: no token is a 401; another coordinator and every other role are refused; nothing is written", async () => {
  stored.status = "PREPARATION";
  expect((await confirm(null)).status).toBe(401);
  expect((await mark({ is_essential: false }, { token: null })).status).toBe(401);
  for (const token of [`${OTHER}:event_coordinator`, "lead-1:event_coordinator_lead", "officer-1:safety_officer",
    "venue-1:venue_staff", "tech-1:technical_support_staff", "org-1:event_organiser", "att-1:attendee"]) {
    expect((await confirm(token)).status, token).toBe(403);
    expect((await mark({ is_essential: false }, { token })).status, token).toBe(403);
  }
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(repository.setArrangementEssential).not.toHaveBeenCalled();
});

test("SCRUM-144 failure: storage errors answer a safe 500 for confirm and the flag", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  stored.status = "PREPARATION";
  repository.findArrangements.mockRejectedValue(new Error("events.repository: connection refused"));
  repository.setArrangementEssential.mockRejectedValue(new Error("events.repository: column is_essential does not exist"));

  for (const response of [await confirm(), await mark({ is_essential: false })]) {
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Something went wrong. Please try again." });
  }
  errors.mockRestore();
});
