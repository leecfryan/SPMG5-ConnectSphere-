// Production equipment router and permission policy with fake identity and storage.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");

const equipmentRoutes = require("../../../src/routes/equipment.routes");

const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_EVENT_ID = "99999999-9999-9999-9999-999999999999";
const REQUEST_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_REQUEST_ID = "33333333-3333-3333-3333-333333333333";


function fakeMessagesService({ messages = [] } = {}) {
  const calls = { create: [], updateBody: [] };
  return {
    calls,
    async listByEquipmentRequestIds(ids) {
      return messages.filter((m) => ids.includes(m.equipment_request_id) && !m.deleted_at);
    },
    async findById(id) {
      return messages.find((m) => m.id === id && !m.deleted_at) || null;
    },
    async create(fields, authorId, authorRole) {
      const message = {
        id: "new-message-id",
        equipment_request_id: fields.equipment_request_id,
        body: fields.body,
        author_id: authorId,
        author_role: authorRole,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      calls.create.push(message);
      messages.push(message);
      return message;
    },
    async updateBody(id, body) {
      calls.updateBody.push({ id, body });
      const existing = messages.find((m) => m.id === id);
      if (!existing) return null;
      existing.body = body;
      return existing;
    },
  };
}

function fakeEquipmentService({ requestsByEvent = {}, requestById = {} } = {}) {
  return {
    async listRequestsByEvent(eventId) {
      return requestsByEvent[eventId] || [];
    },
    async findRequestById(id) {
      return requestById[id] || null;
    },
  };
}

async function setup(t, {
  roleAssignments = {},
  messagesService,
  equipmentService,
  findEventById,
}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const header = req.get("x-test-user-id");
    if (header) req.user = { id: header, roles: roleAssignments[header] || [] };
    next();
  });

  app.use("/api", equipmentRoutes({ authenticate: (req, res, next) => next(), equipmentService, messagesService, findEventById }));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return "http://127.0.0.1:" + server.address().port;
}

function futureEvent() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return { id: EVENT_ID, name: "Tech Connect 2026", coordinator_id: "coord-1", start_time: start, end_time: null };
}

// --- Scrum-28-Scrum65 (AC3): posting and reading a thread ------------------

test("Scrum-28-Scrum65: Technical Support Staff can post and read a message on any event", async (t) => {
  const equipmentService = fakeEquipmentService({
    requestsByEvent: { [EVENT_ID]: [{ id: REQUEST_ID, event_id: EVENT_ID }] },
    requestById: { [REQUEST_ID]: { id: REQUEST_ID, event_id: EVENT_ID } },
  });
  const messagesService = fakeMessagesService();
  const base = await setup(t, {
    roleAssignments: { "tech-1": ["technical_support_staff"] },
    messagesService,
    equipmentService,
    findEventById: async () => futureEvent(),
  });

  const post = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ equipment_request_id: REQUEST_ID, body: "Need the exact model." }),
  });
  assert.equal(post.status, 201);
  const created = (await post.json()).data;
  assert.equal(created.author_role, "tech_support");

  const list = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    headers: { "x-test-user-id": "tech-1" },
  });
  assert.equal(list.status, 200);
  const { data } = await list.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].body, "Need the exact model.");
});

test("Scrum-28-Scrum65: a message for an equipment line from a different event is rejected", async (t) => {
  const equipmentService = fakeEquipmentService({
    requestById: { [OTHER_REQUEST_ID]: { id: OTHER_REQUEST_ID, event_id: OTHER_EVENT_ID } },
  });
  const base = await setup(t, {
    roleAssignments: { "tech-1": ["technical_support_staff"] },
    messagesService: fakeMessagesService(),
    equipmentService,
    findEventById: async () => futureEvent(),
  });

  const post = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ equipment_request_id: OTHER_REQUEST_ID, body: "hi" }),
  });
  assert.equal(post.status, 404);
});

// --- AC4: Event Coordinator scoping to events they coordinate -------------

