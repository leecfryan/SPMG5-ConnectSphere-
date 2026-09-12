const { test } = require("node:test");
const assert = require("node:assert/strict");

const { getPolicy, hasPermission } = require("../../../src/auth/permissions");
const requirePermission = require("../../../src/middleware/requirePermission");

// docs/staff-access.md "Teammate integration": writes need their own
// action-specific permission, never a reused read permission. These tests
// exercise the real permissions.js + requirePermission.js directly (both
// pure/no Supabase import), so they run without env vars, same reasoning
// as equipment.validation.test.js.

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = () => res;
  return res;
}

test("equipment_requests.write is its own permission, distinct from equipment.read", () => {
  const writePolicy = getPolicy("equipment_requests.write");
  assert.ok(writePolicy, "equipment_requests.write must be defined");
  assert.notEqual(writePolicy, getPolicy("equipment.read"));
});

test("equipment_requests.write is granted only to event_coordinator", () => {
  assert.equal(hasPermission(["event_coordinator"], "equipment_requests.write"), true);
  for (const roles of [
    ["venue_staff"],
    ["technical_support_staff"],
    ["event_ops_manager"],
    ["event_organiser"],
    ["attendee"],
    [],
  ]) {
    assert.equal(
      hasPermission(roles, "equipment_requests.write"),
      false,
      `roles [${roles}] must not gain the write permission`,
    );
  }
});

test("requirePermission lets a Coordinator's POST through", async () => {
  const middleware = requirePermission("equipment_requests.write");
  const req = { user: { id: "coord-1", roles: ["event_coordinator"] }, method: "POST" };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requirePermission blocks a non-Coordinator's POST/PATCH", async () => {
  for (const method of ["POST", "PATCH"]) {
    const middleware = requirePermission("equipment_requests.write");
    const req = { user: { id: "vs-1", roles: ["venue_staff"] }, method };
    const res = mockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, method);
    assert.equal(res.statusCode, 403, method);
  }
});

test("requirePermission rejects an unauthenticated request before checking roles", async () => {
  const middleware = requirePermission("equipment_requests.write");
  const req = { method: "POST" };
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
