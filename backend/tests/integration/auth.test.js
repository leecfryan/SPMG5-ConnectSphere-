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
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return "http://127.0.0.1:" + server.address().port;
}

test("AC2: missing/malformed credentials cannot reach protected identity", async (t) => {
  let called = false;
  const base = await setup(t, async () => { called = true; });
  for (const value of ["", "Basic abc", "Bearer", "Bearer a b"]) {
    const response = await fetch(base + "/api/auth/me", { headers: { Authorization: value } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).user, undefined);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(called, false);
});

test("AC2: forged or expired tokens fail verification and return no protected data", async (t) => {
  const base = await setup(t, async (token) => {
    assert.equal(token, "forged-token");
    return { data: { user: null }, error: { status: 401, message: "sensitive upstream details" } };
  });
  const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer forged-token" } });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /sensitive upstream details/);
});

test("AC1/AC3: verified identity is returned; roles come only from admin metadata", async (t) => {
  const base = await setup(t, async (token) => {
    assert.equal(token, "valid-token");
    return { data: { user: {
      id: "verified-user-id", email: "attendee@example.com",
      app_metadata: { roles: ["attendee"], user_type: "external" },
      user_metadata: { full_name: "Demo Attendee", roles: ["venue_staff"], user_type: "internal" },
    } }, error: null };
  });
  const response = await fetch(base + "/api/auth/me?role=venue_staff", {
    headers: { Authorization: "Bearer valid-token", "X-User-Role": "venue_staff" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: {
    id: "verified-user-id", email: "attendee@example.com", fullName: "Demo Attendee",
    roles: ["attendee"], accountTypes: ["external"],
  } });
});

test("AC3: multiple trusted roles can represent internal and external responsibilities", async (t) => {
  const base = await setup(t, async () => ({ data: { user: {
    id: "staff-id", app_metadata: { roles: ["venue_staff", "attendee", "venue_staff", "superadmin"] },
  } }, error: null }));
  const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer valid" } });
  const { user } = await response.json();
  assert.deepEqual(user.roles, ["venue_staff", "attendee"]);
  assert.deepEqual(user.accountTypes, ["internal", "external"]);
});

test("AC3: absent or malformed roles never default to staff access", async (t) => {
  const base = await setup(t, async () => ({ data: { user: {
    id: "user-id", app_metadata: { roles: "venue_staff", user_type: "internal" },
  } }, error: null }));
  const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer valid" } });
  const { user } = await response.json();
  assert.deepEqual(user.roles, []);
  assert.deepEqual(user.accountTypes, []);
});

test("AC2: upstream failure fails closed without exposing provider errors", async (t) => {
  const base = await setup(t, async () => { throw new Error("private provider details"); });
  const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer valid" } });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private provider details/);
});

test("AC2: provider rate limits and outages do not grant access", async (t) => {
  const base = await setup(t, async () => ({
    data: { user: null }, error: { status: 429, message: "rate limited" },
  }));
  const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer valid" } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).user, undefined);
});

test("AC2: an empty verified response does not authenticate a user", async (t) => {
  const base = await setup(t, async () => ({ data: { user: null }, error: null }));
  const response = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer valid" } });
  assert.equal(response.status, 401);
});

test("public configuration contains only the URL and publishable key; health stays public", async (t) => {
  const base = await setup(t, async () => { throw new Error("must not authenticate"); });
  const response = await fetch(base + "/api/auth/config");
  assert.deepEqual(await response.json(), {
    supabaseUrl: "https://example.supabase.co", publishableKey: "sb_publishable_test",
  });
  assert.equal((await fetch(base + "/api/health")).status, 200);
});
