// SCRUM-26 over real HTTP: the /api/internal gate, the
// events.assign_coordinator guard, and the status codes the assignment queue
// depends on. Only the repository and the coordinator directory are faked, so
// this proves the contract without touching Supabase or Supabase Auth.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const COORDINATORS = [
  { id: "coord-1", fullName: "Ada Tan", email: "ada@example.com" },
  { id: "coord-2", fullName: "Ben Lim", email: "ben@example.com" },
];
const QUEUE = [
  { id: EVENT_ID, name: "Digital Literacy for Seniors", status: "SUBMITTED", coordinator_id: null, submitted_at: "2026-09-01T00:00:00Z" },
  { id: "aaaaaaaa-0002-0000-0000-000000000000", name: "Parent & Child Coding Workshop", status: "SUBMITTED", coordinator_id: null, submitted_at: "2026-09-08T00:00:00Z" },
];

const repository = {
  findSubmittedUnassigned: vi.fn(),
  findActiveAssignments: vi.fn(),
  assignCoordinator: vi.fn(),
  findById: vi.fn(),
};
const directory = { listCoordinators: vi.fn() };

// The token is the role list, so each case states the identity it is exercising.
const authClient = { auth: { getUser: async (token) => ({
  data: { user: token === "invalid" ? null : {
    id: "verified-manager", email: "eventopsmanager.demo@example.com",
    app_metadata: { roles: token.split(",") },
    // Never read: roles come from admin-controlled app_metadata only.
    user_metadata: { full_name: "Ops Manager", roles: ["event_ops_manager"] },
  } }, error: null,
}) } };

let server, base;
beforeAll(async () => {
  server = createApp({ authClient, assignmentDependencies: { repository, directory } }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  for (const fn of [...Object.values(repository), directory.listCoordinators]) fn.mockReset();
  repository.findSubmittedUnassigned.mockResolvedValue(QUEUE);
  repository.findActiveAssignments.mockResolvedValue([
    { coordinator_id: "coord-1", start_time: "2026-11-15T09:00:00+00:00" },
  ]);
  repository.assignCoordinator.mockImplementation(async (id, coordinatorId) =>
    ({ ...QUEUE[0], id, coordinator_id: coordinatorId }));
  repository.findById.mockResolvedValue(null);
  directory.listCoordinators.mockResolvedValue(COORDINATORS);
});

function send(path, role = "event_ops_manager", method = "GET", data) {
  return fetch(base + "/api/internal" + path, {
    method,
    headers: {
      ...(role ? { Authorization: "Bearer " + role } : {}),
      "Content-Type": "application/json",
      // Forged role claims in headers must change nothing.
      "x-user-role": "event_ops_manager",
    },
    // fetch refuses a body on GET, so the role loops can pass one for every path.
    ...(data === undefined || method === "GET" ? {} : { body: JSON.stringify(data) }),
  });
}

const PATHS = [["/events/unassigned", "GET"], ["/coordinators", "GET"], [`/events/${EVENT_ID}/coordinator`, "PUT"]];

test.each(["", "invalid"])(
  "SCRUM-26: an unauthenticated caller (%s) reaches no assignment endpoint", async (role) => {
    for (const [path, method] of PATHS) {
      expect((await send(path, role, method, { coordinatorId: "coord-1" })).status).toBe(401);
    }
  });

test.each(["event_coordinator", "venue_staff", "technical_support_staff", "event_organiser", "attendee", "unknown"])(
  "SCRUM-26: %s is signed in but cannot see or change assignments", async (role) => {
    for (const [path, method] of PATHS) {
      expect((await send(path, role, method, { coordinatorId: "coord-1" })).status).toBe(403);
    }
    // The guard runs before the handler: nothing was read and nothing written.
    expect(repository.findSubmittedUnassigned).not.toHaveBeenCalled();
    expect(repository.assignCoordinator).not.toHaveBeenCalled();
  });

test("SCRUM-26: an event_coordinator holds internal.access yet is still refused - the capability is specific", async () => {
  // The whole point of a separate permission rather than reusing the gate.
  expect((await send("/access", "event_coordinator")).status).toBe(200);
  expect((await send("/events/unassigned", "event_coordinator")).status).toBe(403);
});

test("SCRUM-26: a multi-role account holding event_ops_manager is admitted", async () => {
  expect((await send("/events/unassigned", "attendee,event_ops_manager")).status).toBe(200);
});

test("SCRUM-26: the queue returns submitted, unassigned requests in the repository's order", async () => {
  const response = await send("/events/unassigned");
  expect(response.status).toBe(200);
  const { events } = await response.json();
  expect(events.map((event) => event.name)).toEqual([
    "Digital Literacy for Seniors", "Parent & Child Coding Workshop",
  ]);
  expect(events.every((event) => event.status === "SUBMITTED" && event.coordinator_id === null)).toBe(true);
});

test("SCRUM-26: the coordinator table carries each coordinator's active workload", async () => {
  const response = await send("/coordinators");
  expect(response.status).toBe(200);
  const { coordinators } = await response.json();
  expect(coordinators).toEqual([
    { id: "coord-1", fullName: "Ada Tan", email: "ada@example.com", activeEvents: 1, nextEventStart: "2026-11-15T09:00:00.000Z" },
    { id: "coord-2", fullName: "Ben Lim", email: "ben@example.com", activeEvents: 0, nextEventStart: null },
  ]);
});

// Over HTTP an empty collection must still be a 200 with an empty array. A
// 404 or a bare body would read to the browser as a broken screen, and the
// queue is empty on every environment the moment the manager finishes.
test("SCRUM-26: an empty queue is a 200 with an empty list", async () => {
  repository.findSubmittedUnassigned.mockResolvedValue([]);

  const response = await send("/events/unassigned");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ events: [] });
});

