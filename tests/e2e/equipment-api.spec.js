const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const { setupEquipment, getAccessToken, updateAccountRoles, updateEvent } = require("./support/live-equipment-fixtures");

// Live-Supabase suite. Replaces the retired tests/playwright/equipment.api.spec.cjs, which relied
// on a fake in-memory Auth+backend simulator - incompatible with this story's
// changes regardless, since equipment_requests.requested_by/event_id are real
// foreign keys the fake simulator's synthetic account ids could never satisfy.
function authHeader(token) {
  return { Authorization: "Bearer " + token };
}

function requestFields(setup, overrides = {}) {
  return {
    equipment_id: setup.equipmentId, quantity_requested: 1,
    borrow_start: "2099-10-10T00:00:00Z", borrow_end: "2099-10-10T03:00:00Z",
    ...overrides,
  };
}

test.describe("Equipment API: role-scoped requests, technical review, clarifications, retention (live Supabase)", () => {
  let setup, tokens;

  test.beforeEach(async () => {
    setup = await setupEquipment();
    tokens = {
      coordinator: await getAccessToken(setup.coordinator),
      technical: await getAccessToken(setup.technical),
      outsider: await getAccessToken(setup.outsider),
    };
  });
  test.afterEach(async () => { await setup.teardown(); });

  test("an assigned coordinator creates a request; the server ignores forged requested_by/status; unrelated coordinators cannot read or create", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, {
      headers: authHeader(tokens.coordinator),
      data: requestFields(setup, { quantity_requested: 2, requested_by: "forged", status: "APPROVED" }),
    });
    expect(created.status(), await created.text()).toBe(201);
    const { data: row } = await created.json();
    expect(row).toMatchObject({ requested_by: setup.coordinator.id, status: "PENDING", quantity_requested: 2 });

    expect((await request.get(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.outsider) })).status()).toBe(403);
    expect((await request.post(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.outsider), data: requestFields(setup) })).status()).toBe(403);
  });

  test("technical support reviews and revises arrangements; a coordinator cannot review statuses", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.coordinator), data: requestFields(setup) });
    const { data: row } = await created.json();

    const dashboard = await request.get("/api/technical-support/equipment-requests", { headers: authHeader(tokens.technical) });
    expect(dashboard.status()).toBe(200);
    const line = (await dashboard.json()).data.find((item) => item.id === row.id);
    expect(line).toMatchObject({ requested_by_name: expect.any(String) });
    expect(line.event_name).toContain("E2E equipment test");

    expect((await request.get("/api/technical-support/equipment-requests", { headers: authHeader(tokens.coordinator) })).status()).toBe(403);
    expect((await request.patch(`/api/equipment-requests/${row.id}/status`, { headers: authHeader(tokens.coordinator), data: { status: "APPROVED" } })).status()).toBe(403);

    for (const status of ["APPROVED", "REJECTED", "APPROVED"]) {
      const changed = await request.patch(`/api/equipment-requests/${row.id}/status`, { headers: authHeader(tokens.technical), data: { status } });
      expect(changed.status()).toBe(200);
      expect((await changed.json()).data.status).toBe(status);
    }
  });

  test("clarification messages enforce event relationships, real author identity, and are editable by their author", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.coordinator), data: requestFields(setup) });
    const { data: row } = await created.json();

    const posted = await request.post(`/api/events/${setup.eventId}/messages`, {
      headers: authHeader(tokens.technical),
      data: { equipment_request_id: row.id, body: "Need an adapter?", author_id: "forged", author_role: "event_coordinator" },
    });
    expect(posted.status(), await posted.text()).toBe(201);
    const { data: message } = await posted.json();
    expect(message).toMatchObject({ author_id: setup.technical.id, author_role: "tech_support" });

    expect((await request.get(`/api/events/${setup.eventId}/messages`, { headers: authHeader(tokens.outsider) })).status()).toBe(403);
    expect((await request.patch(`/api/messages/${message.id}`, { headers: authHeader(tokens.coordinator), data: { body: "Changed" } })).status()).toBe(403);

    const edited = await request.patch(`/api/messages/${message.id}`, { headers: authHeader(tokens.technical), data: { body: "Need two adapters?" } });
    expect(edited.status()).toBe(200);
    const shared = await request.get(`/api/events/${setup.eventId}/messages`, { headers: authHeader(tokens.coordinator) });
    expect((await shared.json()).data[0].body).toBe("Need two adapters?");
  });

  test("Scrum-28-Scrum65 (AC3): a clarification thread is hidden 30 days after the event ends", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.coordinator), data: requestFields(setup) });
    const { data: row } = await created.json();
    await request.post(`/api/events/${setup.eventId}/messages`, {
      headers: authHeader(tokens.technical), data: { equipment_request_id: row.id, body: "Still within the window" },
    });

    // events has an end_time > start_time check constraint, so both move back.
    await updateEvent(setup.eventId, { start_time: "1999-12-01T00:00:00Z", end_time: "2000-01-01T00:00:00Z" });

    const afterExpiry = await request.get(`/api/events/${setup.eventId}/messages`, { headers: authHeader(tokens.technical) });
    expect((await afterExpiry.json()).data).toEqual([]);
    expect((await request.post(`/api/events/${setup.eventId}/messages`, { headers: authHeader(tokens.technical), data: { equipment_request_id: row.id, body: "Too late" } })).status()).toBe(410);
  });

  test("revoking a role denies the very next request with the same still-valid token", async ({ request }) => {
    expect((await request.get("/api/technical-support/equipment-requests", { headers: authHeader(tokens.technical) })).status()).toBe(200);
    await updateAccountRoles(setup.technical.id, ["attendee"]);
    expect((await request.get("/api/technical-support/equipment-requests", { headers: authHeader(tokens.technical) })).status()).toBe(403);
  });
});
