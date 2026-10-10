// SCRUM-104: releaseReservationsForCancelledEvent is called by a script, not
// a route (there is no cancellation endpoint in this story - events.status
// is set directly in Supabase). Same live-DB pattern as
// equipment-status-change.test.js: real createEquipmentService(supabase)
// wired into the real Express app for the read-side assertions (AC2's
// availability check), real network calls to the dev Supabase project,
// throwaway rows cleaned up in afterEach.
//
// Unlike equipment-status-change.test.js, this file also creates its own
// throwaway events (never a shared demo event) because it needs to set
// status = CANCELLED, which must never happen to coordinator.demo's real
// assigned events.
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

let coordinatorUserId;
let technicalUserId;

beforeAll(async () => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const coordinator = data.users.find((u) => u.email === "coordinator.demo@example.com");
  if (!coordinator) throw new Error("Seed user coordinator.demo@example.com not found - run `npm run seed:users` first.");
  coordinatorUserId = coordinator.id;
  const technical = data.users.find((u) => u.email === "technical.demo@example.com");
  if (!technical) throw new Error("Seed user technical.demo@example.com not found - run `npm run seed:users` first.");
  technicalUserId = technical.id;
});

let createdEventIds = [];
let createdEquipmentIds = [];

afterEach(async () => {
  if (createdEventIds.length) {
    await supabase.from("events").delete().in("id", createdEventIds); // cascades equipment_requests/messages
    createdEventIds = [];
  }
  if (createdEquipmentIds.length) {
    await supabase.from("equipment").delete().in("id", createdEquipmentIds);
    createdEquipmentIds = [];
  }
});

async function insertEvent({ status = "CANCELLED" } = {}) {
  const id = randomUUID();
  // organiser_id is technicalUserId, not coordinatorUserId, and coordinator_id
  // is left null - other live-DB suites (managedEvents.userStory.test.js)
  // independently compute "events coordinator.demo manages" by matching
  // organiser_id OR coordinator_id against that account, concurrently against
  // the same shared account. Using a different real user here keeps this
  // throwaway event out of that computation entirely.
  const { error } = await supabase.from("events").insert({
    id, name: "SCRUM-104 release test " + id.slice(0, 8), purpose: "test", description: "test",
    start_time: "2026-01-01T09:00:00Z", end_time: "2026-01-01T17:00:00Z", expected_attendance: 1,
    status, organiser_id: technicalUserId,
  });
  if (error) throw new Error("events insert failed: " + error.message);
  createdEventIds.push(id);
  return id;
}

async function insertEquipment({ type, status = "AVAILABLE" }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment").insert({ id, type, current_location: "Test Room", status });
  if (error) throw new Error("equipment insert failed: " + error.message);
  createdEquipmentIds.push(id);
  return id;
}

async function insertRequest({ eventId, equipmentId, status = "APPROVED", borrowStart, borrowEnd }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment_requests").insert({
    id, event_id: eventId, equipment_id: equipmentId, requested_by: coordinatorUserId,
    quantity_requested: 1, borrow_start: borrowStart, borrow_end: borrowEnd, status,
  });
  if (error) throw new Error("equipment_requests insert failed: " + error.message);
  return id;
}

async function requestStatus(id) {
  const { data, error } = await supabase.from("equipment_requests").select("status").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.status;
}

async function equipmentStatus(id) {
  const { data, error } = await supabase.from("equipment").select("status, updated_by").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

function freshType() {
  return "SCRUM104_TEST_" + randomUUID().slice(0, 8);
}

function isoNextWeek(hour = "12:00:00") {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10) + "T" + hour + "Z";
}

const equipmentService = createEquipmentService(supabase);

