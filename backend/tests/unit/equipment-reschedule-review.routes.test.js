// SCRUM-150 AC2: available_for_window over real HTTP, through both read
// endpoints a coordinator and Technical Support Staff actually use, and the
// approval overlap re-check on the decision endpoint. Doubles only, no live
// Supabase - the real equipment.service.js and equipment.controller.js run
// against an in-memory fake client (same shape as equipment-release-event.test.js),
// wired into the real Express app via createApp, so the route guards
// (requirePermission, loadEvent, canReadEvent) are exercised for real too.
import { test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { createEquipmentService } = require("../../src/modules/equipment/equipment.service");
const { once } = require("node:events");

function fakeSupabase(store) {
  function from(table) {
    let rows = store[table] || [];
    let patch = null;

    function applyPatch() {
      if (!patch) return;
      const ids = new Set(rows.map((row) => row.id));
      store[table] = (store[table] || []).map((row) => (ids.has(row.id) ? { ...row, ...patch } : row));
      rows = rows.map((row) => ({ ...row, ...patch }));
    }

    const builder = {
      select() { return builder; },
      order() { return builder; },
      eq(field, value) { rows = rows.filter((row) => row[field] === value); return builder; },
      neq(field, value) { rows = rows.filter((row) => row[field] !== value); return builder; },
      in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return builder; },
      update(fields) { patch = fields; return builder; },
      async maybeSingle() { applyPatch(); return { data: rows[0] || null, error: null }; },
      then(resolve, reject) { applyPatch(); return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return builder;
  }
  return { from };
}

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const COORDINATOR_ID = "coord-1";
const TECH_ID = "tech-1";
const EQ_A = "bbbbbbbb-0001-0000-0000-000000000000";
const REQ_FLAGGED = "cccccccc-0001-0000-0000-000000000000";
const REQ_CONFLICT = "cccccccc-0002-0000-0000-000000000000";
const REQ_APPROVED = "cccccccc-0003-0000-0000-000000000000";

const store = { equipment_requests: [], equipment: [] };
const equipmentService = createEquipmentService(fakeSupabase(store));

function request(overrides) {
  return {
    event_id: EVENT_ID, equipment_id: EQ_A, status: "REVIEW_REQUIRED",
    borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z",
    requested_by: COORDINATOR_ID, quantity_requested: 1,
    ...overrides,
  };
}

const authClient = { auth: { getUser: async (token) => {
  const [id, roles] = token.split(":");
  return { data: { user: { id, email: `${id}@example.com`, app_metadata: { roles: roles.split(",") }, user_metadata: {} } }, error: null };
} } };

let server, base;

beforeAll(async () => {
  server = createApp({
    authClient,
    equipmentDependencies: {
      equipmentService,
      findEventById: async (id) => (id === EVENT_ID ? { id: EVENT_ID, coordinator_id: COORDINATOR_ID, name: "Test Event", status: "APPROVED" } : null),
      findEventsByIds: async (ids) => ids.map((id) => ({ id, name: "Test Event" })),
      getUserDisplayName: async (id) => "User " + id,
      listCancelledEventIds: async () => [],
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  store.equipment_requests = [];
  store.equipment = [{ id: EQ_A, type: "Projector", current_location: "Store", status: "AVAILABLE" }];
});

function get(path, token) {
  return fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
function patch(path, token, body) {
  return fetch(`${base}${path}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("[TC-150-05] a flagged request whose unit is now double-booked is marked unavailable", async () => {
  store.equipment_requests = [
    request({ id: REQ_FLAGGED }),
    request({ id: REQ_CONFLICT, status: "APPROVED", borrow_start: "2026-01-01T10:00:00Z", borrow_end: "2026-01-01T18:00:00Z" }),
  ];
  const res = await get(`/api/events/${EVENT_ID}/equipment-requests`, `${TECH_ID}:technical_support_staff`);
  const { data } = await res.json();
  const flagged = data.find((r) => r.id === REQ_FLAGGED);
  expect(flagged.available_for_window).toBe(false);
});

test("[TC-150-06] a flagged request whose unit is still free is marked available", async () => {
  store.equipment_requests = [request({ id: REQ_FLAGGED })];
  const res = await get(`/api/events/${EVENT_ID}/equipment-requests`, `${TECH_ID}:technical_support_staff`);
  const { data } = await res.json();
  expect(data.find((r) => r.id === REQ_FLAGGED).available_for_window).toBe(true);
});

test("[TC-150-07] the coordinator and Technical Support Staff see the same available_for_window value", async () => {
  store.equipment_requests = [
    request({ id: REQ_FLAGGED }),
    request({ id: REQ_CONFLICT, status: "APPROVED", borrow_start: "2026-01-01T10:00:00Z", borrow_end: "2026-01-01T18:00:00Z" }),
  ];
  const asCoordinator = await (await get(`/api/events/${EVENT_ID}/equipment-requests`, `${COORDINATOR_ID}:event_coordinator`)).json();
  const asTechSupport = await (await get(`/api/events/${EVENT_ID}/equipment-requests`, `${TECH_ID}:technical_support_staff`)).json();
  expect(asCoordinator.data.find((r) => r.id === REQ_FLAGGED).available_for_window)
    .toBe(asTechSupport.data.find((r) => r.id === REQ_FLAGGED).available_for_window);
});

test("[TC-150-08] only REVIEW_REQUIRED rows carry available_for_window, even when something else now overlaps", async () => {
  store.equipment_requests = [
    request({ id: REQ_APPROVED, status: "APPROVED" }),
    request({ id: REQ_CONFLICT, status: "APPROVED", equipment_id: EQ_A, borrow_start: "2026-01-01T10:00:00Z", borrow_end: "2026-01-01T18:00:00Z" }),
  ];
  const res = await get(`/api/events/${EVENT_ID}/equipment-requests`, `${TECH_ID}:technical_support_staff`);
  const { data } = await res.json();
  expect(data.find((r) => r.id === REQ_APPROVED)).not.toHaveProperty("available_for_window");
});

test("[TC-150-26] the Technical Support dashboard also attaches available_for_window to REVIEW_REQUIRED rows", async () => {
  store.equipment_requests = [
    request({ id: REQ_FLAGGED }),
    request({ id: REQ_CONFLICT, status: "APPROVED", borrow_start: "2026-01-01T10:00:00Z", borrow_end: "2026-01-01T18:00:00Z" }),
  ];
  const res = await get("/api/technical-support/equipment-requests", `${TECH_ID}:technical_support_staff`);
  const { data } = await res.json();
  expect(data.find((r) => r.id === REQ_FLAGGED).available_for_window).toBe(false);
  expect(data.find((r) => r.id === REQ_CONFLICT)).not.toHaveProperty("available_for_window");
});

test("[TC-150-20] approving a REVIEW_REQUIRED request whose unit is now double-booked is refused with 409", async () => {
  store.equipment_requests = [
    request({ id: REQ_FLAGGED }),
    request({ id: REQ_CONFLICT, status: "APPROVED", borrow_start: "2026-01-01T10:00:00Z", borrow_end: "2026-01-01T18:00:00Z" }),
  ];
  const res = await patch(`/api/equipment-requests/${REQ_FLAGGED}/status`, `${TECH_ID}:technical_support_staff`, { status: "APPROVED" });
  expect(res.status).toBe(409);
  expect((await equipmentService.findRequestById(REQ_FLAGGED)).status).toBe("REVIEW_REQUIRED");
});

test("[TC-150-21] approving a REVIEW_REQUIRED request whose unit is still free succeeds", async () => {
  store.equipment_requests = [request({ id: REQ_FLAGGED })];
  const res = await patch(`/api/equipment-requests/${REQ_FLAGGED}/status`, `${TECH_ID}:technical_support_staff`, { status: "APPROVED" });
  expect(res.status).toBe(200);
  expect((await res.json()).data.status).toBe("APPROVED");
});
