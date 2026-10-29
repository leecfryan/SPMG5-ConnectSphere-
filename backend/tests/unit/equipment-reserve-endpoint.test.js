// SCRUM-31: HTTP-level tests for the new reserve endpoint's response
// shaping (404/409/200) and role gating. The reservation decision itself is
// already proven against the real service in
// equipment-group-reserve.service.test.js; this only checks that
// equipment.controller.js/equipment.routes.js map that decision onto the
// right HTTP response. Same production-router-with-fakes pattern as
// tests/unit/equipment/equipment.functional.test.js, but Vitest (new
// equipment work goes here, not the node:test glob - see that file's and
// equipment-group-reserve.test.js's header comments).
import { describe, expect, test, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const express = require("express");
const equipmentRoutes = require("../../src/routes/equipment.routes");

const GROUP_ID = "55555555-5555-5555-5555-555555555555";

function fakeEquipmentService(reserveGroupResult) {
  const calls = [];
  return {
    calls,
    async reserveGroup(groupId) {
      calls.push(groupId);
      return typeof reserveGroupResult === "function" ? reserveGroupResult(groupId) : reserveGroupResult;
    },
  };
}

let server;
afterEach(() => {
  if (server) { server.close(); server = undefined; }
});

async function setup({ roleAssignments = { "tech-1": ["technical_support_staff"] }, equipmentService }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const header = req.get("x-test-user-id");
    if (header) req.user = { id: header, roles: roleAssignments[header] || [] };
    next();
  });
  app.use("/api", equipmentRoutes({
    authenticate: (req, res, next) => next(),
    equipmentService,
    findEventById: async () => null,
    findEventsByIds: async () => [],
    getUserDisplayName: async () => null,
    listAssignedEvents: async () => [],
    listReleasableEventIds: async () => [],
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return "http://127.0.0.1:" + server.address().port;
}

function reserve(base, groupId, userId) {
  return fetch(`${base}/api/equipment-requests/groups/${groupId}/reserve`, {
    method: "PATCH",
    headers: userId ? { "x-test-user-id": userId } : {},
  });
}

describe("SCRUM-31: PATCH /equipment-requests/groups/:groupId/reserve", () => {
  test("TC-09: an unknown group id is a 404", async () => {
    const equipmentService = fakeEquipmentService(null);
    const base = await setup({ equipmentService });

    const response = await reserve(base, GROUP_ID, "tech-1");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Equipment request not found" });
  });

  test("TC-07: an essential shortfall is a 409, naming the counts", async () => {
    const equipmentService = fakeEquipmentService({ ok: false, reason: "essential_shortfall", availableCount: 3, pendingCount: 4 });
    const base = await setup({ equipmentService });

    const response = await reserve(base, GROUP_ID, "tech-1");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Not enough units available to fully reserve this essential item (needs 4, 3 available).",
    });
  });

  test("TC-01/02: a successful reserve (full or partial) is a 200 with the reserved/unfulfilled rows", async () => {
    const reserved = [{ id: "r1", status: "APPROVED", equipment_id: "u1" }];
    const unfulfilled = [{ id: "r2", status: "UNFULFILLED" }];
    const equipmentService = fakeEquipmentService({ ok: true, reserved, unfulfilled });
    const base = await setup({ equipmentService });

    const response = await reserve(base, GROUP_ID, "tech-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reserved, unfulfilled } });
  });

  test("TC-17: nothing left to reserve is still a 200, with empty arrays", async () => {
    const equipmentService = fakeEquipmentService({ ok: true, reserved: [], unfulfilled: [] });
    const base = await setup({ equipmentService });

    const response = await reserve(base, GROUP_ID, "tech-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reserved: [], unfulfilled: [] } });
  });

  test("TC-11: an Event Coordinator cannot reserve (403); the service is never called", async () => {
    const equipmentService = fakeEquipmentService({ ok: true, reserved: [], unfulfilled: [] });
    const base = await setup({
      roleAssignments: { "coord-1": ["event_coordinator"] },
      equipmentService,
    });

    const response = await reserve(base, GROUP_ID, "coord-1");
    expect(response.status).toBe(403);
    expect(equipmentService.calls).toHaveLength(0);
  });

  test("no token is 401; the service is never called", async () => {
    const equipmentService = fakeEquipmentService({ ok: true, reserved: [], unfulfilled: [] });
    const base = await setup({ equipmentService });

    const response = await reserve(base, GROUP_ID, undefined);
    expect(response.status).toBe(401);
    expect(equipmentService.calls).toHaveLength(0);
  });

  test("an invalid group id shape is a 400 before the service is called", async () => {
    const equipmentService = fakeEquipmentService({ ok: true, reserved: [], unfulfilled: [] });
    const base = await setup({ equipmentService });

    const response = await reserve(base, "not-a-uuid", "tech-1");
    expect(response.status).toBe(400);
    expect(equipmentService.calls).toHaveLength(0);
  });
});
