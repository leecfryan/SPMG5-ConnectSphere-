// Scrum-29: functional/HTTP-level tests for the availability check, against
// the REAL dev Supabase database. Real createEquipmentService(supabase)
// is wired into the real Express app (createApp) with real requireAuth-shaped
// guards. Auth identity itself stays a lightweight stub - verifying Supabase
// JWTs isn't this story's concern and is already covered by auth.test.js;
// what's real here is the equipment/equipment_requests data layer: every
// insert/select/delete below is a genuine network call to Supabase's REST
// API against real Postgres tables, not an in-memory fake.
//
// Each test creates its own equipment rows under a fresh, randomly-generated
// `type` string so it can never collide with real catalogue data (the dev DB
// already has real PROJECTOR/MICROPHONE/etc. rows), and cleans up everything
// it created in afterEach - a shared dev database, not a disposable one.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.resolve(process.cwd(), "../.env") });

const createApp = require("../../src/app");
const { createEquipmentService } = require("../../src/modules/equipment/equipment.service");
const supabase = require("../../src/supabase");
const { once } = require("node:events");

// equipment_requests.requested_by and .event_id are real foreign keys (to
// auth.users and events respectively) - a random UUID is rejected outright
// (verified: both inserts fail with a foreign key violation), and creating a
// throwaway event has its own chain (events.organiser_id is NOT NULL and
// itself FK'd to auth.users). Rather than hardcode a specific UUID that rots
// if that row is ever deleted/reseeded, resolve both once per run via the
// stable, documented seed identity (docs/seed-users.md) instead of a literal.
let anchorUserId;
let anchorEventId;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const coordinator = data.users.find((u) => u.email === "coordinator.demo@example.com");
  if (!coordinator) {
    throw new Error("Seed user coordinator.demo@example.com not found - run `npm run seed:users` first.");
  }
  anchorUserId = coordinator.id;

  const { data: events, error: eventsError } = await supabase
    .from("events").select("id").eq("coordinator_id", anchorUserId).limit(1);
  if (eventsError) throw eventsError;
  if (!events.length) {
    throw new Error("coordinator.demo@example.com has no assigned event - seed one before running these tests.");
  }
  anchorEventId = events[0].id;
});

let createdEquipmentIds = [];
let createdRequestIds = [];

afterEach(async () => {
  if (createdRequestIds.length) {
    await supabase.from("equipment_requests").delete().in("id", createdRequestIds);
    createdRequestIds = [];
  }
  if (createdEquipmentIds.length) {
    await supabase.from("equipment").delete().in("id", createdEquipmentIds);
    createdEquipmentIds = [];
  }
});

async function insertEquipment({ type, status = "AVAILABLE", location = "Test Room" }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment").insert({ id, type, current_location: location, status });
  if (error) throw new Error("equipment insert failed: " + error.message);
  createdEquipmentIds.push(id);
  return id;
}

async function insertRequest({ equipmentId, status = "PENDING", borrowStart, borrowEnd }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment_requests").insert({
    id, event_id: anchorEventId, equipment_id: equipmentId, requested_by: anchorUserId,
    quantity_requested: 1, borrow_start: borrowStart, borrow_end: borrowEnd, status,
  });
  if (error) throw new Error("equipment_requests insert failed: " + error.message);
  createdRequestIds.push(id);
  return id;
}

function freshType() {
  return "SCRUM29_TEST_" + randomUUID().slice(0, 8);
}

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: {
        user: token === "invalid" ? null : { id: anchorUserId, app_metadata: { roles: token.split(",") } },
      },
      error: null,
    }),
  },
};

let server;

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

