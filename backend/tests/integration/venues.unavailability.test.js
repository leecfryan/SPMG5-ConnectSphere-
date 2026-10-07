// SCRUM-133: Venue Staff mark a venue temporarily unavailable.
// Same shape as venueDecisions.test.js: real Express app, stubbed venue service,
// fake verified identities — routing, permission and validation are exercised
// without a database.
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

const venueId = "11111111-1111-4111-8111-111111111111";
const periodId = "44444444-4444-4444-4444-444444444444";
const eventId = "22222222-2222-4222-8222-222222222222";

const venue = {
  id: venueId,
  name: "Integration Hall",
  is_active: true,
  capacity: 200,
  facilities: ["Projector"],
  accessibility_features: ["Lift"],
  room_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { open: "08:00", close: "23:00" }])
  ),
};

const event = {
  id: eventId,
  name: "Assigned conference",
  status: "ACCEPTED",
  start_time: "2099-10-10T00:00:00Z",
  end_time: "2099-10-10T15:00:00Z",
};

const period = {
  id: periodId,
  venue_id: venueId,
  start_date: "2099-11-01",
  end_date: "2099-11-01",
  slots: ["am"],
  reason: "Maintenance",
  created_by: "verified-user",
  created_at: "2026-10-07T00:00:00Z",
  updated_at: "2026-10-07T00:00:00Z",
};

const createBody = {
  start_date: "2099-11-01",
  end_date: "2099-11-01",
  slots: ["am"],
  reason: "Maintenance",
};

const service = Object.fromEntries(
  [
    "listVenues", "getVenueById", "updateVenue", "listBookingsInRange",
    "listUnavailabilityInRange", "getEventById", "listBookableEvents",
    "listSlotRowsForDate", "submitBookingRequest", "getBookingRequestById",
    "listBookingRequests", "decideBookingRequest",
    "createUnavailabilityPeriod", "listUnavailabilityPeriods",
    "getUnavailabilityPeriodById", "updateUnavailabilityPeriod",
    "deleteUnavailabilityPeriod",
  ].map((name) => [name, vi.fn()])
);

const authClient = {
  auth: {
    getUser: async (token) => ({
      data: {
        user: token === "invalid" ? null : {
          id: "verified-user",
          app_metadata: { roles: token.split(",") },
        },
      },
      error: null,
    }),
  },
};

let server, base;

