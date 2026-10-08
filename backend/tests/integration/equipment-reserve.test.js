// Scrum-30: add/update/retire a catalogue record, and that the availability
// check (Scrum-29, reused unchanged) reflects those writes immediately. Same
// pattern as equipment.availability.test.js: real createEquipmentService(supabase)
// wired into the real Express app, real network calls to the dev Supabase
// project, throwaway rows under a fresh `type` per test, cleaned up in afterEach.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.resolve(process.cwd(), "../.env"), quiet: true });

const createApp = require("../../src/app");
const { createEquipmentService } = require("../../src/modules/equipment/equipment.service");
const supabase = require("../../src/supabase");
const { once } = require("node:events");

// SCRUM-103 AC4: equipment.updated_by is a uuid column, so the acting user's
// id in these tests must be a real value, not the placeholder string
// "tester" this file used before that column existed - same resolution
// pattern as equipment.availability.test.js's anchorUserId.
let technicalUserId;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const technical = data.users.find((u) => u.email === "technical.demo@example.com");
  if (!technical) {
    throw new Error("Seed user technical.demo@example.com not found - run `npm run seed:users` first.");
  }
  technicalUserId = technical.id;
});

let createdEquipmentIds = [];

afterEach(async () => {
  if (createdEquipmentIds.length) {
    await supabase.from("equipment").delete().in("id", createdEquipmentIds);
    createdEquipmentIds = [];
  }
});

async function insertEquipment({ type, status = "AVAILABLE", location = "Test Room", description = null }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment").insert({ id, type, current_location: location, status, description });
  if (error) throw new Error("equipment insert failed: " + error.message);
  createdEquipmentIds.push(id);
  return id;
}

function freshType() {
  return "SCRUM30_TEST_" + randomUUID().slice(0, 8);
}

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: { user: token === "invalid" ? null : { id: technicalUserId, app_metadata: { roles: token.split(",") } } },
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
      findEventById: async () => null,
      findEventsByIds: async () => [],
      getUserDisplayName: async () => null,
      // SCRUM-104: this file's own events are never CANCELLED - a real query
      // here would also sweep any other suite's throwaway cancelled events
      // running concurrently against the shared dev database.
      listCancelledEventIds: async () => [],
    },
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function send(base, path, role, { method = "GET", body } = {}) {
  return fetch(base + "/api" + path, {
    method,
    headers: { ...(role ? { Authorization: "Bearer " + role } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function availabilityQuery(type, overrides = {}) {
  const params = new URLSearchParams({
    start: "2026-09-10T09:00:00Z", end: "2026-09-10T17:00:00Z", type, quantity: "1", location: "Main Hall", ...overrides,
  });
  return "/equipment/availability?" + params.toString();
}

describe("Scrum-30 AC1: Technical Support Staff can add, update and retire equipment records", () => {
  test("a technical support staff member can add a new record", async () => {
    const base = await startApp();
    const type = freshType();
    const response = await send(base, "/equipment", "technical_support_staff", {
      method: "POST", body: { type, description: "4K projector", current_location: "Store A" },
    });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    createdEquipmentIds.push(data.id);
    expect(data).toMatchObject({ type, description: "4K projector", current_location: "Store A", status: "AVAILABLE" });
  });

  test("an Event Coordinator cannot add a record (403); unauthenticated is 401", async () => {
    const base = await startApp();
    const type = freshType();
    const body = { type, current_location: "Store A" };

    expect((await send(base, "/equipment", "event_coordinator", { method: "POST", body })).status).toBe(403);
    expect((await send(base, "/equipment", undefined, { method: "POST", body })).status).toBe(401);
  });

  test("a technical support staff member can update type, description, location and status", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    const response = await send(base, `/equipment/${id}`, "technical_support_staff", {
      method: "PATCH", body: { description: "Needs a new bulb", status: "MAINTENANCE" },
    });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ type, description: "Needs a new bulb", status: "MAINTENANCE" });
  });

  test("updating a record that does not exist is a 404; a Coordinator cannot update (403)", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    expect((await send(base, `/equipment/${randomUUID()}`, "technical_support_staff", { method: "PATCH", body: { description: "x" } })).status).toBe(404);
    expect((await send(base, `/equipment/${id}`, "event_coordinator", { method: "PATCH", body: { description: "x" } })).status).toBe(403);
  });

  test("retiring a record sets status to UNAVAILABLE and the row still exists (not deleted)", async () => {
    const type = freshType();
    const id = await insertEquipment({ type, status: "AVAILABLE" });
    const base = await startApp();

    const response = await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("UNAVAILABLE");

    const { data: stillThere } = await (await send(base, "/equipment", "technical_support_staff")).json();
    expect(stillThere.find((u) => u.id === id)).toBeTruthy();
  });

  test("retiring a record that does not exist is a 404; a Coordinator cannot retire (403)", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    expect((await send(base, `/equipment/${randomUUID()}/retire`, "technical_support_staff", { method: "PATCH" })).status).toBe(404);
    expect((await send(base, `/equipment/${id}/retire`, "event_coordinator", { method: "PATCH" })).status).toBe(403);
  });

  test("the quick status endpoint (equipment.review) rejects UNAVAILABLE - retire is the only path there", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    const response = await send(base, `/equipment/${id}/status`, "technical_support_staff", {
      method: "PATCH", body: { status: "UNAVAILABLE" },
    });
    expect(response.status).toBe(400);
  });
});

