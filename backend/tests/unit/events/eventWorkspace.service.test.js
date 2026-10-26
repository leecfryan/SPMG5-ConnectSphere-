import { createRequire } from "node:module";
import { expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createEventWorkspaceService } = require("../../../src/modules/events/eventWorkspace.service");
const storage = require("../../../../tests/playwright/support/registration-storage.cjs");

function setup({ equipmentService = { flagReservationsForReview: vi.fn(async () => ({ flagged: [] })) } } = {}) {
  const users = [
    { id: "alice", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "bob", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "cara", app_metadata: { roles: ["event_organiser"], organisation_id: "beta" }, user_metadata: {} },
  ];
  const records = users.map((user, index) => ({
    id: "event-" + user.id, organiser_id: user.id, name: user.id + " workshop",
    purpose: "Training", description: "Client workshop", expected_attendance: 20,
    start_time: "2099-01-01T01:00:12.345Z", end_time: "2099-01-01T03:00:12.345Z",
    // SCRUM-164: edits are only allowed at SUBMITTED; fixtures updated accordingly.
    status: "SUBMITTED", coordinator_id: null, other_comments: "Private requirements",
    equipment_needs: "Projector and a lectern",
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
  return { service: createEventWorkspaceService(client, equipmentService), client, users, records, updates, equipmentService };
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
    name: "  Revised workshop  ", expected_attendance: "1", other_comments: "  ", reason: "Fixing workshop name",
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
  expect((await service.updateOrganiserEvent("alice", "event-alice", { name: "Own correction", reason: "Fixing name" })).ok).toBe(true);
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
  expect(await service.updateOrganiserEvent("alice", "event-alice", { name: "Stale change", reason: "Correction" })).toEqual({ ok: false, reason: "conflict" });
  expect(records).toEqual([{ ...before[0], organiser_id: "bob" }, ...before.slice(1)]);
});

test("[SCRUM-100-UNIT-008] Current trusted affiliation replaces old colleague access on the next lookup", async () => {
  const { service, users } = setup();
  expect(await service.find("organiser", "alice", "event-bob")).not.toBeNull();
  users[0].app_metadata.organisation_id = "beta";
  expect(await service.find("organiser", "alice", "event-bob")).toBeNull();
  expect((await service.list("organiser", "alice")).map(event => event.id).sort()).toEqual(["event-alice", "event-cara"]);
});

// SCRUM-150 AC1/AC3: the diff-detection half of the reschedule-review flag -
// equipmentService.flagReservationsForReview itself is proven directly in
// tests/unit/equipment-flag-review.test.js. These tests only prove *when*
// updateOrganiserEvent decides to call it, and with what.
test("[TC-150-01] changing start_time flags equipment, with the new window and datesChanged true", async () => {
  const { service, equipmentService } = setup();
  // Still before the fixture's unchanged end_time (2099-01-01T03:00:12.345Z) -
  // only start_time moves, so the write itself stays valid.
  const result = await service.updateOrganiserEvent("alice", "event-alice", { start_time: "2099-01-01T00:30:00.000Z", reason: "Rescheduled" });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).toHaveBeenCalledExactlyOnceWith("event-alice", {
    startTime: "2099-01-01T00:30:00.000Z",
    endTime: "2099-01-01T03:00:12.345Z",
    datesChanged: true,
  });
});

test("[TC-150-02] changing only equipment_needs flags equipment with datesChanged false", async () => {
  const { service, equipmentService } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { equipment_needs: "Also a whiteboard", reason: "Need extra equipment" });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).toHaveBeenCalledExactlyOnceWith("event-alice", expect.objectContaining({ datesChanged: false }));
});

test("[TC-150-03] resubmitting the same start_time/end_time/equipment_needs values is a no-op - no flagging call", async () => {
  const { service, records, equipmentService } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", {
    start_time: records[0].start_time,
    end_time: records[0].end_time,
    equipment_needs: records[0].equipment_needs,
    reason: "No real change",
  });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).not.toHaveBeenCalled();
});

test("[TC-150-22] a change unrelated to date/time/equipment needs (name) does not flag equipment", async () => {
  const { service, equipmentService } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "Renamed only", reason: "Clearer name" });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).not.toHaveBeenCalled();
});

test("[SCRUM-141 AC4] The event detail carries its own activity history, newest first, without naming the officer (no user_id)", async () => {
  const { service, client } = setup();
  client.activity.push(
    // Stored in the live event_activity_log shape: user_id, and the move and note in details.
    { id: "act-1", event_id: "event-alice", user_id: "officer-1", action: "SAFETY_REJECTED", details: { from_status: "SAFETY_REVIEW", to_status: "APPROVED", note: "One exit only" }, created_at: "2026-10-18T01:00:00.000Z" },
    { id: "act-2", event_id: "event-bob", user_id: "officer-1", action: "SAFETY_APPROVED", details: { from_status: "SAFETY_REVIEW", to_status: "PREPARATION", note: null }, created_at: "2026-10-18T02:00:00.000Z" },
    { id: "act-3", event_id: "event-alice", user_id: "officer-2", action: "SAFETY_APPROVED", details: { from_status: "SAFETY_REVIEW", to_status: "PREPARATION", note: null }, created_at: "2026-10-18T03:00:00.000Z" },
  );

  const event = await service.find("organiser", "alice", "event-alice");

  expect(event.activity).toEqual([
    { id: "act-3", action: "SAFETY_APPROVED", from_status: "SAFETY_REVIEW", to_status: "PREPARATION", note: null, created_at: "2026-10-18T03:00:00.000Z" },
    { id: "act-1", action: "SAFETY_REJECTED", from_status: "SAFETY_REVIEW", to_status: "APPROVED", note: "One exit only", created_at: "2026-10-18T01:00:00.000Z" },
  ]);
});

