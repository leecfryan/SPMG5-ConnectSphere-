// SCRUM-103: AC3 (marking equipment unavailable while reserved flags every
// affected event) and AC4 (status change recorded with who and when), plus
// the user-added restore-to-available action.
//
// AC1 and AC2 are NOT retested here - this story adds no new code for
// either, so there is nothing new for a test in this file to exercise:
//   - AC1 (only Technical Support Staff change operational status) is
//     continuing from SCRUM-30's `equipment.manage`/`equipment.review`
//     guards, proven by TC-SCRUM-30-04/05b in
//     backend/tests/integration/equipment-reserve.test.js.
//   - AC2 (damaged/under-maintenance/unavailable excluded from availability)
//     is continuing from SCRUM-29's `isStatusAvailable` allowlist, proven by
//     the exclusion cases in
//     backend/tests/integration/equipment.availability.test.js.
// See .agent/docs/other/SCRUM-103-equipment-records.md's AC table for the
// full reasoning (TC-SCRUM-103-01/02 are the reused-coverage rows there).
//
// Same live-DB pattern as equipment-reserve.test.js/equipment.availability.test.js:
// real createEquipmentService(supabase) wired into the real Express app, real
// network calls to the dev Supabase project, throwaway rows cleaned up in
// afterEach. equipment_requests.event_id/requested_by are real foreign keys,
// so a real seeded coordinator and one of their real assigned events anchor
// every request row (see equipment.availability.test.js's anchorUserId for
// the same reasoning).
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
require("dotenv").config({ path: path.resolve(process.cwd(), "../.env"), quiet: true });

const createApp = require("../../src/app");
const { createEquipmentService } = require("../../src/modules/equipment/equipment.service");
const { createMessagesService } = require("../../src/modules/equipment/messages.service");
const supabase = require("../../src/supabase");
const { once } = require("node:events");

let technicalUserId;
let coordinatorUserId;
let anchorEventId;
let secondEventId;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const technical = data.users.find((u) => u.email === "technical.demo@example.com");
  if (!technical) throw new Error("Seed user technical.demo@example.com not found - run `npm run seed:users` first.");
  technicalUserId = technical.id;

  const coordinator = data.users.find((u) => u.email === "coordinator.demo@example.com");
  if (!coordinator) throw new Error("Seed user coordinator.demo@example.com not found - run `npm run seed:users` first.");
  coordinatorUserId = coordinator.id;

  // equipment_requests.event_id is a real foreign key - a second real event
  // (not a random UUID) is needed for the multi-event flagging test below.
  const { data: events, error: eventsError } = await supabase
    .from("events").select("id").eq("coordinator_id", coordinatorUserId).limit(2);
  if (eventsError) throw eventsError;
  if (events.length < 2) {
    throw new Error("coordinator.demo@example.com needs at least 2 assigned events - seed another before running these tests.");
  }
  anchorEventId = events[0].id;
  secondEventId = events[1].id;
});

let createdEquipmentIds = [];
let createdRequestIds = [];
let createdMessageIds = [];

afterEach(async () => {
  if (createdMessageIds.length) {
    await supabase.from("messages").delete().in("id", createdMessageIds);
    createdMessageIds = [];
  }
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

async function insertRequest({ equipmentId, status = "APPROVED", borrowStart, borrowEnd, eventId = anchorEventId }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment_requests").insert({
    id, event_id: eventId, equipment_id: equipmentId, requested_by: coordinatorUserId,
    quantity_requested: 1, borrow_start: borrowStart, borrow_end: borrowEnd, status,
  });
  if (error) throw new Error("equipment_requests insert failed: " + error.message);
  createdRequestIds.push(id);
  return id;
}

function freshType() {
  return "SCRUM103_TEST_" + randomUUID().slice(0, 8);
}

function isoToday(hour = "12:00:00") {
  return new Date().toISOString().slice(0, 10) + "T" + hour + "Z";
}

