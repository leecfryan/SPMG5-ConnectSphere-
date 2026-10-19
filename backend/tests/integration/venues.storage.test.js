import { beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { stubSupabase } = require("../helpers/stubSupabase");
const service = require("../../src/modules/venues/venues.service");
let db, query;
beforeEach(() => {
  query = { then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve) };
  for (const key of ["select", "in", "eq", "order", "limit", "neq", "not", "gte", "maybeSingle"]) query[key] = vi.fn(() => query);
  db = stubSupabase({ from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: "created-id", error: null }) });
});
test("[VENUE-DB-001] Both event lookup and picker constrain the real database query to the coordinator", async () => {
  await service.getEventById("event-id", "verified-coordinator");
  expect(query.eq).toHaveBeenCalledWith("coordinator_id", "verified-coordinator");
  query.eq.mockClear();
  await service.listBookableEvents("verified-coordinator");
  expect(query.in).toHaveBeenCalledWith("status", ["APPROVED", "CONFIRMED"]);
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
test("[VENUE-DB-005] The check report's event lookup is coordinator-scoped, unscoped for Venue Staff, and slot rows carry their request id", async () => {
  await service.getEventForCheckReport("event-id", { coordinatorId: "verified-coordinator" });
  expect(query.eq).toHaveBeenCalledWith("coordinator_id", "verified-coordinator");

  // Venue Staff review bookings across every location, so no coordinator filter.
  query.eq.mockClear();
  await service.getEventForCheckReport("event-id", { allVenues: true });
  expect(query.eq).toHaveBeenCalledWith("id", "event-id");
  expect(query.eq).not.toHaveBeenCalledWith("coordinator_id", expect.anything());

  // SCRUM-138: the request id is read back so a check can tell this booking's
  // own rows apart from another live request of the same event.
  query.select.mockClear();
  await service.listSlotRowsForDate("venue-id", "2099-10-10");
  expect(query.select).toHaveBeenCalledWith(expect.stringContaining("request_id(id, event_id)"));
});

// SCRUM-154: changeBookingRequest and cancelBookingRequest are thin RPC
// wrappers, same shape as decideBookingRequest above them in the module -
// these tests pin the call shape and the error-code passthrough the
// controller depends on to tell REQUEST_NOT_FOUND and NOT_LIVE apart. Slots
// are deliberately not a param - the SQL function reads the booking's own
// live slots itself and carries them to the new date.
test("[VENUE-DB-006] changeBookingRequest sends the date and every non-slot field to the atomic change RPC, nothing more", async () => {
  const value = {
    booking_date: "2099-11-01", expected_attendees: 50,
    room_layout: "Theatre", required_facilities: ["Stage"], accessibility_requirements: [],
    additional_requirements: null,
  };
  db.rpc.mockResolvedValue({ data: "request-id", error: null });

  const result = await service.changeBookingRequest("request-id", "verified-user", value);

  expect(result).toBe("request-id");
  expect(db.rpc).toHaveBeenCalledWith("change_venue_booking_request", {
    p_request_id: "request-id",
    p_user_id: "verified-user",
    p_booking_date: "2099-11-01",
    p_expected_attendees: 50,
    p_room_layout: "Theatre",
    p_required_facilities: ["Stage"],
    p_accessibility_requirements: [],
    p_additional_requirements: null,
  });
});

test("[VENUE-DB-007] changeBookingRequest surfaces the RPC's errcode so the controller can map it", async () => {
  const notFound = new Error("REQUEST_NOT_FOUND");
  notFound.code = "P0002";
  db.rpc.mockResolvedValue({ data: null, error: notFound });

  await expect(
    service.changeBookingRequest("missing-id", "verified-user", {
      booking_date: "2099-11-01", expected_attendees: 1, room_layout: "Theatre",
      required_facilities: [], accessibility_requirements: [], additional_requirements: null,
    })
  ).rejects.toMatchObject({ code: "P0002" });
});

test("[VENUE-DB-008] cancelBookingRequest sends only the request id and the verified actor", async () => {
  db.rpc.mockResolvedValue({ data: 2, error: null });

  const result = await service.cancelBookingRequest("request-id", "verified-user");

  expect(result).toBe(2);
  expect(db.rpc).toHaveBeenCalledWith("cancel_venue_booking_request", {
    p_request_id: "request-id",
    p_user_id: "verified-user",
  });
});

test("[VENUE-DB-009] cancelBookingRequest surfaces the RPC's errcode so the controller can map it", async () => {
  const notLive = new Error("NOT_LIVE");
  notLive.code = "P0003";
  db.rpc.mockResolvedValue({ data: null, error: notLive });

  await expect(
    service.cancelBookingRequest("request-id", "verified-user")
  ).rejects.toMatchObject({ code: "P0003" });
});