describe("Scrum-30 AC2: each record carries type, description, quantity held (row count), location and status", () => {
  test("a newly created record's fields round-trip through the catalogue read", async () => {
    const type = freshType();
    const base = await startApp();
    const created = await (await send(base, "/equipment", "technical_support_staff", {
      method: "POST", body: { type, description: "Wireless lapel mic", current_location: "Store B" },
    })).json();
    createdEquipmentIds.push(created.data.id);

    const { data: list } = await (await send(base, "/equipment", "technical_support_staff")).json();
    const found = list.find((u) => u.id === created.data.id);
    expect(found).toMatchObject({ type, description: "Wireless lapel mic", current_location: "Store B", status: "AVAILABLE" });
  });

  test("quantity held for a type is the count of its rows, not a stored number", async () => {
    const type = freshType();
    await insertEquipment({ type });
    await insertEquipment({ type });
    await insertEquipment({ type });
    const base = await startApp();

    const { data } = await (await send(base, availabilityQuery(type), "technical_support_staff")).json();
    expect(data.available_quantity).toBe(3);
  });
});

describe("Scrum-30 AC4: catalogue changes are reflected immediately in availability checks", () => {
  test("adding a new unit of a type immediately increases its available quantity", async () => {
    const type = freshType();
    await insertEquipment({ type });
    const base = await startApp();

    const before = await (await send(base, availabilityQuery(type), "technical_support_staff")).json();
    expect(before.data.available_quantity).toBe(1);

    const created = await (await send(base, "/equipment", "technical_support_staff", {
      method: "POST", body: { type, current_location: "Store A" },
    })).json();
    createdEquipmentIds.push(created.data.id);

    const after = await (await send(base, availabilityQuery(type), "technical_support_staff")).json();
    expect(after.data.available_quantity).toBe(2);
  });

  test("retiring a unit immediately decreases its available quantity", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    const before = await (await send(base, availabilityQuery(type), "technical_support_staff")).json();
    expect(before.data.available_quantity).toBe(1);

    await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });

    const after = await (await send(base, availabilityQuery(type), "technical_support_staff")).json();
    expect(after.data.available_quantity).toBe(0);
  });
});

describe("Scrum-30 AC5: no negative values", () => {
  test("retiring the only unit of a type never reports a negative available quantity", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });

    const { data } = await (await send(base, availabilityQuery(type), "technical_support_staff")).json();
    expect(data.available_quantity).toBe(0);
  });

  test("an empty type (no rows at all) reports zero, not negative or an error", async () => {
    const base = await startApp();
    const { data } = await (await send(base, availabilityQuery(freshType()), "technical_support_staff")).json();
    expect(data.available_quantity).toBe(0);
  });
});
