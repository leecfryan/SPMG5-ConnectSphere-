const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");
const requirePermission = require("../../src/middleware/requirePermission");

// These handlers/records exist only in tests. No placeholder business API is shipped.
async function setup(t, getUser) {
  const app = createApp({
    authClient: { auth: { getUser } },
    supabaseUrl: "https://example.supabase.co", publishableKey: "test-public-key",
  });
  let reads = 0, recordChecks = 0;
  app.all("/api/internal/test-venues/:id", requirePermission("venues.read"), (req, res) => {
    reads++;
    res.json({ id: req.params.id, location: "Different venue location", capacity: 120 });
  });
  app.get("/api/internal/test-equipment/:type", requirePermission("equipment.read"), (req, res) => {
    reads++;
    res.json({ type: req.params.type, available: 4 });
  });
  const recordPermissions = ["bookings.read", "technical_requests.read", "event_planning.read", "attendees.read", "clients.read"];
  for (const permission of recordPermissions) {
    app.get("/api/internal/test-record/" + permission + "/:eventId",
      requirePermission(permission, async (req) => {
        recordChecks++;
        // The feature owner loads relationships from their database, not query/body claims.
        if (req.params.eventId === "provider-down") throw new Error("private database detail");
        if (req.params.eventId === "truthy") return "yes";
        if (req.params.eventId !== "managed-event") return false;
        return true;
      }), (req, res) => {
        reads++;
        // Feature handlers must explicitly select fields relevant to this permission.
        res.json({ eventId: req.params.eventId, permission, information: "Restricted fixture" });
      });
  }
  const server = app.listen(0, "127.0.0.1");await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve);server.closeAllConnections(); }));
  return { base: "http://127.0.0.1:" + server.address().port, counts: () => ({ reads, recordChecks }) };
}
function authUser(roles, metadata = {}) {
  return { data: { user: {
    id: "verified-user", email: "demo@example.com",
    app_metadata: { roles }, user_metadata: metadata,
  } }, error: null };
}
const authHeaders = { Authorization: "Bearer valid" };
const matrix = [
  { role: "venue_staff", permitted: ["venues.read", "bookings.read"] },
  { role: "technical_support_staff", permitted: ["equipment.read", "technical_requests.read"] },
  { role: "event_coordinator", permitted: ["venues.read", "bookings.read", "equipment.read", "technical_requests.read", "event_planning.read", "attendees.read", "clients.read"] },
  { role: "event_organiser", permitted: [] },
  { role: "attendee", permitted: [] },
];
const paths = {
  "venues.read": "/api/internal/test-venues/other-venue",
  "equipment.read": "/api/internal/test-equipment/other-equipment-type",
  ...Object.fromEntries(["bookings.read", "technical_requests.read", "event_planning.read", "attendees.read", "clients.read"]
    .map((p) => [p, "/api/internal/test-record/" + p + "/managed-event"])),
};
for (const { role, permitted } of matrix) {
  test("Staff story AC1/2/4: permission matrix for " + role, async (t) => {
    const { base, counts } = await setup(t, async () => authUser([role]));
    for (const [permission, route] of Object.entries(paths)) {
      const before = counts();
      const response = await fetch(base + route, { headers: authHeaders });
      assert.equal(response.status, permitted.includes(permission) ? 200 : 403, permission);
      if (!permitted.includes(permission)) {
        assert.deepEqual(counts(), before, "Denied access must not reach record lookup or data handler");
        assert.doesNotMatch(await response.text(), /Restricted fixture|capacity|available/);
      }
    }
  });
}
test("Staff story AC3: staff access is not restricted by venue, equipment type, or location", async (t) => {
  const { base } = await setup(t, async () => authUser(["venue_staff", "technical_support_staff"], {
    venue_id: "assigned-venue", location: "Other location", equipment_type: "projector",
  }));
  for (const route of ["/api/internal/test-venues/unassigned-venue", "/api/internal/test-equipment/microphone"]) {
    assert.equal((await fetch(base + route, { headers: authHeaders })).status, 200);
  }
});
test("Staff story AC4: anonymous and invalid sessions cannot access internal endpoints", async (t) => {
  const { base } = await setup(t, async () => ({ data: { user: null }, error: { status: 401 } }));
  for (const headers of [{}, authHeaders]) {
    const response = await fetch(base + "/api/internal/access", { headers });
    assert.equal(response.status, 401);
  }
});
test("Staff story AC4: user metadata, headers, and query fields cannot elevate external users", async (t) => {
  const { base, counts } = await setup(t, async () => authUser(["attendee"], {
    roles: ["venue_staff"], permissions: ["venues.read"], user_type: "internal",
  }));
  const response = await fetch(base + paths["venues.read"] + "?role=venue_staff&user_type=internal", {
    headers: { ...authHeaders, "X-User-Role": "venue_staff" },
  });
  assert.equal(response.status, 403);assert.deepEqual(counts(), { reads: 0, recordChecks: 0 });
});
test("Staff story AC4: unknown/missing/malformed roles default to no internal access", async (t) => {
  for (const roles of [undefined, [], ["administrator"], "venue_staff"]) {
    const { base } = await setup(t, async () => authUser(roles));
    assert.equal((await fetch(base + "/api/internal/access", { headers: authHeaders })).status, 403);
  }
});
test("Staff access endpoint returns only the current user's responsibilities", async (t) => {
  const { base } = await setup(t, async () => authUser(["venue_staff", "attendee"]));
  const response = await fetch(base + "/api/internal/access", { headers: authHeaders });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(data.responsibilities.map((r) => r.permission), ["venues.read", "bookings.read"]);
  assert.equal(data.responsibilities[1].requiresRecordCheck, true);
});
test("Event-specific permissions require an explicit record-access resolver", () => {
  assert.throws(() => requirePermission("attendees.read"), /record access check/);
  assert.throws(() => requirePermission("clients.read", true), /record access check/);
  assert.throws(() => requirePermission("unknown.read"), /Unknown permission/);
  assert.throws(() => requirePermission("__proto__"), /Unknown permission/);
});
test("Staff story AC4: unrelated/missing records and truthy non-boolean checks deny access", async (t) => {
  const { base, counts } = await setup(t, async () => authUser(["event_coordinator"]));
  for (const id of ["unrelated-event", "missing-event", "truthy"]) {
    const response = await fetch(base + "/api/internal/test-record/attendees.read/" + id, { headers: authHeaders });
    assert.equal(response.status, 403);
  }
  assert.equal(counts().reads, 0);
});
test("Staff story AC4: failed relationship lookup hides data and private errors", async (t) => {
  const { base, counts } = await setup(t, async () => authUser(["event_coordinator"]));
  const response = await fetch(base + "/api/internal/test-record/clients.read/provider-down", { headers: authHeaders });
  assert.equal(response.status, 503);assert.equal(counts().reads, 0);
  assert.doesNotMatch(await response.text(), /private database detail/);
});
test("Read permissions do not allow write requests", async (t) => {
  const { base, counts } = await setup(t, async () => authUser(["venue_staff"]));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await fetch(base + paths["venues.read"], { method, headers: authHeaders });
    assert.equal(response.status, 403);
  }
  assert.equal(counts().reads, 0);
});
test("Role removal takes effect on the next verified request, using the same token", async (t) => {
  let roles = ["venue_staff"];
  const { base } = await setup(t, async () => authUser(roles));
  assert.equal((await fetch(base + paths["venues.read"], { headers: authHeaders })).status, 200);
  roles = ["attendee"];
  assert.equal((await fetch(base + paths["venues.read"], { headers: authHeaders })).status, 403);
});
