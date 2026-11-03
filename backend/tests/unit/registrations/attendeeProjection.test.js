import { expect, test, vi } from "vitest";
const eventRoutes = require("../../../src/modules/registrations/eventHandlers");
const registrationRoutes = require("../../../src/modules/registrations/registrationHandlers");

// Isolate each read handler from HTTP/auth/storage. The explicit public field
// contracts prevent SELECT * (including in joins) from leaking future columns.
test.each([
  ["ATT-UNIT-001", "event listing", eventRoutes, "/", "events",
    "id,name,description,start_time,status,enrolled_attendees,expected_attendance"],
  ["ATT-UNIT-002", "event detail", eventRoutes, "/event-public", "events",
    "id,name,purpose,description,start_time,end_time,enrolled_attendees,expected_attendance,status,registration_fields"],
  ["ATT-UNIT-003", "own registration listing", registrationRoutes, "/me", "registrations",
    "id,event_id,status,created_at,updated_at,registration_data,events(name,start_time)"],
  ["ATT-UNIT-004", "own registration detail", registrationRoutes, "/me/registration-own", "registrations",
    "id,event_id,status,created_at,updated_at,registration_data,events(start_time)"],
])("[%s] %s selects only the attendee-facing field contract", async (_id, _scenario, routes, url, table, allowedFields) => {
  const data = url === "/" || url === "/me" ? [] : { id: "public-record" };
  const queries = [];
  const client = {
    from: vi.fn((queriedTable) => {
      const query = {
        table: queriedTable,
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      queries.push(query);
      return query;
    }),
    rpc: vi.fn(async (name, args) => ({
      data: name === "registration_availability_for_events"
        ? args.p_event_ids.map((event_id) => ({
          event_id,
          slots_remaining: 1,
          waitlist_queue_count: 0,
          waitlist_reserved: 0,
        }))
        : null,
      error: null,
    })),
  };
  const response = await new Promise((resolve, reject) => {
    const res = { status: vi.fn().mockReturnThis(), json: resolve };
    routes(client)({ method: "GET", url, user: { id: "attendee-a" } }, res,
      error => reject(error || new Error("Expected read route was not handled")));
  });
  expect(response).toBeDefined();
  expect(client.from).toHaveBeenCalledWith(table);
  const query = queries.find((entry) => entry.table === table);
  expect(query.select).toHaveBeenCalledOnce();
  const selected = query.select.mock.calls[0][0];
  expect(typeof selected).toBe("string");
  expect(selected.replace(/\s/g, "")).toBe(allowedFields);
  if (url === "/event-public") {
    expect(client.rpc).toHaveBeenCalledWith("registration_availability_for_events", {
      p_event_ids: ["public-record"],
    });
  }
  if (url === "/me") {
    expect(client.from.mock.calls.map(([queriedTable]) => queriedTable)).toEqual([
      "registrations",
      "event_waitlist_entries",
      "event_waitlist_entries",
    ]);
  }
});
