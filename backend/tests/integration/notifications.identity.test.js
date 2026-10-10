import { afterAll, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { createNotificationsService } = require("../../src/modules/notifications/notifications.service");

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CONFIG = { applicationIdentifier: "novu-test-app", secretKey: "scrum143-test-secret" };
// SCRUM-143: fixed vectors were computed independently with .NET HMACSHA256.
const SIGNATURES = {
  [ALICE]: "a73f149e222988d9649683c3a09091d516ed87c860d25c6739d08c35467e09cf",
  [BOB]: "1f1201895eb552f6708ee87e037a198134adf00e330d9b2a7ca7d590080476ab",
};
const servers = [];

function authResult(token) {
  if (token === "invalid" || token === "expired") {
    return { data: { user: null }, error: { status: 401, message: "private provider details" } };
  }
  const [name, role = "attendee"] = token.split(":");
  return { data: { user: {
    id: name === "bob" ? BOB : ALICE,
    app_metadata: { roles: role === "none" ? [] : [role] },
  } }, error: null };
}

async function setup({ config = CONFIG, getUser = authResult } = {}) {
  const app = createApp({
    authClient: { auth: { getUser } },
    notificationsService: createNotificationsService(config),
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "test-public-key",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return "http://127.0.0.1:" + server.address().port;
}

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});

function request(base, token = "alice", suffix = "", headers = {}) {
  return fetch(base + "/api/notifications/inbox-config" + suffix, {
    headers: { Authorization: "Bearer " + token, ...headers },
  });
}

function expected(userId) {
  return { applicationIdentifier: CONFIG.applicationIdentifier, subscriberId: userId, subscriberHash: SIGNATURES[userId] };
}

test("SCRUM-143 AC3 TC-SCRUM-143-01: returns only public config and the caller-bound signature", async () => {
  const base = await setup();
  const response = await request(base);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text();
  expect(JSON.parse(body)).toEqual(expected(ALICE));
  expect(body).not.toContain(CONFIG.secretKey);
  const publicConfig = await fetch(base + "/api/auth/config");
  expect(await publicConfig.json()).toEqual({ supabaseUrl: "https://example.supabase.co", publishableKey: "test-public-key" });
});

test("SCRUM-143 AC3 TC-SCRUM-143-02: query and header identity claims never select another user's inbox", async () => {
  const base = await setup();
  const response = await request(base, "alice", "?subscriberId=" + BOB + "&userId=" + BOB, { "X-User-Id": BOB });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected(ALICE));
  const otherInbox = await request(base, "alice", "/" + BOB);
  expect(otherInbox.status).toBe(404);
  expect(await otherInbox.text()).not.toContain(SIGNATURES[BOB]);
});

test("SCRUM-143 AC3 TC-SCRUM-143-02: POST cannot issue a signature from a supplied subscriber ID", async () => {
  const base = await setup();
  const response = await fetch(base + "/api/notifications/inbox-config", {
    method: "POST",
    headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
    body: JSON.stringify({ subscriberId: BOB }),
  });
  expect(response.status).toBe(404);
  const body = await response.text();
  expect(body).not.toContain("subscriberHash");
  expect(body).not.toContain(CONFIG.secretKey);
});

test.each(["", "Basic abc", "Bearer", "Bearer a b", "Bearer invalid", "Bearer expired"])(
  "SCRUM-143 AC3 TC-SCRUM-143-03: rejects unauthenticated credentials %j", async authorization => {
    const getUser = vi.fn(authResult);
    const base = await setup({ getUser });
    const response = await request(base, "alice", "", { Authorization: authorization });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toContain("subscriberHash");
    expect(body).not.toContain("private provider details");
    if (!authorization.startsWith("Bearer invalid") && !authorization.startsWith("Bearer expired")) {
      expect(getUser).not.toHaveBeenCalled();
    }
  },
);

test("SCRUM-143 AC3 TC-SCRUM-143-04: consecutive users receive different signatures bound to their own identities", async () => {
  const base = await setup();
  for (const [token, userId] of [["alice", ALICE], ["bob", BOB], ["alice", ALICE]]) {
    const response = await request(base, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected(userId));
  }
});

test.each(["event_coordinator", "venue_staff", "technical_support_staff", "event_ops_manager", "event_organiser", "attendee", "none"])(
  "SCRUM-143 AC3 TC-SCRUM-143-05: signed-in %s can request their own inbox identity", async role => {
    const base = await setup();
    const response = await request(base, "alice:" + role);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected(ALICE));
  },
);

test.each([
  {},
  { secretKey: CONFIG.secretKey },
  { applicationIdentifier: "", secretKey: CONFIG.secretKey },
  { applicationIdentifier: "   ", secretKey: CONFIG.secretKey },
  { applicationIdentifier: CONFIG.applicationIdentifier },
  { applicationIdentifier: CONFIG.applicationIdentifier, secretKey: "" },
  { applicationIdentifier: CONFIG.applicationIdentifier, secretKey: "   " },
])("SCRUM-143 AC3 TC-SCRUM-143-06: incomplete configuration fails closed (case %#)", async config => {
  const base = await setup({ config });
  const response = await request(base);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ message: "Notifications are not configured yet. Please try again later." });
  const identity = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer alice" } });
  expect(identity.status).toBe(200);
  expect((await identity.json()).user.id).toBe(ALICE);
});

test("SCRUM-143 AC3 TC-SCRUM-143-01: surrounding whitespace in the public application ID is normalised", async () => {
  const base = await setup({ config: { ...CONFIG, applicationIdentifier: "  novu-test-app  " } });
  const response = await request(base);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected(ALICE));
});

test.each(["outage", "exception", "no-user"])(
  "SCRUM-143 AC3 TC-SCRUM-143-07: verification %s returns no inbox identity", async failure => {
    const base = await setup({ getUser: async () => {
      if (failure === "exception") throw new Error("private provider details");
      return { data: { user: null }, error: failure === "outage" ? { status: 503, message: "private provider details" } : null };
    } });
    const response = await request(base);
    expect(response.status).toBe(failure === "no-user" ? 401 : 503);
    const body = await response.text();
    expect(body).not.toContain("subscriberHash");
    expect(body).not.toContain("private provider details");
  },
);
