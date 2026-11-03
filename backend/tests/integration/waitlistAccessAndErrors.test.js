import { test, expect, vi, afterEach } from "vitest";
import { once } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const servers = [];

async function startServer({ role = "attendee", rpcError = null, rpcData = null } = {}) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: rpcError }));
  const app = createApp({
    authClient: {
      auth: {
        async getUser(token) {
          if (!["attendee-token", "coordinator-token"].includes(token)) {
            return { data: { user: null }, error: null };
          }
          return {
            data: {
              user: {
                id: "user-1",
                app_metadata: { roles: [token === "coordinator-token" ? "coordinator" : role] },
                user_metadata: {},
              },
            },
            error: null,
          };
        },
      },
    },
    dataClient: { rpc },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return { rpc, url: `http://127.0.0.1:${server.address().port}/api/waitlist/event-1` };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});

test("waitlist routes deny a signed-in coordinator without calling storage", async () => {
  const { rpc, url } = await startServer();
  const response = await fetch(url, {
    headers: { Authorization: "Bearer coordinator-token" },
  });

  expect(response.status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

test.each([
  ["already_waitlisted", 409],
  ["event_not_full", 409],
  ["event_not_found", 404],
])("waitlist join maps the %s outcome to HTTP %i", async (outcome, status) => {
  const { rpc, url } = await startServer({ rpcData: { outcome } });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer attendee-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ attendeeId: "untrusted-client-id" }),
  });
  const body = await response.json();

  expect(response.status).toBe(status);
  expect(body.code).toBe(outcome);
  expect(rpc).toHaveBeenCalledWith("enqueue_waitlist_if_full_v2", {
    p_event_id: "event-1",
    p_attendee_id: "user-1",
    p_registration_data: null,
  });
});

test("waitlist storage failures return a generic 500 and log the provider failure", async () => {
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const { url } = await startServer({ rpcError: { message: "private provider detail" } });
  const response = await fetch(url, {
    headers: { Authorization: "Bearer attendee-token" },
  });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    message: "Unable to process your waitlist request. Please try again.",
  });
  expect(logger).toHaveBeenCalledWith("Waitlist request error:", "private provider detail");
});
