import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWaitlistService = require("../../src/modules/registrations/waitlistService");

function makeClient({ activeEntries, offers }) {
  const selects = [];
  const reconciled = [];
  return {
    selects,
    reconciled,
    from(table) {
      const query = { table, filters: [] };
      const builder = {
        select(value) { query.selection = value; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order(column, options) { query.order = [column, options]; return builder; },
        then(resolve, reject) {
          selects.push(query);
          return Promise.resolve({
            data: selects.length === 1 ? activeEntries : offers,
            error: null,
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      reconciled.push([name, args]);
      return { data: null, error: null };
    },
  };
}

test("listMyOffers reconciles the attendee's active events and only returns their offers", async () => {
  const activeEntries = [
    { event_id: "event-1" },
    { event_id: "event-1" },
    { event_id: "event-2" },
  ];
  const offers = [{
    id: "offer-1",
    event_id: "event-1",
    status: "active",
    offer_state: "offered",
    registration_data: { dietary: "Vegetarian" },
    offer_expires_at: "2030-01-02T00:00:00Z",
    events: {
      name: "Community Dinner",
      start_time: "2030-01-01T00:00:00Z",
      registration_fields: [],
    },
  }];
  const client = makeClient({ activeEntries, offers });
  const result = await createWaitlistService(client).listMyOffers("attendee-1");

  assert.equal(result.ok, true);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].effective_deadline, "2030-01-01T00:00:00.000Z");
  assert.equal(result.offers[0].event.name, "Community Dinner");
  assert.equal("offer_expires_at" in result.offers[0], false);
  assert.deepEqual(client.reconciled, [
    ["reconcile_event_waitlist", { p_event_id: "event-1" }],
    ["reconcile_event_waitlist", { p_event_id: "event-2" }],
  ]);
  assert.deepEqual(client.selects[0].filters, [
    ["attendee_id", "attendee-1"],
    ["status", "active"],
  ]);
  assert.deepEqual(client.selects[1].filters, [
    ["attendee_id", "attendee-1"],
    ["status", "active"],
  ]);
});

test("listMyOffers does not return expired offers after reconciliation", async () => {
  const client = makeClient({
    activeEntries: [{ event_id: "event-1" }],
    offers: [],
  });
  const result = await createWaitlistService(client).listMyOffers("attendee-1");

  assert.equal(result.ok, true);
  assert.deepEqual(result.offers, []);
  assert.equal(client.reconciled.length, 1);
});
