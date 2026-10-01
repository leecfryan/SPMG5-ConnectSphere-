// SCRUM-26 unit layer: the workload join, the checks that run before a write,
// and the repository filters that make first-assignment-only true in the
// database rather than only in the UI.
//
// Test names lead with the Jira key so the verbose reporter's output is the
// traceability record docs/event-request-tests.md cites. Map these onto
// SCRUM-52/53/54/55 when the acceptance criteria are confirmed on the board.

import { test, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");
const { createAssignmentsService } = require("../../../src/modules/events/assignments.service");

const COORDINATORS = [
  { id: "coord-1", fullName: "Ada Tan", email: "ada@example.com" },
  { id: "coord-2", fullName: "Ben Lim", email: "ben@example.com" },
  { id: "coord-3", fullName: "Cara Ng", email: "cara@example.com" },
];

function build({ assignments = [], coordinators = COORDINATORS, assigned = { id: "evt-1" }, existing = null } = {}) {
  const repository = {
    findSubmittedUnassigned: vi.fn().mockResolvedValue([]),
    findActiveAssignments: vi.fn().mockResolvedValue(assignments),
    assignCoordinator: vi.fn().mockResolvedValue(assigned),
    findById: vi.fn().mockResolvedValue(existing),
  };
  const directory = { listCoordinators: vi.fn().mockResolvedValue(coordinators) };
  return { service: createAssignmentsService({ repository, directory }), repository, directory };
}

test("SCRUM-26: the coordinator table counts active events and keeps coordinators with none", async () => {
  const { service } = build({ assignments: [
    { coordinator_id: "coord-1", start_time: "2026-11-15T09:00:00+00:00" },
    { coordinator_id: "coord-1", start_time: "2026-10-20T13:00:00+00:00" },
    { coordinator_id: "coord-2", start_time: "2026-12-05T18:00:00+00:00" },
  ] });

  const { coordinators } = await service.listCoordinators();

  expect(coordinators.map((c) => [c.id, c.activeEvents])).toEqual([
    ["coord-1", 2], ["coord-2", 1], ["coord-3", 0],
  ]);
  // The earliest of the two, not the first row returned.
  expect(coordinators[0].nextEventStart).toBe("2026-10-20T13:00:00.000Z");
  // An idle coordinator is the row the manager most wants to see.
  expect(coordinators[2].nextEventStart).toBeNull();
});

test("SCRUM-26: a coordinator's next event is the earliest instant, not the lowest string", async () => {
  // Same moment, different offsets. Compared as text, +08:00 sorts before
  // +00:00 and the later event would win.
  const { service } = build({ assignments: [
    { coordinator_id: "coord-1", start_time: "2026-11-15T09:00:00+00:00" },
    { coordinator_id: "coord-1", start_time: "2026-11-15T10:00:00+08:00" },
  ] });

  const [ada] = (await service.listCoordinators()).coordinators;
  expect(ada.nextEventStart).toBe("2026-11-15T02:00:00.000Z");
});

test("SCRUM-26: unparseable and orphaned assignment rows do not corrupt the counts", async () => {
  const { service } = build({ assignments: [
    { coordinator_id: null, start_time: "2026-11-15T09:00:00+00:00" },
    { coordinator_id: "coord-1", start_time: null },
    { coordinator_id: "coord-1", start_time: "not a date" },
  ] });

  const [ada] = (await service.listCoordinators()).coordinators;
  expect(ada.activeEvents).toBe(2);
  expect(ada.nextEventStart).toBeNull();
});

test("SCRUM-26: a coordinator id that is not in the directory is never written", async () => {
  const { service, repository } = build();

  expect(await service.assign("evt-1", "not-a-coordinator")).toEqual({ ok: false, reason: "unknown_coordinator" });
  // events.coordinator_id has no foreign key, so this check is the only thing
  // standing between the browser and an unverifiable row.
  expect(repository.assignCoordinator).not.toHaveBeenCalled();
});

test.each([[undefined], [null], [""], ["   "], [42], [{ id: "coord-1" }]])(
  "SCRUM-26: a missing or malformed coordinator id is rejected before any lookup (%s)", async (value) => {
    const { service, repository, directory } = build();

    expect(await service.assign("evt-1", value)).toEqual({ ok: false, reason: "invalid_coordinator" });
    expect(directory.listCoordinators).not.toHaveBeenCalled();
    expect(repository.assignCoordinator).not.toHaveBeenCalled();
  });

test("SCRUM-26: a guarded write that matches nothing is a conflict when the event still exists", async () => {
  const { service } = build({ assigned: null, existing: { id: "evt-1", coordinator_id: "coord-2" } });
  expect(await service.assign("evt-1", "coord-1")).toEqual({ ok: false, reason: "conflict" });
});

test("SCRUM-26: a guarded write that matches nothing is a 404 when the event does not exist", async () => {
  const { service } = build({ assigned: null, existing: null });
  expect(await service.assign("missing", "coord-1")).toEqual({ ok: false, reason: "not_found" });
});

test("SCRUM-26: a successful assignment returns the updated event", async () => {
  const { service, repository } = build({ assigned: { id: "evt-1", coordinator_id: "coord-1", status: "SUBMITTED" } });

  const result = await service.assign("evt-1", "coord-1");

  expect(result).toEqual({ ok: true, event: { id: "evt-1", coordinator_id: "coord-1", status: "SUBMITTED" } });
  expect(repository.assignCoordinator).toHaveBeenCalledWith("evt-1", "coord-1");
});

// Empty is a real state, not a placeholder: on a fresh environment nobody has
// been given the coordinator role yet, and the queue empties every time the
// manager finishes routing. Both are reached through the normal path.
test("SCRUM-26: an empty directory is an empty coordinator table, not a failure", async () => {
  const { service, repository } = build({ coordinators: [] });

  expect(await service.listCoordinators()).toEqual({ ok: true, coordinators: [] });
  // The workload join still runs; there is simply nothing to join onto.
  expect(repository.findActiveAssignments).toHaveBeenCalledTimes(1);
});

test("SCRUM-26: with no coordinators at all, every assignment is refused before the write", async () => {
  const { service, repository } = build({ coordinators: [] });

  expect(await service.assign("evt-1", "coord-1")).toEqual({ ok: false, reason: "unknown_coordinator" });
  expect(repository.assignCoordinator).not.toHaveBeenCalled();
});

test("SCRUM-26: a fully routed queue is an empty list, not a missing one", async () => {
  const { service } = build();

  expect(await service.listQueue()).toEqual({ ok: true, events: [] });
});

// --- repository query construction -------------------------------------------------
// The guard that makes "first assignment only" real. Asserted here because it
// lives in the database filters, where no service-level test can see it.

function recorder(result) {
  const calls = [];
  const settled = { data: result, error: null };
  // Every builder method records its arguments and returns the chain. The
  // chain is itself thenable because PostgREST queries that do not end in
  // maybeSingle()/single() are awaited directly.
  const chain = new Proxy({}, { get: (_target, name) => {
    if (name === "then") return (resolve, reject) => Promise.resolve(settled).then(resolve, reject);
    if (name === "maybeSingle" || name === "single") return async () => settled;
    return (...args) => { calls.push([name, ...args]); return chain; };
  } });
  stubSupabase({ from: (table) => { calls.push(["from", table]); return chain; } });
  return { calls, chain };
}

beforeEach(() => { vi.resetModules(); });

test("SCRUM-26: assignCoordinator writes only coordinator_id, and only to a submitted, unassigned event", async () => {
  const { calls } = recorder({ id: "evt-1", coordinator_id: "coord-1" });
  const repository = require("../../../src/modules/events/events.repository");

  await repository.assignCoordinator("evt-1", "coord-1");

  // Clarification #1: no acceptance step, so assignment does not move status.
  expect(calls).toContainEqual(["update", { coordinator_id: "coord-1" }]);
  expect(calls.find(([name]) => name === "update")[1]).not.toHaveProperty("status");
  expect(calls).toContainEqual(["eq", "id", "evt-1"]);
  expect(calls).toContainEqual(["eq", "status", "SUBMITTED"]);
  // Re-assignment is US-50. Until that story exists, the database refuses it.
  expect(calls).toContainEqual(["is", "coordinator_id", null]);
});

test("SCRUM-26: the queue is submitted, unassigned, oldest first, with a created_at tiebreak", async () => {
  const { calls } = recorder([]);
  const repository = require("../../../src/modules/events/events.repository");

  await repository.findSubmittedUnassigned();

  expect(calls).toContainEqual(["eq", "status", "SUBMITTED"]);
  expect(calls).toContainEqual(["is", "coordinator_id", null]);
  // Seeded rows carry a null submitted_at; without the tiebreak they sort
  // arbitrarily against real submissions.
  expect(calls).toContainEqual(["order", "submitted_at", { ascending: true, nullsFirst: false }]);
  expect(calls).toContainEqual(["order", "created_at", { ascending: true }]);
});

test("SCRUM-26: workload counts read only assigned events in an active status", async () => {
  const { calls } = recorder([]);
  const repository = require("../../../src/modules/events/events.repository");

  await repository.findActiveAssignments();

  expect(calls).toContainEqual(["select", "coordinator_id, start_time"]);
  expect(calls).toContainEqual(["in", "status", ["SUBMITTED", "ACCEPTED", "APPROVED"]]);
  expect(calls).toContainEqual(["not", "coordinator_id", "is", null]);
});
