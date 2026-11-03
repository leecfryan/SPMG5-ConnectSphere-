import { test } from "vitest";
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");

test("GET /api/registrations/me separates queue entries from active offers", async (t) => {
  const attendeeId = "attendee-1";
  let waitlistReads = 0;
  const client = {
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select(selection) { query.selection = selection; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order() { return builder; },
        then(resolve, reject) {
          let data = [];
          if (table === "event_waitlist_entries") {
            waitlistReads += 1;
            data = waitlistReads === 1
              ? [{ event_id: "queue-event" }, { event_id: "offer-event" }]
              : [
                {
                  id: "entry-queue",
                  event_id: "queue-event",
                  status: "active",
                  offer_state: null,
                  created_at: "2026-09-01T00:00:00Z",
                  events: { name: "Workshop", start_time: null },
                },
                {
                  id: "entry-offer",
                  event_id: "offer-event",
                  status: "active",
                  offer_state: "offered",
                  registration_data: {},
                  offer_expires_at: "2030-01-03T00:00:00Z",
                  events: {
                    name: "Community Dinner",
                    start_time: "2030-01-02T00:00:00Z",
                    registration_fields: [],
                  },
                },
              ];
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      if (name === "reconcile_event_waitlist") {
        assert.ok(["queue-event", "offer-event"].includes(args.p_event_id));
      } else {
        assert.equal(name, "get_my_waitlist_state");
        assert.deepEqual(args, {
          p_event_id: "queue-event",
          p_attendee_id: attendeeId,
        });
        return { data: { outcome: "found", position: 2 }, error: null };
      }
      return { data: null, error: null };
    },
  };
  const app = createApp({
    authClient: {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: attendeeId,
              app_metadata: { roles: ["attendee"] },
              user_metadata: { full_name: "Test Attendee" },
            },
          },
          error: null,
        }),
      },
    },
    dataClient: client,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_test",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/registrations/me`,
    { headers: { Authorization: "Bearer test" } },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.waitlist.length, 1);
  assert.deepEqual(body.waitlist[0], {
    id: "entry-queue",
    event_id: "queue-event",
    status: "waitlist",
    position: 2,
    event: { name: "Workshop", start_time: null },
    created_at: "2026-09-01T00:00:00Z",
  });
  assert.equal(body.offers.length, 1);
  assert.equal(body.offers[0].status, "offered");
  assert.equal(body.offers[0].event.name, "Community Dinner");
  assert.equal(body.offers[0].effective_deadline, "2030-01-02T00:00:00.000Z");
});
