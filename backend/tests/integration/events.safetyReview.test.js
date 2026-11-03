// SCRUM-140 over real HTTP: the /api/internal gate, the events.safety.read
// guard (GET only), and the safety review list and detail. Only the
// repository is faked; the service's arrangement filtering runs for real.
// SCRUM-141 adds the events.safety.decide guard and the approve/reject decisions.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const EVENT_ID = "bbbbbbbb-0001-0000-0000-000000000000";
const PLANNING_ID = "bbbbbbbb-0002-0000-0000-000000000000";
const MISSING_ID = "bbbbbbbb-0009-0000-0000-000000000000";
const OFFICER = "officer-1:safety_officer";

// The stored row deliberately carries organiser and coordinator details; a
// leak through the response would show up here (discussion #45).
const STORED = {
  [EVENT_ID]: {
    id: EVENT_ID, name: "Community Health Fair", status: "SAFETY_REVIEW", organiser_id: "org-1", coordinator_id: "coord-1",
    description: "Free screenings", start_time: "2099-05-01T01:00:00Z", end_time: "2099-05-01T09:00:00Z",
    expected_attendance: 180, accessibility_needs: "Two wheelchair users", other_comments: "Single entrance; queue outside.",
  },
  [PLANNING_ID]: { id: PLANNING_ID, name: "Still planning", status: "APPROVED" },
};
const SAFE_COLUMNS = ["id", "name", "description", "start_time", "end_time", "expected_attendance", "accessibility_needs", "other_comments"];
const pick = (row, columns) => Object.fromEntries(columns.map((column) => [column, row[column]]));

const HALL = { name: "Hall A", capacity: 200, accessibility_features: ["Step-free access"], notes: "Fire exits on the east wall." };
const BOOKED = {
  id: "vr-a", booking_date: "2099-05-01", expected_attendees: 150, room_layout: "Theatre",
  accessibility_requirements: ["Wheelchair seating"], venue: HALL, slots: [{ slot: "am", status: "confirmed" }],
};
const PENDING = { ...BOOKED, id: "vr-p", slots: [{ slot: "pm", status: "pending" }] };
const PROJECTOR = { id: "eq-1", status: "APPROVED", quantity_requested: 2, technical_requirement: "Rear of hall", equipment: { type: "Projector" } };

const repository = {
  findById: vi.fn(),
  transitionStatus: vi.fn(),
  findAwaitingSafetyReview: vi.fn(),
  findAwaitingSafetyReviewById: vi.fn(),
  findArrangements: vi.fn(),
  recordActivity: vi.fn(),
  undoTransition: vi.fn(),
};

// The token is "<user id>:<roles>", so each case states the identity it exercises.
const authClient = { auth: { getUser: async (token) => {
  const [id, roles] = token.split(":");
  return { data: { user: {
    id, email: `${id}@example.com`, app_metadata: { roles: roles.split(",") },
    // Never read: roles come from admin-controlled app_metadata only.
    user_metadata: { roles: ["safety_officer"] },
  } }, error: null };
} } };

let server, base;
beforeAll(async () => {
  server = createApp({ authClient, eventsRepository: repository }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  repository.findById.mockReset().mockImplementation(async (id) => STORED[id] ?? null);
  repository.transitionStatus.mockReset().mockResolvedValue(null);
  repository.findAwaitingSafetyReview.mockReset().mockResolvedValue([
    pick(STORED[EVENT_ID], ["id", "name", "start_time", "end_time", "expected_attendance"]),
  ]);
  repository.findAwaitingSafetyReviewById.mockReset().mockImplementation(async (id) =>
    STORED[id]?.status === "SAFETY_REVIEW" ? pick(STORED[id], SAFE_COLUMNS) : null);
  repository.findArrangements.mockReset().mockResolvedValue({ venueRequests: [BOOKED, PENDING], equipmentRequests: [PROJECTOR] });
  repository.recordActivity.mockReset().mockResolvedValue({ id: "act-1" });
  repository.undoTransition.mockReset().mockResolvedValue({ id: EVENT_ID });
});

function call(path, token = OFFICER, method = "GET") {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      // Forged role claims in headers must change nothing.
      "x-user-role": "safety_officer",
      "Content-Type": "application/json",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify({ name: "Changed", status: "PREPARATION" }) }),
  });
}

const LIST = "/api/internal/safety-reviews";
const DETAIL = `${LIST}/${EVENT_ID}`;

test("[SCRUM-140] AC1: the Safety Officer gets the events awaiting safety review", async () => {
  const response = await call(LIST);

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ events: [{
    id: EVENT_ID, name: "Community Health Fair", start_time: "2099-05-01T01:00:00Z", end_time: "2099-05-01T09:00:00Z", expected_attendance: 180,
  }] });
});

test("[SCRUM-140] AC1: an empty queue is an empty list, not an error", async () => {
  repository.findAwaitingSafetyReview.mockResolvedValue([]);

  const response = await call(LIST);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ events: [] });
});

