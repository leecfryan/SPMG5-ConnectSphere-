import { test, vi } from "vitest";
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");

const ATTENDEE = {
  id: "attendee-user-id",
  email: "attendee@example.com",
  app_metadata: { roles: ["attendee"] },
  user_metadata: {},
};

const AUTH = {
  Authorization: "Bearer test-token",
  "Content-Type": "application/json",
};

function matches(row, filters) {
  return filters.every(({ column, operator, value }) => {
    if (operator === "is") return row[column] === value;
    return row[column] === value;
  });
}

function makeDataClient({
  enrolled = 0,
  capacity = 2,
  registrations = [],
  insertError,
  beforeEventUpdate,
} = {}) {
  const event = {
    id: "event-capacity",
    status: "APPROVED",
    registration_fields: [],
    enrolled_attendees: enrolled,
    expected_attendance: capacity,
  };
  const savedRegistrations = registrations.map((row) => ({ ...row }));
  const eventUpdates = [];

  function execute(query, terminal) {
    const { table, operation, filters } = query;
    if (table === "events") {
      if (operation === "select") {
        return { data: matches(event, filters) ? { ...event } : null, error: null };
      }
      if (operation === "update") {
        const accepted = beforeEventUpdate
          ? beforeEventUpdate({ event, query })
          : true;
        if (!accepted || !matches(event, filters)) {
          eventUpdates.push({ update: query.values, filters, changed: false });
          return { data: null, error: null };
        }
        Object.assign(event, query.values);
        eventUpdates.push({ update: query.values, filters, changed: true });
        return { data: { id: event.id, enrolled_attendees: event.enrolled_attendees }, error: null };
      }
    }

    if (table === "registrations") {
      if (operation === "select") {
        const row = savedRegistrations.find((item) => matches(item, filters));
        return { data: row ? { ...row } : null, error: null };
      }
      if (operation === "insert") {
        if (insertError) return { data: null, error: insertError };
        const duplicate = savedRegistrations.some((item) =>
          item.event_id === query.values.event_id &&
          item.attendee_id === query.values.attendee_id,
        );
        if (duplicate) {
          return { data: null, error: { code: "23505", message: "duplicate registration" } };
        }
        const row = {
          id: `registration-${savedRegistrations.length + 1}`,
          ...query.values,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        savedRegistrations.push(row);
        return { data: { ...row }, error: null };
      }
      if (operation === "update") {
        const row = savedRegistrations.find((item) => matches(item, filters));
        if (!row) {
          return {
            data: null,
            error: terminal === "single"
              ? { code: "PGRST116", message: "No rows found" }
              : null,
          };
        }
        Object.assign(row, query.values);
        return { data: { ...row }, error: null };
      }
    }

    return { data: null, error: null };
  }

  return {
    event,
    eventUpdates,
    registrations: savedRegistrations,
    from(table) {
      const query = { table, operation: "select", filters: [] };
      const builder = {
        select() {
          if (query.operation === "select") query.operation = "select";
          return builder;
        },
        eq(column, value) {
          query.filters.push({ column, operator: "eq", value });
          return builder;
        },
        is(column, value) {
          query.filters.push({ column, operator: "is", value });
          return builder;
        },
        insert(values) {
          query.operation = "insert";
          query.values = values;
          return builder;
        },
        update(values) {
          query.operation = "update";
          query.values = values;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(execute(query, "maybeSingle"));
        },
        single() {
          return Promise.resolve(execute(query, "single"));
        },
        then(resolve, reject) {
          return Promise.resolve(execute(query, "await")).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function setup(t, options) {
  const dataClient = makeDataClient(options);
  const app = createApp({
    authClient: {
      auth: {
        getUser: async () => ({ data: { user: ATTENDEE }, error: null }),
      },
    },
    dataClient,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_test",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { base: `http://127.0.0.1:${server.address().port}`, dataClient };
}

async function register(base) {
  return fetch(base + "/api/registrations", {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ eventId: "event-capacity" }),
  });
}

test("REG-CAP-001: a successful registration increments enrolled_attendees", async (t) => {
  const { base, dataClient } = await setup(t, { enrolled: 2, capacity: 5 });

  const response = await register(base);

  assert.equal(response.status, 201);
  assert.equal(dataClient.event.enrolled_attendees, 3);
  assert.equal(dataClient.registrations.length, 1);
});

test("REG-CAP-002: a registration at capacity is refused without claiming a seat", async (t) => {
  const { base, dataClient } = await setup(t, { enrolled: 2, capacity: 2 });

  const response = await register(base);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.match(body.message, /reached or exceeded capacity/);
  assert.match(body.message, /waiting-list redirection is pending implementation/);
  assert.equal(dataClient.eventUpdates.length, 0);
  assert.equal(dataClient.registrations.length, 0);
});

test("REG-CAP-003: the last available seat can be claimed", async (t) => {
  const { base, dataClient } = await setup(t, { enrolled: 0, capacity: 1 });

  const response = await register(base);

  assert.equal(response.status, 201);
  assert.equal(dataClient.event.enrolled_attendees, 1);
});

test("REG-CAP-013: simultaneous requests cannot both claim the last seat", async (t) => {
  const { base, dataClient } = await setup(t, { enrolled: 0, capacity: 1 });

  const responses = await Promise.all([register(base), register(base)]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(dataClient.event.enrolled_attendees, 1);
  assert.equal(dataClient.registrations.length, 1);
});

test("REG-CAP-004: a lost seat race re-reads the event and retries", async (t) => {
  let updates = 0;
  const { base, dataClient } = await setup(t, {
    enrolled: 0,
    capacity: 3,
    beforeEventUpdate: ({ event }) => {
      updates += 1;
      if (updates === 1) {
        event.enrolled_attendees = 1;
        return false;
      }
      return true;
    },
  });

  const response = await register(base);

  assert.equal(response.status, 201);
  assert.equal(updates, 2);
  assert.equal(dataClient.event.enrolled_attendees, 2);
  assert.deepEqual(dataClient.eventUpdates[0].filters.at(-1), {
    column: "enrolled_attendees",
    operator: "eq",
    value: 0,
  });
  assert.deepEqual(dataClient.eventUpdates[1].filters.at(-1), {
    column: "enrolled_attendees",
    operator: "eq",
    value: 1,
  });
});

test("REG-CAP-005: three lost seat races return a retryable busy response", async (t) => {
  let updates = 0;
  const { base, dataClient } = await setup(t, {
    enrolled: 0,
    capacity: 3,
    beforeEventUpdate: () => {
      updates += 1;
      return false;
    },
  });

  const response = await register(base);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.message, /busy.*Please retry/i);
  assert.equal(updates, 3);
  assert.equal(dataClient.registrations.length, 0);
});

test("REG-CAP-006: an insert failure attempts to release the claimed seat", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 0,
    capacity: 2,
    insertError: { message: "private insert failure" },
  });

  const response = await register(base);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.message, /Unable to submit/);
  assert.doesNotMatch(JSON.stringify(body), /private insert failure/);
  assert.equal(dataClient.event.enrolled_attendees, 0);
  assert.equal(dataClient.eventUpdates.length, 2);
  assert.equal(dataClient.eventUpdates[1].filters.at(-1).value, 1);
});

test("REG-CAP-007: a duplicate registration is rejected before claiming a seat", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 0,
    capacity: 2,
    registrations: [{
      id: "existing-registration",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "pending",
    }],
  });

  const response = await register(base);

  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /already registered/);
  assert.equal(dataClient.eventUpdates.length, 0);
  assert.equal(dataClient.registrations.length, 1);
});

