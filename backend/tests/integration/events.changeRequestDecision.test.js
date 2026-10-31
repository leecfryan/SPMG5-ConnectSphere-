import { test, expect } from "vitest";
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const createApp = require("../../src/app");
const storage = require("../../../tests/playwright/support/registration-storage.cjs");

const PENDING = {
  proposed_changes: { name: "Revised Gala" },
  reason: "Venue rebranding",
  requested_at: "2026-10-29T10:00:00.000Z",
  requested_by: null, // filled in setup
};

async function setup(t, { eventStatus = "UNDER_REVIEW", pending = true } = {}) {
  const organiser   = { id: randomUUID(), email: "organiser@test", email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_organiser"] }, user_metadata: {} };
  const coordinator = { id: randomUUID(), email: "coord@test",     email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_coordinator"] }, user_metadata: {} };
  const otherCoord  = { id: randomUUID(), email: "other@test",     email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_coordinator"] }, user_metadata: {} };
  const users = [organiser, coordinator, otherCoord];

  const pcr = pending ? { ...PENDING, requested_by: organiser.id } : null;
  const record = {
    id: randomUUID(),
    name: "Annual Gala", purpose: "Celebration", description: "Year-end event",
    start_time: "2099-06-01T10:00:00.000Z", end_time: "2099-06-01T18:00:00.000Z",
    registration_start: null, registration_end: null, expected_attendance: 100,
    venue_requirements: "Ballroom", accessibility_needs: null, equipment_needs: null, other_comments: null,
    status: eventStatus, organiser_id: organiser.id, coordinator_id: coordinator.id,
    submitted_at: "2026-01-01T00:00:00Z", updated_at: "2026-10-29T00:00:00.000Z",
    pending_change_request: pcr,
  };

  const client = storage(new Map([[organiser.id, { events: [record] }]]));
  require("../../../tests/playwright/support/assignment-notification-storage.cjs")(client, new Map());
  client.auth = { admin: {
    async listUsers() { return { data: { users }, error: null }; },
    async getUserById(id) { return { data: { user: users.find(u => u.id === id) }, error: null }; },
  } };

  const app = createApp({ dataClient: client, authClient: { auth: {
    async getUser(token) { return { data: { user: users.find(u => u.id === token) || null }, error: null }; },
  } }, eventsRepository: {
    findById: async (id) => id === record.id ? { ...record } : null,
  } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));

  const send = (path, userId, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/internal${path}`, {
      method: "POST",
      headers: { ...(userId ? { Authorization: "Bearer " + userId } : {}), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return { send, organiser, coordinator, otherCoord, record, client };
}

// TC-SCRUM-165-01
test("[TC-SCRUM-165-01] coordinator approves non-significant change on UNDER_REVIEW event", async t => {
  const { send, coordinator, record, client } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Looks good." });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.name).toBe("Revised Gala");       // proposed change applied
  expect(body.event.status).toBe("UNDER_REVIEW");     // no regression (not APPROVED)
  expect(body.event.pending_change_request).toBeNull();
  expect(client.activity.some(e => e.action === "CHANGE_REQUEST_APPROVED")).toBe(true);
});

// TC-SCRUM-165-02
test("[TC-SCRUM-165-02] coordinator approves non-significant change on APPROVED event, no regression", async t => {
  const { send, coordinator, record } = await setup(t, { eventStatus: "APPROVED" });
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Agreed." });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.name).toBe("Revised Gala");
  expect(body.event.status).toBe("APPROVED");         // name is not a significant field
  expect(body.event.pending_change_request).toBeNull();
});

// TC-SCRUM-165-03
test("[TC-SCRUM-165-03] coordinator approves significant change on APPROVED event, regresses to SUBMITTED", async t => {
  const { send, coordinator, record } = await setup(t, { eventStatus: "APPROVED" });
  // Override proposed_changes with a significant field
  record.pending_change_request.proposed_changes = { expected_attendance: 250 };
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Agreed." });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.expected_attendance).toBe(250);
  expect(body.event.status).toBe("SUBMITTED");        // regression because APPROVED + significant field
  expect(body.event.pending_change_request).toBeNull();
});

// TC-SCRUM-165-04
test("[TC-SCRUM-165-04] coordinator rejects change request, event fields unchanged", async t => {
  const { send, coordinator, record, client } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "reject", reason: "Not aligned with the original brief." });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.name).toBe("Annual Gala");        // original name unchanged
  expect(body.event.status).toBe("UNDER_REVIEW");
  expect(body.event.pending_change_request).toBeNull();
  const log = client.activity.find(e => e.action === "CHANGE_REQUEST_REJECTED");
  expect(log).toBeDefined();
  expect(log.details.note).toBe("Not aligned with the original brief.");
});

// TC-SCRUM-165-05 (conflict: pending_change_request already cleared by a concurrent action)
test("[TC-SCRUM-165-05] pending_change_request cleared concurrently returns 409", async t => {
  const { send, coordinator, record } = await setup(t);
  // Simulate a concurrent clear (e.g., another coordinator action) that removes the
  // pending request between the service read and write. The .not() guard catches this.
  const origUpdate = record.pending_change_request;
  record.pending_change_request = null; // pre-clear so the .not(pending_change_request, is, null) filter fails
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Fine." });
  expect(res.status).toBe(409);
  record.pending_change_request = origUpdate; // restore for cleanup
});

// TC-SCRUM-165-06
test("[TC-SCRUM-165-06] missing reason returns 400", async t => {
  const { send, coordinator, record } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve" });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.errors?.some(e => e.field === "reason")).toBe(true);
});

// TC-SCRUM-165-07
test("[TC-SCRUM-165-07] whitespace-only reason returns 400", async t => {
  const { send, coordinator, record } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "   " });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.errors?.some(e => e.field === "reason")).toBe(true);
});

// TC-SCRUM-165-08
test("[TC-SCRUM-165-08] unknown decision value returns 400", async t => {
  const { send, coordinator, record } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "maybe", reason: "Hmm." });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.errors?.some(e => e.field === "decision")).toBe(true);
});

// TC-SCRUM-165-09 (no pending request)
test("[TC-SCRUM-165-09] no pending change request returns 409", async t => {
  const { send, coordinator, record } = await setup(t, { pending: false });
  const res = await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Fine." });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.message).toMatch(/no pending/i);
});

// TC-SCRUM-165-10
test("[TC-SCRUM-165-10] unauthenticated request returns 401", async t => {
  const { send, record } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, null, { decision: "approve", reason: "Fine." });
  expect(res.status).toBe(401);
});

// TC-SCRUM-165-11
test("[TC-SCRUM-165-11] organiser role returns 403", async t => {
  const { send, organiser, record } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, organiser.id, { decision: "approve", reason: "Fine." });
  expect(res.status).toBe(403);
});

// TC-SCRUM-165-12
test("[TC-SCRUM-165-12] unassigned coordinator returns 403", async t => {
  const { send, otherCoord, record } = await setup(t);
  const res = await send(`/events/${record.id}/decide-change-request`, otherCoord.id, { decision: "approve", reason: "Fine." });
  expect(res.status).toBe(403);
});

// TC-SCRUM-165-13
test("[TC-SCRUM-165-13] rejection reason visible in activity log after decision", async t => {
  const { send, coordinator, record, client } = await setup(t);
  await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "reject", reason: "Scope creep." });
  const entry = client.activity.find(e => e.action === "CHANGE_REQUEST_REJECTED");
  expect(entry?.details?.note).toBe("Scope creep.");
  expect(entry?.details?.proposed_changes).toMatchObject({ name: "Revised Gala" });
});

// TC-SCRUM-165-14
test("[TC-SCRUM-165-14] approval decision visible in activity history with proposed_changes snapshot", async t => {
  const { send, coordinator, record, client } = await setup(t);
  await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Approved." });
  const entry = client.activity.find(e => e.action === "CHANGE_REQUEST_APPROVED");
  expect(entry?.details?.note).toBe("Approved.");
  expect(entry?.details?.proposed_changes).toMatchObject({ name: "Revised Gala" });
});

// TC-SCRUM-165-15
test("[TC-SCRUM-165-15] notification enqueued for organiser after decision", async t => {
  const { send, coordinator, record, client } = await setup(t);
  await send(`/events/${record.id}/decide-change-request`, coordinator.id, { decision: "approve", reason: "Approved." });
  const notif = client.notificationOutbox.find(n => n.payload?.eventId === record.id);
  expect(notif).toBeDefined();
  expect(notif.recipient_id).toBe(record.organiser_id);
  expect(notif.payload.outcome).toBe("change request approved");
  expect(notif.payload.remark).toBe("Approved.");
});
