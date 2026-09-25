const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");

async function setup(t, getUser) {
  const app = createApp({
    authClient: { auth: { getUser } },
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return "http://127.0.0.1:" + server.address().port;
}

test("AC2: missing/malformed credentials cannot reach protected identity", async (t) => {
  let called = false;
  const base = await setup(t, async () => {
    called = true;
  });
  for (const value of ["", "Basic abc", "Bearer", "Bearer a b"]) {
    const response = await fetch(base + "/api/auth/me", {
      headers: { Authorization: value },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).user, undefined);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(called, false);
});

test("AC2: forged or expired tokens fail verification and return no protected data", async (t) => {
  const base = await setup(t, async (token) => {
    assert.equal(token, "forged-token");
    return {
      data: { user: null },
      error: { status: 401, message: "sensitive upstream details" },
    };
  });
  const response = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer forged-token" },
  });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /sensitive upstream details/);
});

test("AC1/AC3: verified identity is returned; roles come only from admin metadata", async (t) => {
  const base = await setup(t, async (token) => {
    assert.equal(token, "valid-token");
    return {
      data: {
        user: {
          id: "verified-user-id",
          email: "attendee@example.com",
          app_metadata: { roles: ["attendee"], user_type: "external" },
          user_metadata: {
            full_name: "Demo Attendee",
            roles: ["venue_staff"],
            user_type: "internal",
          },
        },
      },
      error: null,
    };
  });
  const response = await fetch(base + "/api/auth/me?role=venue_staff", {
    headers: {
      Authorization: "Bearer valid-token",
      "X-User-Role": "venue_staff",
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: {
      id: "verified-user-id",
      email: "attendee@example.com",
      fullName: "Demo Attendee",
      roles: ["attendee"],
      accountTypes: ["external"],
    },
    permissions: [],
  });
});

test("AC3: multiple trusted roles can represent internal and external responsibilities", async (t) => {
  const base = await setup(t, async () => ({
    data: {
      user: {
        id: "staff-id",
        app_metadata: {
          roles: ["venue_staff", "attendee", "venue_staff", "superadmin"],
        },
      },
    },
    error: null,
  }));
  const response = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer valid" },
  });
  const { user } = await response.json();
  assert.deepEqual(user.roles, ["venue_staff", "attendee"]);
  assert.deepEqual(user.accountTypes, ["internal", "external"]);
});

test("AC3: absent or malformed roles never default to staff access", async (t) => {
  const base = await setup(t, async () => ({
    data: {
      user: {
        id: "user-id",
        app_metadata: { roles: "venue_staff", user_type: "internal" },
      },
    },
    error: null,
  }));
  const response = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer valid" },
  });
  const { user } = await response.json();
  assert.deepEqual(user.roles, []);
  assert.deepEqual(user.accountTypes, []);
});

test("AC2: upstream failure fails closed without exposing provider errors", async (t) => {
  const base = await setup(t, async () => {
    throw new Error("private provider details");
  });
  const response = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer valid" },
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private provider details/);
});

test("AC2: provider rate limits and outages do not grant access", async (t) => {
  const base = await setup(t, async () => ({
    data: { user: null },
    error: { status: 429, message: "rate limited" },
  }));
  const response = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer valid" },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).user, undefined);
});

test("AC2: an empty verified response does not authenticate a user", async (t) => {
  const base = await setup(t, async () => ({
    data: { user: null },
    error: null,
  }));
  const response = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer valid" },
  });
  assert.equal(response.status, 401);
});

test("public configuration contains only the URL and publishable key; health stays public", async (t) => {
  const base = await setup(t, async () => {
    throw new Error("must not authenticate");
  });
  const response = await fetch(base + "/api/auth/config");
  assert.deepEqual(await response.json(), {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
  });
  assert.equal((await fetch(base + "/api/health")).status, 200);
});

