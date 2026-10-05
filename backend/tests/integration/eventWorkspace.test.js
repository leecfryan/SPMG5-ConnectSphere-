import { test, expect, vi } from "vitest";
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
    { id: randomUUID(), name: "First private event", status: "APPROVED", coordinator_id: users.first.id, organiser_id: users.organiser.id, other_comments: "Private planning" },
    { id: randomUUID(), name: "Second private event", status: "APPROVED", coordinator_id: users.second.id, organiser_id: users.otherOrganiser.id },
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

// SCRUM-98/99: the manager assigns at SUBMITTED and the assigned coordinator
// decides later (discussions #73, #80, #95, #101).
test("[WORKFLOW-001] Manager assigns a submitted request; assignment alone neither starts review nor opens it to attendees", async t => {
  const { send, records, users } = await setup(t);
  const id = records[2].id;
  expect((await send(`/event-workspace/${id}/coordinator`, "manager", "PATCH", { coordinatorId: users.first.id, expectedCoordinatorId: null })).status).toBe(200);
  expect(records[2]).toMatchObject({ status: "SUBMITTED", coordinator_id: users.first.id });
  expect((await send(`/event-workspace/coordinator/${id}`, "first")).status).toBe(200);
  expect((await send(`/event-workspace/coordinator/${id}`, "second")).status).toBe(404);
  expect((await send(`/events/${id}`, "attendee")).status).toBe(404);
});