beforeAll(async () => {
  server = createApp({ authClient, venuesService: service }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.getVenueById.mockResolvedValue(venue);
  service.createUnavailabilityPeriod.mockResolvedValue(period);
  service.listUnavailabilityPeriods.mockResolvedValue([period]);
  service.getUnavailabilityPeriodById.mockResolvedValue(period);
  service.updateUnavailabilityPeriod.mockResolvedValue(period);
  service.deleteUnavailabilityPeriod.mockResolvedValue({ id: periodId });
  service.listUnavailabilityInRange.mockResolvedValue([]);
  service.listBookingsInRange.mockResolvedValue([]);
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.getEventById.mockResolvedValue(event);
  service.listBookableEvents.mockResolvedValue([event]);
});

function send(path, role = "venue_staff", method = "GET", data) {
  return fetch(`${base}/api/venues${path}`, {
    method,
    headers: {
      ...(role ? { Authorization: "Bearer " + role } : {}),
      "Content-Type": "application/json",
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

test("[TC-SCRUM-133-01] Venue Staff creates a single-day, single-slot unavailability period", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST", createBody);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.data).toMatchObject({ start_date: "2099-11-01", slots: ["am"], reason: "Maintenance" });
  expect(service.createUnavailabilityPeriod).toHaveBeenCalledWith(
    venueId,
    expect.objectContaining({ start_date: "2099-11-01", slots: ["am"], reason: "Maintenance" }),
    "verified-user"
  );
});

test("[TC-SCRUM-133-02] Multi-day, multi-slot period is created successfully", async () => {
  const multiBody = { start_date: "2099-11-01", end_date: "2099-11-03", slots: ["am", "pm"], reason: "Renovation" };
  const multiPeriod = { ...period, ...multiBody };
  service.createUnavailabilityPeriod.mockResolvedValue(multiPeriod);
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST", multiBody);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.data.end_date).toBe("2099-11-03");
  expect(json.data.slots).toEqual(["am", "pm"]);
});

test("[TC-SCRUM-133-03] Booking request is blocked when the slot is marked unavailable", async () => {
  service.listUnavailabilityInRange.mockResolvedValue([
    { unavailable_date: "2099-10-10", slot: "am", reason: "Maintenance" },
  ]);
  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId, booking_date: "2099-10-10", slots: ["am"],
    expected_attendees: 100, room_layout: "Theatre",
    required_facilities: [], accessibility_requirements: [],
  });
  expect(res.status).toBe(409);
});

test("[TC-SCRUM-133-04] Multiple slots blocked when all are covered by an unavailability period", async () => {
  service.listUnavailabilityInRange.mockResolvedValue([
    { unavailable_date: "2099-10-10", slot: "am", reason: "Renovation" },
    { unavailable_date: "2099-10-10", slot: "pm", reason: "Renovation" },
  ]);
  for (const slot of ["am", "pm"]) {
    const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
      event_id: eventId, booking_date: "2099-10-10", slots: [slot],
      expected_attendees: 100, room_layout: "Theatre",
      required_facilities: [], accessibility_requirements: [],
    });
    expect(res.status).toBe(409);
  }
});

test("[TC-SCRUM-133-05] Creating an unavailability period does not modify existing confirmed bookings", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST", createBody);
  expect(res.status).toBe(201);
  expect(service.createUnavailabilityPeriod).toHaveBeenCalled();
  expect(service.decideBookingRequest).not.toHaveBeenCalled();
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});

test("[TC-SCRUM-133-06] Venue Staff edits an existing period's reason and end date", async () => {
  const updated = { ...period, reason: "Updated reason", end_date: "2099-11-02" };
  service.updateUnavailabilityPeriod.mockResolvedValue(updated);
  const res = await send(`/${venueId}/unavailability/${periodId}`, "venue_staff", "PATCH",
    { reason: "Updated reason", end_date: "2099-11-02" });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.data.reason).toBe("Updated reason");
  expect(json.data.end_date).toBe("2099-11-02");
});

test("[TC-SCRUM-133-07] Ending a period early by shortening its end_date succeeds", async () => {
  const existing = { ...period, start_date: "2099-11-01", end_date: "2099-11-05" };
  const shortened = { ...existing, end_date: "2099-11-02" };
  service.getUnavailabilityPeriodById.mockResolvedValue(existing);
  service.updateUnavailabilityPeriod.mockResolvedValue(shortened);
  const res = await send(`/${venueId}/unavailability/${periodId}`, "venue_staff", "PATCH",
    { end_date: "2099-11-02" });
  expect(res.status).toBe(200);
  expect((await res.json()).data.end_date).toBe("2099-11-02");
});

test("[TC-SCRUM-133-08] Venue Staff lists unavailability periods for a venue", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff");
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(Array.isArray(json.data)).toBe(true);
  expect(json.data).toHaveLength(1);
  expect(json.data[0].id).toBe(periodId);
});

test("[TC-SCRUM-133-09] Event Coordinator cannot create an unavailability period", async () => {
  const res = await send(`/${venueId}/unavailability`, "event_coordinator", "POST", createBody);
  expect(res.status).toBe(403);
  expect(service.createUnavailabilityPeriod).not.toHaveBeenCalled();
});

test("[TC-SCRUM-133-10] Unauthenticated request is refused", async () => {
  const res = await send(`/${venueId}/unavailability`, "", "POST", createBody);
  expect(res.status).toBe(401);
});

