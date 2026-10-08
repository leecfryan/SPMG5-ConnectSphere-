import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { createManagedEventsService } = require("../../src/modules/managedEvents/managedEvents.service");

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const ORGANISER_ID = "organiser-user";
const COORDINATOR_ID = "coordinator-user";

function makeDataClient(overrides = {}) {
  const event = {
    id: EVENT_ID,
    name: "Window test event",
    purpose: "Test event",
    description: "Test registration windows",
    start_time: "2031-02-01T10:00:00.000Z",
    end_time: "2031-02-01T12:00:00.000Z",
    status: "APPROVED",
    registration_fields: [],
    enrolled_attendees: 0,
    expected_attendance: 5,
    registration_start: null,
    registration_end: null,
    organiser_id: ORGANISER_ID,
    coordinator_id: COORDINATOR_ID,
    ...overrides,
  };
  const registrations = [];
  const eventUpdates = [];

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.type === "or") return filter.values.some(([field, value]) => row[field] === value);
      if (filter.operator === "is") return row[filter.field] === filter.value;
      return row[filter.field] === filter.value;
    });
  }

  return {
    event,
    registrations,
    eventUpdates,
    from(table) {
      const rows = table === "events" ? [event] : registrations;
      const query = { operation: "select", filters: [] };
      let selection;
      const execute = (single) => {
        let found = rows.filter((row) => matches(row, query.filters));
        if (query.operation === "update") {
          found.forEach((row) => Object.assign(row, query.values));
          if (table === "events") eventUpdates.push({ ...query.values });
        }
        if (query.operation === "insert") {
          const inserted = {
            id: `registration-${registrations.length + 1}`,
            ...query.values,
          };
          registrations.push(inserted);
          found = [inserted];
        }
        const data = found.map((row) => selection && selection !== "*" ?
          Object.fromEntries(selection.split(",").map((field) => [field.trim(), row[field.trim()]])) :
          { ...row });
        return { data: single ? data[0] ?? null : data, error: null };
      };

      const builder = {
        select(fields) {
          selection = fields;
          return builder;
        },
        eq(field, value) {
          query.filters.push({ field, value });
          return builder;
        },
        is(field, value) {
          query.filters.push({ field, value, operator: "is" });
          return builder;
        },
        or(filter) {
          query.filters.push({
            type: "or",
            values: filter.split(",").map((part) => {
              const [field, , value] = part.split(".");
              return [field, value];
            }),
          });
          return builder;
        },
        update(values) {
          query.operation = "update";
          query.values = values;
          return builder;
        },
        insert(values) {
          query.operation = "insert";
          query.values = values;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(execute(true));
        },
        single() {
          return Promise.resolve(execute(true));
        },
        then(resolve, reject) {
          return Promise.resolve(execute(false)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

let dataClient;
let server;
let baseUrl;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  dataClient = makeDataClient();
  const app = createApp({
    authClient: {
      auth: {
        getUser: async (token) => {
          const identity = token === "event_organiser"
            ? { id: ORGANISER_ID, roles: ["event_organiser"] }
            : token === "event_coordinator"
              ? { id: COORDINATOR_ID, roles: ["event_coordinator"] }
              : { id: "attendee-user", roles: ["attendee"] };
          return {
            data: {
              user: {
                id: identity.id,
                app_metadata: { roles: identity.roles },
              },
            },
            error: null,
          };
        },
      },
    },
    dataClient,
    managedEventsService: createManagedEventsService(dataClient),
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "test-public-key",
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  vi.useRealTimers();
});

async function request(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  return { status: response.status, body: await response.json() };
}

function register() {
  return request("/api/registrations", "attendee", {
    method: "POST",
    body: JSON.stringify({ eventId: EVENT_ID }),
  });
}

describe("registration-window server enforcement", () => {
  test("the event list window endpoint returns only approved events and server time", async () => {
    dataClient.event.registration_start = "2030-01-02T00:00:00.000Z";

    const result = await request("/api/events/registration-windows", "attendee");

    expect(result.status).toBe(200);
    expect(result.body.windows).toEqual([{
      id: EVENT_ID,
      registration_start: "2030-01-02T00:00:00.000Z",
      registration_end: null,
    }]);
    expect(Number.isFinite(Date.parse(result.body.server_time))).toBe(true);
  });

  test("the event detail window endpoint returns the window and server time", async () => {
    dataClient.event.registration_end = "2030-01-03T00:00:00.000Z";

    const result = await request(`/api/events/registration-windows/${EVENT_ID}`, "attendee");

    expect(result.status).toBe(200);
    expect(result.body.window).toEqual({
      registration_start: null,
      registration_end: "2030-01-03T00:00:00.000Z",
    });
    expect(Number.isFinite(Date.parse(result.body.server_time))).toBe(true);
  });

  test("a request before registration_start is refused without claiming a seat", async () => {
    dataClient.event.registration_start = "2030-01-01T00:00:01.000Z";

    const result = await register();

    expect(result.status).toBe(409);
    expect(result.body.message).toBe(
      "Registration has not opened yet. It opens on 2030-01-01T00:00:01.000Z.",
    );
    expect(dataClient.event.enrolled_attendees).toBe(0);
    expect(dataClient.eventUpdates).toHaveLength(0);
    expect(dataClient.registrations).toHaveLength(0);
  });

  test("a request after registration_end is refused without claiming a seat", async () => {
    dataClient.event.registration_end = "2029-12-31T23:59:59.999Z";

    const result = await register();

    expect(result.status).toBe(409);
    expect(result.body.message).toBe("Registration has closed.");
    expect(dataClient.event.enrolled_attendees).toBe(0);
    expect(dataClient.eventUpdates).toHaveLength(0);
    expect(dataClient.registrations).toHaveLength(0);
  });

  test("registration_start is inclusive", async () => {
    dataClient.event.registration_start = "2030-01-01T00:00:00.000Z";

    const result = await register();

    expect(result.status).toBe(201);
    expect(dataClient.event.enrolled_attendees).toBe(1);
  });

  test("registration_end is inclusive", async () => {
    dataClient.event.registration_end = "2030-01-01T00:00:00.000Z";

    const result = await register();

    expect(result.status).toBe(201);
    expect(dataClient.event.enrolled_attendees).toBe(1);
  });

  test("a registration inside its window succeeds", async () => {
    dataClient.event.registration_start = "2029-12-31T23:59:59.000Z";
    dataClient.event.registration_end = "2030-01-01T00:00:01.000Z";

    const result = await register();

    expect(result.status).toBe(201);
    expect(dataClient.event.enrolled_attendees).toBe(1);
  });

  test("null boundaries preserve immediate, unlimited-time registration", async () => {
    const result = await register();

    expect(result.status).toBe(201);
    expect(dataClient.event.enrolled_attendees).toBe(1);
  });
});

describe("managed registration-window updates", () => {
  test("a managed event read exposes its window separately from the summary", async () => {
    dataClient.event.registration_start = "2030-01-02T00:00:00.000Z";

    const result = await request(
      `/api/managed-events/${EVENT_ID}/registration-window`,
      "event_organiser",
    );

    expect(result.status).toBe(200);
    expect(result.body.window).toEqual({
      registration_start: "2030-01-02T00:00:00.000Z",
      registration_end: null,
    });
    expect(Number.isFinite(Date.parse(result.body.server_time))).toBe(true);
  });

  test("an end-only patch can extend a closed window and registration succeeds", async () => {
    dataClient.event.registration_end = "2029-12-31T23:59:59.000Z";
    const updated = await request(
      `/api/managed-events/${EVENT_ID}/registration-window`,
      "event_coordinator",
      { method: "PATCH", body: JSON.stringify({ registration_end: "2030-01-01T01:00:00.000Z" }) },
    );

    expect(updated.status).toBe(200);
    expect(updated.body.event.registration_end).toBe("2030-01-01T01:00:00.000Z");
    expect(dataClient.event.registration_start).toBeNull();
    expect((await register()).status).toBe(201);
  });

  test("a partial patch validates its end against the stored start", async () => {
    dataClient.event.registration_start = "2030-01-01T01:00:00.000Z";

    const result = await request(
      `/api/managed-events/${EVENT_ID}/registration-window`,
      "event_organiser",
      { method: "PATCH", body: JSON.stringify({ registration_end: "2030-01-01T00:30:00.000Z" }) },
    );

    expect(result.status).toBe(400);
    expect(result.body.details).toContainEqual({
      field: "registration_end",
      message: "must be after registration_start",
    });
    expect(dataClient.event.registration_end).toBeNull();
  });

  test("an attendee cannot update a registration window", async () => {
    const result = await request(
      `/api/managed-events/${EVENT_ID}/registration-window`,
      "attendee",
      { method: "PATCH", body: JSON.stringify({ registration_end: "2030-01-02T00:00" }) },
    );

    expect(result.status).toBe(403);
    expect(dataClient.eventUpdates).toHaveLength(0);
  });
});
