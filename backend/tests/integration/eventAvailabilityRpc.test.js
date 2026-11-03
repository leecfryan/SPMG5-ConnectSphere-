import { test } from "vitest";
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");

test("GET /api/events uses server availability returned by the availability RPC", async (t) => {
  const event = { id: "event-1", name: "Queued Event", status: "APPROVED" };
  const app = createApp({
    authClient: {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "attendee-1",
              app_metadata: { roles: ["attendee"] },
              user_metadata: { full_name: "Test Attendee" },
            },
          },
          error: null,
        }),
      },
    },
    dataClient: {
      from(table) {
        const query = {};
        const builder = {
          select(value) { query.selection = value; return builder; },
          eq(column, value) { query[column] = value; return builder; },
          order() { return builder; },
          then(resolve, reject) {
            return Promise.resolve({ data: table === "events" ? [event] : [], error: null })
              .then(resolve, reject);
          },
        };
        return builder;
      },
      async rpc(name, args) {
        assert.equal(name, "registration_availability_for_events");
        assert.deepEqual(args.p_event_ids, ["event-1"]);
        return {
          data: [{
            event_id: "event-1",
            slots_remaining: 0,
            waitlist_queue_count: 1,
            waitlist_reserved: 0,
          }],
          error: null,
        };
      },
    },
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_test",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, {
    headers: { Authorization: "Bearer test" },
  });
  assert.equal(response.status, 200);
  const { events } = await response.json();
  assert.deepEqual(
    {
      slots_remaining: events[0].slots_remaining,
      waitlist_queue_count: events[0].waitlist_queue_count,
      waitlist_reserved: events[0].waitlist_reserved,
    },
    { slots_remaining: 0, waitlist_queue_count: 1, waitlist_reserved: 0 },
  );
});
