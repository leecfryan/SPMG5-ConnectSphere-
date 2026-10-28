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
    status: "APPROVED", coordinator_id: "coordinator-one", other_comments: "Private requirements",
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

// SCRUM-150 AC1/AC3: the diff-detection half of the reschedule-review flag -
// equipmentService.flagReservationsForReview itself is proven directly in
// tests/unit/equipment-flag-review.test.js. These tests only prove *when*
// updateOrganiserEvent decides to call it, and with what.
test("[TC-150-01] changing start_time flags equipment, with the new window and datesChanged true", async () => {
  const { service, equipmentService } = setup();
  // Still before the fixture's unchanged end_time (2099-01-01T03:00:12.345Z) -
  // only start_time moves, so the write itself stays valid.
  const result = await service.updateOrganiserEvent("alice", "event-alice", { start_time: "2099-01-01T00:30:00.000Z" });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).toHaveBeenCalledExactlyOnceWith("event-alice", {
    startTime: "2099-01-01T00:30:00.000Z",
    endTime: "2099-01-01T03:00:12.345Z",
    datesChanged: true,
  });
});

test("[TC-150-02] changing only equipment_needs flags equipment with datesChanged false", async () => {
  const { service, equipmentService } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { equipment_needs: "Also a whiteboard" });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).toHaveBeenCalledExactlyOnceWith("event-alice", expect.objectContaining({ datesChanged: false }));
});

test("[TC-150-03] resubmitting the same start_time/end_time/equipment_needs values is a no-op - no flagging call", async () => {
  const { service, records, equipmentService } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", {
    start_time: records[0].start_time,
    end_time: records[0].end_time,
    equipment_needs: records[0].equipment_needs,
  });
  expect(result.ok).toBe(true);
  expect(equipmentService.flagReservationsForReview).not.toHaveBeenCalled();
});

test("[TC-150-22] a change unrelated to date/time/equipment needs (name) does not flag equipment", async () => {
  const { service, equipmentService } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "Renamed only" });
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

// SCRUM-36: submitChangeRequest unit tests
function setup36() {
  const users = [
    { id: "alice", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "bob",   app_metadata: { roles: ["event_organiser"], organisation_id: "beta"  }, user_metadata: {} },
  ];
  const records = [
    { id: "event-under-review", organiser_id: "alice", name: "Annual Gala",
      purpose: "Celebration", description: "Year-end gala",
      start_time: "2099-06-01T10:00:00.000Z", end_time: "2099-06-01T18:00:00.000Z",
      registration_start: null, registration_end: null,
      expected_attendance: 100, venue_requirements: "Ballroom",
      accessibility_needs: null, equipment_needs: null, other_comments: null,
      status: "UNDER_REVIEW", coordinator_id: "coord-1", submitted_at: "2026-01-01T00:00:00Z",
      pending_change_request: null },
    { id: "event-approved", organiser_id: "alice", name: "Tech Summit",
      purpose: "Networking", description: "Annual tech summit",
      start_time: "2099-07-01T09:00:00.000Z", end_time: "2099-07-01T17:00:00.000Z",
      registration_start: null, registration_end: null,
      expected_attendance: 200, venue_requirements: "Conference hall",
      accessibility_needs: null, equipment_needs: null, other_comments: null,
      status: "APPROVED", coordinator_id: "coord-1", submitted_at: "2026-01-02T00:00:00Z",
      pending_change_request: null },
    { id: "event-bob", organiser_id: "bob", name: "Bob event",
      purpose: "Demo", description: "Bob demo",
      start_time: "2099-08-01T10:00:00.000Z", end_time: "2099-08-01T18:00:00.000Z",
      registration_start: null, registration_end: null,
      expected_attendance: 50, venue_requirements: null,
      accessibility_needs: null, equipment_needs: null, other_comments: null,
      status: "UNDER_REVIEW", coordinator_id: "coord-2", submitted_at: "2026-01-03T00:00:00Z",
      pending_change_request: null },
  ];
  const client = storage(new Map([["fixture", { events: records }]]));
  client.auth = { admin: {
    getUserById: vi.fn(async id => ({ data: { user: users.find(u => u.id === id) }, error: null })),
    listUsers: vi.fn(async () => ({ data: { users }, error: null })),
  } };
  const service = createEventWorkspaceService(client);
  return { service, records, client };
}

test("[TC-SCRUM-36-01] organiser submits a valid change request on their UNDER_REVIEW event", async () => {
  const { service, records } = setup36();
  const before = structuredClone(records[0]);
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { name: "Revised Gala" },
    reason: "Venue branding updated",
  });
  expect(result.ok).toBe(true);
  expect(result.event.pending_change_request).toMatchObject({
    proposed_changes: { name: "Revised Gala" },
    reason: "Venue branding updated",
    requested_by: "alice",
  });
  expect(result.event.pending_change_request.requested_at).toBeTruthy();
  // event's own fields are unchanged
  expect(result.event.name).toBe(before.name);
  expect(result.event.expected_attendance).toBe(before.expected_attendance);
});

