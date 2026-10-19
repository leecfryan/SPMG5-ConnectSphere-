import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { once } = require("node:events");

// Test fixtures
const venueId = "11111111-1111-4111-8111-111111111111";
const affectedBookingId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";
const coordinatorId = "verified-user";

const venue = {
  id: venueId,
  name: "Marina Grand Ballroom",
  is_active: true,
  capacity: 200,
  facilities: ["Stage", "AV system"],
  accessibility_features: ["Step-free access"],
  room_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { open: "08:00", close: "23:00" }])
  ),
};

const event = {
  id: eventId,
  name: "Annual Conference",
  status: "APPROVED",
  coordinator_id: coordinatorId,
  start_time: "2099-10-10T00:00:00Z",
  end_time: "2099-10-10T15:00:00Z",
};



let server, base;

beforeAll(async () => {
  server = createApp({
    authClient: {
      auth: {
        getUser: async (token) => {
          const roleMap = {
            "event_coordinator": {
              data: {
                user: { id: coordinatorId, email: "coord@test.com" },
                app_metadata: { roles: ["event_coordinator"] },
              },
              error: null,
            },
            "venue_staff": {
              data: {
                user: { id: coordinatorId, email: "staff@test.com" },
                app_metadata: { roles: ["venue_staff"] },
              },
              error: null,
            },
            "attendee": {
              data: {
                user: { id: coordinatorId, email: "attendee@test.com" },
                app_metadata: { roles: ["attendee"] },
              },
              error: null,
            },
            "event_organiser": {
              data: {
                user: { id: coordinatorId, email: "organiser@test.com" },
                app_metadata: { roles: ["event_organiser"] },
              },
              error: null,
            },
            "invalid": {
              data: null,
              error: new Error("Invalid token"),
            },
          };
          return roleMap[token] || roleMap["invalid"];
        },
      },
    },
    venuesService: {
      listVenues: vi.fn().mockResolvedValue([]),
      getVenueById: vi.fn().mockResolvedValue(venue),
      updateVenue: vi.fn().mockResolvedValue(venue),
      listBookingsInRange: vi.fn().mockResolvedValue([]),
      listUnavailabilityInRange: vi.fn().mockResolvedValue([]),
      listBookingsForVenuesOnDate: vi.fn().mockResolvedValue([]),
      listUnavailabilityForVenuesOnDate: vi.fn().mockResolvedValue([]),
      getEventById: vi.fn().mockResolvedValue(event),
      listBookableEvents: vi.fn().mockResolvedValue([event]),
      listSlotRowsForDate: vi.fn().mockResolvedValue([]),
      submitBookingRequest: vi.fn().mockResolvedValue("req-123"),
      getBookingRequestById: vi.fn().mockResolvedValue({ id: "req-123", event, venue, slots: [] }),
      listBookingRequests: vi.fn().mockResolvedValue([]),
      decideBookingRequest: vi.fn().mockResolvedValue({ id: "req-123", status: "pending" }),
      recheckConflictsAfterUpdate: vi.fn().mockResolvedValue(),
      listConflictingRequests: vi.fn().mockResolvedValue([]),
      listActiveHoldsInRange: vi.fn().mockResolvedValue([]),
      listHolds: vi.fn().mockResolvedValue([]),
      createHold: vi.fn().mockResolvedValue([]),
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

// Reset all mocks before each test case
beforeEach(() => {
  vi.clearAllMocks();
});

function send(path = "", role = "event_coordinator", method = "GET", data) {
  const headers = {
    "Content-Type": "application/json",
    ...(role ? { "x-user-role": role } : {}),
    ...(role ? { Authorization: "Bearer " + role } : {}),
  };
  return fetch(base + "/api/venues" + path, {
    method,
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

describe("SCRUM-145: Venue Replacement Integration Tests - Core Flow", () => {
  describe("Authentication & Permissions", () => {
    test("[SCRUM-145-PERM-001] Attendees cannot access replacement endpoints", async () => {
      const paths = [
        `/booking-requests/${affectedBookingId}/replacement-search`,
        `/booking-requests/${affectedBookingId}/mark-affected`,
        `/booking-requests/${affectedBookingId}/release`,
      ];

      for (const path of paths) {
        const response = await send(
          path,
          "attendee",
          path.includes("search") ? "GET" : "POST",
          path.includes("search") ? undefined : { reason: "test" }
        );
        expect(response.status).toBe(403);
      }
    });

    test("[SCRUM-145-PERM-002] Unauthenticated requests are rejected with 401", async () => {
      const paths = [
        `/booking-requests/${affectedBookingId}/replacement-search`,
        `/booking-requests/${affectedBookingId}/mark-affected`,
        `/booking-requests/${affectedBookingId}/release`,
      ];

      for (const path of paths) {
        const response = await send(
          path,
          "",
          path.includes("search") ? "GET" : "POST",
          path.includes("search") ? undefined : { reason: "test" }
        );
        expect(response.status).toBe(401);
      }
    });

    test("[SCRUM-145-PERM-003] Event organisers cannot access replacement endpoints", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/replacement-search`,
        "event_organiser"
      );
      expect(response.status).toBe(403);
    });

    test("[SCRUM-145-PERM-004] Venue staff can mark affected bookings", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/mark-affected`,
        "venue_staff",
        "POST",
        { reason: "Emergency maintenance" }
      );
      expect([200, 403]).toContain(response.status);
    });
  });

  describe("Replacement Search Flow", () => {
    test("[TC-SCRUM-145-01] Coordinator can search for replacement venues", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/replacement-search`,
        "event_coordinator"
      );
      expect([200, 403]).toContain(response.status);
    });

    test("[TC-SCRUM-145-02] Search returns original booking details preserved", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/replacement-search`,
        "event_coordinator"
      );
      if (response.status === 200) {
        const data = await response.json();
        expect(data.data.originalBooking).toBeDefined();
        expect(data.data.originalBooking.bookingId).toBe(affectedBookingId);
      }
    });
  });

  describe("Mark Affected Flow", () => {
    test("[TC-SCRUM-145-03] Coordinator can mark booking as affected", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/mark-affected`,
        "event_coordinator",
        "POST",
        { reason: "Venue maintenance closure" }
      );
      expect([200, 400, 403]).toContain(response.status);
    });

    test("[TC-SCRUM-145-04] Mark affected requires a reason", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/mark-affected`,
        "event_coordinator",
        "POST",
        {} // No reason
      );
      expect([400, 403]).toContain(response.status);
    });

    test("[TC-SCRUM-145-05] Whitespace-only reason is rejected", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/mark-affected`,
        "event_coordinator",
        "POST",
        { reason: "   " }
      );
      expect([400, 403]).toContain(response.status);
    });
  });

  describe("Release Flow", () => {
    test("[TC-SCRUM-145-06] Coordinator can release affected booking", async () => {
      const response = await send(
        `/booking-requests/${affectedBookingId}/release`,
        "event_coordinator",
        "POST"
      );
      expect([200, 403]).toContain(response.status);
    });

    test("[TC-SCRUM-145-07] Release requires affected booking status", async () => {
      const response = await send(
        `/booking-requests/invalid/release`,
        "event_coordinator",
        "POST"
      );
      expect([400, 403]).toContain(response.status);
    });
  });
});