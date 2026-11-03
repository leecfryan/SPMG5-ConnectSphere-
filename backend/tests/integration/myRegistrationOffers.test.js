import { test } from "vitest";
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");

test("GET /api/registrations/me returns only the caller's reconciled open offers", async (t) => {
  const attendeeId = "authenticated-attendee";
  const waitlistQueries = [];
  const client = {
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select(selection) { query.selection = selection; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order(column, options) { query.order = [column, options]; return builder; },
        then(resolve, reject) {
          let data = [];
          if (table === "event_waitlist_entries") {
            waitlistQueries.push(query);
            data = query.selection === "event_id"
              ? [{ event_id: "event-1" }]
              : [{
                id: "offer-1",
                event_id: "event-1",
                status: "active",
                offer_state: "offered",
                registration_data: {},
                offer_expires_at: "2030-01-02T00:00:00Z",
                events: {
                  name: "Community Dinner",
                  start_time: "2030-01-01T00:00:00Z",
                  registration_fields: [],
                },
              }];
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      assert.equal(name, "reconcile_event_waitlist");
      assert.deepEqual(args, { p_event_id: "event-1" });
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
    `http://127.0.0.1:${server.address().port}/api/registrations/me?attendee_id=other-attendee`,
    { headers: { Authorization: "Bearer test" } },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.registrations, []);
  assert.equal(body.offers.length, 1);
  assert.equal(body.offers[0].id, "offer-1");
  assert.equal(body.offers[0].event.name, "Community Dinner");
  assert.equal(body.offers[0].effective_deadline, "2030-01-01T00:00:00.000Z");
  assert.equal("offer_expires_at" in body.offers[0], false);
  assert.equal("attendee_id" in body.offers[0], false);
  assert.ok(body.server_time);
  assert.ok(waitlistQueries.every((query) =>
    query.filters.some(([column, value]) => column === "attendee_id" && value === attendeeId)
  ));
});