async function startApp() {
  const equipmentService = createEquipmentService(supabase);
  const app = createApp({
    authClient,
    equipmentDependencies: {
      equipmentService,
      findEventById: async () => ({ id: anchorEventId, coordinator_id: anchorUserId, status: "APPROVED" }),
      findEventsByIds: async () => [],
      getUserDisplayName: async () => null,
    },
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function send(base, path, role, { method = "GET", body } = {}) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      ...(role ? { Authorization: "Bearer " + role } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function availabilityQuery(type, overrides = {}) {
  const params = new URLSearchParams({
    start: "2026-09-10T09:00:00Z",
    end: "2026-09-10T17:00:00Z",
    type,
    quantity: "1",
    location: "Main Hall",
    ...overrides,
  });
  return "/equipment/availability?" + params.toString();
}

describe("Scrum-29 AC1: The availability check accepts the event start date/time, end date/time, equipment type, requested quantity, and event location.", () => {
  test("a fully-specified request is accepted and echoes type, location and period", async () => {
    const type = freshType();
    await insertEquipment({ type });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type), "technical_support_staff");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({
      equipment_type: type,
      location: "Main Hall",
      period: { start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T17:00:00.000Z" },
      available_quantity: 1,
    });
  });

  test("a request missing the event location is rejected before any data lookup", async () => {
    const base = await startApp();
    const params = new URLSearchParams({ start: "2026-09-10T09:00:00Z", end: "2026-09-10T17:00:00Z", type: freshType(), quantity: "1" });
    const response = await send(base, "/equipment/availability?" + params.toString(), "technical_support_staff");
    expect(response.status).toBe(400);
  });
});

describe("Scrum-29 AC2: Equipment committed to another event that overlaps the requested period is excluded from the available quantity.", () => {
  test("a unit with an overlapping PENDING request for another event is excluded, leaving the other unit available", async () => {
    const type = freshType();
    const unit1 = await insertEquipment({ type });
    const unit2 = await insertEquipment({ type });
    await insertRequest({ equipmentId: unit1, status: "PENDING", borrowStart: "2026-09-10T08:00:00Z", borrowEnd: "2026-09-10T12:00:00Z" });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type), "technical_support_staff");
    const { data } = await response.json();
    expect(data.available_quantity).toBe(1);
    expect(data.available_equipment_ids).toEqual([unit2]);
  });

  test("a unit with an overlapping APPROVED request is also excluded", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type });
    await insertRequest({ equipmentId: unit, status: "APPROVED", borrowStart: "2026-09-10T08:00:00Z", borrowEnd: "2026-09-10T12:00:00Z" });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type), "technical_support_staff");
    const { data } = await response.json();
    expect(data.available_quantity).toBe(0);
  });
});

describe("Scrum-29 AC3: Equipment marked as Unavailable, Damaged, or Under Maintenance is excluded from the available quantity.", () => {
  test("a DAMAGED unit is excluded, leaving only the AVAILABLE unit counted", async () => {
    const type = freshType();
    const available = await insertEquipment({ type, status: "AVAILABLE" });
    await insertEquipment({ type, status: "DAMAGED" });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type), "technical_support_staff");
    const { data } = await response.json();
    expect(data.available_quantity).toBe(1);
    expect(data.available_equipment_ids).toEqual([available]);
  });

  test("an UNAVAILABLE unit is excluded even with no competing requests at all", async () => {
    const type = freshType();
    await insertEquipment({ type, status: "UNAVAILABLE" });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type), "technical_support_staff");
    const { data } = await response.json();
    expect(data.available_quantity).toBe(0);
  });
});

describe("Scrum-29 AC4: Equipment returned on a given day is not counted as available again until the following day (Return Day + 1).", () => {
  test("a request starting the same day the equipment is returned shows 0 available", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type });
    await insertRequest({ equipmentId: unit, status: "APPROVED", borrowStart: "2026-09-09T08:00:00Z", borrowEnd: "2026-09-10T12:00:00Z" });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type, { start: "2026-09-10T14:00:00Z", end: "2026-09-10T18:00:00Z" }), "technical_support_staff");
    const { data } = await response.json();
    expect(data.available_quantity).toBe(0);
  });

  test("the same request starting the following day shows the equipment as available", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type });
    await insertRequest({ equipmentId: unit, status: "APPROVED", borrowStart: "2026-09-09T08:00:00Z", borrowEnd: "2026-09-10T12:00:00Z" });
    const base = await startApp();

    const response = await send(base, availabilityQuery(type, { start: "2026-09-11T08:00:00Z", end: "2026-09-11T12:00:00Z" }), "technical_support_staff");
    const { data } = await response.json();
    expect(data.available_quantity).toBe(1);
  });
});

