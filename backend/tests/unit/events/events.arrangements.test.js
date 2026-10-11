import { test, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");

// Records every query-builder call; each chain resolves to `result`.
function recorder(result, error = null) {
  const calls = [];
  const settled = { data: result, error };
  const chain = new Proxy({}, { get: (_target, name) => {
    if (name === "then") return (resolve, reject) => Promise.resolve(settled).then(resolve, reject);
    return (...args) => { calls.push([name, ...args]); return chain; };
  } });
  stubSupabase({ from: (table) => { calls.push(["from", table]); return chain; } });
  return { calls };
}

const loadRepository = () => require("../../../src/modules/events/events.repository");

beforeEach(() => { vi.resetModules(); });

test("SCRUM-139 AC1: findArrangements reads only this event's venue and equipment requests", async () => {
  const rows = [{ id: "row-1" }];
  const { calls } = recorder(rows);

  const arrangements = await loadRepository().findArrangements("evt-1");

  expect(calls).toContainEqual(["from", "venue_booking_requests"]);
  expect(calls).toContainEqual(["from", "equipment_requests"]);
  expect(calls.filter(([name]) => name === "eq")).toEqual([
    ["eq", "event_id", "evt-1"],
    ["eq", "event_id", "evt-1"],
  ]);
  expect(calls.some(([name]) => ["update", "insert", "delete", "upsert"].includes(name))).toBe(false);
  expect(arrangements).toEqual({ venueRequests: rows, equipmentRequests: rows });
});

test("SCRUM-139 failure: findArrangements throws when storage fails, so the caller answers a safe error", async () => {
  recorder(null, { message: "connection refused" });

  await expect(loadRepository().findArrangements("evt-1")).rejects.toThrow("findArrangements venue failed");
});