test("REG-CAP-008: withdrawing a pending registration decrements its event count", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 2,
    capacity: 2,
    registrations: [{
      id: "registration-to-withdraw",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "pending",
      events: { start_time: null },
    }],
  });

  const response = await fetch(base + "/api/registrations/registration-to-withdraw/withdraw", {
    method: "PATCH",
    headers: { Authorization: AUTH.Authorization },
  });

  assert.equal(response.status, 200);
  assert.equal(dataClient.registrations[0].status, "withdrawn");
  assert.equal(dataClient.event.enrolled_attendees, 1);
});

test("REG-CAP-009: an event with null expected attendance has no registration cap", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 8,
    capacity: null,
  });

  const response = await register(base);

  assert.equal(response.status, 201);
  assert.equal(dataClient.event.enrolled_attendees, 9);
});

test("REG-CAP-014: a null enrolled counter is claimed with an IS NULL compare", async (t) => {
  const { base, dataClient } = await setup(t, { enrolled: null, capacity: 1 });

  const response = await register(base);

  assert.equal(response.status, 201);
  assert.equal(dataClient.event.enrolled_attendees, 1);
  assert.deepEqual(dataClient.eventUpdates[0].filters.at(-1), {
    column: "enrolled_attendees",
    operator: "is",
    value: null,
  });
});

