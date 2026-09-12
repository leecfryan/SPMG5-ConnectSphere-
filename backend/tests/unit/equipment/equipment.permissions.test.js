const { test } = require("node:test");
const assert = require("node:assert/strict");

const { getPolicy, hasPermission } = require("../../../src/auth/permissions");
const requirePermission = require("../../../src/middleware/requirePermission");

// Coordinators submit requests for their own events; Technical Support Staff
// edit/manage requests. Neither role does both (see auth/permissions.js and
// supabase/migrations/003_kl_create_equipment.sql). These tests exercise the
// real permissions.js + requirePermission.js directly (both pure/no Supabase
// import), so they run without env vars, same reasoning as
// equipment.validation.test.js.

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = () => res;
  return res;
}

test("equipment_requests.create and .update are distinct permissions", () => {
  const createPolicy = getPolicy("equipment_requests.create");
  const updatePolicy = getPolicy("equipment_requests.update");
  assert.ok(createPolicy, "equipment_requests.create must be defined");
  assert.ok(updatePolicy, "equipment_requests.update must be defined");
  assert.notEqual(createPolicy, updatePolicy);
});

test("equipment_requests.create is granted only to event_coordinator", () => {
  assert.equal(hasPermission(["event_coordinator"], "equipment_requests.create"), true);
  for (const roles of [
    ["technical_support_staff"],
    ["venue_staff"],
    ["event_ops_manager"],
    ["event_organiser"],
    ["attendee"],
    [],
  ]) {
    assert.equal(
      hasPermission(roles, "equipment_requests.create"),
      false,
      `roles [${roles}] must not gain the create permission`,
    );
  }
});

test("equipment_requests.update is granted only to technical_support_staff", () => {
  assert.equal(hasPermission(["technical_support_staff"], "equipment_requests.update"), true);
  for (const roles of [
    ["event_coordinator"],
    ["venue_staff"],
    ["event_ops_manager"],
    ["event_organiser"],
    ["attendee"],
    [],
  ]) {
    assert.equal(
      hasPermission(roles, "equipment_requests.update"),
      false,
      `roles [${roles}] must not gain the update permission`,
    );
  }
});

test("equipment_requests.create requires a record access resolver", () => {
  assert.throws(
    () => requirePermission("equipment_requests.create"),
    /record access check/,
  );
});

test("a Coordinator's POST is let through only for an event they organise or coordinate", async () => {
  const middleware = requirePermission("equipment_requests.create", async (req) => {
    return req.params.eventId === "managed-event";
  });

  for (const eventId of ["managed-event", "unrelated-event"]) {
    const req = { user: { id: "coord-1", roles: ["event_coordinator"] }, method: "POST", params: { eventId } };
    const res = mockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, eventId === "managed-event", eventId);
    if (eventId !== "managed-event") assert.equal(res.statusCode, 403);
  }
});

test("Technical Support Staff cannot create requests; Coordinators cannot update them", async () => {
  const createMiddleware = requirePermission("equipment_requests.create", async () => true);
  const req1 = { user: { id: "tech-1", roles: ["technical_support_staff"] }, method: "POST", params: { eventId: "any" } };
  const res1 = mockRes();
  let next1 = false;
  await createMiddleware(req1, res1, () => { next1 = true; });
  assert.equal(next1, false);
  assert.equal(res1.statusCode, 403);

  const updateMiddleware = requirePermission("equipment_requests.update");
  const req2 = { user: { id: "coord-1", roles: ["event_coordinator"] }, method: "PATCH" };
  const res2 = mockRes();
  let next2 = false;
  await updateMiddleware(req2, res2, () => { next2 = true; });
  assert.equal(next2, false);
  assert.equal(res2.statusCode, 403);
});

test("Technical Support Staff's PATCH is let through unconditionally (no event scoping)", async () => {
  const middleware = requirePermission("equipment_requests.update");
  const req = { user: { id: "tech-1", roles: ["technical_support_staff"] }, method: "PATCH" };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requirePermission rejects an unauthenticated request before checking roles", async () => {
  const middleware = requirePermission("equipment_requests.update");
  const req = { method: "PATCH" };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
