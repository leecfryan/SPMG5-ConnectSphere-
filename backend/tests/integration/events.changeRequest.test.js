import { test, expect } from "vitest";
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const createApp = require("../../src/app");
const storage = require("../../../tests/playwright/support/registration-storage.cjs");

async function setup(t) {
  const organiser      = { id: randomUUID(), email: "organiser@test", email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_organiser"] }, user_metadata: {} };
  const otherOrganiser = { id: randomUUID(), email: "other@test",     email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_organiser"] }, user_metadata: {} };
  const coordinator    = { id: randomUUID(), email: "coord@test",     email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_coordinator"] }, user_metadata: {} };
  const users = [organiser, otherOrganiser, coordinator];

  const records = [
    { id: randomUUID(), name: "Annual Gala", purpose: "Celebration", description: "Year-end event",
      start_time: "2099-06-01T10:00:00.000Z", end_time: "2099-06-01T18:00:00.000Z",
      registration_start: null, registration_end: null, expected_attendance: 100,
      venue_requirements: "Ballroom", accessibility_needs: null, equipment_needs: null, other_comments: null,
      status: "UNDER_REVIEW", organiser_id: organiser.id, coordinator_id: coordinator.id,
      submitted_at: "2026-01-01T00:00:00Z", pending_change_request: null },
    { id: randomUUID(), name: "Tech Summit", purpose: "Networking", description: "Annual summit",
      start_time: "2099-07-01T09:00:00.000Z", end_time: "2099-07-01T17:00:00.000Z",
      registration_start: null, registration_end: null, expected_attendance: 200,
      venue_requirements: "Hall", accessibility_needs: null, equipment_needs: null, other_comments: null,
      status: "UNDER_REVIEW", organiser_id: otherOrganiser.id, coordinator_id: coordinator.id,
      submitted_at: "2026-01-02T00:00:00Z", pending_change_request: null },
  ];

  const client = storage(new Map([[organiser.id, { events: records }]]));
  require("../../../tests/playwright/support/assignment-notification-storage.cjs")(client, new Map());
  client.auth = { admin: {
    async listUsers() { return { data: { users }, error: null }; },
    async getUserById(id) { return { data: { user: users.find(u => u.id === id) }, error: null }; },
  } };

  const app = createApp({ dataClient: client, authClient: { auth: {
    async getUser(token) { return { data: { user: users.find(u => u.id === token) || null }, error: null }; },
  } } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));

  const send = (path, userId, method = "POST", body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { ...(userId ? { Authorization: "Bearer " + userId } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return { send, organiser, otherOrganiser, coordinator, records };
}

// TC-SCRUM-36-01 (integration)
test("[TC-SCRUM-36-01] integration: organiser submits valid change request on their own event", async t => {
  const { send, organiser, records } = await setup(t);
  const id = records[0].id;
  const res = await send(`/event-workspace/organiser/${id}/change-request`, organiser.id, "POST", {
    proposed_changes: { name: "Revised Gala" }, reason: "Venue rebranding",
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.event.pending_change_request).toMatchObject({
    proposed_changes: { name: "Revised Gala" },
    reason: "Venue rebranding",
    requested_by: organiser.id,
  });
  expect(body.event.name).toBe("Annual Gala"); // event itself unchanged
});

// TC-SCRUM-36-05 (integration, one ineligible status)
test("[TC-SCRUM-36-05] integration: ineligible status returns 409", async t => {
  const { send, organiser, records } = await setup(t);
  records[0].status = "SAFETY_REVIEW";
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, organiser.id, "POST", {
    proposed_changes: { name: "New" }, reason: "Testing",
  });
  expect(res.status).toBe(409);
});

// TC-SCRUM-36-06 (integration)
test("[TC-SCRUM-36-06] integration: missing reason returns 400 with field error", async t => {
  const { send, organiser, records } = await setup(t);
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, organiser.id, "POST", {
    proposed_changes: { name: "New name" },
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(Array.isArray(body.errors)).toBe(true);
  expect(body.errors.some(e => e.field === "reason")).toBe(true);
});

// TC-SCRUM-36-10 (integration)
test("[TC-SCRUM-36-10] integration: non-permitted field in proposed_changes returns 400", async t => {
  const { send, organiser, records } = await setup(t);
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, organiser.id, "POST", {
    proposed_changes: { status: "CONFIRMED" }, reason: "Testing",
  });
  expect(res.status).toBe(400);
});

// TC-SCRUM-36-11 (integration)
test("[TC-SCRUM-36-11] integration: invalid proposed value returns 400 with field error", async t => {
  const { send, organiser, records } = await setup(t);
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, organiser.id, "POST", {
    proposed_changes: { expected_attendance: -5 }, reason: "Capacity change",
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.errors.some(e => e.field === "expected_attendance")).toBe(true);
});

// TC-SCRUM-36-15 (integration)
test("[TC-SCRUM-36-15] integration: second request while one is pending returns 409", async t => {
  const { send, organiser, records } = await setup(t);
  records[0].pending_change_request = {
    proposed_changes: { name: "First" }, reason: "First",
    requested_at: "2026-10-26T10:00:00.000Z", requested_by: organiser.id,
  };
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, organiser.id, "POST", {
    proposed_changes: { name: "Second" }, reason: "Second",
  });
  expect(res.status).toBe(409);
});

// TC-SCRUM-36-16 (integration)
test("[TC-SCRUM-36-16] integration: GET organiser workspace detail includes pending_change_request", async t => {
  const { send, organiser, records } = await setup(t);
  const pcr = { proposed_changes: { name: "Proposed" }, reason: "Testing",
    requested_at: "2026-10-26T10:00:00.000Z", requested_by: organiser.id };
  records[0].pending_change_request = pcr;
  const res = await send(`/event-workspace/organiser/${records[0].id}`, organiser.id, "GET");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.pending_change_request).toMatchObject(pcr);
});

// TC-SCRUM-36-18 (integration)
test("[TC-SCRUM-36-18] integration: unauthenticated request returns 401", async t => {
  const { send, records } = await setup(t);
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, null, "POST", {
    proposed_changes: { name: "New" }, reason: "Testing",
  });
  expect(res.status).toBe(401);
});

// TC-SCRUM-36-19 (integration)
test("[TC-SCRUM-36-19] integration: coordinator role returns 403", async t => {
  const { send, coordinator, records } = await setup(t);
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, coordinator.id, "POST", {
    proposed_changes: { name: "New" }, reason: "Testing",
  });
  expect(res.status).toBe(403);
});

// TC-SCRUM-36-20 (integration)
test("[TC-SCRUM-36-20] integration: organiser on another event gets 404, event unchanged", async t => {
  const { send, otherOrganiser, records } = await setup(t);
  const before = records[0].pending_change_request;
  const res = await send(`/event-workspace/organiser/${records[0].id}/change-request`, otherOrganiser.id, "POST", {
    proposed_changes: { name: "Hijack" }, reason: "Testing",
  });
  expect(res.status).toBe(404);
  expect(records[0].pending_change_request).toBe(before);
});
