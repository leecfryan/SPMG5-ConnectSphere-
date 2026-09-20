// Production equipment router and permission policy with fake identity and storage.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");

const equipmentRoutes = require("../../../src/routes/equipment.routes");

const VALID_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const VALID_EQUIPMENT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_EQUIPMENT_ID = "33333333-3333-3333-3333-333333333333";

function validCreatePayload(overrides = {}) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return {
    equipment_id: VALID_EQUIPMENT_ID,
    quantity_requested: 2,
    technical_requirement: "Needs HDMI",
    borrow_start: start.toISOString(),
    borrow_end: end.toISOString(),
    ...overrides,
  };
}

function fakeEquipmentService({ equipmentById = {}, requestsByEvent = {}, requestById = {}, allRequests = [], overlapping = false } = {}) {
  const calls = { createRequest: [], updateStatus: [], hasOverlappingRequest: [] };
  return {
    calls,
    async listEquipment() {
      return Object.values(equipmentById);
    },
    async findEquipmentById(id) {
      return equipmentById[id] || null;
    },
    async listRequestsByEvent(eventId) {
      return requestsByEvent[eventId] || [];
    },
    async findRequestById(id) {
      return requestById[id] || null;
    },
    async listAllRequests() {
      return allRequests;
    },
    async hasOverlappingRequest(equipmentId, borrowStart, borrowEnd) {
      calls.hasOverlappingRequest.push({ equipmentId, borrowStart, borrowEnd });
      return overlapping;
    },
    async createRequest(fields, requestedBy) {
      calls.createRequest.push({ fields, requestedBy });
      return { id: "new-request-id", status: "PENDING", requested_by: requestedBy, ...fields };
    },
    // Scrum-28-Scrum64 (AC2): unconditional, matching the real service - no
    // PENDING-only precondition (see equipment.service.js's updateStatus).
    async updateStatus(id, status) {
      calls.updateStatus.push({ id, status });
      const existing = requestById[id];
      if (!existing) return null;
      return { ...existing, status };
    },
  };
}

// Builds an app wired the same way equipment.routes.js wires the real one,
// but with a stub auth middleware (identity comes from a test-only header -
// requireAuth itself is covered by auth.test.js, not re-tested here) and
// injected fakes in place of the real Supabase-backed client/service.
async function setup(t, {
  roleAssignments = { "anyone-authenticated": ["technical_support_staff"] },
  equipmentService,
  findEventById = async () => ({ id: VALID_EVENT_ID, coordinator_id: "coord-1" }),
  findEventsByIds = async (ids) => ids.map((id) => ({ id, name: "Event " + id })),
  getUserDisplayName = async (id) => "User " + id,
}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const header = req.get("x-test-user-id");
    if (header) req.user = { id: header, roles: roleAssignments[header] || [] };
    next();
  });

  app.use("/api", equipmentRoutes({ authenticate: (req, res, next) => next(), equipmentService, findEventById, findEventsByIds, getUserDisplayName }));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return "http://127.0.0.1:" + server.address().port;
}

// --- Scrum-27 AC1: equipment type can be recorded (equipment_id link resolves) ---

test("Scrum-27 AC1: a request created with a valid equipment_id resolves to that equipment", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID, type: "PROJECTOR" } },
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload()),
  });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.equipment_id, VALID_EQUIPMENT_ID);
  assert.equal(equipmentService.calls.createRequest.length, 1);
});

test("Scrum-27 AC1: an equipment_id that does not exist is rejected", async (t) => {
  const equipmentService = fakeEquipmentService({ equipmentById: {} });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload()),
  });
  assert.equal(response.status, 404);
  assert.equal(equipmentService.calls.createRequest.length, 0);
});

test("the equipment catalogue is listed for authenticated technical staff", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID, type: "PROJECTOR" } },
  });
  const base = await setup(t, { equipmentService });

  const response = await fetch(base + "/api/equipment", {
    headers: { "x-test-user-id": "anyone-authenticated" },
  });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((e) => e.id), [VALID_EQUIPMENT_ID]);
});