// details defaults to {} in the live table, so a row written without it still reads.
test("[SCRUM-141 AC4] A history row with empty details reads with null move and note", async () => {
  const { service, client } = setup();
  client.activity.push({ id: "act-9", event_id: "event-alice", user_id: null, action: "SOMETHING_NEW", details: {}, created_at: "2026-10-18T04:00:00.000Z" });

  expect((await service.find("organiser", "alice", "event-alice")).activity).toEqual([
    { id: "act-9", action: "SOMETHING_NEW", from_status: null, to_status: null, note: null, created_at: "2026-10-18T04:00:00.000Z" },
  ]);
});

test("[SCRUM-141 AC4] An event with no recorded activity has an empty history", async () => {
  const { service } = setup();
  expect((await service.find("organiser", "alice", "event-alice")).activity).toEqual([]);
});

test("[SCRUM-141 AC4] A failed history read still loads the event, with the history unknown", async () => {
  const { service, client } = setup();
  const from = client.from;
  client.from = table => table === "event_activity_log"
    ? { select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) }
    : from(table);

  const event = await service.find("organiser", "alice", "event-alice");

  expect(event).toMatchObject({ id: "event-alice", activity: null });
});

// SCRUM-164: status guard, reason requirement and activity log writing.

test("[TC-SCRUM-164-01] organiser saves valid changes to their own SUBMITTED event; activity is recorded", async () => {
  const { service, records, client } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "New title", reason: "Client requested rename" });
  expect(result.ok).toBe(true);
  expect(records[0].name).toBe("New title");
  expect(client.activity).toHaveLength(1);
  expect(client.activity[0]).toMatchObject({ event_id: "event-alice", user_id: "alice", action: "EDIT" });
  expect(client.activity[0].details).toMatchObject({ note: "Client requested rename" });
});

test("[TC-SCRUM-164-02] update is refused when event has moved past SUBMITTED", async () => {
  const { service, records, updates } = setup();
  records[0].status = "UNDER_REVIEW";
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "Denied", reason: "any reason" });
  expect(result).toEqual({ ok: false, reason: "locked" });
  expect(updates).not.toHaveBeenCalled();
});

test.each(["APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "CANCELLED", "REJECTED", "POSTPONED"])(
  "[TC-SCRUM-164-03] update is refused for every non-SUBMITTED status (%s)",
  async (status) => {
    const { service, records, updates } = setup();
    records[0].status = status;
    expect(await service.updateOrganiserEvent("alice", "event-alice", { name: "Any", reason: "any" }))
      .toEqual({ ok: false, reason: "locked" });
    expect(updates).not.toHaveBeenCalled();
  },
);

test("[TC-SCRUM-164-16] race: coordinator starts review between status check and write; edit is rejected", async () => {
  const { service, client, records } = setup();
  const from = client.from.getMockImplementation();
  client.from.mockImplementation(table => {
    const query = from(table);
    if (table === "events") {
      const update = query.update;
      query.update = fields => { records[0].status = "UNDER_REVIEW"; return update(fields); };
    }
    return query;
  });
  expect(await service.updateOrganiserEvent("alice", "event-alice", { name: "Too late", reason: "Race" }))
    .toEqual({ ok: false, reason: "conflict" });
});

test("[TC-SCRUM-164-04] update without a reason is a 400", async () => {
  const { service, updates } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "No reason" });
  expect(result).toMatchObject({ ok: false, reason: "invalid" });
  expect(result.errors.some(e => e.field === "reason")).toBe(true);
  expect(updates).not.toHaveBeenCalled();
});

test.each([{ name: "Valid", reason: "" }, { name: "Valid", reason: "   " }, { name: "Valid", reason: null }])(
  "[TC-SCRUM-164-05] a whitespace-only or empty reason is treated as blank (%j)",
  async (input) => {
    const { service, updates } = setup();
    const result = await service.updateOrganiserEvent("alice", "event-alice", input);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(result.errors.some(e => e.field === "reason")).toBe(true);
    expect(updates).not.toHaveBeenCalled();
  },
);

test("[TC-SCRUM-164-06] the activity log row carries actor, action and trimmed reason", async () => {
  const { service, client } = setup();
  await service.updateOrganiserEvent("alice", "event-alice", { name: "Updated", reason: "  fix typo  " });
  expect(client.activity[0]).toMatchObject({
    event_id: "event-alice",
    user_id: "alice",
    action: "EDIT",
    details: { note: "fix typo" },
  });
});


test("[SCRUM-147-UNIT-013] AC4: drafts stay out of the organisation view, a colleague's and the owner's alike", async () => {
  const { service, records } = setup();
  records.push(
    { ...records[0], id: "draft-alice", name: "Alice draft", status: "DRAFT" },
    { ...records[1], id: "draft-bob", name: "Bob draft", status: "DRAFT" },
  );

  expect((await service.list("organiser", "alice")).map(event => event.id).sort()).toEqual(["event-alice", "event-bob"]);
  expect(await service.find("organiser", "alice", "draft-bob")).toBeNull();
  expect(await service.find("organiser", "alice", "draft-alice")).toBeNull();
  expect(await service.updateOrganiserEvent("alice", "draft-alice", { name: "Renamed" })).toEqual({ ok: false, reason: "not_found" });
});