test("REG-CAP-015: a confirmed registration remains seat-counted and cannot be withdrawn", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 1,
    capacity: 1,
    registrations: [{
      id: "confirmed-registration",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "confirmed",
      events: { start_time: null },
    }],
  });

  const response = await fetch(base + "/api/registrations/confirmed-registration/withdraw", {
    method: "PATCH",
    headers: { Authorization: AUTH.Authorization },
  });

  assert.equal(response.status, 403);
  assert.equal(dataClient.event.enrolled_attendees, 1);
  assert.equal(dataClient.eventUpdates.length, 0);
});

test("REG-CAP-016: concurrent withdrawals of one pending registration release only one seat", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 1,
    capacity: 2,
    registrations: [{
      id: "registration-to-withdraw",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "pending",
      events: { start_time: null },
    }],
  });
  const withdraw = () => fetch(base + "/api/registrations/registration-to-withdraw/withdraw", {
    method: "PATCH",
    headers: { Authorization: AUTH.Authorization },
  });

  const responses = await Promise.all([withdraw(), withdraw()]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(dataClient.event.enrolled_attendees, 0);
  assert.equal(dataClient.eventUpdates.length, 1);
});

test("REG-CAP-010: a pending withdrawal retries its compare-and-set decrement", async (t) => {
  let updates = 0;
  const { base, dataClient } = await setup(t, {
    enrolled: 2,
    capacity: 3,
    registrations: [{
      id: "registration-to-withdraw",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "pending",
      events: { start_time: null },
    }],
    beforeEventUpdate: ({ event }) => {
      updates += 1;
      if (updates === 1) {
        event.enrolled_attendees = 3;
        return false;
      }
      return true;
    },
  });

  const response = await fetch(base + "/api/registrations/registration-to-withdraw/withdraw", {
    method: "PATCH",
    headers: { Authorization: AUTH.Authorization },
  });

  assert.equal(response.status, 200);
  assert.equal(updates, 2);
  assert.equal(dataClient.event.enrolled_attendees, 2);
});

test("REG-CAP-011: a failed withdrawal decrement is logged without failing the withdrawal", async (t) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  t.onTestFinished(() => log.mockRestore());
  let updates = 0;
  const { base, dataClient } = await setup(t, {
    enrolled: 2,
    capacity: 3,
    registrations: [{
      id: "registration-to-withdraw",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "pending",
      events: { start_time: null },
    }],
    beforeEventUpdate: () => {
      updates += 1;
      return false;
    },
  });

  const response = await fetch(base + "/api/registrations/registration-to-withdraw/withdraw", {
    method: "PATCH",
    headers: { Authorization: AUTH.Authorization },
  });

  assert.equal(response.status, 200);
  assert.equal(dataClient.registrations[0].status, "withdrawn");
  assert.equal(dataClient.event.enrolled_attendees, 2);
  assert.equal(updates, 3);
  assert.ok(log.mock.calls.some(([message]) => /seat release failed/.test(message)));
});

test("REG-CAP-012: a withdrawal never decrements the counter below zero", async (t) => {
  const { base, dataClient } = await setup(t, {
    enrolled: 0,
    capacity: 3,
    registrations: [{
      id: "registration-to-withdraw",
      event_id: "event-capacity",
      attendee_id: ATTENDEE.id,
      status: "pending",
      events: { start_time: null },
    }],
  });

  const response = await fetch(base + "/api/registrations/registration-to-withdraw/withdraw", {
    method: "PATCH",
    headers: { Authorization: AUTH.Authorization },
  });

  assert.equal(response.status, 200);
  assert.equal(dataClient.event.enrolled_attendees, 0);
  assert.equal(dataClient.eventUpdates.length, 0);
});
