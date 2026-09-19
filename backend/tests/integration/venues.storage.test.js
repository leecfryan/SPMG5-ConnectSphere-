import { beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { stubSupabase } = require("../helpers/stubSupabase");
const service = require("../../src/modules/venues/venues.service");
let db, query;
beforeEach(() => {
  query = { then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve) };
  for (const key of ["select", "eq", "order", "limit", "neq", "not", "gte", "maybeSingle"]) query[key] = vi.fn(() => query);
  db = stubSupabase({ from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: "created-id", error: null }) });
});
test("[VENUE-DB-001] Both event lookup and picker constrain the real database query to the coordinator", async () => {
  await service.getEventById("event-id", "verified-coordinator");
  expect(query.eq).toHaveBeenCalledWith("coordinator_id", "verified-coordinator");
  query.eq.mockClear();
  await service.listBookableEvents("verified-coordinator");
  expect(query.eq).toHaveBeenCalledWith("coordinator_id", "verified-coordinator");
});
test("[VENUE-DB-002] Booking list and direct lookup filter parents using the assigned event join", async () => {
  for (const lookup of [() => service.listBookingRequests({ coordinatorId: "coordinator" }),
    () => service.getBookingRequestById("request-id", { coordinatorId: "coordinator" })]) {
    query.eq.mockClear();
    await lookup();
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("event:events!event_id!inner("));
    expect(query.eq).toHaveBeenCalledWith("event.coordinator_id", "coordinator");
  }
});
test("[VENUE-DB-003] Venue Staff have cross-location review access, but missing scope fails closed", async () => {
  await service.listBookingRequests({ allVenues: true });
  expect(query.eq).not.toHaveBeenCalled();
  await expect(service.listBookingRequests()).rejects.toThrow("Missing booking access scope");
  await expect(service.getBookingRequestById("request-id")).rejects.toThrow("Missing booking access scope");
});
test("[VENUE-DB-004] Atomic booking RPC receives only the verified requester and validated fields", async () => {
  const value = { event_id: "event", booking_date: "2099-10-10", slots: ["am"], expected_attendees: 10,
    room_layout: "Theatre", required_facilities: [], accessibility_requirements: [], additional_requirements: null,
    requested_by: "forged-user" };
  await service.submitBookingRequest("venue", "Event", value, "verified-user");
  expect(db.rpc).toHaveBeenCalledWith("submit_authenticated_venue_booking_request", expect.objectContaining({
    p_requested_by: "verified-user", p_venue_id: "venue", p_event_id: "event", p_slots: ["am"],
  }));
});