describe("The equipment catalogue endpoint optionally filters to bookable units for the request form's dropdown", () => {
  test("GET /api/equipment with no start/end includes units regardless of status (full catalogue, unchanged from before this story)", async () => {
    const type = freshType();
    const available = await insertEquipment({ type, status: "AVAILABLE" });
    const damaged = await insertEquipment({ type, status: "DAMAGED" });
    const base = await startApp();

    const response = await send(base, "/equipment", "technical_support_staff");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const ids = data.map((unit) => unit.id);
    expect(ids).toEqual(expect.arrayContaining([available, damaged]));
  });

  test("GET /api/equipment?start=&end= narrows to only units bookable for that period", async () => {
    const type = freshType();
    const available = await insertEquipment({ type, status: "AVAILABLE" });
    await insertEquipment({ type, status: "DAMAGED" });
    const base = await startApp();

    const params = new URLSearchParams({ start: "2026-09-10T09:00:00Z", end: "2026-09-10T17:00:00Z" });
    const response = await send(base, "/equipment?" + params.toString(), "event_coordinator");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const ids = data.filter((unit) => unit.type === type).map((unit) => unit.id);
    expect(ids).toEqual([available]);
  });
});

describe("Technical Support Staff can manually change an equipment unit's status", () => {
  test("a technical support staff member can change status via PATCH /equipment/:id/status", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type, status: "AVAILABLE" });
    const base = await startApp();

    const response = await send(base, `/equipment/${unit}/status`, "technical_support_staff", {
      method: "PATCH", body: { status: "MAINTENANCE" },
    });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.status).toBe("MAINTENANCE");

    const { data: refetched } = await (await send(base, "/equipment", "technical_support_staff")).json();
    expect(refetched.find((u) => u.id === unit).status).toBe("MAINTENANCE");
  });

  test("an Event Coordinator cannot change equipment status (403); an invalid status is rejected (400); an unknown id is 404", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type, status: "AVAILABLE" });
    const base = await startApp();

    expect((await send(base, `/equipment/${unit}/status`, "event_coordinator", { method: "PATCH", body: { status: "DAMAGED" } })).status).toBe(403);
    expect((await send(base, `/equipment/${unit}/status`, "technical_support_staff", { method: "PATCH", body: { status: "NOT_A_REAL_STATUS" } })).status).toBe(400);
    expect((await send(base, `/equipment/${randomUUID()}/status`, "technical_support_staff", { method: "PATCH", body: { status: "DAMAGED" } })).status).toBe(404);
  });
});

describe("role gating and consistency with the create-request path", () => {
  test("an Event Coordinator can also read availability; an unrelated Organiser cannot (403); no token is 401", async () => {
    const type = freshType();
    await insertEquipment({ type });
    const base = await startApp();

    expect((await send(base, availabilityQuery(type), "event_coordinator")).status).toBe(200);
    expect((await send(base, availabilityQuery(type), "event_organiser")).status).toBe(403);
    expect((await send(base, availabilityQuery(type), undefined)).status).toBe(401);
  });

  // Team requirement: an item the availability check reports as 0 available
  // must never be successfully bookable through the create-request endpoint.
  test("equipment excluded by status (AC3) cannot be successfully requested", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type, status: "DAMAGED" });
    const base = await startApp();

    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 2 * 86400000).toISOString();
    const response = await send(base, `/events/${anchorEventId}/equipment-requests`, "event_coordinator", {
      method: "POST",
      body: { equipment_id: unit, quantity_requested: 1, borrow_start: start, borrow_end: end },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This equipment is not available for booking." });
  });

  test("equipment excluded by Return Day + 1 (scrum-29 AC4) cannot be successfully requested on the return day itself", async () => {
    const type = freshType();
    const unit = await insertEquipment({ type });
    await insertRequest({ equipmentId: unit, status: "APPROVED", borrowStart: "2026-09-09T08:00:00Z", borrowEnd: "2026-09-10T12:00:00Z" });
    const base = await startApp();

    const response = await send(base, `/events/${anchorEventId}/equipment-requests`, "event_coordinator", {
      method: "POST",
      body: { equipment_id: unit, quantity_requested: 1, borrow_start: "2026-09-10T14:00:00Z", borrow_end: "2026-09-10T18:00:00Z" },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This equipment is already requested for an overlapping period" });
  });
});