test("SCRUM-26: an empty directory is a 200 with an empty list", async () => {
  directory.listCoordinators.mockResolvedValue([]);

  const response = await send("/coordinators");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ coordinators: [] });
});

test("SCRUM-26: assignment succeeds and does not move the event's status", async () => {
  const response = await send(`/events/${EVENT_ID}/coordinator`, "event_ops_manager", "PUT", { coordinatorId: "coord-1" });

  expect(response.status).toBe(200);
  const { event } = await response.json();
  expect(event.coordinator_id).toBe("coord-1");
  // Clarification #1: no acceptance step, so there is no status transition here.
  expect(event.status).toBe("SUBMITTED");
  expect(repository.assignCoordinator).toHaveBeenCalledWith(EVENT_ID, "coord-1");
});

test("SCRUM-26: a status or organiser smuggled into the body is ignored", async () => {
  await send(`/events/${EVENT_ID}/coordinator`, "event_ops_manager", "PUT",
    { coordinatorId: "coord-1", status: "APPROVED", organiser_id: "someone-else", coordinator_id: "coord-2" });

  // Only the two values the route is allowed to act on reach the repository.
  expect(repository.assignCoordinator).toHaveBeenCalledWith(EVENT_ID, "coord-1");
});

test("SCRUM-26: a missing coordinator is a 400 and writes nothing", async () => {
  const response = await send(`/events/${EVENT_ID}/coordinator`, "event_ops_manager", "PUT", {});
  expect(response.status).toBe(400);
  expect(repository.assignCoordinator).not.toHaveBeenCalled();
});

test("SCRUM-26: someone who is not an Event Coordinator is a 422 and writes nothing", async () => {
  const response = await send(`/events/${EVENT_ID}/coordinator`, "event_ops_manager", "PUT", { coordinatorId: "venue-staff-1" });
  expect(response.status).toBe(422);
  expect(repository.assignCoordinator).not.toHaveBeenCalled();
});

test("SCRUM-26: an unknown event is a 404", async () => {
  repository.assignCoordinator.mockResolvedValue(null);
  repository.findById.mockResolvedValue(null);
  const response = await send("/events/missing/coordinator", "event_ops_manager", "PUT", { coordinatorId: "coord-1" });
  expect(response.status).toBe(404);
});

test("SCRUM-26: a request another manager already assigned is a 409, not a silent overwrite", async () => {
  repository.assignCoordinator.mockResolvedValue(null);
  repository.findById.mockResolvedValue({ ...QUEUE[0], coordinator_id: "coord-2" });

  const response = await send(`/events/${EVENT_ID}/coordinator`, "event_ops_manager", "PUT", { coordinatorId: "coord-1" });

  expect(response.status).toBe(409);
  // Re-assignment is US-50; the message has to tell the manager that, or they
  // will retry the same click.
  expect((await response.json()).message).toMatch(/assigned by someone else/i);
});

test("SCRUM-26: a storage failure is logged, never returned to the manager", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  repository.findSubmittedUnassigned.mockRejectedValue(new Error("events.repository: findSubmittedUnassigned failed - connection refused"));

  const response = await send("/events/unassigned");

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toMatch(/connection refused/);
  expect(logged).toHaveBeenCalled();
  logged.mockRestore();
});

test("SCRUM-26: without the server data key, assignment reports 503 and sign-in still works", async () => {
  const unconfigured = createApp({ authClient }).listen(0, "127.0.0.1");
  await once(unconfigured, "listening");
  const url = `http://127.0.0.1:${unconfigured.address().port}`;
  const headers = { Authorization: "Bearer event_ops_manager", "Content-Type": "application/json" };

  for (const [path, method] of PATHS) {
    const response = await fetch(url + "/api/internal" + path, { method, headers, ...(method === "GET" ? {} : { body: "{}" }) });
    expect(response.status).toBe(503);
  }
  expect((await fetch(url + "/api/health")).status).toBe(200);
  await new Promise((resolve) => unconfigured.close(resolve));
});