test("[TC-SCRUM-133-11] Non-existent venue returns 404", async () => {
  service.getVenueById.mockResolvedValue(null);
  const fakeId = "99999999-9999-4999-8999-999999999999";
  const res = await send(`/${fakeId}/unavailability`, "venue_staff", "POST", createBody);
  expect(res.status).toBe(404);
});

test("[TC-SCRUM-133-12] Invalid slot value is rejected with 400", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST",
    { ...createBody, slots: ["noon"] });
  expect(res.status).toBe(400);
  expect(service.createUnavailabilityPeriod).not.toHaveBeenCalled();
});

test("[TC-SCRUM-133-13] end_date before start_date is rejected with 400", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST",
    { ...createBody, start_date: "2099-11-05", end_date: "2099-11-01" });
  expect(res.status).toBe(400);
  expect(service.createUnavailabilityPeriod).not.toHaveBeenCalled();
});

test("[TC-SCRUM-133-14] PATCH with end_date before the period start_date is rejected with 400", async () => {
  service.getUnavailabilityPeriodById.mockResolvedValue({ ...period, start_date: "2099-11-01" });
  const res = await send(`/${venueId}/unavailability/${periodId}`, "venue_staff", "PATCH",
    { end_date: "2099-10-01" });
  expect(res.status).toBe(400);
  expect(service.updateUnavailabilityPeriod).not.toHaveBeenCalled();
});

test("[TC-SCRUM-133-15] Minimum period (one slot, one day) is accepted", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST",
    { start_date: "2099-11-01", end_date: "2099-11-01", slots: ["am"], reason: "Maintenance" });
  expect(res.status).toBe(201);
});

test("[TC-SCRUM-133-16] New booking request is blocked after an unavailability period covers that slot", async () => {
  service.listUnavailabilityInRange.mockResolvedValue([
    { unavailable_date: "2099-10-10", slot: "am", reason: "Maintenance" },
  ]);
  const res = await send(`/${venueId}/booking-requests`, "event_coordinator", "POST", {
    event_id: eventId, booking_date: "2099-10-10", slots: ["am"],
    expected_attendees: 100, room_layout: "Theatre",
    required_facilities: [], accessibility_requirements: [],
  });
  expect(res.status).toBe(409);
});

test("[TC-SCRUM-133-17] Editing end_date to equal start_date (single-day period) is accepted", async () => {
  const existing = { ...period, start_date: "2099-11-01", end_date: "2099-11-05" };
  const singleDay = { ...existing, end_date: "2099-11-01" };
  service.getUnavailabilityPeriodById.mockResolvedValue(existing);
  service.updateUnavailabilityPeriod.mockResolvedValue(singleDay);
  const res = await send(`/${venueId}/unavailability/${periodId}`, "venue_staff", "PATCH",
    { end_date: "2099-11-01" });
  expect(res.status).toBe(200);
  expect((await res.json()).data.end_date).toBe("2099-11-01");
});

test("[TC-SCRUM-133-18] Creating a period overlapping a confirmed booking does not alter that booking", async () => {
  const res = await send(`/${venueId}/unavailability`, "venue_staff", "POST", {
    start_date: "2099-11-01", end_date: "2099-11-05", slots: ["am"], reason: "Renovation",
  });
  expect(res.status).toBe(201);
  expect(service.decideBookingRequest).not.toHaveBeenCalled();
  expect(service.submitBookingRequest).not.toHaveBeenCalled();
});

test("[TC-SCRUM-133-19] PATCH on a non-existent or wrong-venue period returns 404", async () => {
  service.getUnavailabilityPeriodById.mockResolvedValue(null);
  const res = await send(`/${venueId}/unavailability/${periodId}`, "venue_staff", "PATCH",
    { reason: "Updated" });
  expect(res.status).toBe(404);
  expect(service.updateUnavailabilityPeriod).not.toHaveBeenCalled();
});