test("[WORKFLOW-007] The manager can no longer accept, reject or open registration", async t => {
  const { send, records } = await setup(t);
  const id = records[2].id;
  expect((await send(`/event-workspace/${id}/decision`, "manager", "PATCH", { decision: "accept" })).status).toBe(404);
  expect((await send(`/event-workspace/${id}/decision`, "manager", "PATCH", { decision: "reject" })).status).toBe(404);
  expect((await send(`/event-workspace/${id}/publication`, "manager", "PATCH", { openRegistration: true })).status).toBe(404);
  expect(records[2].status).toBe("SUBMITTED");
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

test("[WORKFLOW-003] A rejected request is unavailable for assignment and attendees", async t => {
  const { send, records, users } = await setup(t);
  const id = records[2].id;
  // Rejection is the assigned coordinator's action (SCRUM-98); set directly here.
  records[2].status = "REJECTED";
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

test("[WORKFLOW-005] Non-managers cannot assign or self-assign an event", async t => {
  const { send, records, users } = await setup(t);
  for (const user of ["first", "organiser", "attendee", "dual"]) {
    for (const [action, body] of [["coordinator", { coordinatorId: users.first.id, expectedCoordinatorId: null }]]) {
      expect((await send(`/event-workspace/${records[2].id}/${action}`, user, "PATCH", body)).status).toBe(403);
    }
  }
  expect(records[2].status).toBe("SUBMITTED");
  expect(records[2].coordinator_id).toBe(null);
});

test("[WORKFLOW-006] Malformed IDs and forged lifecycle fields are rejected", async t => {
  const { send, records, users } = await setup(t);
  expect((await send("/event-workspace/manager/not-an-id")).status).toBe(400);
  expect((await send(`/event-workspace/${records[2].id}/coordinator`, "manager", "PATCH", { coordinatorId: users.first.id, expectedCoordinatorId: null, status: "APPROVED" })).status).toBe(400);
  expect((await send(`/event-workspace/${records[0].id}/coordinator`, "manager", "PATCH", { coordinatorId: [users.second.id], expectedCoordinatorId: users.first.id })).status).toBe(400);
});

test("[ACCESS-005] Missing sessions and role removal fail closed on the next request", async t => {
  const { send, users } = await setup(t);
  expect((await send("/event-workspace/coordinator", null)).status).toBe(401);
  expect((await send("/event-workspace/coordinator", "first")).status).toBe(200);
  users.first.app_metadata.roles = ["attendee"];
  expect((await send("/event-workspace/coordinator", "first")).status).toBe(403);
});

// Every field the organiser supplies on the request form (SCRUM-23).
const ORGANISER_FIELDS = {
  purpose: "Teach basic digital skills", description: "Six weekly sessions.",
  start_time: "2099-10-10T01:00:00.000Z", end_time: "2099-10-10T05:00:00.000Z", expected_attendance: 30,
  venue_requirements: "Step-free room", accessibility_needs: "Hearing loop", equipment_needs: "Laptops",
  other_comments: "Seniors may need help signing in", submitted_at: "2099-09-01T00:00:00.000Z",
};

function addEvent(records, fields) {
  const event = { id: randomUUID(), name: "Digital Literacy for Seniors", ...fields };
  records.push(event);
  return event;
}

test("[SCRUM-98] AC1: the assigned coordinator opens a submitted request and sees everything the organiser supplied", async t => {
  const { send, records, users } = await setup(t);
  const event = addEvent(records, { ...ORGANISER_FIELDS, status: "SUBMITTED", coordinator_id: users.first.id, organiser_id: users.organiser.id });

  const response = await send(`/event-workspace/coordinator/${event.id}`, "first");
  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ name: event.name, status: "SUBMITTED", ...ORGANISER_FIELDS });
});

test("[SCRUM-98] AC1: another coordinator cannot open the request, and its details are not revealed", async t => {
  const { send, records, users } = await setup(t);
  const event = addEvent(records, { ...ORGANISER_FIELDS, status: "SUBMITTED", coordinator_id: users.first.id, organiser_id: users.organiser.id });

  const response = await send(`/event-workspace/coordinator/${event.id}`, "second");
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(ORGANISER_FIELDS.purpose);
});

// SCRUM-99 AC3: the decision, approver and time go to the responsible organiser,
// the assigned coordinator and the manager (discussion #125).
async function decidedSetup(t) {
  const context = await setup(t);
  const { records, users } = context;
  users.first.user_metadata = { full_name: "  Ada Tan  " };
  const event = addEvent(records, { status: "APPROVED", coordinator_id: users.first.id, organiser_id: users.organiser.id,
    decided_by: users.first.id, decided_at: "2099-09-05T02:30:00.000Z", decision_note: "Ready for planning." });
  return { ...context, event };
}

test("[SCRUM-99] AC3: the organiser, the assigned coordinator and the manager see the decision, the approver and the time", async t => {
  const { send, event, users } = await decidedSetup(t);
  for (const [scope, user] of [["organiser", "organiser"], ["coordinator", "first"], ["manager", "manager"]]) {
    const response = await send(`/event-workspace/${scope}/${event.id}`, user);
    expect(response.status, scope).toBe(200);
    expect((await response.json()).event, scope).toMatchObject({ status: "APPROVED", decided_by: users.first.id,
      decided_at: "2099-09-05T02:30:00.000Z", decision_note: "Ready for planning.", decided_by_name: "Ada Tan" });
  }
});

test("[SCRUM-99] AC3: another organiser and an unassigned coordinator cannot see the decision", async t => {
  const { send, event } = await decidedSetup(t);
  for (const [scope, user] of [["organiser", "otherOrganiser"], ["coordinator", "second"]]) {
    const response = await send(`/event-workspace/${scope}/${event.id}`, user);
    expect(response.status, user).toBe(404);
    expect(await response.text(), user).not.toContain("Ready for planning.");
  }
});

test("[SCRUM-99] boundary: an approver without a full name is shown by email", async t => {
  const { send, event, users } = await decidedSetup(t);
  users.first.user_metadata = { full_name: "   " };
  expect((await (await send(`/event-workspace/manager/${event.id}`)).json()).event.decided_by_name).toBe("first@example.test");
});

for (const [situation, reply] of [
  ["no longer exists", { data: { user: null }, error: null }],
  ["cannot be looked up", { data: null, error: { status: 500, message: "Auth unavailable" } }],
]) {
  test(`[SCRUM-99] boundary: when the approver's account ${situation} the event still loads with no approver name`, async t => {
    const { send, event, client } = await decidedSetup(t);
    client.auth.admin.getUserById = async () => reply;

    const response = await send(`/event-workspace/organiser/${event.id}`, "organiser");
    expect(response.status).toBe(200);
    expect((await response.json()).event).toMatchObject({ decided_at: "2099-09-05T02:30:00.000Z", decided_by_name: null });
  });
}

test("[SCRUM-99] AC3: an undecided event has no approver and no account is looked up", async t => {
  const { send, records, users, client } = await setup(t);
  const submitted = addEvent(records, { status: "SUBMITTED", coordinator_id: null, organiser_id: users.organiser.id });
  const lookup = vi.spyOn(client.auth.admin, "getUserById");

  const event = (await (await send(`/event-workspace/manager/${submitted.id}`)).json()).event;
  expect(event).toMatchObject({ status: "SUBMITTED", decided_by_name: null });
  expect(lookup).not.toHaveBeenCalled();
});

test("[SCRUM-98] AC3: the coordinator who rejected a request still sees it and the reason they recorded", async t => {
  const { send, records, users } = await setup(t);
  const event = addEvent(records, { status: "REJECTED", coordinator_id: users.first.id, organiser_id: users.organiser.id,
    decided_by: users.first.id, decided_at: "2099-09-05T02:30:00.000Z", decision_note: "Dates clash with exams." });

  const listed = (await (await send("/event-workspace/coordinator", "first")).json()).events.map(item => item.id);
  expect(listed).toContain(event.id);
  const response = await send(`/event-workspace/coordinator/${event.id}`, "first");
  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: "REJECTED", decision_note: "Dates clash with exams." });
  expect((await send(`/event-workspace/coordinator/${event.id}`, "second")).status).toBe(404);
});
