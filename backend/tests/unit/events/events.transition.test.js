import { test, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");

// Records every query-builder call; the chain resolves to `result`.
function recorder(result, error = null) {
  const calls = [];
  const settled = { data: result, error };
  const chain = new Proxy({}, { get: (_target, name) => {
    if (name === "then") return (resolve, reject) => Promise.resolve(settled).then(resolve, reject);
    if (name === "maybeSingle" || name === "single") return async () => settled;
    return (...args) => { calls.push([name, ...args]); return chain; };
  } });
  stubSupabase({ from: (table) => { calls.push(["from", table]); return chain; } });
  return { calls };
}

const loadRepository = () => require("../../../src/modules/events/events.repository");

beforeEach(() => { vi.resetModules(); });

test("SCRUM-97 AC2: transitionStatus writes the new status only where the event is still in the old one", async () => {
  const { calls } = recorder({ id: "evt-1", status: "UNDER_REVIEW" });

  const event = await loadRepository().transitionStatus("evt-1", "SUBMITTED", "UNDER_REVIEW");

  expect(calls).toContainEqual(["from", "events"]);
  expect(calls).toContainEqual(["update", { status: "UNDER_REVIEW" }]);
  expect(calls).toContainEqual(["eq", "id", "evt-1"]);
  expect(calls).toContainEqual(["eq", "status", "SUBMITTED"]);
  expect(event).toEqual({ id: "evt-1", status: "UNDER_REVIEW" });
});

test("SCRUM-97 AC2: extra columns are written alongside the status, but cannot override it", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().transitionStatus("evt-1", "UNDER_REVIEW", "APPROVED", {
    decided_by: "coord-1",
    status: "CONFIRMED",
  });

  expect(calls).toContainEqual(["update", { decided_by: "coord-1", status: "APPROVED" }]);
});

test("SCRUM-97 conflict: zero rows matched returns null so the caller can answer 409", async () => {
  recorder(null);

  const event = await loadRepository().transitionStatus("evt-1", "SUBMITTED", "UNDER_REVIEW");

  expect(event).toBeNull();
});

test("SCRUM-97 AC3: a transition not in the lifecycle is refused before Supabase is called", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await expect(loadRepository().transitionStatus("evt-1", "DRAFT", "CONFIRMED"))
    .rejects.toThrow("DRAFT -> CONFIRMED is not a permitted transition");
  expect(calls).toEqual([]);
});

test("SCRUM-97 failure: a Supabase error is thrown with the action named", async () => {
  recorder(null, { message: "boom" });

  await expect(loadRepository().transitionStatus("evt-1", "SUBMITTED", "UNDER_REVIEW"))
    .rejects.toThrow("events.repository: transitionStatus failed - boom");
});

test("SCRUM-97 AC2: status is not a writable column, so a general update cannot change it", async () => {
  const { calls } = recorder({ id: "evt-1" });
  const repository = loadRepository();

  await repository.update("evt-1", { name: "Gala", status: "CONFIRMED" });

  expect(repository.WRITABLE_COLS).not.toContain("status");
  expect(calls).toContainEqual(["update", { name: "Gala" }]);
});

test("SCRUM-98 AC4: with a coordinator given, the write also requires that coordinator to still hold the event", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().transitionStatus("evt-1", "UNDER_REVIEW", "APPROVED", {}, "coord-1");

  expect(calls).toContainEqual(["eq", "coordinator_id", "coord-1"]);
});

test("SCRUM-97: without a coordinator, no coordinator filter is added", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().transitionStatus("evt-1", "SUBMITTED", "UNDER_REVIEW");

  expect(calls.some(([name, column]) => name === "eq" && column === "coordinator_id")).toBe(false);
});