test("[TC-SCRUM-36-02] change request by a non-owner organiser returns not_found", async () => {
  const { service, records } = setup36();
  const before = structuredClone(records);
  const result = await service.submitChangeRequest("bob", "event-under-review", {
    proposed_changes: { name: "Hijack" }, reason: "Testing",
  });
  expect(result).toEqual({ ok: false, reason: "not_found" });
  expect(records).toEqual(before);
});

test("[TC-SCRUM-36-03] change request refused when event is SUBMITTED", async () => {
  const { service, records } = setup36();
  records[0].status = "SUBMITTED";
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { name: "New name" }, reason: "Just checking",
  });
  expect(result).toEqual({ ok: false, reason: "ineligible" });
});

test("[TC-SCRUM-36-04] change request accepted for both eligible statuses", async () => {
  const { service } = setup36();
  for (const id of ["event-under-review", "event-approved"]) {
    const result = await service.submitChangeRequest("alice", id, {
      proposed_changes: { name: "Updated name" }, reason: "Rebranding",
    });
    expect(result.ok, id).toBe(true);
  }
});

test.each(["SUBMITTED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "CANCELLED", "REJECTED", "POSTPONED"])(
  "[TC-SCRUM-36-05] change request refused for ineligible status %s",
  async (status) => {
    const { service, records } = setup36();
    records[0].status = status;
    const result = await service.submitChangeRequest("alice", "event-under-review", {
      proposed_changes: { name: "New name" }, reason: "Testing",
    });
    expect(result).toEqual({ ok: false, reason: "ineligible" });
  },
);

test("[TC-SCRUM-36-06] missing reason returns invalid with reason field error", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { name: "New name" },
  });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("invalid");
  expect(result.errors.some(e => e.field === "reason")).toBe(true);
});

test.each([undefined, null, "", "   "])(
  "[TC-SCRUM-36-07] blank/missing reason %s returns invalid",
  async (reason) => {
    const { service } = setup36();
    const result = await service.submitChangeRequest("alice", "event-under-review", {
      proposed_changes: { name: "New name" }, reason,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.field === "reason")).toBe(true);
  },
);

test("[TC-SCRUM-36-08] missing proposed_changes returns invalid", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", { reason: "Valid reason" });
  expect(result.ok).toBe(false);
  expect(result.errors.some(e => e.field === "proposed_changes")).toBe(true);
});

test("[TC-SCRUM-36-09] empty proposed_changes object returns invalid", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: {}, reason: "Valid reason",
  });
  expect(result.ok).toBe(false);
  expect(result.errors.some(e => e.field === "proposed_changes")).toBe(true);
});

test("[TC-SCRUM-36-10] non-permitted field in proposed_changes returns invalid", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { status: "CONFIRMED" }, reason: "Testing",
  });
  expect(result.ok).toBe(false);
  expect(result.errors.some(e => e.field === "status")).toBe(true);
});

test("[TC-SCRUM-36-11] invalid proposed value returns 400 with field error", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { expected_attendance: -1 }, reason: "Capacity change",
  });
  expect(result.ok).toBe(false);
  expect(result.errors.some(e => e.field === "expected_attendance")).toBe(true);
});

test("[TC-SCRUM-36-12] end_time before start_time in proposed_changes returns invalid", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { start_time: "2099-06-01T18:00:00.000Z", end_time: "2099-06-01T10:00:00.000Z" },
    reason: "Reschedule",
  });
  expect(result.ok).toBe(false);
  expect(result.errors.some(e => e.field === "end_time")).toBe(true);
});

test("[TC-SCRUM-36-13] all validation errors are reported together", async () => {
  const { service } = setup36();
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { expected_attendance: -1, start_time: "not-a-date" },
    reason: "Testing",
  });
  expect(result.ok).toBe(false);
  expect(result.errors.length).toBeGreaterThanOrEqual(2);
});

test("[TC-SCRUM-36-14] event fields unchanged after change request submitted", async () => {
  const { service, records } = setup36();
  const before = structuredClone(records[0]);
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { name: "Revised Gala" }, reason: "Branding",
  });
  expect(result.ok).toBe(true);
  expect(result.event.name).toBe(before.name);
  expect(result.event.expected_attendance).toBe(before.expected_attendance);
  expect(result.event.start_time).toBe(before.start_time);
});

test("[TC-SCRUM-36-15] second change request refused while one is already pending", async () => {
  const { service, records } = setup36();
  records[0].pending_change_request = {
    proposed_changes: { name: "First request" }, reason: "First",
    requested_at: "2026-10-26T10:00:00.000Z", requested_by: "alice",
  };
  const result = await service.submitChangeRequest("alice", "event-under-review", {
    proposed_changes: { name: "Second request" }, reason: "Second",
  });
  expect(result).toEqual({ ok: false, reason: "already_pending" });
});
