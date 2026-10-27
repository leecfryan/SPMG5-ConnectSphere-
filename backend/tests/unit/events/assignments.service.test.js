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

function build({ assignments = [], coordinators = COORDINATORS, assigned = { id: "evt-1" }, existing = null, queue = [], organiserNames = {} } = {}) {
  const repository = {
    findSubmittedUnassigned: vi.fn().mockResolvedValue(queue),
    findActiveAssignments: vi.fn().mockResolvedValue(assignments),
    assignCoordinator: vi.fn().mockResolvedValue(assigned),
    findById: vi.fn().mockResolvedValue(existing),
  };
  const directory = {
    listCoordinators: vi.fn().mockResolvedValue(coordinators),
    displayNameOf: vi.fn(async (id) => organiserNames[id] ?? null),
  };
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

  const actor = { id: "verified-lead", fullName: "Coordinator Lead" };
  const result = await service.assign("evt-1", "coord-1", actor);

  expect(result).toEqual({ ok: true, event: { id: "evt-1", coordinator_id: "coord-1", status: "SUBMITTED" } });
  expect(repository.assignCoordinator).toHaveBeenCalledWith("evt-1", "coord-1", actor);
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

test("[SCRUM-159] AC2: each queued request carries its organiser's name instead of the organiser's account id", async () => {
  const { service } = build({
    queue: [{ id: "evt-1", name: "Digital Literacy for Seniors", organiser_id: "org-1", expected_attendance: 30 }],
    organiserNames: { "org-1": "Olivia Ong" },
  });

  expect(await service.listQueue()).toEqual({ ok: true, events: [
    { id: "evt-1", name: "Digital Literacy for Seniors", expected_attendance: 30, organiser_name: "Olivia Ong" },
  ] });
});

test("[SCRUM-159] AC2: an organiser with several queued requests is looked up once", async () => {
  const { service, directory } = build({
    queue: [{ id: "evt-1", organiser_id: "org-1" }, { id: "evt-2", organiser_id: "org-1" }, { id: "evt-3", organiser_id: "org-2" }],
    organiserNames: { "org-1": "Olivia Ong", "org-2": "Peter Pan" },
  });

  const { events } = await service.listQueue();

  expect(events.map((event) => event.organiser_name)).toEqual(["Olivia Ong", "Olivia Ong", "Peter Pan"]);
  expect(directory.displayNameOf.mock.calls).toEqual([["org-1"], ["org-2"]]);
});

test("[SCRUM-159] AC2: a request without an organiser, or whose organiser cannot be named, stays in the queue", async () => {
  const { service, directory } = build({
    queue: [{ id: "evt-1", organiser_id: null }, { id: "evt-2", organiser_id: "org-gone" }],
  });

  const { events } = await service.listQueue();

  expect(events).toEqual([{ id: "evt-1", organiser_name: null }, { id: "evt-2", organiser_name: null }]);
  expect(directory.displayNameOf.mock.calls).toEqual([["org-gone"]]);
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
  stubSupabase({
    from: (table) => { calls.push(["from", table]); return chain; },
    rpc: (name, args) => { calls.push(["rpc", name, args]); return chain; },
  });
  return { calls, chain };
}

beforeEach(() => { vi.resetModules(); });

test("SCRUM-26 / SCRUM-155: assignCoordinator sends first-assignment guards and verified actor to history storage", async () => {
  const { calls } = recorder({ id: "evt-1", coordinator_id: "coord-1", status: "SUBMITTED" });
  const repository = require("../../../src/modules/events/events.repository");
  const actor = { id: "verified-lead", fullName: "Coordinator Lead" };

  const event = await repository.assignCoordinator("evt-1", "coord-1", actor);

  // SCRUM-155: the RPC now owns the submitted/unassigned guard; no lifecycle transition is requested.
  expect(calls).toEqual([["rpc", "assign_event_coordinator", {
    p_event_id: "evt-1",
    p_coordinator_id: "coord-1",
    p_expected_coordinator_id: null,
    p_allowed_statuses: ["SUBMITTED"],
    p_actor_id: "verified-lead",
    p_actor_name: "Coordinator Lead",
  }]]);
  expect(event).toEqual({ id: "evt-1", coordinator_id: "coord-1", status: "SUBMITTED" });
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

test("[SCRUM-159] AC2: the queue reads an explicit column list with the fields the Lead sees, never every column", async () => {
  const { calls } = recorder([]);
  const repository = require("../../../src/modules/events/events.repository");

  await repository.findSubmittedUnassigned();

  const [, columns] = calls.find(([name]) => name === "select");
  expect(columns).not.toContain("*");
  expect(columns.split(", ")).toEqual(expect.arrayContaining(
    ["id", "name", "organiser_id", "start_time", "end_time", "expected_attendance"]));
});

test("[TC-149-16] SCRUM-26/149: workload counts read only assigned events in an active status (postponed included)", async () => {
  const { calls } = recorder([]);
  const repository = require("../../../src/modules/events/events.repository");

  await repository.findActiveAssignments();

  expect(calls).toContainEqual(["select", "coordinator_id, start_time"]);
  expect(calls).toContainEqual(["in", "status", ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "POSTPONED"]]);
  expect(calls).toContainEqual(["not", "coordinator_id", "is", null]);
});
