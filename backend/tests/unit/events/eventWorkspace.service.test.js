import { createRequire } from "node:module";
import { expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createEventWorkspaceService } = require("../../../src/modules/events/eventWorkspace.service");
const storage = require("../../../../tests/playwright/support/registration-storage.cjs");

// SCRUM-37: apply_organiser_event_edit (SQL) now owns the write, the
// significance check and the flagging/regression that used to be split
// between a plain .update() here and equipmentService.flagReservationsForReview.
// This fake only replicates the field write - the real function's own
// significance/flagging/regression logic lives in Postgres and isn't
// re-implemented in JS here, per the house rule against duplicating a rule
// in two places; what's tested below is that updateOrganiserEvent calls it
// with the right, fully-merged arguments, and maps its errcode correctly.
let fakeNow = 0;

// SCRUM-37 reviewer feedback (PR #60): the real function compares
// p_expected_updated_at against the row it just locked, and bumps
// updated_at on every write (events_set_updated_at trigger) - replicated
// here so a stale p_expected_updated_at behaves the same way as the real
// EVENT_MODIFIED/P0004 the caller needs to handle.
function fakeApplyOrganiserEventEdit(records) {
  return vi.fn((name, args) => {
    if (name !== "apply_organiser_event_edit") throw new Error(`Unsupported rpc: ${name}`);
    const chain = {
      select: () => chain,
      async maybeSingle() {
        const record = records.find(r => r.id === args.p_event_id && r.organiser_id === args.p_organiser_id);
        if (!record) return { data: null, error: { code: "P0002", message: "EVENT_NOT_FOUND" } };
        if (record.updated_at !== args.p_expected_updated_at) {
          return { data: null, error: { code: "P0004", message: "EVENT_MODIFIED" } };
        }
        fakeNow += 1;
        Object.assign(record, {
          name: args.p_name, purpose: args.p_purpose, description: args.p_description,
          start_time: args.p_start_time, end_time: args.p_end_time,
          registration_start: args.p_registration_start, registration_end: args.p_registration_end,
          expected_attendance: args.p_expected_attendance, venue_requirements: args.p_venue_requirements,
          accessibility_needs: args.p_accessibility_needs, equipment_needs: args.p_equipment_needs,
          other_comments: args.p_other_comments,
          updated_at: "2026-10-26T00:00:00." + String(fakeNow).padStart(3, "0") + "Z",
        });
        return { data: { ...record }, error: null };
      },
    };
    return chain;
  });
}

function setup() {
  fakeNow = 0;
  const users = [
    { id: "alice", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "bob", app_metadata: { roles: ["event_organiser"], organisation_id: "alpha" }, user_metadata: {} },
    { id: "cara", app_metadata: { roles: ["event_organiser"], organisation_id: "beta" }, user_metadata: {} },
  ];
  // Every WRITABLE_COLS field is given a real value (not left undefined) so a
  // gap in FIELDS (the columns read() actually selects) shows up as a wrong
  // merged argument instead of passing silently - see TC-37-21 below,
  // added after exactly that gap (registration_start/_end) reached the live
  // database undetected by this suite.
  const records = users.map((user, index) => ({
    id: "event-" + user.id, organiser_id: user.id, name: user.id + " workshop",
    purpose: "Training", description: "Client workshop", expected_attendance: 20,
    start_time: "2099-01-01T01:00:12.345Z", end_time: "2099-01-01T03:00:12.345Z",
    registration_start: "2098-12-01T00:00:00.000Z", registration_end: "2098-12-20T00:00:00.000Z",
    status: "APPROVED", coordinator_id: "coordinator-one", other_comments: "Private requirements",
    venue_requirements: "A stage", accessibility_needs: "Step-free access",
    equipment_needs: "Projector and a lectern",
    submitted_at: "2026-01-0" + (index + 1) + "T00:00:00Z",
    updated_at: "2026-01-0" + (index + 1) + "T00:00:00.000Z",
  }));
  const client = storage(new Map([["fixture", { events: records }]]));
  client.auth = { admin: {
    getUserById: vi.fn(async id => ({ data: { user: users.find(user => user.id === id) }, error: null })),
    listUsers: vi.fn(async () => ({ data: { users }, error: null })),
  } };
  // Kept as a mock (not the raw storage function) so tests can still swap its
  // implementation for one call, e.g. to simulate a record-read failure.
  const from = client.from.bind(client);
  client.from = vi.fn(table => from(table));
  client.rpc = fakeApplyOrganiserEventEdit(records);
  return { service: createEventWorkspaceService(client), client, users, records };
}

test("[SCRUM-100-UNIT-001] Organiser reads own and colleague records but no unrelated client record", async () => {
  const { service } = setup();
  const visible = await service.list("organiser", "alice");
  expect(visible.map(event => event.id).sort()).toEqual(["event-alice", "event-bob"]);
  expect(await service.find("organiser", "alice", "event-bob")).toMatchObject({ organiser_id: "bob" });
  expect(await service.find("organiser", "alice", "event-cara")).toBeNull();
});

