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
    approved_rejected_by: "coord-1",
    status: "CONFIRMED",
  });

  expect(calls).toContainEqual(["update", { approved_rejected_by: "coord-1", status: "APPROVED" }]);
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

test("SCRUM-148/149 AC2: cancel writes CANCELLED, restricted to the active stages (including POSTPONED), plus any extra columns", async () => {
  const { calls } = recorder({ id: "evt-1", status: "CANCELLED" });

  const event = await loadRepository().cancel("evt-1", {
    cancelled_by: "coord-1", cancelled_at: "2026-10-08T00:00:00.000Z", cancellation_reason: "Venue flooded",
  }, "coord-1");

  expect(calls).toContainEqual(["from", "events"]);
  expect(calls).toContainEqual(["update", {
    cancelled_by: "coord-1", cancelled_at: "2026-10-08T00:00:00.000Z", cancellation_reason: "Venue flooded", status: "CANCELLED",
  }]);
  expect(calls).toContainEqual(["eq", "id", "evt-1"]);
  expect(calls).toContainEqual(["in", "status", ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "POSTPONED"]]);
  expect(event).toEqual({ id: "evt-1", status: "CANCELLED" });
});

test("SCRUM-148: extra cannot override status to anything but CANCELLED", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().cancel("evt-1", { status: "CONFIRMED" }, "coord-1");

  expect(calls).toContainEqual(["update", { status: "CANCELLED" }]);
});

test("SCRUM-148 AC1, required as of SCRUM-171: the write always requires the given coordinator to still hold the event", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().cancel("evt-1", {}, "coord-1");

  expect(calls).toContainEqual(["eq", "coordinator_id", "coord-1"]);
});

test("SCRUM-148 conflict: zero rows matched (wrong stage or a reassignment race) returns null", async () => {
  recorder(null);

  const event = await loadRepository().cancel("evt-1", {}, "coord-1");

  expect(event).toBeNull();
});

test("SCRUM-148 failure: a Supabase error is thrown with the action named", async () => {
  recorder(null, { message: "boom" });

  await expect(loadRepository().cancel("evt-1", {}, "coord-1")).rejects.toThrow("events.repository: cancel failed - boom");
});

// SCRUM-170: postponing is one postpone_event call; which stages, which
// coordinator and what is released are the function's rules, proven in tests/sql.
test("[TC-SCRUM-170-01] postpone hands the event, the verified coordinator and the reason to postpone_event, always requiring the assignment", async () => {
  const event = { id: "evt-1", status: "POSTPONED" };
  const rpc = vi.fn(() => ({ maybeSingle: async () => ({ data: event, error: null }) }));
  stubSupabase({ rpc });

  expect(await loadRepository().postpone("evt-1", "coord-1", "New date not yet known")).toEqual(event);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("postpone_event", {
    p_event_id: "evt-1", p_actor_id: "coord-1", p_reason: "New date not yet known", p_assigned_only: true,
    p_new_start: null, p_new_end: null, p_moves: [],
  });
});

test("[TC-SCRUM-170-21] with a new date, the dates and the bookings to move are handed to postpone_event", async () => {
  const rpc = vi.fn(() => ({ maybeSingle: async () => ({ data: { id: "evt-1" }, error: null }) }));
  stubSupabase({ rpc });
  const moves = [{ request_id: "req-1", booking_date: "2099-07-08" }];

  await loadRepository().postpone("evt-1", "coord-1", "Roof repairs", { newStart: "2099-07-08T01:00:00.000Z", newEnd: "2099-07-08T09:00:00.000Z", moves });

  expect(rpc).toHaveBeenCalledExactlyOnceWith("postpone_event", {
    p_event_id: "evt-1", p_actor_id: "coord-1", p_reason: "Roof repairs", p_assigned_only: true,
    p_new_start: "2099-07-08T01:00:00.000Z", p_new_end: "2099-07-08T09:00:00.000Z", p_moves: moves,
  });
});

test("[TC-SCRUM-170-06] no row back (wrong stage, already POSTPONED, or not the coordinator) returns null", async () => {
  stubSupabase({ rpc: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) });

  expect(await loadRepository().postpone("evt-1", "coord-1", "x")).toBeNull();
});

test("[TC-SCRUM-170-11] a Supabase error is thrown with the action named", async () => {
  stubSupabase({ rpc: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) });

  await expect(loadRepository().postpone("evt-1", "coord-1", "x")).rejects.toThrow("events.repository: postpone failed - boom");
});

test("SCRUM-141 AC4: recordActivity inserts one event_activity_log row, with the move and note in details", async () => {
  const { calls } = recorder({ id: "act-1" });

  const row = await loadRepository().recordActivity({
    eventId: "evt-1", actorId: "officer-1", action: "SAFETY_REJECTED", fromStatus: "SAFETY_REVIEW", toStatus: "APPROVED", note: "No fire marshal",
  });

  expect(calls).toContainEqual(["from", "event_activity_log"]);
  expect(calls).toContainEqual(["insert", {
    event_id: "evt-1", user_id: "officer-1", action: "SAFETY_REJECTED",
    details: { from_status: "SAFETY_REVIEW", to_status: "APPROVED", note: "No fire marshal" },
  }]);
  expect(calls.some(([name]) => name === "update" || name === "delete")).toBe(false);
  expect(row).toEqual({ id: "act-1" });
});

test("SCRUM-141 AC4: a failed activity insert is thrown with the action named", async () => {
  recorder(null, { message: "relation does not exist" });

  await expect(loadRepository().recordActivity({ eventId: "evt-1", actorId: "officer-1", action: "SAFETY_APPROVED" }))
    .rejects.toThrow("recordActivity failed - relation does not exist");
});

test("SCRUM-141 AC4: undoTransition restores the old status only where the event still holds the new one", async () => {
  const { calls } = recorder({ id: "evt-1" });

  await loadRepository().undoTransition("evt-1", "SAFETY_REVIEW", "PREPARATION");

  expect(calls).toContainEqual(["from", "events"]);
  expect(calls).toContainEqual(["update", { status: "SAFETY_REVIEW" }]);
  expect(calls).toContainEqual(["eq", "id", "evt-1"]);
  expect(calls).toContainEqual(["eq", "status", "PREPARATION"]);
});