test("[SCRUM-140] AC2/AC3: the detail shows the event's safety facts with only the confirmed venue and equipment", async () => {
  const response = await call(DETAIL);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    event: pick(STORED[EVENT_ID], SAFE_COLUMNS),
    venues: [{
      id: "vr-a", name: "Hall A", booking_date: "2099-05-01", slots: ["am"], expected_attendees: 150, capacity: 200,
      room_layout: "Theatre", accessibility_requirements: ["Wheelchair seating"],
      accessibility_features: ["Step-free access"], notes: "Fire exits on the east wall.",
    }],
    equipment: [{ id: "eq-1", type: "Projector", quantity_requested: 2, technical_requirement: "Rear of hall" }],
  });
  expect(repository.findArrangements).toHaveBeenCalledWith(EVENT_ID);
});

test("[SCRUM-140] #45: the detail carries no organiser, coordinator or status field", async () => {
  const body = JSON.stringify(await (await call(DETAIL)).json());

  for (const leaked of ["organiser_id", "coordinator_id", "org-1", "coord-1", "status"]) {
    expect(body).not.toContain(leaked);
  }
});

test.each([
  ["an event still in planning", PLANNING_ID],
  ["an unknown event", MISSING_ID],
])("[SCRUM-140] %s is a 404 and its arrangements are not read", async (_label, id) => {
  const response = await call(`${LIST}/${id}`);

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ message: "That event is not waiting for a safety review." });
  expect(repository.findArrangements).not.toHaveBeenCalled();
});

test("[SCRUM-140] a malformed event reference is a 400 that touches no storage", async () => {
  const response = await call(`${LIST}/not-a-uuid`);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message: "That event reference is not valid." });
  expect(repository.findAwaitingSafetyReviewById).not.toHaveBeenCalled();
});

test("[SCRUM-140] access: no token is a 401 on both paths", async () => {
  for (const path of [LIST, DETAIL]) {
    expect((await call(path, null)).status, path).toBe(401);
  }
  expect(repository.findAwaitingSafetyReview).not.toHaveBeenCalled();
});

test.each([
  "event_coordinator", "event_coordinator_lead", "venue_staff", "technical_support_staff", "event_organiser", "attendee",
])("[SCRUM-140] access: %s is refused the list and the detail before any read", async (role) => {
  for (const path of [LIST, DETAIL]) {
    expect((await call(path, `user-1:${role}`)).status, path).toBe(403);
  }
  expect(repository.findAwaitingSafetyReview).not.toHaveBeenCalled();
  expect(repository.findAwaitingSafetyReviewById).not.toHaveBeenCalled();
});

test.each(["POST", "PUT", "PATCH", "DELETE"])("[SCRUM-140] AC4: %s on the safety review paths is refused for the Safety Officer", async (method) => {
  for (const path of [LIST, DETAIL]) {
    const response = await call(path, OFFICER, method);
    expect(response.status, path).toBe(403);
    expect(await response.json()).toEqual({ message: "You do not have permission to access this information." });
  }
  expect(repository.findAwaitingSafetyReviewById).not.toHaveBeenCalled();
});

test("[SCRUM-140] AC4: the Safety Officer cannot change the event through any lifecycle action", async () => {
  for (const action of ["start-review", "approve", "reject", "cancel", "postpone", "submit-safety-check", "withdraw-safety-check"]) {
    expect((await call(`/api/internal/events/${EVENT_ID}/${action}`, OFFICER, "POST")).status, action).toBe(403);
  }
  expect((await call(`/api/event-workspace/${EVENT_ID}/coordinator`, OFFICER, "PATCH")).status).toBe(403);
  expect((await call(`/api/event-workspace/organiser/${EVENT_ID}`, OFFICER, "PATCH")).status).toBe(403);
  expect((await call("/api/venues/booking-requests/vr-a/decision", OFFICER, "PATCH")).status).toBe(403);
  expect(repository.transitionStatus).not.toHaveBeenCalled();
});

test("[SCRUM-140] failure: storage errors answer a safe 500 on both paths", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  repository.findAwaitingSafetyReview.mockRejectedValue(new Error("events.repository: connection refused"));
  repository.findArrangements.mockRejectedValue(new Error("events.repository: connection refused"));

  for (const path of [LIST, DETAIL]) {
    const response = await call(path);
    expect(response.status, path).toBe(500);
    expect(await response.json()).toEqual({ message: "Something went wrong. Please try again." });
  }
  errors.mockRestore();
});