test("[SCRUM-100-UNIT-002] Owner saves normalised partial details while protected and untouched fields persist", async () => {
  const { service, client, records } = setup();
  const before = structuredClone(records);
  const result = await service.updateOrganiserEvent("alice", "event-alice", {
    name: "  Revised workshop  ", expected_attendance: "1", other_comments: "  ",
  });
  expect(result.ok).toBe(true);
  // updated_at is excluded from the spread below - the write bumps it
  // (events_set_updated_at trigger, replicated by the fake), so it's never
  // equal to the pre-save snapshot; that's the whole point of SCRUM-37's
  // optimistic-concurrency fix (PR #60 reviewer feedback).
  const beforeRest = { ...before[0] };
  delete beforeRest.updated_at;
  expect(result.event).toMatchObject({ ...beforeRest, name: "Revised workshop", expected_attendance: 1, other_comments: null });
  expect(records[0]).toMatchObject({ ...beforeRest, name: "Revised workshop", expected_attendance: 1, other_comments: null });
  expect(records[0].updated_at).not.toBe(before[0].updated_at);
  expect(records.slice(1)).toEqual(before.slice(1));
  // SCRUM-37: the function always takes every writable column - untouched
  // ones are carried over from the current row, not omitted.
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith("apply_organiser_event_edit", expect.objectContaining({
    p_event_id: "event-alice", p_organiser_id: "alice",
    p_name: "Revised workshop", p_expected_attendance: 1, p_other_comments: null,
    p_purpose: before[0].purpose, p_description: before[0].description,
    p_equipment_needs: before[0].equipment_needs,
  }));
});

test("[SCRUM-100-UNIT-003] Visible peer and invisible outsider edits are refused before any write", async () => {
  const { service, client, records } = setup();
  const before = structuredClone(records);
  expect(await service.updateOrganiserEvent("alice", "event-bob", { name: "Denied" })).toEqual({ ok: false, reason: "forbidden" });
  expect(await service.updateOrganiserEvent("alice", "event-cara", { name: "Denied" })).toEqual({ ok: false, reason: "not_found" });
  expect(await service.updateOrganiserEvent("alice", "missing", { name: "Denied" })).toEqual({ ok: false, reason: "not_found" });
  expect(client.rpc).not.toHaveBeenCalled();
  expect(records).toEqual(before);
});

test("[SCRUM-100-UNIT-004] Invalid or protected detail changes cannot partly mutate the event", async () => {
  const { service, client, records } = setup();
  const before = structuredClone(records);
  for (const input of [null, [], {}, { name: "Changed", organiser_id: "bob" },
    { name: "Changed", status: "CONFIRMED" }, { organisation_id: "beta" },
    { name: " " }, { expected_attendance: "invalid" }, { start_time: "invalid" }]) {
    const result = await service.updateOrganiserEvent("alice", "event-alice", input);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(records).toEqual(before);
  }
  expect(client.rpc).not.toHaveBeenCalled();
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
    const { service, client, records } = setup();
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
    expect(client.rpc).not.toHaveBeenCalled();
    expect(records).toEqual(before);
  }
});

test("[SCRUM-100-UNIT-007] Changed responsibility prevents the previous owner from saving stale edits", async () => {
  const { service, client, records } = setup();
  const before = structuredClone(records);
  // SCRUM-37: the race now surfaces through apply_organiser_event_edit's own
  // WHERE id = ... AND organiser_id = ... (EVENT_NOT_FOUND/P0002) instead of
  // the plain .update()'s zero-rows-matched - same race, same 409, moved.
  const realRpc = client.rpc;
  client.rpc = vi.fn((name, args) => { records[0].organiser_id = "bob"; return realRpc(name, args); });
  expect(await service.updateOrganiserEvent("alice", "event-alice", { name: "Stale change" })).toEqual({ ok: false, reason: "conflict" });
  expect(records).toEqual([{ ...before[0], organiser_id: "bob" }, ...before.slice(1)]);
});

// SCRUM-37 reviewer feedback (PR #60): same shape as UNIT-007's reassignment
// race, but here the row is still this organiser's own - only updated_at
// moved, because another save (e.g. a second open tab) committed in the gap
// between this call's own read() above and its RPC call below. Without
// p_expected_updated_at, `merged` (computed from the now-stale `current`)
// would silently overwrite whatever that other save changed.
test("[TC-37-24] a save that lands between this read and the write is refused, not silently merged over", async () => {
  const { service, client, records } = setup();
  const before = structuredClone(records[0]);
  const realRpc = client.rpc;
  client.rpc = vi.fn((name, args) => { records[0].updated_at = "2026-10-26T00:00:00.999Z"; return realRpc(name, args); });

  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "Stale change" });

  expect(result).toEqual({ ok: false, reason: "conflict" });
  // Refused outright - the row is exactly as the other save left it, not
  // half-overwritten with this call's stale merged values.
  expect(records[0]).toEqual({ ...before, updated_at: "2026-10-26T00:00:00.999Z" });
});

