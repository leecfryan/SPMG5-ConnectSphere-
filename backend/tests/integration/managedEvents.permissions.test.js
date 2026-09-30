// GET /api/managed-events over real HTTP: router -> requirePermission resolver ->
// controller -> service. The service is faked so the cases that matter here are
// about who is allowed to ask, not about Supabase.
//
// The story's third acceptance criterion is that unrelated registration
// information is never exposed, so the interesting assertions are the denials -
// and specifically that a denial looks the same whether or not the event exists.

import { test, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { createManagedEventsService, WAITLIST_STATUS } =
  require("../../src/modules/managedEvents/managedEvents.service");

const ORGANISER = "organiser-id";
const COORDINATOR = "coordinator-id";
const OTHER_COORDINATOR = "other-coordinator-id";
const ATTENDEE = "attendee-id";

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
};

const SOMEONE_ELSES_EVENT = {
  id: "aaaaaaaa-0003-0000-0000-000000000000",
  name: "Another team's conference",
  start_time: "2026-12-01T01:00:00Z",
  end_time: "2026-12-01T05:00:00Z",
  status: "APPROVED",
  enrolled_attendees: 900,
  expected_attendance: 1000,
  organiser_id: OTHER_COORDINATOR,
  coordinator_id: OTHER_COORDINATOR,
};

const MISSING_EVENT_ID = "aaaaaaaa-9999-0000-0000-000000000000";

// Signed-in identity comes from the verified token, never from the request body
// or query - the same substitution events.submit.test.js uses.
function appFor(roles) {
  return createApp({
    authClient: { auth: { getUser: async (token) => ({
      data: { user: token === "invalid" ? null : {
        id: token,
        // user_metadata.roles is deliberately set to a privileged role: it is
        // user-editable, so requireAuth must ignore it and read app_metadata.
        user_metadata: { roles: ["event_ops_manager", "event_coordinator"] },
        app_metadata: { roles },
      } }, error: null,
    }) } },
    managedEventsService: createManagedEventsService(managedEventsFakeClient()),
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "test-public-key",
  });
}

function managedEventsFakeClient() {
  const events = [OWNED_EVENT, SOMEONE_ELSES_EVENT];
  const rows = [
    { id: "r1", event_id: OWNED_EVENT.id, attendee_id: "someone", status: WAITLIST_STATUS },
  ];
  function table(name) {
    const source = name === "events" ? events : rows;
    let predicates = [];
    let single = false;
    const builder = {
      select(columns) {
        // Matches the real postgrest-js, whose select() calls .split("") on the
        // column argument. A column list that is not a string throws before the
        // request is sent, which over HTTP would read as a 500 - not as a test
        // failure about column formatting.
        if (columns !== undefined && typeof columns !== "string") {
          throw new TypeError("postgrest-js select() only accepts a column string");
        }
        return builder;
      },
      or(filter) {
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
        const matched = source.filter((row) => predicates.every((test) => test(row)));
        Promise.resolve({ count: matched.length, data: single ? (matched[0] ?? null) : matched, error: null })
          .then(resolve, reject);
      },
    };
    return builder;
  }
  return { from: table };
}