function isoTomorrow(hour = "12:00:00") {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) + "T" + hour + "Z";
}

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: {
        user: token === "invalid" ? null : { id: technicalUserId, app_metadata: { roles: token.split(",") } },
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
  const messagesService = createMessagesService(supabase);
  const app = createApp({
    authClient,
    equipmentDependencies: {
      equipmentService,
      messagesService,
      findEventById: async (id) => ({ id, coordinator_id: coordinatorUserId, status: "APPROVED" }),
      findEventsByIds: async (ids) => ids.map((id) => ({ id, coordinator_id: coordinatorUserId, status: "APPROVED" })),
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

async function getEventMessages(base, eventId) {
  const response = await send(base, `/events/${eventId}/messages`, "technical_support_staff");
  const { data } = await response.json();
  return data;
}

async function getRequestStatus(base, eventId, requestId) {
  const response = await send(base, `/events/${eventId}/equipment-requests`, "technical_support_staff");
  const { data } = await response.json();
  return data.find((r) => r.id === requestId)?.status;
}

describe("SCRUM-103 AC4: the status change is recorded with who made it and when", () => {
  test("[SCRUM-103 AC4 / TC-103-08] the quick status PATCH records who and when", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();
    // updated_at is stamped by the database, not by this process, so comparing
    // it with a locally captured wall-clock time compares two different clocks.
    // Read the row's own previous value instead - both come from the database.
    const { data: beforeRow, error: beforeError } = await supabase
      .from("equipment").select("updated_at").eq("id", id).single();
    if (beforeError) throw beforeError;

    const response = await send(base, `/equipment/${id}/status`, "technical_support_staff", {
      method: "PATCH", body: { status: "DAMAGED" },
    });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.updated_by).toBe(technicalUserId);
    expect(new Date(data.updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(beforeRow.updated_at).getTime());
  });

  test("[SCRUM-103 AC4 / TC-103-09] retire also records who and when", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();
    // Same database-clock reasoning as TC-103-08 above.
    const { data: beforeRow, error: beforeError } = await supabase
      .from("equipment").select("updated_at").eq("id", id).single();
    if (beforeError) throw beforeError;

    const response = await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.updated_by).toBe(technicalUserId);
    expect(new Date(data.updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(beforeRow.updated_at).getTime());
  });

  test("[SCRUM-103 AC4 / TC-103-10] updated_by is never taken from the client body - a forged field is rejected outright, not silently dropped", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    const forgedResponse = await send(base, `/equipment/${id}/status`, "technical_support_staff", {
      method: "PATCH", body: { status: "DAMAGED", updated_by: randomUUID() },
    });
    expect(forgedResponse.status).toBe(400);

    // Equipment is untouched by the rejected request - updated_by still reflects
    // the real caller from the legitimate PATCH above, proving the endpoint
    // itself (not just this one payload) never takes updated_by from the body.
    const legitimateResponse = await send(base, `/equipment/${id}/status`, "technical_support_staff", {
      method: "PATCH", body: { status: "DAMAGED" },
    });
    expect(legitimateResponse.status).toBe(200);
    expect((await legitimateResponse.json()).data.updated_by).toBe(technicalUserId);
  });
});

describe("SCRUM-103 (added scope, no AC number): retired equipment can be restored to AVAILABLE", () => {
  test("[SCRUM-103 added-scope / TC-103-11] Technical Support Staff can restore a retired unit to AVAILABLE", async () => {
    const type = freshType();
    const id = await insertEquipment({ type, status: "UNAVAILABLE" });
    const base = await startApp();

    const response = await send(base, `/equipment/${id}/status`, "technical_support_staff", {
      method: "PATCH", body: { status: "AVAILABLE" },
    });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.status).toBe("AVAILABLE");
    expect(data.updated_by).toBe(technicalUserId);

    const params = new URLSearchParams({
      start: "2026-09-10T09:00:00Z", end: "2026-09-10T17:00:00Z", type, quantity: "1", location: "Main Hall",
    });
    const availability = await (await send(base, "/equipment/availability?" + params.toString(), "technical_support_staff")).json();
    expect(availability.data.available_quantity).toBe(1);
  });
});

describe("SCRUM-103 (added scope, no AC number): the catalogue shows a unit as IN_USE while it's booked today", () => {
  async function catalogueStatus(base, id) {
    const { data } = await (await send(base, "/equipment", "technical_support_staff")).json();
    return data.find((unit) => unit.id === id)?.status;
  }

  test("an AVAILABLE unit with an APPROVED request covering today reads as IN_USE, without writing to the row", async () => {
    const type = freshType();
    const id = await insertEquipment({ type, status: "AVAILABLE" });
    await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59") });
    const base = await startApp();

    expect(await catalogueStatus(base, id)).toBe("IN_USE");
    // The quick-status endpoint reads the row directly, not the catalogue's
    // computed view - still AVAILABLE underneath confirms nothing was written.
    const direct = await send(base, `/equipment/${id}/status`, "technical_support_staff", { method: "PATCH", body: { status: "AVAILABLE" } });
    expect((await direct.json()).data.status).toBe("AVAILABLE");
  });

  test("a PENDING (not APPROVED) request covering today does not trigger IN_USE", async () => {
    const type = freshType();
    const id = await insertEquipment({ type, status: "AVAILABLE" });
    await insertRequest({ equipmentId: id, status: "PENDING", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59") });
    const base = await startApp();

    expect(await catalogueStatus(base, id)).toBe("AVAILABLE");
  });

  test("an APPROVED request starting tomorrow does not trigger IN_USE today, and will stop once the window passes", async () => {
    const type = freshType();
    const id = await insertEquipment({ type, status: "AVAILABLE" });
    await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoTomorrow("00:00:00"), borrowEnd: isoTomorrow("23:59:59") });
    const base = await startApp();

    expect(await catalogueStatus(base, id)).toBe("AVAILABLE");
  });

  test("a DAMAGED unit with an APPROVED request covering today still reads as DAMAGED, not IN_USE", async () => {
    const type = freshType();
    const id = await insertEquipment({ type, status: "DAMAGED" });
    await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59") });
    const base = await startApp();

    expect(await catalogueStatus(base, id)).toBe("DAMAGED");
  });
});