test("[SCRUM-140] failure: without event storage the paths answer 503, after the permission check", async () => {
  const bare = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(bare, "listening");
  const url = `http://127.0.0.1:${bare.address().port}${LIST}`;
  try {
    const denied = await fetch(url, { headers: { Authorization: "Bearer user-1:venue_staff" } });
    const officer = await fetch(url, { headers: { Authorization: `Bearer ${OFFICER}` } });

    expect(denied.status).toBe(403);
    expect(officer.status).toBe(503);
    expect(await officer.json()).toEqual({ message: "Safety review is not configured." });
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

// SCRUM-141: the decisions. transitionStatus answers as the real conditional
// write would: the stored row moved, or null when it is not under review.
function decide(action, body, token = OFFICER, id = EVENT_ID) {
  return fetch(`${base}${LIST}/${id}/${action}`, {
    method: "POST",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const movesStoredRow = () => repository.transitionStatus.mockImplementation(async (id, from, to) =>
  STORED[id]?.status === from ? { ...STORED[id], status: to } : null);

test("[SCRUM-141] AC1/AC3/AC4: the Safety Officer approves; the event moves to preparation and the decision is recorded", async () => {
  movesStoredRow();

  const response = await decide("approve", { note: "Stewards confirmed", status: "CONFIRMED", actor_id: "someone-else" });

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ event: { id: EVENT_ID, status: "PREPARATION" } });
  expect(repository.transitionStatus).toHaveBeenCalledExactlyOnceWith(EVENT_ID, "SAFETY_REVIEW", "PREPARATION");
  expect(repository.recordActivity).toHaveBeenCalledExactlyOnceWith({
    eventId: EVENT_ID, actorId: "officer-1", action: "SAFETY_APPROVED", fromStatus: "SAFETY_REVIEW", toStatus: "PREPARATION", note: "Stewards confirmed",
  });
});

test("[SCRUM-141] AC2/AC3/AC4: the Safety Officer rejects with a reason; the event returns to planning, not preparation", async () => {
  movesStoredRow();

  const response = await decide("reject", { reason: "Only one exit for 180 people" });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ event: { id: EVENT_ID, status: "APPROVED" } });
  expect(repository.recordActivity).toHaveBeenCalledExactlyOnceWith({
    eventId: EVENT_ID, actorId: "officer-1", action: "SAFETY_REJECTED", fromStatus: "SAFETY_REVIEW", toStatus: "APPROVED", note: "Only one exit for 180 people",
  });
});

test("[SCRUM-141] #45: a decision answers with the id and status only", async () => {
  movesStoredRow();

  const body = JSON.stringify(await (await decide("approve", {})).json());

  for (const leaked of ["organiser_id", "coordinator_id", "org-1", "coord-1"]) expect(body).not.toContain(leaked);
});

test.each([{}, { reason: "   " }, { reason: 7 }, { note: "Reason in the wrong field" }])(
  "[SCRUM-141] AC2: rejecting without a reason (%j) is a 400 and nothing is written", async (body) => {
    const response = await decide("reject", body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Give a reason for rejecting this safety arrangement." });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
    expect(repository.recordActivity).not.toHaveBeenCalled();
  });

test("[SCRUM-141] an approval note that is not text is a 400", async () => {
  const response = await decide("approve", { note: ["x"] });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ message: "The note must be text." });
});

test.each(["approve", "reject"])("[SCRUM-141] conflict: %s on an event not under safety review is a 409 with no history", async (action) => {
  movesStoredRow();

  const response = await decide(action, { reason: "Late decision" }, OFFICER, PLANNING_ID);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ message: "This event is no longer waiting for a safety review. Refresh to see its current status." });
  expect(repository.recordActivity).not.toHaveBeenCalled();
});

test("[SCRUM-141] an unknown event is a 404 and a malformed reference a 400, with no history", async () => {
  movesStoredRow();

  const missing = await decide("approve", {}, OFFICER, MISSING_ID);
  const malformed = await decide("approve", {}, OFFICER, "not-a-uuid");

  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ message: "That event no longer exists." });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ message: "That event reference is not valid." });
  expect(repository.recordActivity).not.toHaveBeenCalled();
});

test("[SCRUM-141] access: no token is a 401 for both decisions", async () => {
  for (const action of ["approve", "reject"]) expect((await decide(action, { reason: "x" }, null)).status, action).toBe(401);
  expect(repository.transitionStatus).not.toHaveBeenCalled();
});

test.each([
  "event_coordinator", "event_coordinator_lead", "venue_staff", "technical_support_staff", "event_organiser", "attendee",
])("[SCRUM-141] access: %s cannot approve or reject a safety arrangement", async (role) => {
  for (const action of ["approve", "reject"]) {
    const response = await decide(action, { reason: "x" }, `user-1:${role}`);
    expect(response.status, action).toBe(403);
    expect(await response.json()).toEqual({ message: "You do not have permission to access this information." });
  }
  expect(repository.transitionStatus).not.toHaveBeenCalled();
});

test("[SCRUM-141] failure: if the history cannot be written the move is undone and a safe 500 answers", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  movesStoredRow();
  repository.recordActivity.mockRejectedValue(new Error("events.repository: recordActivity failed - relation does not exist"));

  const response = await decide("approve", {});

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ message: "Something went wrong. Please try again." });
  expect(repository.undoTransition).toHaveBeenCalledExactlyOnceWith(EVENT_ID, "SAFETY_REVIEW", "PREPARATION");
  errors.mockRestore();
});

test("[SCRUM-141] failure: without event storage the decisions answer 503, after the permission check", async () => {
  const bare = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(bare, "listening");
  const url = `http://127.0.0.1:${bare.address().port}${DETAIL}/approve`;
  try {
    const denied = await fetch(url, { method: "POST", headers: { Authorization: "Bearer user-1:event_coordinator" } });
    const officer = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${OFFICER}` } });

    expect(denied.status).toBe(403);
    expect(officer.status).toBe(503);
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});