test("Scrum-28-Scrum66 (AC4): the coordinator of the event can read and post", async (t) => {
  const equipmentService = fakeEquipmentService({
    requestsByEvent: { [EVENT_ID]: [] },
    requestById: { [REQUEST_ID]: { id: REQUEST_ID, event_id: EVENT_ID } },
  });
  const base = await setup(t, {
    roleAssignments: { "coord-1": ["event_coordinator"] },
    messagesService: fakeMessagesService(),
    equipmentService,
    findEventById: async () => futureEvent(),
  });

  const response = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    headers: { "x-test-user-id": "coord-1" },
  });
  assert.equal(response.status, 200);
});

test("Scrum-28-Scrum66 (AC4): a coordinator who does NOT coordinate this event is denied", async (t) => {
  const equipmentService = fakeEquipmentService({ requestsByEvent: { [EVENT_ID]: [] } });
  const base = await setup(t, {
    roleAssignments: { "coord-2": ["event_coordinator"] },
    messagesService: fakeMessagesService(),
    equipmentService,
    findEventById: async () => futureEvent(), // coordinator_id is "coord-1"
  });

  const response = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    headers: { "x-test-user-id": "coord-2" },
  });
  assert.equal(response.status, 403);
});

test("Scrum-28-Scrum66 (AC4): no role at all (e.g. an Event Organiser) is denied before any event lookup", async (t) => {
  const equipmentService = fakeEquipmentService({ requestsByEvent: { [EVENT_ID]: [] } });
  const base = await setup(t, {
    roleAssignments: {},
    messagesService: fakeMessagesService(),
    equipmentService,
    findEventById: async () => futureEvent(),
  });

  const response = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    headers: { "x-test-user-id": "organiser-1" },
  });
  assert.equal(response.status, 403);
});

// --- author-only edits -----------------------------------------------------

test("Scrum-28-Scrum65: only the author can edit their own message", async (t) => {
  const messageId = "44444444-4444-4444-4444-444444444444";
  const existing = {
    id: messageId,
    equipment_request_id: REQUEST_ID,
    author_id: "tech-1",
    body: "original",
  };
  const equipmentService = fakeEquipmentService({
    requestById: { [REQUEST_ID]: { id: REQUEST_ID, event_id: EVENT_ID } },
  });
  const base = await setup(t, {
    roleAssignments: { "tech-1": ["technical_support_staff"], "tech-2": ["technical_support_staff"] },
    messagesService: fakeMessagesService({ messages: [existing] }),
    equipmentService,
    findEventById: async () => futureEvent(),
  });

  const asOther = await fetch(base + `/api/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-2" },
    body: JSON.stringify({ body: "edited by someone else" }),
  });
  assert.equal(asOther.status, 403);

  const asAuthor = await fetch(base + `/api/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-test-user-id": "tech-1" },
    body: JSON.stringify({ body: "edited by the author" }),
  });
  assert.equal(asAuthor.status, 200);
  assert.equal((await asAuthor.json()).data.body, "edited by the author");
});

// --- Scrum-28-Scrum65 (AC3): retention -------------------------------------

test("Scrum-28-Scrum65: a thread past 30 days after the event is over reads as empty", async (t) => {
  const oldEvent = {
    id: EVENT_ID,
    coordinator_id: "coord-1",
    end_time: "2020-01-01T00:00:00.000Z",
  };
  const equipmentService = fakeEquipmentService({
    requestsByEvent: { [EVENT_ID]: [{ id: REQUEST_ID, event_id: EVENT_ID }] },
  });
  const messagesService = fakeMessagesService({
    messages: [{ id: "old-msg", equipment_request_id: REQUEST_ID, body: "old" }],
  });
  const base = await setup(t, {
    roleAssignments: { "tech-1": ["technical_support_staff"] },
    messagesService,
    equipmentService,
    findEventById: async () => oldEvent,
  });

  const response = await fetch(base + `/api/events/${EVENT_ID}/messages`, {
    headers: { "x-test-user-id": "tech-1" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
});
