import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");

const venueId = "11111111-1111-4111-8111-111111111111";
const originalBookingId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const coordinatorId = "44444444-4444-4444-8444-444444444444";

const venue = {
  id: venueId,
  name: "Replacement Hall",
  is_active: true,
  capacity: 120,
  facilities: ["Projector"],
  accessibility_features: ["Lift"],
  room_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { open: "08:00", close: "23:00" }]),
  ),
};

const replacementBody = {
  event_id: eventId,
  booking_date: "2099-10-10",
  slots: ["am"],
  expected_attendees: 100,
  room_layout: "Theatre",
  required_facilities: ["Projector"],
  accessibility_requirements: ["Lift"],
  purpose: "Annual conference",
  replaces_booking_id: originalBookingId,
};

const service = {
  getVenueById: vi.fn(),
  getEventById: vi.fn(),
  listSlotRowsForDate: vi.fn(),
  listUnavailabilityInRange: vi.fn(),
  listActiveHoldsInRange: vi.fn(),
  submitBookingRequest: vi.fn(),
  getBookingRequestById: vi.fn(),
  searchReplacementVenues: vi.fn(),
  markVenueBookingAffected: vi.fn(),
  releaseAffectedVenueBooking: vi.fn(),
};

let server;
let base;

beforeAll(async () => {
  server = createApp({
    authClient: {
      auth: {
        getUser: async (token) => {
          const roles = token === "coordinator" ? ["event_coordinator"]
            : token === "staff" ? ["venue_staff"]
              : token === "attendee" ? ["attendee"] : [];
          return roles.length > 0
            ? { data: { user: { id: coordinatorId, app_metadata: { roles } } }, error: null }
            : { data: { user: null }, error: new Error("Invalid token") };
        },
      },
    },
    venuesService: service,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.clearAllMocks();
  service.getVenueById.mockResolvedValue(venue);
  service.getEventById.mockResolvedValue({
    id: eventId,
    name: "Annual conference",
    status: "PREPARATION",
    start_time: "2099-10-10T00:00:00Z",
    end_time: "2099-10-10T15:00:00Z",
  });
  service.listSlotRowsForDate.mockResolvedValue([]);
  service.listUnavailabilityInRange.mockResolvedValue([]);
  service.listActiveHoldsInRange.mockResolvedValue([]);
  service.submitBookingRequest.mockResolvedValue("55555555-5555-4555-8555-555555555555");
  service.getBookingRequestById.mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    venue,
    event: { id: eventId, name: "Annual conference" },
    slots: [{ slot: "am", status: "pending" }],
  });
});

function send(path, { token = "coordinator", method = "GET", body } = {}) {
  return fetch(base + "/api/venues" + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("SCRUM-145 venue replacement routes", () => {
  test("[SCRUM-145] AC1: the assigned coordinator receives the preserved affected booking and candidates", async () => {
    const result = {
      originalBooking: { bookingId: originalBookingId, eventId, venueName: "Closed Hall", slots: ["am"] },
      candidateVenues: [{ venueId, name: venue.name }],
    };
    service.searchReplacementVenues.mockResolvedValue(result);

    const response = await send(`/booking-requests/${originalBookingId}/replacement-search?minCapacity=100&facilities=Projector`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: result });
    expect(service.searchReplacementVenues).toHaveBeenCalledWith(originalBookingId, coordinatorId, {
      minCapacity: 100,
      facilities: ["Projector"],
      accessibility: undefined,
      roomLayout: undefined,
    });
  });

  test("[SCRUM-145] AC1: an invalid replacement search id is refused before storage", async () => {
    const response = await send("/booking-requests/not-a-uuid/replacement-search");

    expect(response.status).toBe(400);
    expect(service.searchReplacementVenues).not.toHaveBeenCalled();
  });

  test("[SCRUM-145] AC3: an ordinary request remains blocked in PREPARATION", async () => {
    const ordinaryBody = { ...replacementBody };
    delete ordinaryBody.replaces_booking_id;

    const response = await send(`/${venueId}/booking-requests`, { method: "POST", body: ordinaryBody });

    expect(response.status).toBe(400);
    expect(service.submitBookingRequest).not.toHaveBeenCalled();
  });

  test("[SCRUM-145] AC5: a linked replacement is allowed in PREPARATION for safety review to run again", async () => {
    const response = await send(`/${venueId}/booking-requests`, { method: "POST", body: replacementBody });

    expect(response.status).toBe(201);
    expect(service.submitBookingRequest).toHaveBeenCalledWith(
      venueId,
      "Annual conference",
      expect.objectContaining({ replaces_booking_id: originalBookingId }),
      coordinatorId,
    );
  });

  test("[SCRUM-145] AC2: an attendee cannot search, mark, or release a replacement booking", async () => {
    for (const [path, method] of [
      [`/booking-requests/${originalBookingId}/replacement-search`, "GET"],
      [`/booking-requests/${originalBookingId}/mark-affected`, "POST"],
      [`/booking-requests/${originalBookingId}/release`, "POST"],
    ]) {
      const response = await send(path, { token: "attendee", method, body: method === "POST" ? { reason: "Maintenance" } : undefined });
      expect(response.status).toBe(403);
    }
  });

  test("[SCRUM-145] AC3: the coordinator can release an affected booking", async () => {
    service.releaseAffectedVenueBooking.mockResolvedValue(originalBookingId);

    const response = await send(`/booking-requests/${originalBookingId}/release`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(service.releaseAffectedVenueBooking).toHaveBeenCalledWith(originalBookingId, coordinatorId);
  });
});
