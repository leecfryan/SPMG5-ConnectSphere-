import { expect, test, vi } from "vitest";
const eventRoutes = require("../../../src/modules/registrations/eventHandlers");
const registrationRoutes = require("../../../src/modules/registrations/registrationHandlers");

// Isolate each read handler from HTTP/auth/storage. The explicit public field
// contracts prevent SELECT * (including in joins) from leaking future columns.
test.each([
  ["ATT-UNIT-001", "event listing", eventRoutes, "/", "events",
    "id,name,description,start_time,status"],
  ["ATT-UNIT-002", "event detail", eventRoutes, "/event-public", "events",
    "id,name,purpose,description,start_time,end_time,expected_attendance,status,registration_fields"],
  ["ATT-UNIT-003", "own registration listing", registrationRoutes, "/me", "registrations",
    "id,event_id,status,created_at,updated_at,registration_data,events(name,start_time)"],
  ["ATT-UNIT-004", "own registration detail", registrationRoutes, "/me/registration-own", "registrations",
    "id,event_id,status,created_at,updated_at,registration_data,events(start_time)"],
])("[%s] %s selects only the attendee-facing field contract", async (_id, _scenario, routes, url, table, allowedFields) => {
  const data = url === "/" || url === "/me" ? [] : { id: "public-record" };
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
  };
  const client = { from: vi.fn(() => query) };
  const response = await new Promise((resolve, reject) => {
    const res = { status: vi.fn().mockReturnThis(), json: resolve };
    routes(client)({ method: "GET", url, user: { id: "attendee-a" } }, res,
      error => reject(error || new Error("Expected read route was not handled")));
  });
  expect(response).toBeDefined();
  expect(client.from).toHaveBeenCalledExactlyOnceWith(table);
  expect(query.select).toHaveBeenCalledOnce();
  const selected = query.select.mock.calls[0][0];
  expect(typeof selected).toBe("string");
  expect(selected.replace(/\s/g, "")).toBe(allowedFields);
});