test("[SCRUM-100-UNIT-008] Current trusted affiliation replaces old colleague access on the next lookup", async () => {
  const { service, users } = setup();
  expect(await service.find("organiser", "alice", "event-bob")).not.toBeNull();
  users[0].app_metadata.organisation_id = "beta";
  expect(await service.find("organiser", "alice", "event-bob")).toBeNull();
  expect((await service.list("organiser", "alice")).map(event => event.id).sort()).toEqual(["event-alice", "event-cara"]);
});

// SCRUM-150 AC1 used to be proven here via equipmentService.
// flagReservationsForReview, called only when start_time/end_time/
// equipment_needs changed. SCRUM-37's team design retires that call
// entirely - a significant edit now regresses the event itself to
// SUBMITTED (apply_organiser_event_edit, SQL) rather than flagging the
// reservation for Technical Support to re-decide, so SCRUM-150's AC1 is
// unreachable via this trigger now, by deliberate decision (see this
// story's task note). TC-150-01/03/22 are repurposed below (TC-150-02's own
// scenario, an equipment_needs-only edit with no date change, no longer
// means anything once there's no datesChanged flag to prove) to show the
// one thing still true at this JS layer: every successful edit calls the
// function with the correctly merged arguments, whatever changed. The
// significance rule itself now lives only in the function's own logic,
// proven by reading it, not by a JS-level test.
test("[TC-150-01/SCRUM-37] changing start_time calls apply_organiser_event_edit with the new value merged onto the unchanged fields", async () => {
  const { service, client, records } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { start_time: "2099-01-01T00:30:00.000Z" });
  expect(result.ok).toBe(true);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith("apply_organiser_event_edit", expect.objectContaining({
    p_event_id: "event-alice", p_organiser_id: "alice",
    p_start_time: "2099-01-01T00:30:00.000Z", p_end_time: records[0].end_time,
  }));
});

test("[TC-150-03/SCRUM-37] resubmitting the same start_time/end_time/equipment_needs values still calls the function - significance is its own decision, not the caller's", async () => {
  const { service, client, records } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", {
    start_time: records[0].start_time,
    end_time: records[0].end_time,
    equipment_needs: records[0].equipment_needs,
  });
  expect(result.ok).toBe(true);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith("apply_organiser_event_edit", expect.objectContaining({
    p_start_time: records[0].start_time, p_end_time: records[0].end_time, p_equipment_needs: records[0].equipment_needs,
  }));
});

test("[TC-150-22/SCRUM-37] a change unrelated to date/time/equipment needs (name) still calls the function, with name updated and everything else carried over", async () => {
  const { service, client, records } = setup();
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "Renamed only" });
  expect(result.ok).toBe(true);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith("apply_organiser_event_edit", expect.objectContaining({
    p_name: "Renamed only", p_start_time: records[0].start_time, p_equipment_needs: records[0].equipment_needs,
  }));
});

// Found live, 2026-10-21: registration_start/registration_end were missing
// from FIELDS, so current.registration_start/_end read undefined and the RPC
// call silently dropped those two required parameters - breaking every
// single edit, not just registration-window ones. expect.objectContaining
// above would never have caught this (it ignores keys it isn't told to
// check), so this one asserts the *complete* argument object for every
// WRITABLE_COLS field - a dropped or undefined parameter anywhere now fails
// the test, not just in production.
test("[TC-37-21] every writable column reaches the function as a real value, never undefined, including fields the edit itself didn't touch", async () => {
  const { service, client, records } = setup();
  // Snapshotted before acting: the fake RPC writes its own args straight
  // back onto this same records[0] object, so reading records[0] *after*
  // the call would silently compare an already-mutated value against
  // itself - exactly the gap that let the live registration_start/_end bug
  // through a first draft of this test undetected.
  const before = structuredClone(records[0]);
  const result = await service.updateOrganiserEvent("alice", "event-alice", { name: "Renamed only" });
  expect(result.ok).toBe(true);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith("apply_organiser_event_edit", {
    p_event_id: "event-alice", p_organiser_id: "alice", p_expected_updated_at: before.updated_at,
    p_name: "Renamed only", p_purpose: before.purpose, p_description: before.description,
    p_start_time: before.start_time, p_end_time: before.end_time,
    p_registration_start: before.registration_start, p_registration_end: before.registration_end,
    p_expected_attendance: before.expected_attendance,
    p_venue_requirements: before.venue_requirements, p_accessibility_needs: before.accessibility_needs,
    p_equipment_needs: before.equipment_needs, p_other_comments: before.other_comments,
  });
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