let server;
let baseUrl;
beforeAll(async () => {
  const app = appFor(["event_organiser"]);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

// The listening server has one fixed identity, so role cases get their own app.
async function getAs(path, token, roles = ["event_organiser"]) {
  const app = appFor(roles);
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once("listening", resolve));
  const url = `http://127.0.0.1:${listener.address().port}${path}`;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
}

const detail = (eventId) => `/api/managed-events/${eventId}`;

test("an organiser sees registration information for an event they own", async () => {
  const { status, body } = await getAs(detail(OWNED_EVENT.id), ORGANISER);

  expect(status).toBe(200);
  expect(body.summary).toEqual({
    id: OWNED_EVENT.id,
    name: "Owner's own gala",
    start_time: "2026-10-02T01:00:00Z",
    end_time: "2026-10-02T05:00:00Z",
    status: "APPROVED",
    enrolled: 42,
    maxEnrollment: 120,
    waitingList: 1,
  });
});

test("a coordinator sees registration information for an event assigned to them", async () => {
  const { status, body } = await getAs(detail(OWNED_EVENT.id), COORDINATOR, ["event_coordinator"]);

  expect(status).toBe(200);
  expect(body.summary).toMatchObject({ id: OWNED_EVENT.id, enrolled: 42 });
});

test("a coordinator's unrelated event is denied, even though they hold the permission", async () => {
  const { status, body } = await getAs(
    detail(SOMEONE_ELSES_EVENT.id), COORDINATOR, ["event_coordinator"],
  );

  expect(status).toBe(403);
  expect(JSON.stringify(body)).not.toContain("Another team's conference");
  expect(JSON.stringify(body)).not.toContain("900");
});

test("an organiser is denied an event owned by another coordinator", async () => {
  const { status } = await getAs(detail(SOMEONE_ELSES_EVENT.id), ORGANISER);

  expect(status).toBe(403);
});

test("an unrelated event and a non-existent event are indistinguishable", async () => {
  const unrelated = await getAs(detail(SOMEONE_ELSES_EVENT.id), ORGANISER);
  const missing = await getAs(detail(MISSING_EVENT_ID), ORGANISER);

  expect(unrelated.status).toBe(missing.status);
  expect(unrelated.body).toEqual(missing.body);
});

test("a role without events.registrations.read is denied before any record is read", async () => {
  for (const roles of [["attendee"], ["venue_staff"], ["technical_support_staff"], []]) {
    const { status } = await getAs(detail(OWNED_EVENT.id), ORGANISER, roles);
    expect(status, roles.join(",")).toBe(403);
  }
});

test("a client-supplied role claim cannot grant access", async () => {
  // appFor's fake user also carries event_coordinator/event_ops_manager in
  // user_metadata, which is attacker-editable. requireAuth must read
  // app_metadata only, so this is denied.
  const { status } = await getAs(detail(SOMEONE_ELSES_EVENT.id), ORGANISER, ["attendee"]);

  expect(status).toBe(403);
});

test("a request with no token cannot reach the resolver", async () => {
  const response = await fetch(`${baseUrl}${detail(OWNED_EVENT.id)}`);

  expect(response.status).toBe(401);
});

test("an invalid token is rejected", async () => {
  const { status } = await getAs(detail(OWNED_EVENT.id), "invalid");

  expect(status).toBe(401);
});

test("a malformed event id is refused without a query", async () => {
  const { status } = await getAs(detail("not-a-uuid"), ORGANISER);

  expect(status).toBe(403);
});

test("the organiser sees their own and coordinated events in the list, and nothing else", async () => {
  const { status, body } = await getAs("/api/managed-events", ORGANISER);

  expect(status).toBe(200);
  expect(body.events.map((event) => event.id)).toEqual([OWNED_EVENT.id]);
});

test("the coordinator's list contains only events assigned to them", async () => {
  const { body } = await getAs("/api/managed-events", COORDINATOR, ["event_coordinator"]);

  expect(body.events.map((event) => event.id)).toEqual([OWNED_EVENT.id]);
});

test("a role without events.managed.read is denied the list", async () => {
  const { status } = await getAs("/api/managed-events", ATTENDEE, ["attendee"]);

  expect(status).toBe(403);
});

test("the list never carries attendee identity or submitted registration data", async () => {
  const { body } = await getAs("/api/managed-events", ORGANISER);

  const serialised = JSON.stringify(body);
  expect(serialised).not.toContain("organiser_id");
  expect(serialised).not.toContain("coordinator_id");
  expect(serialised).not.toContain("attendee_id");
  expect(serialised).not.toContain("registration_data");
});

test("the summary never carries attendee identity or submitted registration data", async () => {
  const { body } = await getAs(detail(OWNED_EVENT.id), ORGANISER);

  const serialised = JSON.stringify(body);
  expect(serialised).not.toContain("someone");
  expect(body.summary).not.toHaveProperty("attendee_id");
  expect(body.summary).not.toHaveProperty("registration_data");
});

test("a failure while counting the waiting list is a 500, not a partial summary", async () => {
  // The resolver still resolves, so this reaches the controller: the failure is
  // in the count, after ownership was already proven.
  const failing = createManagedEventsService(managedEventsFakeClient());
  vi.spyOn(failing, "getRegistrationSummary").mockRejectedValue(new Error("boom"));

  const app = createApp({
    authClient: { auth: { getUser: async () => ({
      data: { user: { id: ORGANISER, app_metadata: { roles: ["event_organiser"] } } }, error: null,
    }) } },
    managedEventsService: failing,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "test-public-key",
  });
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${listener.address().port}${detail(OWNED_EVENT.id)}`,
      { headers: { Authorization: `Bearer ${ORGANISER}` } },
    );
    expect(response.status).toBe(500);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});
