import { test } from "vitest";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");

test("waitlist state lookups return an empty state for non-members", async (t) => {
  const calls = [];
  const app = createApp({
    authClient: {
      auth: {
        async getUser(token) {
          if (token !== "attendee-token") return { data: { user: null }, error: null };
          return {
            data: {
              user: {
                id: "attendee-user-id",
                app_metadata: { roles: ["attendee"] },
                user_metadata: {},
              },
            },
            error: null,
          };
        },
      },
    },
    dataClient: {
      async rpc(name, args) {
        calls.push({ name, args });
        assert.equal(name, "get_my_waitlist_state");
        return {
          data: { outcome: "not_found", server_time: "2026-10-12T01:00:00Z" },
          error: null,
        };
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/waitlist/event-1/state`, {
    headers: { Authorization: "Bearer attendee-token" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    entry: null,
    position: null,
    effective_deadline: null,
    server_time: null,
  });
  const legacyResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/waitlist/event-1`, {
    headers: { Authorization: "Bearer attendee-token" },
  });
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(await legacyResponse.json(), {
    entry: null,
    position: null,
    effective_deadline: null,
    server_time: null,
  });
  assert.deepEqual(calls, [
    {
      name: "get_my_waitlist_state",
      args: { p_event_id: "event-1", p_attendee_id: "attendee-user-id" },
    },
    {
      name: "get_my_waitlist_state",
      args: { p_event_id: "event-1", p_attendee_id: "attendee-user-id" },
    },
  ]);
});
