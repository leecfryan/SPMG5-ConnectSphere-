// The REAL query chain in managedEvents.service.js, driven against a fake
// Supabase client that applies .or/.eq to an in-memory table instead of ignoring
// them. Stubbing the service out would prove nothing about the two things this
// story has to get right: that ownership is a WHERE clause, and that the
// waitlist count asks Postgres for a count rather than for rows.
//
// A record that reaches the service through a broken filter is exactly the leak
// the acceptance criteria forbid, so the fake has to be honest about it.

import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createManagedEventsService, WAITLIST_STATUS } =
  require("../../../src/modules/managedEvents/managedEvents.service");

const ORGANISER = "11111111-1111-1111-1111-111111111111";
const COORDINATOR = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";

const OWNED_EVENT = {
  id: "aaaaaaaa-0001-0000-0000-000000000000",
  name: "Owner's own gala",
  start_time: "2026-10-02T01:00:00Z",
  end_time: "2026-10-02T05:00:00Z",
  status: "APPROVED",
  enrolled_attendees: 42,
  expected_attendance: 120,
  organiser_id: ORGANISER,
  coordinator_id: COORDINATOR,
  // Columns the select() must not pull. Present so a widened select fails the
  // shaping assertions below rather than passing silently.
  description: "should not be returned",
  registration_fields: [{ id: "diet", label: "Dietary needs" }],
};

const ASSIGNED_EVENT = {
  id: "aaaaaaaa-0002-0000-0000-000000000000",
  name: "Coordinator's assignment",
  start_time: "2026-11-07T01:00:00Z",
  end_time: "2026-11-07T04:00:00Z",
  status: "SUBMITTED",
  enrolled_attendees: 0,
  expected_attendance: null,
  organiser_id: STRANGER,
  coordinator_id: COORDINATOR,
};

const SOMEONE_ELSES_EVENT = {
  id: "aaaaaaaa-0003-0000-0000-000000000000",
  name: "Another team's conference",
  start_time: "2026-12-01T01:00:00Z",
  end_time: "2026-12-01T05:00:00Z",
  status: "APPROVED",
  enrolled_attendees: 900,
  expected_attendance: 1000,
  organiser_id: STRANGER,
  coordinator_id: STRANGER,
};