test("RBAC: identity response derives permissions from verified roles, never claimed permissions", async (t) => {
  const base = await setup(t, async () => ({
    data: { user: {
      id: "staff-id", app_metadata: { roles: ["venue_staff", "attendee"], permissions: ["clients.read"] },
      user_metadata: { roles: ["event_coordinator"], permissions: ["clients.read"] },
    } }, error: null,
  }));
  const response = await fetch(base + "/api/auth/me?permissions=clients.read", {
    headers: { Authorization: "Bearer valid", "X-Permissions": "clients.read" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { permissions } = await response.json();
  assert.deepEqual(permissions, ["venues.update", "bookings.decide", "internal.access", "venues.read", "bookings.read"]);
});

test("RBAC: combined roles return unique permissions and role removal updates the next identity request", async (t) => {
  let roles = ["venue_staff", "technical_support_staff", "attendee", "venue_staff"];
  const base = await setup(t, async () => ({ data: { user: { id: "user", app_metadata: { roles } } }, error: null }));
  const headers = { Authorization: "Bearer same-token" };
  assert.deepEqual((await (await fetch(base + "/api/auth/me", { headers })).json()).permissions,
    ["venues.update", "bookings.decide", "equipment.review", "equipment.messages", "internal.access", "venues.read", "bookings.read", "equipment.read", "technical_requests.read"]);
  roles = ["attendee"];
  assert.deepEqual((await (await fetch(base + "/api/auth/me", { headers })).json()).permissions, []);
  assert.equal((await fetch(base + "/api/internal/access", { headers })).status, 403);
});

test("RBAC: missing and malformed roles return no permissions", async (t) => {
  for (const roles of [undefined, null, [], "venue_staff", ["__proto__", "superadmin"]]) {
    const base = await setup(t, async () => ({ data: { user: { id: "user", app_metadata: { roles } } }, error: null }));
    const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer valid" } });
    assert.deepEqual((await response.json()).permissions, []);
  }
});

// SCRUM-26 settled the policy question this test was written to pin. The Event
// Operations Manager now holds internal.access, because /api/internal is gated
// on it before any route-specific guard runs and the customer clarification
// (#42) puts assignment in the manager's hands.
//
// The test is kept, and inverted, to measure the blast radius of that grant:
// entering the internal area must not hand the manager anyone else's feature.
// Every venue and equipment route carries its own specific permission, so the
// outer gate opening changes nothing for them - and this is what proves it.
test("RBAC/SCRUM-26: the operations manager's internal gate grants assignment and nothing else", async (t) => {
  const base = await setup(t, async () => ({ data: { user: {
    id: "manager", app_metadata: { roles: ["event_ops_manager"] },
  } }, error: null }));
  const headers = { Authorization: "Bearer valid" };
  const { user, permissions } = await (await fetch(base + "/api/auth/me", { headers })).json();
  assert.deepEqual(user.accountTypes, ["internal"]);
  assert.deepEqual(permissions.sort(), ["event_organisers.read", "events.assign_coordinator", "internal.access"]);
  assert.equal((await fetch(base + "/api/internal/access", { headers })).status, 200);

  // Not a coordinator, not venue staff, not technical support. The manager
  // routes requests; they do not plan the events they route.
  for (const path of ["/api/venues", "/api/venues/booking-events", "/api/venues/booking-requests",
    "/api/equipment", "/api/equipment/events", "/api/technical-support/equipment-requests"]) {
    assert.equal((await fetch(base + path, { headers })).status, 403, path);
  }
});


test("EQUIPMENT-CONFIG-001: missing data configuration keeps identity available and Equipment fails closed", async (t) => {
  const base = await setup(t, async () => ({ data: { user: { id: "verified-user-id",
    app_metadata: { roles: ["event_coordinator", "technical_support_staff"] } } }, error: null }));
  const headers = { Authorization: "Bearer verified-token" };
  assert.equal((await fetch(base + "/api/auth/me", { headers })).status, 200);
  assert.equal((await fetch(base + "/api/health")).status, 200);
  for (const endpoint of ["/equipment", "/equipment/events", "/technical-support/equipment-requests",
    "/events/11111111-1111-4111-8111-111111111111/messages"]) {
    const response = await fetch(base + "/api" + endpoint, { headers });
    assert.equal(response.status, 503, endpoint);
    assert.deepEqual(await response.json(), { message: "Equipment storage is not configured. Please try again later." });
  }
  assert.equal((await fetch(base + "/api/equipment")).status, 401);
});
