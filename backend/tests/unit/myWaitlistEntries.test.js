import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWaitlistService = require("../../src/modules/registrations/waitlistService");

function makeClient({ activeEntries, refreshedEntries, withdrawResult = { id: "entry-1" } }) {
  const queries = [];
  const reconciled = [];
  const client = {
    queries,
    reconciled,
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select(selection) { query.selection = selection; return builder; },
        delete() { query.delete = true; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order(column, options) { query.order = [column, options]; return builder; },
        maybeSingle() {
          queries.push(query);
          return Promise.resolve({ data: withdrawResult, error: null });
        },
        then(resolve, reject) {
          queries.push(query);
          return Promise.resolve({
            data: query.selection === "event_id" ? activeEntries : refreshedEntries,
            error: null,
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      reconciled.push([name, args]);
      if (name === "get_my_waitlist_state") {
        return { data: { outcome: "found", position: 3 }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return client;
}

test("listMyEntries returns regular waitlist rows and offers as distinct caller-owned states", async () => {
  const client = makeClient({
    activeEntries: [{ event_id: "event-1" }, { event_id: "event-2" }],
    refreshedEntries: [
      {
        id: "entry-1",
        event_id: "event-1",
        offer_state: null,
        created_at: "2026-09-01T00:00:00Z",
        events: { name: "Workshop", start_time: "2030-01-01T00:00:00Z" },
      },
      {
        id: "entry-2",
        event_id: "event-2",
        offer_state: "offered",
        registration_data: {},
        offer_expires_at: "2030-01-03T00:00:00Z",
        events: {
          name: "Dinner",
          start_time: "2030-01-02T00:00:00Z",
          registration_fields: [],
        },
      },
    ],
  });

  const result = await createWaitlistService(client).listMyEntries("attendee-1");

  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map(({ status, event }) => [status, event.name]), [
    ["waitlist", "Workshop"],
    ["offered", "Dinner"],
  ]);
  assert.equal(result.entries[0].position, 3);
  assert.equal(result.entries[1].effective_deadline, "2030-01-02T00:00:00.000Z");
  assert.deepEqual(client.reconciled, [
    ["reconcile_event_waitlist", { p_event_id: "event-1" }],
    ["reconcile_event_waitlist", { p_event_id: "event-2" }],
    ["get_my_waitlist_state", {
      p_event_id: "event-1",
      p_attendee_id: "attendee-1",
    }],
  ]);
  assert.deepEqual(client.queries[1].filters, [
    ["attendee_id", "attendee-1"],
    ["status", "active"],
  ]);
});

test("withdrawing deletes only the caller's active entry and reconciles its event", async () => {
  const client = makeClient({
    activeEntries: [],
    refreshedEntries: [],
  });

  const result = await createWaitlistService(client).withdraw("event-1", "attendee-1");

  assert.deepEqual(result, { ok: true });
  assert.equal(client.queries[0].delete, true);
  assert.deepEqual(client.queries[0].filters, [
    ["event_id", "event-1"],
    ["attendee_id", "attendee-1"],
    ["status", "active"],
  ]);
  assert.deepEqual(client.reconciled, [
    ["reconcile_event_waitlist", { p_event_id: "event-1" }],
  ]);
});