// Applies each filter as Postgrest would: .or() is a disjunction of its clauses,
// .eq() is one more conjunct on top.
function fakeSupabase(tables) {
  const selects = [];
  const ors = [];
  const client = {
    selects,
    ors,
    from(table) {
      let predicates = [];
      let single = false;
      let headCount = false;
      const builder = {
        select(fields, options) {
          // The real postgrest-js does `(columns ?? "*").split("")`, so an array
          // throws before the request is sent. Mirroring that is what stops this
          // fake from quietly accepting a column list the driver would reject.
          if (fields !== undefined && typeof fields !== "string") {
            throw new TypeError("postgrest-js select() only accepts a column string");
          }
          if (options?.head && options?.count) headCount = true;
          selects.push({ table, fields, options });
          return builder;
        },
        or(filter) {
          ors.push({ table, filter });
          const clauses = filter.split(",").map((clause) => {
            const [field, , value] = clause.split(".");
            return (row) => String(row[field] ?? "") === value;
          });
          predicates.push((row) => clauses.some((clause) => clause(row)));
          return builder;
        },
        eq(field, value) {
          predicates.push((row) => String(row[field] ?? "") === String(value));
          return builder;
        },
        order() { return builder; },
        maybeSingle() { single = true; return builder; },
        then(resolve, reject) {
          const rows = (tables[table] || []).filter((row) => predicates.every((test) => test(row)));
          Promise.resolve(headCount
            ? { count: rows.length, error: null }
            : { data: single ? (rows[0] ?? null) : rows, error: null }
          ).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client;
}

function serviceWith(events = [], registrations = []) {
  const client = fakeSupabase({ events, registrations });
  return { service: createManagedEventsService(client), client };
}

test("the list returns events the user organises and events assigned to them", async () => {
  const { service } = serviceWith([OWNED_EVENT, ASSIGNED_EVENT, SOMEONE_ELSES_EVENT]);

  const events = await service.listManagedEvents(COORDINATOR);

  expect(events.map((event) => event.id)).toEqual([OWNED_EVENT.id, ASSIGNED_EVENT.id]);
});

test("the list never returns an event the user neither organises nor coordinates", async () => {
  const { service } = serviceWith([OWNED_EVENT, SOMEONE_ELSES_EVENT]);

  const events = await service.listManagedEvents(ORGANISER);

  expect(events.map((event) => event.id)).not.toContain(SOMEONE_ELSES_EVENT.id);
  expect(events.map((event) => event.name)).not.toContain("Another team's conference");
});

test("the ownership filter names both organiser_id and coordinator_id for the given user", async () => {
  // The filter is built from the session id inside the service. A caller cannot
  // supply it, so this is the only place a user id enters a query.
  const { service, client } = serviceWith([OWNED_EVENT]);

  await service.listManagedEvents(ORGANISER);

  expect(client.ors.at(-1)).toEqual({
    table: "events",
    filter: `organiser_id.eq.${ORGANISER},coordinator_id.eq.${ORGANISER}`,
  });
});

test("the ownership filter is built per request, not cached with the first user's id", async () => {
  const { service, client } = serviceWith([OWNED_EVENT, ASSIGNED_EVENT]);

  await service.listManagedEvents(ORGANISER);
  await service.listManagedEvents(COORDINATOR);

  expect(client.ors.at(-1).filter).toBe(
    `organiser_id.eq.${COORDINATOR},coordinator_id.eq.${COORDINATOR}`,
  );
});

test("findManagedEvent returns the row for an organiser and for a coordinator", async () => {
  const { service } = serviceWith([OWNED_EVENT, SOMEONE_ELSES_EVENT]);

  expect((await service.findManagedEvent(OWNED_EVENT.id, ORGANISER)).id).toBe(OWNED_EVENT.id);
  expect((await service.findManagedEvent(OWNED_EVENT.id, COORDINATOR)).id).toBe(OWNED_EVENT.id);
});

test("findManagedEvent returns null for an unrelated event and for one that does not exist", async () => {
  const { service } = serviceWith([OWNED_EVENT]);

  expect(await service.findManagedEvent(SOMEONE_ELSES_EVENT.id, ORGANISER)).toBeNull();
  expect(await service.findManagedEvent("aaaaaaaa-9999-0000-0000-000000000000", ORGANISER)).toBeNull();
});

test("findManagedEvent selects only the columns the response needs", async () => {
  const { service, client } = serviceWith([OWNED_EVENT]);

  await service.findManagedEvent(OWNED_EVENT.id, ORGANISER);

  const columns = client.selects.at(-1).fields.split(",").map((c) => c.trim());
  expect(columns).toEqual([
    "id", "name", "start_time", "end_time", "status",
    "enrolled_attendees", "expected_attendance",
  ]);
  expect(columns).not.toContain("registration_fields");
  expect(columns).not.toContain("organiser_id");
});

test("the waitlist count asks for a head count and returns 0 when no rows match", async () => {
  const { service, client } = serviceWith([OWNED_EVENT], [
    { id: "r1", event_id: OWNED_EVENT.id, attendee_id: ORGANISER, status: "confirmed" },
    { id: "r2", event_id: OWNED_EVENT.id, attendee_id: STRANGER, status: "pending" },
    { id: "r3", event_id: OWNED_EVENT.id, attendee_id: STRANGER, status: "withdrawn" },
  ]);

  expect(await service.getRegistrationSummary(OWNED_EVENT)).toMatchObject({ waitingList: 0 });

  const registrations = client.selects.at(-1);
  expect(registrations.table).toBe("registrations");
  expect(registrations.options).toEqual({ count: "exact", head: true });
  expect(registrations.fields).toBe("id");
});

test("the waitlist count uses WAITLIST_STATUS and counts the matching rows", async () => {
  const { service } = serviceWith([OWNED_EVENT], [
    { id: "r1", event_id: OWNED_EVENT.id, attendee_id: ORGANISER, status: WAITLIST_STATUS },
    { id: "r2", event_id: OWNED_EVENT.id, attendee_id: STRANGER, status: WAITLIST_STATUS },
    { id: "r3", event_id: OWNED_EVENT.id, attendee_id: STRANGER, status: WAITLIST_STATUS },
    { id: "r4", event_id: OWNED_EVENT.id, attendee_id: STRANGER, status: "confirmed" },
    // Same status, different event: must not be counted.
    { id: "r5", event_id: ASSIGNED_EVENT.id, attendee_id: STRANGER, status: WAITLIST_STATUS },
  ]);

  expect(await service.getRegistrationSummary(OWNED_EVENT)).toMatchObject({ waitingList: 3 });
});

test("WAITLIST_STATUS is the one named constant every caller shares", () => {
  expect(WAITLIST_STATUS).toBe("waitlisted");
});

test("the summary reports enrolled_attendees against expected_attendance", async () => {
  const { service } = serviceWith([OWNED_EVENT]);

  expect(await service.getRegistrationSummary(OWNED_EVENT)).toMatchObject({
    enrolled: 42,
    maxEnrollment: 120,
  });
});

test("the summary renders a null expected_attendance as null, not 0", async () => {
  const { service } = serviceWith([ASSIGNED_EVENT]);

  expect(await service.getRegistrationSummary(ASSIGNED_EVENT)).toMatchObject({
    enrolled: 0,
    maxEnrollment: null,
    waitingList: 0,
  });
});

test("the summary carries no attendee identity and no submitted registration data", async () => {
  const { service } = serviceWith([OWNED_EVENT], [
    { id: "r1", event_id: OWNED_EVENT.id, attendee_id: "someone@attendee.example",
      status: WAITLIST_STATUS, registration_data: { email: "someone@attendee.example" } },
  ]);

  const summary = await service.getRegistrationSummary(OWNED_EVENT);

  const serialised = JSON.stringify(summary);
  expect(summary).not.toHaveProperty("attendee_id");
  expect(summary).not.toHaveProperty("registration_data");
  expect(summary).not.toHaveProperty("organiser_id");
  expect(summary).not.toHaveProperty("coordinator_id");
  expect(summary).not.toHaveProperty("description");
  expect(serialised).not.toContain("someone@attendee.example");
});

test("a database error surfaces as a thrown error, not a silent empty result", async () => {
  const failing = { from: () => {
    const builder = {
      select() { return builder; }, or() { return builder; }, eq() { return builder; },
      order() { return builder; }, maybeSingle() { return builder; },
      then: (resolve) => Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve),
    };
    return builder;
  } };
  const service = createManagedEventsService(failing);

  await expect(service.listManagedEvents(ORGANISER)).rejects.toThrow(/boom/);
});

test("a failing waitlist count does not return a partial summary", async () => {
  const client = fakeSupabase({ events: [OWNED_EVENT], registrations: [] });
  vi.spyOn(client, "from").mockImplementation((table) => {
    if (table === "events") return fakeSupabase({ events: [OWNED_EVENT] }).from(table);
    const builder = {
      select() { return builder; }, eq() { return builder; },
      then: (resolve) => Promise.resolve({ count: null, error: { message: "count failed" } }).then(resolve),
    };
    return builder;
  });

  await expect(createManagedEventsService(client).getRegistrationSummary(OWNED_EVENT))
    .rejects.toThrow(/count failed/);
});