describe("SCRUM-104 AC1: cancelling an event releases its equipment reservations", () => {
  test("[TC-SCRUM-104-01] an APPROVED request on a cancelled event moves to RELEASED", async () => {
    const eventId = await insertEvent();
    const equipmentId = await insertEquipment({ type: freshType() });
    const requestId = await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(summary.released).toEqual([requestId]);
    expect(await requestStatus(requestId)).toBe("RELEASED");
  });

  // SCRUM-148 changed this: PENDING requests are now released too (see that
  // story's TC-148-11), not auto-rejected - REJECTED is Technical Support
  // Staff's own "Issues" status and would misreport why the request stopped
  // mattering. Already-REJECTED requests are still untouched.
  test("[TC-SCRUM-104-02] a REJECTED request on the same cancelled event is untouched; PENDING is now released (SCRUM-148)", async () => {
    const eventId = await insertEvent();
    const pendingUnit = await insertEquipment({ type: freshType() });
    const rejectedUnit = await insertEquipment({ type: freshType() });
    const pendingRequest = await insertRequest({ eventId, equipmentId: pendingUnit, status: "PENDING", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });
    const rejectedRequest = await insertRequest({ eventId, equipmentId: rejectedUnit, status: "REJECTED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(summary.released).toEqual([pendingRequest]);
    expect(await requestStatus(pendingRequest)).toBe("RELEASED");
    expect(await requestStatus(rejectedRequest)).toBe("REJECTED");
  });

  test("[TC-SCRUM-104-03] a future-dated APPROVED request is still released - not scoped to today", async () => {
    const eventId = await insertEvent();
    const equipmentId = await insertEquipment({ type: freshType() });
    const requestId = await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: isoNextWeek("00:00:00"), borrowEnd: isoNextWeek("23:59:59") });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(summary.released).toEqual([requestId]);
    expect(await requestStatus(requestId)).toBe("RELEASED");
  });

  test("[TC-SCRUM-104-08] running the release twice is a no-op the second time", async () => {
    const eventId = await insertEvent();
    const equipmentId = await insertEquipment({ type: freshType() });
    const requestId = await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    await equipmentService.releaseReservationsForCancelledEvent(eventId);
    const second = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(second.released).toEqual([]);
    expect(await requestStatus(requestId)).toBe("RELEASED");
  });

  test("[TC-SCRUM-104-09] a cancelled event with no reservations at all returns an empty summary", async () => {
    const eventId = await insertEvent();

    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(summary).toEqual({ released: [], equipmentReverted: [], equipmentSkipped: [] });
  });

  // SCRUM-148 AC3/TC-148-13: releasing one event's reservations must never touch
  // a different, still-active event's requests, whatever their status.
  test("[TC-SCRUM-148-13] requests on a different, still-active event are untouched", async () => {
    const cancelledEventId = await insertEvent({ status: "CANCELLED" });
    const activeEventId = await insertEvent({ status: "APPROVED" });
    const pendingUnit = await insertEquipment({ type: freshType() });
    const approvedUnit = await insertEquipment({ type: freshType() });
    const otherPending = await insertRequest({ eventId: activeEventId, equipmentId: pendingUnit, status: "PENDING", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });
    const otherApproved = await insertRequest({ eventId: activeEventId, equipmentId: approvedUnit, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(cancelledEventId);

    expect(summary).toEqual({ released: [], equipmentReverted: [], equipmentSkipped: [] });
    expect(await requestStatus(otherPending)).toBe("PENDING");
    expect(await requestStatus(otherApproved)).toBe("APPROVED");
  });
});

// Reads the real events table - only used by the self-heal describe block
// below, which tests the sweep itself. Every other describe block in this
// file passes the no-op `async () => []` default so its own GET calls never
// go looking for OTHER suites' throwaway cancelled events on the shared dev
// database.
async function listLiveCancelledEventIds() {
  const { data, error } = await supabase.from("events").select("id").eq("status", "CANCELLED");
  if (error) throw error;
  return data.map((event) => event.id);
}

describe("SCRUM-104 AC2: the released quantity is available for new reservations", () => {
  async function startApp({ listCancelledEventIds = async () => [] } = {}) {
    const app = createApp({
      authClient: { auth: { getUser: async () => ({ data: { user: { id: technicalUserId, app_metadata: { roles: ["technical_support_staff"] } } }, error: null }) } },
      equipmentDependencies: {
        equipmentService, messagesService: createMessagesService(supabase),
        findEventById: async (id) => ({ id, coordinator_id: coordinatorUserId, status: "APPROVED" }),
        findEventsByIds: async (ids) => ids.map((id) => ({ id, coordinator_id: coordinatorUserId, status: "APPROVED" })),
        getUserDisplayName: async () => null,
        listCancelledEventIds,
      },
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { base: `http://127.0.0.1:${server.address().port}`, server };
  }

  test("[TC-SCRUM-104-04] a released unit is counted as available again, no availability-code change needed", async () => {
    const eventId = await insertEvent();
    const type = freshType();
    const equipmentId = await insertEquipment({ type });
    await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    await equipmentService.releaseReservationsForCancelledEvent(eventId);

    const { base, server } = await startApp();
    try {
      const params = new URLSearchParams({ start: "2026-01-01T09:00:00Z", end: "2026-01-01T17:00:00Z", type, quantity: "1", location: "Test Room" });
      const response = await fetch(`${base}/api/equipment/availability?${params}`, { headers: { Authorization: "Bearer technical_support_staff" } });
      const { data } = await response.json();
      expect(data.available_quantity).toBe(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("[TC-SCRUM-104-04b] a second, still-active reservation on the same unit still blocks it", async () => {
    const cancelledEventId = await insertEvent({ status: "CANCELLED" });
    const activeEventId = await insertEvent({ status: "APPROVED" });
    const type = freshType();
    const equipmentId = await insertEquipment({ type });
    await insertRequest({ eventId: cancelledEventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });
    await insertRequest({ eventId: activeEventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    await equipmentService.releaseReservationsForCancelledEvent(cancelledEventId);

    const { base, server } = await startApp();
    try {
      const params = new URLSearchParams({ start: "2026-01-01T09:00:00Z", end: "2026-01-01T17:00:00Z", type, quantity: "1", location: "Test Room" });
      const response = await fetch(`${base}/api/equipment/availability?${params}`, { headers: { Authorization: "Bearer technical_support_staff" } });
      const { data } = await response.json();
      expect(data.available_quantity).toBe(0); // the active event's own APPROVED request still blocks it
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("[TC-SCRUM-104-11] cancelling an event in the database alone is enough - the next equipment read self-heals it, no script required", async () => {
    const eventId = await insertEvent({ status: "CANCELLED" });
    const type = freshType();
    const equipmentId = await insertEquipment({ type, status: "IN_USE" });
    const requestId = await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    // No call to releaseReservationsForCancelledEvent here - that's the point.
    const { base, server } = await startApp({ listCancelledEventIds: listLiveCancelledEventIds });
    try {
      const params = new URLSearchParams({ start: "2026-01-01T09:00:00Z", end: "2026-01-01T17:00:00Z", type, quantity: "1", location: "Test Room" });
      const availability = await (await fetch(`${base}/api/equipment/availability?${params}`, { headers: { Authorization: "Bearer technical_support_staff" } })).json();
      expect(availability.data.available_quantity).toBe(1);

      expect(await requestStatus(requestId)).toBe("RELEASED");
      expect((await equipmentStatus(equipmentId)).status).toBe("AVAILABLE");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("SCRUM-104 AC3: reserved equipment's status is automatically changed to available", () => {
  test("[TC-SCRUM-104-05] equipment manually stored IN_USE reverts to AVAILABLE once its only reservation is released", async () => {
    const eventId = await insertEvent();
    const equipmentId = await insertEquipment({ type: freshType(), status: "IN_USE" });
    await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(summary.equipmentReverted).toEqual([equipmentId]);
    const unit = await equipmentStatus(equipmentId);
    expect(unit.status).toBe("AVAILABLE");
    expect(unit.updated_by).toBeNull();
  });

  test("[TC-SCRUM-104-06] equipment stays IN_USE when another active reservation still covers today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cancelledEventId = await insertEvent({ status: "CANCELLED" });
    const activeEventId = await insertEvent({ status: "APPROVED" });
    const equipmentId = await insertEquipment({ type: freshType(), status: "IN_USE" });
    await insertRequest({ eventId: cancelledEventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });
    await insertRequest({ eventId: activeEventId, equipmentId, status: "APPROVED", borrowStart: today + "T00:00:00Z", borrowEnd: today + "T23:59:59Z" });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(cancelledEventId);

    expect(summary.equipmentSkipped).toEqual([equipmentId]);
    expect((await equipmentStatus(equipmentId)).status).toBe("IN_USE");
  });

  test("[TC-SCRUM-104-07] a deliberately DAMAGED unit is never forced back to AVAILABLE", async () => {
    const eventId = await insertEvent();
    const equipmentId = await insertEquipment({ type: freshType(), status: "DAMAGED" });
    await insertRequest({ eventId, equipmentId, status: "APPROVED", borrowStart: "2026-01-01T09:00:00Z", borrowEnd: "2026-01-01T17:00:00Z" });

    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);

    expect(summary.equipmentReverted).toEqual([]);
    expect(summary.equipmentSkipped).toEqual([]); // never inspected - it was never IN_USE
    expect((await equipmentStatus(equipmentId)).status).toBe("DAMAGED");
  });
});
