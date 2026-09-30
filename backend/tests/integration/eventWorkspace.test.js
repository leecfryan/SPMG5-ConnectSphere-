import { test, expect } from "vitest";
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const createApp = require("../../src/app");
const storage = require("../../../tests/playwright/support/registration-storage.cjs");

async function setup(t) {
  const roles = { manager: ["event_ops_manager"], first: ["event_coordinator"], second: ["event_coordinator"],
    organiser: ["event_organiser"], otherOrganiser: ["event_organiser"], attendee: ["attendee"],
    venue: ["venue_staff"], technical: ["technical_support_staff"], dual: ["venue_staff", "technical_support_staff"] };
  const users = Object.fromEntries(Object.entries(roles).map(([key, values]) => [key, {
    id: randomUUID(), email: key + "@example.test", email_confirmed_at: "2026-01-01", app_metadata: { roles: values }, user_metadata: {},
  }]));
  const records = [
    { id: randomUUID(), name: "First private event", status: "ACCEPTED", coordinator_id: users.first.id, organiser_id: users.organiser.id, other_comments: "Private planning" },
    { id: randomUUID(), name: "Second private event", status: "ACCEPTED", coordinator_id: users.second.id, organiser_id: users.otherOrganiser.id },
    { id: randomUUID(), name: "Submitted request", status: "SUBMITTED", coordinator_id: null, organiser_id: users.organiser.id },
  ];
  const accounts = new Map([[users.organiser.id, { events: records }]]);
  const client = storage(accounts);
  client.auth = { admin: {
    async listUsers() { return { data: { users: Object.values(users) }, error: null }; },
    async getUserById(id) { return { data: { user: Object.values(users).find(user => user.id === id) }, error: null }; },
  } };
  const app = createApp({ dataClient: client, authClient: { auth: {
    async getUser(token) { return { data: { user: users[token] || null }, error: null }; },
  } } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = (path, user = "manager", method = "GET", body) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { ...(user ? { Authorization: "Bearer " + user } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { send, users, records, client };
}

test("[ACCESS-001] Two coordinators see only their own list and direct event details", async t => {
  const { send, records } = await setup(t);
  for (const [role, own, other] of [["first", records[0], records[1]], ["second", records[1], records[0]]]) {
    const list = await (await send("/event-workspace/coordinator?coordinator_id=forged", role)).json();
    expect(list.events.map(event => event.id)).toEqual([own.id]);
    expect((await send(`/event-workspace/coordinator/${own.id}`, role)).status).toBe(200);
    const denied = await send(`/event-workspace/coordinator/${other.id}`, role);
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain(other.name);
  }
});

test("[ACCESS-002] Organisers can read only their own requests before approval", async t => {
  const { send, records } = await setup(t);
  expect((await (await send("/event-workspace/organiser", "organiser")).json()).events.map(row => row.id).sort()).toEqual([records[0].id, records[2].id].sort());
  expect((await send(`/event-workspace/organiser/${records[1].id}`, "organiser")).status).toBe(404);
});

test("[ACCESS-003] Staff and organisers cannot use attendee browsing or registration APIs", async t => {
  const { send, records } = await setup(t);
  for (const user of ["first", "second", "manager", "venue", "technical", "dual", "organiser"]) {
    for (const path of ["/events", `/events/${records[0].id}`, "/registrations/me", "/registrations/me/anything"]) {
      expect((await send(path, user)).status, user + path).toBe(403);
    }
    expect((await send("/registrations", user, "POST", { eventId: records[0].id })).status).toBe(403);
    expect((await send("/registrations/anything/withdraw", user, "PATCH", {})).status).toBe(403);
  }
});

test("[ACCESS-004] Venue and technical responsibilities do not grant full planning, review or directory access", async t => {
  const { send, records } = await setup(t);
  for (const user of ["venue", "technical", "dual", "attendee"]) {
    for (const path of ["coordinator", "organiser", "manager", "coordinators", `coordinator/${records[0].id}`]) {
      expect((await send("/event-workspace/" + path, user)).status).toBe(403);
    }
  }
});

test("[WORKFLOW-001] Manager accepts, assigns and separately opens registration", async t => {
  const { send, records, users } = await setup(t);
  const id = records[2].id;
  expect((await send(`/event-workspace/${id}/coordinator`, "manager", "PATCH", { coordinatorId: users.first.id, expectedCoordinatorId: null })).status).toBe(409);
  expect((await send(`/event-workspace/${id}/decision`, "manager", "PATCH", { decision: "accept" })).status).toBe(200);
  expect(records[2].status).toBe("ACCEPTED");
  expect((await send(`/events/${id}`, "attendee")).status).toBe(404);
  expect((await send(`/event-workspace/${id}/publication`, "manager", "PATCH", { openRegistration: true })).status).toBe(409);
  expect((await send(`/event-workspace/${id}/coordinator`, "manager", "PATCH", { coordinatorId: users.first.id, expectedCoordinatorId: null })).status).toBe(200);
  expect((await send(`/event-workspace/coordinator/${id}`, "first")).status).toBe(200);
  expect((await send(`/event-workspace/${id}/publication`, "manager", "PATCH", { openRegistration: true })).status).toBe(200);
  const published = await (await send(`/events/${id}`, "attendee")).json();
  expect(JSON.stringify(published)).toContain("Submitted request");
  expect(JSON.stringify(published)).not.toContain("coordinator_id");
});

test("[WORKFLOW-002] Reassignment revokes the previous coordinator and stale assignments fail", async t => {
  const { send, records, users } = await setup(t);
  const path = `/event-workspace/${records[0].id}/coordinator`;
  const body = { coordinatorId: users.second.id, expectedCoordinatorId: users.first.id };
  expect((await send(path, "manager", "PATCH", body)).status).toBe(200);
  expect((await send(path, "manager", "PATCH", body)).status).toBe(409);
  expect((await send(`/event-workspace/coordinator/${records[0].id}`, "first")).status).toBe(404);
  expect((await send(`/event-workspace/coordinator/${records[0].id}`, "second")).status).toBe(200);
});

test("[WORKFLOW-003] Rejecting a request leaves it unavailable for assignment and attendees", async t => {
  const { send, records, users } = await setup(t);
  const id = records[2].id;
  expect((await send(`/event-workspace/${id}/decision`, "manager", "PATCH", { decision: "reject" })).status).toBe(200);
  expect((await send(`/event-workspace/${id}/decision`, "manager", "PATCH", { decision: "accept" })).status).toBe(409);
  expect((await send(`/event-workspace/${id}/coordinator`, "manager", "PATCH", { coordinatorId: users.first.id, expectedCoordinatorId: null })).status).toBe(409);
  expect((await send(`/events/${id}`, "attendee")).status).toBe(404);
  expect((await (await send(`/event-workspace/organiser/${id}`, "organiser")).json()).event.status).toBe("REJECTED");
});

test("[WORKFLOW-004] Only verified active coordinators appear in the manager directory", async t => {
  const { send, users, records } = await setup(t);
  users.attendee.user_metadata.roles = ["event_coordinator"];
  users.first.user_metadata.full_name = { forged: "Not a display name" };
  const directory = await (await send("/event-workspace/coordinators")).json();
  expect(directory.coordinators.map(row => row.id).sort()).toEqual([users.first.id, users.second.id].sort());
  expect(Object.keys(directory.coordinators[0]).sort()).toEqual(["email", "id", "name"]);
  expect(directory.coordinators.find(row => row.id === users.first.id).name).toBe(users.first.email);
  for (const key of ["attendee", "venue", "manager"]) {
    expect((await send(`/event-workspace/${records[0].id}/coordinator`, "manager", "PATCH", {
      coordinatorId: users[key].id, expectedCoordinatorId: users.first.id,
    })).status).toBe(400);
  }
  users.second.banned_until = "2099-01-01";
  expect((await (await send("/event-workspace/coordinators")).json()).coordinators.map(row => row.id)).toEqual([users.first.id]);
});

test("[WORKFLOW-005] Non-managers cannot decide, publish, or self-assign an event", async t => {
  const { send, records, users } = await setup(t);
  for (const user of ["first", "organiser", "attendee", "dual"]) {
    for (const [action, body] of [["decision", { decision: "accept" }], ["publication", { openRegistration: true }],
      ["coordinator", { coordinatorId: users.first.id, expectedCoordinatorId: null }]]) {
      expect((await send(`/event-workspace/${records[2].id}/${action}`, user, "PATCH", body)).status).toBe(403);
    }
  }
  expect(records[2].status).toBe("SUBMITTED");
  expect(records[2].coordinator_id).toBe(null);
});

test("[WORKFLOW-006] Malformed IDs and forged lifecycle fields are rejected", async t => {
  const { send, records, users } = await setup(t);
  expect((await send("/event-workspace/manager/not-an-id")).status).toBe(400);
  expect((await send(`/event-workspace/${records[2].id}/decision`, "manager", "PATCH", { decision: "accept", coordinator_id: "forged" })).status).toBe(400);
  expect((await send(`/event-workspace/${records[2].id}/decision`, "manager", "PATCH", { decision: "APPROVED" })).status).toBe(400);
  expect((await send(`/event-workspace/${records[2].id}/publication`, "manager", "PATCH", { openRegistration: "true" })).status).toBe(400);
  expect((await send(`/event-workspace/${records[0].id}/coordinator`, "manager", "PATCH", { coordinatorId: [users.second.id], expectedCoordinatorId: users.first.id })).status).toBe(400);
});

test("[ACCESS-005] Missing sessions and role removal fail closed on the next request", async t => {
  const { send, users } = await setup(t);
  expect((await send("/event-workspace/coordinator", null)).status).toBe(401);
  expect((await send("/event-workspace/coordinator", "first")).status).toBe(200);
  users.first.app_metadata.roles = ["attendee"];
  expect((await send("/event-workspace/coordinator", "first")).status).toBe(403);
});