// --- Scrum-27 AC2: required quantity can be recorded ---

test("Scrum-27 AC2: a valid quantity is persisted on the created request", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID } },
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload({ quantity_requested: 5 })),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.quantity_requested, 5);
});

test("Scrum-27 AC2: quantity <= 0 is rejected before reaching the data layer", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID } },
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload({ quantity_requested: 0 })),
  });
  assert.equal(response.status, 400);
  assert.equal(equipmentService.calls.createRequest.length, 0);
});

// --- Scrum-27 AC3: relevant technical requirements can be recorded ---

test("Scrum-27 AC3: technical_requirement is persisted on the created request", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID } },
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload({ technical_requirement: "Needs a wireless lapel mic." })),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.technical_requirement, "Needs a wireless lapel mic.");
});

// --- Scrum-27 AC4: the request remains associated with the relevant event ---

test("Scrum-27 AC4: a request is retrievable via its event_id; cascade delete is enforced by the events.id foreign key in the schema (not re-verified by this app-layer test)", async (t) => {
  const requestsByEvent = {
    [VALID_EVENT_ID]: [{ id: "44444444-4444-4444-4444-444444444444", event_id: VALID_EVENT_ID, equipment_id: VALID_EQUIPMENT_ID }],
  };
  const equipmentService = fakeEquipmentService({ requestsByEvent });
  const base = await setup(t, { equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    headers: { "x-test-user-id": "anyone-authenticated" },
  });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((r) => r.id), ["44444444-4444-4444-4444-444444444444"]);
});

// --- role gating: create is coordinator-only ---

test("a Coordinator can create a request; a Technical Support Staff member cannot (403)", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID } },
  });
  const base = await setup(t, {
    roleAssignments: { "coord-1": ["event_coordinator"], "tech-1": ["technical_support_staff"] },
    equipmentService,
  });

  const asCoordinator = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload()),
  });
  assert.equal(asCoordinator.status, 201);

  const asTechSupport = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify(validCreatePayload()),
  });
  assert.equal(asTechSupport.status, 403);
  assert.equal(equipmentService.calls.createRequest.length, 1, "only the coordinator's request should reach the data layer");
});

// --- role gating: status update is tech_support-only ---

test("Technical Support Staff can update status; a Coordinator cannot (403)", async (t) => {
  const requestById = { "44444444-4444-4444-4444-444444444444": { id: "44444444-4444-4444-4444-444444444444", status: "PENDING" } };
  const equipmentService = fakeEquipmentService({ requestById });
  const base = await setup(t, {
    roleAssignments: { "coord-1": ["event_coordinator"], "tech-1": ["technical_support_staff"] },
    equipmentService,
  });

  const asCoordinator = await fetch(base + "/api/equipment-requests/44444444-4444-4444-4444-444444444444/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(asCoordinator.status, 403);
  assert.equal(equipmentService.calls.updateStatus.length, 0);

  const asTechSupport = await fetch(base + "/api/equipment-requests/44444444-4444-4444-4444-444444444444/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(asTechSupport.status, 200);
  assert.equal((await asTechSupport.json()).data.status, "APPROVED");
});

// --- overlap guard ---

test("an overlapping borrow window for the same equipment is rejected", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID } },
    overlapping: true,
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload()),
  });
  assert.equal(response.status, 409);
  assert.equal(equipmentService.calls.createRequest.length, 0);
});

test("a non-overlapping borrow window for the same equipment is accepted", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [OTHER_EQUIPMENT_ID]: { id: OTHER_EQUIPMENT_ID } },
    overlapping: false,
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "coord-1" },
    body: JSON.stringify(validCreatePayload({ equipment_id: OTHER_EQUIPMENT_ID })),
  });
  assert.equal(response.status, 201);
});

// --- authentication ---

