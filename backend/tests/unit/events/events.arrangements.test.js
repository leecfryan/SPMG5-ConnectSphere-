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

test("SCRUM-140 AC1: findAwaitingSafetyReview reads only SAFETY_REVIEW events, soonest first, without organiser details", async () => {
  const rows = [{ id: "evt-1" }];
  const { calls } = recorder(rows);

  expect(await loadRepository().findAwaitingSafetyReview()).toEqual(rows);
  expect(calls).toEqual([
    ["from", "events"],
    ["select", "id, name, start_time, end_time, expected_attendance"],
    ["eq", "status", "SAFETY_REVIEW"],
    ["order", "start_time", { ascending: true }],
  ]);
});

test("SCRUM-140 AC2: findAwaitingSafetyReviewById matches the id and SAFETY_REVIEW together, selecting no organiser or coordinator column", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().findAwaitingSafetyReviewById("evt-1");

  expect(calls.filter(([name]) => name === "eq")).toEqual([["eq", "id", "evt-1"], ["eq", "status", "SAFETY_REVIEW"]]);
  const [, columns] = calls.find(([name]) => name === "select");
  expect(columns).not.toMatch(/\*|organiser|coordinator/);
  expect(columns).toContain("expected_attendance");
  expect(calls.some(([name]) => ["update", "insert", "delete", "upsert"].includes(name))).toBe(false);
});

test("SCRUM-140 failure: findAwaitingSafetyReview throws when storage fails", async () => {
  recorder(null, { message: "connection refused" });

  await expect(loadRepository().findAwaitingSafetyReview()).rejects.toThrow("findAwaitingSafetyReview failed");
});

test("SCRUM-144 AC4: findArrangements reads each request's is_essential flag", async () => {
  const { calls } = recorder([]);

  await loadRepository().findArrangements("evt-1");

  const selects = calls.filter(([name]) => name === "select").map(([, columns]) => columns);
  expect(selects).toHaveLength(2);
  for (const columns of selects) expect(columns).toContain("is_essential");
});

test.each([["venue", "venue_booking_requests"], ["equipment", "equipment_requests"]])(
  "SCRUM-144 AC4: setArrangementEssential writes only is_essential on a %s request of this event", async (kind, table) => {
    const { calls } = recorder({ id: "req-1", is_essential: false });

    const row = await loadRepository().setArrangementEssential(kind, "req-1", "evt-1", false);

    expect(calls).toContainEqual(["from", table]);
    expect(calls).toContainEqual(["update", { is_essential: false }]);
    expect(calls).toContainEqual(["eq", "id", "req-1"]);
    expect(calls).toContainEqual(["eq", "event_id", "evt-1"]);
    expect(row).toEqual({ id: "req-1", is_essential: false });
  });
