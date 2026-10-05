import { createRequire } from "node:module";
import { expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createEventWorkspaceService } = require("../../../src/modules/events/eventWorkspace.service");
const storage = require("../../../../tests/playwright/support/registration-storage.cjs");

function setup() {
  const users = [
    { id: "alice", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "bob", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "cara", app_metadata: { roles: ["event_organiser"], organisation_id: "beta" }, user_metadata: {} },
  ];
  const records = users.map((user, index) => ({
    id: "event-" + user.id, organiser_id: user.id, name: user.id + " workshop",
    purpose: "Training", description: "Client workshop", expected_attendance: 20,
    start_time: "2099-01-01T01:00:12.345Z", end_time: "2099-01-01T03:00:12.345Z",
    status: "APPROVED", coordinator_id: "coordinator-one", other_comments: "Private requirements",
    submitted_at: "2026-01-0" + (index + 1) + "T00:00:00Z",
  }));
  const client = storage(new Map([["fixture", { events: records }]]));
  client.auth = { admin: {
    getUserById: vi.fn(async id => ({ data: { user: users.find(user => user.id === id) }, error: null })),
    listUsers: vi.fn(async () => ({ data: { users }, error: null })),
  } };
  const updates = vi.fn();
  const from = client.from.bind(client);
  client.from = vi.fn(table => {
    const query = from(table);
    const update = query.update;
    query.update = fields => { updates(fields); return update(fields); };
    return query;
  });
  return { service: createEventWorkspaceService(client), client, users, records, updates };
}

test("[SCRUM-100-UNIT-001] Organiser reads own and colleague records but no unrelated client record", async () => {
  const { service } = setup();
  const visible = await service.list("organiser", "alice");
  expect(visible.map(event => event.id).sort()).toEqual(["event-alice", "event-bob"]);
  expect(await service.find("organiser", "alice", "event-bob")).toMatchObject({ organiser_id: "bob" });
  expect(await service.find("organiser", "alice", "event-cara")).toBeNull();
});

test("[SCRUM-100-UNIT-002] Owner saves normalised partial details while protected and untouched fields persist", async () => {
  const { service, records, updates } = setup();
  const before = structuredClone(records);
  const result = await service.updateOrganiserEvent("alice", "event-alice", {
    name: "  Revised workshop  ", expected_attendance: "1", other_comments: "  ",
  });
  expect(result.ok).toBe(true);
  expect(result.event).toMatchObject({ ...before[0], name: "Revised workshop", expected_attendance: 1, other_comments: null });
  expect(records[0]).toMatchObject({ ...before[0], name: "Revised workshop", expected_attendance: 1, other_comments: null });
  expect(records.slice(1)).toEqual(before.slice(1));
  expect(updates).toHaveBeenCalledExactlyOnceWith({ name: "Revised workshop", expected_attendance: 1, other_comments: null });
});

test("[SCRUM-100-UNIT-003] Visible peer and invisible outsider edits are refused before any write", async () => {
  const { service, records, updates } = setup();
  const before = structuredClone(records);
  expect(await service.updateOrganiserEvent("alice", "event-bob", { name: "Denied" })).toEqual({ ok: false, reason: "forbidden" });
  expect(await service.updateOrganiserEvent("alice", "event-cara", { name: "Denied" })).toEqual({ ok: false, reason: "not_found" });
  expect(await service.updateOrganiserEvent("alice", "missing", { name: "Denied" })).toEqual({ ok: false, reason: "not_found" });
  expect(updates).not.toHaveBeenCalled();
  expect(records).toEqual(before);
});

test("[SCRUM-100-UNIT-004] Invalid or protected detail changes cannot partly mutate the event", async () => {
  const { service, records, updates } = setup();
  const before = structuredClone(records);
  for (const input of [null, [], {}, { name: "Changed", organiser_id: "bob" },
    { name: "Changed", status: "CONFIRMED" }, { organisation_id: "beta" },
    { name: " " }, { expected_attendance: "invalid" }, { start_time: "invalid" }]) {
    const result = await service.updateOrganiserEvent("alice", "event-alice", input);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(records).toEqual(before);
  }
  expect(updates).not.toHaveBeenCalled();
});

test("[SCRUM-100-UNIT-005] Missing trusted membership ignores profile claims and retains own read and edit access", async () => {
  const { service, client, users, records } = setup();
  delete users[0].app_metadata.organisation_id;
  users[0].user_metadata.organisation_id = "alpha";
  expect((await service.list("organiser", "alice")).map(event => event.id)).toEqual(["event-alice"]);
  expect(await service.find("organiser", "alice", "event-bob")).toBeNull();
  expect((await service.updateOrganiserEvent("alice", "event-alice", { name: "Own correction" })).ok).toBe(true);
  expect(records[0].name).toBe("Own correction");
  expect(client.auth.admin.listUsers).not.toHaveBeenCalled();
});

test("[SCRUM-100-UNIT-006] Membership, directory or record-read failure propagates before any event write", async () => {
  for (const stage of ["membership", "directory", "record"]) {
    const { service, client, records, updates } = setup();
    const before = structuredClone(records);
    const error = new Error("Simulated boundary failure");
    if (stage === "membership") client.auth.admin.getUserById.mockResolvedValue({ data: null, error });
    if (stage === "directory") client.auth.admin.listUsers.mockResolvedValue({ data: null, error });
    if (stage === "record") {
      const from = client.from.getMockImplementation();
      client.from.mockImplementation(table => {
        const query = from(table);
        query.maybeSingle = () => Promise.resolve({ data: null, error });
        return query;
      });
    }
    await expect(service.updateOrganiserEvent("alice", "event-alice", { name: "Must not save" })).rejects.toBe(error);
    expect(updates).not.toHaveBeenCalled();
    expect(records).toEqual(before);
  }
});

test("[SCRUM-100-UNIT-007] Changed responsibility prevents the previous owner from saving stale edits", async () => {
  const { service, client, records } = setup();
  const before = structuredClone(records);
  const from = client.from.getMockImplementation();
  client.from.mockImplementation(table => {
    const query = from(table);
    const update = query.update;
    query.update = fields => { records[0].organiser_id = "bob"; return update(fields); };
    return query;
  });
  expect(await service.updateOrganiserEvent("alice", "event-alice", { name: "Stale change" })).toEqual({ ok: false, reason: "conflict" });
  expect(records).toEqual([{ ...before[0], organiser_id: "bob" }, ...before.slice(1)]);
});

test("[SCRUM-100-UNIT-008] Current trusted affiliation replaces old colleague access on the next lookup", async () => {
  const { service, users } = setup();
  expect(await service.find("organiser", "alice", "event-bob")).not.toBeNull();
  users[0].app_metadata.organisation_id = "beta";
  expect(await service.find("organiser", "alice", "event-bob")).toBeNull();
  expect((await service.list("organiser", "alice")).map(event => event.id).sort()).toEqual(["event-alice", "event-cara"]);
});