test("unauthenticated requests are rejected before any role or data check", async (t) => {
  const equipmentService = fakeEquipmentService({
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID } },
  });
  const base = await setup(t, { roleAssignments: { "coord-1": ["event_coordinator"] }, equipmentService });

  const response = await fetch(base + `/api/events/${VALID_EVENT_ID}/equipment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validCreatePayload()),
  });
  assert.equal(response.status, 401);
  assert.equal(equipmentService.calls.createRequest.length, 0);
});

// --- Scrum-28-Scrum64 (AC2): status updates as arrangements progress ---
// Deliberate behavior change from Scrum-27's one-way PENDING-only review
// gate (see equipment.controller.js/equipment.service.js): status can now
// move between APPROVED and REJECTED repeatedly, not just once.

test("Scrum-28-Scrum64: an already-reviewed request can be reviewed again (no one-way gate)", async (t) => {
  const requestId = "44444444-4444-4444-4444-444444444444";
  const requestById = { [requestId]: { id: requestId, status: "APPROVED" } };
  const equipmentService = fakeEquipmentService({ requestById });
  const base = await setup(t, { roleAssignments: { "tech-1": ["technical_support_staff"] }, equipmentService });

  const toRejected = await fetch(base + `/api/equipment-requests/${requestId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ status: "REJECTED" }),
  });
  assert.equal(toRejected.status, 200);
  assert.equal((await toRejected.json()).data.status, "REJECTED");

  const backToApproved = await fetch(base + `/api/equipment-requests/${requestId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(backToApproved.status, 200);
  assert.equal((await backToApproved.json()).data.status, "APPROVED");
});

test("Scrum-28-Scrum64: a status update for a request that does not exist is a 404", async (t) => {
  const equipmentService = fakeEquipmentService({ requestById: {} });
  const base = await setup(t, { roleAssignments: { "tech-1": ["technical_support_staff"] }, equipmentService });

  const response = await fetch(base + "/api/equipment-requests/44444444-4444-4444-4444-444444444444/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(response.status, 404);
});

// --- Scrum-28-Scrum63 (AC1): the cross-event Technical Support dashboard ---

test("Scrum-28-Scrum63: Technical Support Staff sees every event's requests, enriched", async (t) => {
  const request = {
    id: "55555555-5555-5555-5555-555555555555",
    event_id: VALID_EVENT_ID,
    equipment_id: VALID_EQUIPMENT_ID,
    requested_by: "coord-1",
    quantity_requested: 2,
    status: "PENDING",
  };
  const equipmentService = fakeEquipmentService({
    allRequests: [request],
    equipmentById: { [VALID_EQUIPMENT_ID]: { id: VALID_EQUIPMENT_ID, type: "PROJECTOR" } },
  });
  const base = await setup(t, {
    roleAssignments: { "tech-1": ["technical_support_staff"] },
    equipmentService,
    findEventsByIds: async (ids) => ids.map((id) => ({ id, name: "Tech Connect 2026" })),
    getUserDisplayName: async (id) => (id === "coord-1" ? "Demo Coordinator" : null),
  });

  const response = await fetch(base + "/api/technical-support/equipment-requests", {
    headers: { "x-test-user-id": "tech-1" },
  });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].event_name, "Tech Connect 2026");
  assert.equal(data[0].equipment_type, "PROJECTOR");
  assert.equal(data[0].requested_by_name, "Demo Coordinator");
});

test("Scrum-28-Scrum63: an Event Coordinator cannot see the Technical Support dashboard (403)", async (t) => {
  const equipmentService = fakeEquipmentService({ allRequests: [] });
  const base = await setup(t, {
    roleAssignments: { "coord-1": ["event_coordinator"] },
    equipmentService,
  });

  const response = await fetch(base + "/api/technical-support/equipment-requests", {
    headers: { "x-test-user-id": "coord-1" },
  });
  assert.equal(response.status, 403);
});
