import { test } from "vitest";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");

const USER_ID = "attendee-user-id";
const EVENT_ID = "event-waitlist";
const ENTRY = {
  id: "entry-1",
  event_id: EVENT_ID,
  attendee_id: USER_ID,
  status: "active",
  offer_state: null,
  created_at: "2026-01-01T00:00:00Z",
};

async function setup(t, { acceptOutcome = "accepted" } = {}) {
  const calls = [];
  const dataClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "enqueue_waitlist_if_full_v2") {
        return { data: { outcome: "joined", entry: ENTRY, position: 1 }, error: null };
      }
      if (name === "get_my_waitlist_state") {
        return {
          data: {
            outcome: "found",
            entry: ENTRY,
            position: 1,
            effective_deadline: null,
            server_time: "2026-01-01T00:00:00Z",
          },
          error: null,
        };
      }
      if (name === "update_waitlist_registration_data") {
        return {
          data: {
            outcome: "updated",
            entry: { ...ENTRY, registration_data: { dietary: "None" } },
            effective_deadline: null,
            server_time: "2026-01-01T00:00:00Z",
          },
          error: null,
        };
      }
      if (name === "accept_waitlist_offer") {
        if (acceptOutcome !== "accepted") {
          return { data: { outcome: acceptOutcome }, error: null };
        }
        return {
          data: { outcome: "accepted", registration_id: "registration-1", server_time: "2026-01-01T00:00:00Z" },
          error: null,
        };
      }
      if (name === "decline_waitlist_offer") {
        return { data: { outcome: "declined" }, error: null };
      }
      if (name === "reconcile_event_waitlist") {
        return { data: { outcome: "reconciled" }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      assert.equal(table, "event_waitlist_entries");
      const builder = {
        delete() { return builder; },
        eq() { return builder; },
        select() { return builder; },
        maybeSingle() { return Promise.resolve({ data: { id: ENTRY.id }, error: null }); },
      };
      return builder;
    },
  };
  const app = createApp({
    authClient: {
      auth: {
        async getUser(token) {
          if (token !== "attendee-token") return { data: { user: null }, error: null };
          return {
            data: {
              user: {
                id: USER_ID,
                app_metadata: { roles: ["attendee"] },
                user_metadata: {},
              },
            },
            error: null,
          };
        },
      },
    },
    dataClient,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}

async function request(base, path, method, body) {
  return fetch(`${base}/api/waitlist/${path}`, {
    method,
    headers: {
      Authorization: "Bearer attendee-token",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("waitlist routes use the authenticated attendee for RPCs and expose join, state, details, offer, and withdrawal", async (t) => {
  const { base, calls } = await setup(t);

  const joined = await request(base, EVENT_ID, "POST", {
    attendeeId: "untrusted-client-id",
    registrationData: { dietary: "None" },
  });
  assert.equal(joined.status, 201);
  assert.equal((await joined.json()).position, 1);
  assert.equal(calls[0].name, "enqueue_waitlist_if_full_v2");
  assert.deepEqual(calls[0].args, {
    p_event_id: EVENT_ID,
    p_attendee_id: USER_ID,
    p_registration_data: { dietary: "None" },
  });

  const state = await request(base, EVENT_ID, "GET");
  assert.equal(state.status, 200);
  assert.equal((await state.json()).entry.attendee_id, USER_ID);

  const updated = await request(base, `${EVENT_ID}/details`, "PUT", {
    registrationData: { dietary: "None" },
  });
  assert.equal(updated.status, 200);

  const accepted = await request(base, `${EVENT_ID}/offer/accept`, "POST");
  assert.equal(accepted.status, 200);

  const declined = await request(base, `${EVENT_ID}/offer/decline`, "POST");
  assert.equal(declined.status, 204);

  const withdrawn = await request(base, EVENT_ID, "DELETE");
  assert.equal(withdrawn.status, 204);
  assert.ok(calls.some((call) => call.name === "reconcile_event_waitlist"));
});

test("waitlist routes require an authenticated attendee", async (t) => {
  const { base } = await setup(t);
  const response = await fetch(`${base}/api/waitlist/${EVENT_ID}`, { method: "GET" });
  assert.equal(response.status, 401);
});

test("accept returns 409 when the event has no capacity for the offered attendee", async (t) => {
  const { base } = await setup(t, { acceptOutcome: "capacity_unavailable" });
  const response = await request(base, `${EVENT_ID}/offer/accept`, "POST");
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "capacity_unavailable");
  assert.match(body.message, /no longer has an available place/);
});