describe("SCRUM-103 AC3: marking equipment unavailable while reserved flags every affected event", () => {
  test("[SCRUM-103 AC3 / TC-103-03] retiring equipment with one APPROVED request covering today flags that event and moves the request to REJECTED (Issues)", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const requestId = await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59") });
    const base = await startApp();

    const response = await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("UNAVAILABLE");

    const messages = await getEventMessages(base, anchorEventId);
    createdMessageIds = messages.map((m) => m.id);
    const flagged = messages.find((m) => m.equipment_request_id === requestId);
    expect(flagged).toBeTruthy();
    expect(flagged.author_id).toBe(technicalUserId);
    expect(flagged.author_role).toBe("tech_support");

    expect(await getRequestStatus(base, anchorEventId, requestId)).toBe("REJECTED");
  });

  test("[SCRUM-103 AC3 / TC-103-04] PENDING and REJECTED requests covering today are NOT flagged - only APPROVED counts", async () => {
    const type = freshType();
    const pendingUnit = await insertEquipment({ type });
    const rejectedUnit = await insertEquipment({ type });
    const pendingRequest = await insertRequest({ equipmentId: pendingUnit, status: "PENDING", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59") });
    const rejectedRequest = await insertRequest({ equipmentId: rejectedUnit, status: "REJECTED", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59") });
    const base = await startApp();

    await send(base, `/equipment/${pendingUnit}/retire`, "technical_support_staff", { method: "PATCH" });
    await send(base, `/equipment/${rejectedUnit}/retire`, "technical_support_staff", { method: "PATCH" });

    const messages = await getEventMessages(base, anchorEventId);
    createdMessageIds = messages.map((m) => m.id);
    expect(messages.find((m) => m.equipment_request_id === pendingRequest)).toBeFalsy();
    expect(messages.find((m) => m.equipment_request_id === rejectedRequest)).toBeFalsy();

    expect(await getRequestStatus(base, anchorEventId, pendingRequest)).toBe("PENDING");
    expect(await getRequestStatus(base, anchorEventId, rejectedRequest)).toBe("REJECTED");
  });

  test("[SCRUM-103 AC3 / TC-103-05] an APPROVED request starting tomorrow is NOT flagged (today only, not future-inclusive)", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const requestId = await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoTomorrow("00:00:00"), borrowEnd: isoTomorrow("23:59:59") });
    const base = await startApp();

    await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });

    const messages = await getEventMessages(base, anchorEventId);
    createdMessageIds = messages.map((m) => m.id);
    expect(messages.find((m) => m.equipment_request_id === requestId)).toBeFalsy();
    expect(await getRequestStatus(base, anchorEventId, requestId)).toBe("APPROVED");
  });

  test("[SCRUM-103 AC3 / TC-103-06] multiple APPROVED requests across different events each get their own correctly-mapped message", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const requestA = await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59"), eventId: anchorEventId });
    const requestB = await insertRequest({ equipmentId: id, status: "APPROVED", borrowStart: isoToday("00:00:00"), borrowEnd: isoToday("23:59:59"), eventId: secondEventId });
    const base = await startApp();

    await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });

    const messagesA = await getEventMessages(base, anchorEventId);
    const messagesB = await getEventMessages(base, secondEventId);
    createdMessageIds = [...messagesA.map((m) => m.id), ...messagesB.map((m) => m.id)];

    expect(messagesA.find((m) => m.equipment_request_id === requestA)).toBeTruthy();
    expect(messagesA.find((m) => m.equipment_request_id === requestB)).toBeFalsy();
    expect(messagesB.find((m) => m.equipment_request_id === requestB)).toBeTruthy();
    expect(messagesB.find((m) => m.equipment_request_id === requestA)).toBeFalsy();

    expect(await getRequestStatus(base, anchorEventId, requestA)).toBe("REJECTED");
    expect(await getRequestStatus(base, secondEventId, requestB)).toBe("REJECTED");
  });

  test("[SCRUM-103 AC3 / TC-103-07] no APPROVED reservation at all - retire still succeeds, no messages", async () => {
    const type = freshType();
    const id = await insertEquipment({ type });
    const base = await startApp();

    const response = await send(base, `/equipment/${id}/retire`, "technical_support_staff", { method: "PATCH" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("UNAVAILABLE");
  });
});
