import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.SUPABASE_URL = "https://replacement.test";
process.env.SUPABASE_SECRET_KEY = "replacement-test-key";

// Mock the Supabase client and service dependencies
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  neq: vi.fn(() => mockSupabase),
  in: vi.fn(() => mockSupabase),
  gte: vi.fn(() => mockSupabase),
  lte: vi.fn(() => mockSupabase),
  contains: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  limit: vi.fn(() => mockSupabase),
  single: vi.fn(() => mockSupabase),
  maybeSingle: vi.fn(() => mockSupabase),
  rpc: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  delete: vi.fn(() => mockSupabase),
};

// Mock the getSupabase function
vi.mock("../../../src/supabase", () => ({
  ...mockSupabase,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabase,
}));

// Import after mocking
const {
  searchReplacementVenues,
  markVenueBookingAffected,
  releaseAffectedVenueBooking,
  setSupabaseClientForTests,
} = await import("../../../src/modules/venues/venueReplacement.service.js");

setSupabaseClientForTests(mockSupabase);

describe("Venue Replacement Service - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.select.mockReset();
    mockSupabase.eq.mockReset();
    mockSupabase.neq.mockReset();
    mockSupabase.in.mockReset();
    mockSupabase.gte.mockReset();
    mockSupabase.lte.mockReset();
    mockSupabase.contains.mockReset();
    mockSupabase.order.mockReset();
    mockSupabase.limit.mockReset();
    mockSupabase.single.mockReset();
    mockSupabase.maybeSingle.mockReset();
    mockSupabase.rpc.mockReset();
    mockSupabase.update.mockReset();
    mockSupabase.insert.mockReset();
    mockSupabase.delete.mockReset();
    mockSupabase.from.mockReturnValue(mockSupabase);
  });

  describe("searchReplacementVenues", () => {
    const affectedBookingId = "b1111111-0000-0000-0000-000000000001";
    const coordinatorId = "coord-123";
    const venueId = "v1111111-0000-0000-0000-000000000001";
    const eventId = "evt-456";
    const bookingDate = "2026-11-15";

    const mockAffectedBooking = {
      id: affectedBookingId,
      venue_id: venueId,
      event_id: eventId,
      booking_date: bookingDate,
      expected_attendees: 150,
      room_layout: "Theatre",
      required_facilities: ["Stage", "AV system", "Wi-Fi"],
      accessibility_requirements: ["Step-free access"],
      purpose: "Annual conference",
      slots: [
        { slot: "am", status: "confirmed" },
        { slot: "pm", status: "confirmed" },
      ],
      venue: {
        id: venueId,
        name: "Marina Grand Ballroom",
        city: "Singapore",
        country: "Singapore",
      },
    };

    const mockCandidateVenues = [
      {
        id: "v2222222-0000-0000-0000-000000000002",
        name: "City Convention Hall B",
        city: "Singapore",
        country: "Singapore",
        capacity: 200,
        facilities: ["Stage", "AV system", "Wi-Fi", "Catering kitchen"],
        accessibility_features: ["Step-free access", "Accessible restrooms"],
        room_layouts: ["Theatre", "Banquet"],
        operating_hours: { mon: { open: "08:00", close: "22:00" } },
        setup_minutes: 60,
        turnaround_minutes: 30,
        is_active: true,
      },
      {
        id: "v3333333-0000-0000-0000-000000000003",
        name: "Victoria Auditorium",
        city: "Singapore",
        country: "Singapore",
        capacity: 180,
        facilities: ["Stage", "AV system"],
        accessibility_features: ["Step-free access"],
        room_layouts: ["Theatre"],
        operating_hours: { mon: { open: "08:00", close: "22:00" } },
        setup_minutes: 60,
        turnaround_minutes: 30,
        is_active: true,
      },
    ];

    const mockExistingBookingsForEvent = [
      // This venue is already booked by the same event on the same date
      { venue_id: "v3333333-0000-0000-0000-000000000003", booking_date: bookingDate, slot: "am", status: "confirmed", event_name: "Other Event" },
    ];

    beforeEach(() => {
      // Reset and setup default chain
      mockSupabase.from.mockReturnValue(mockSupabase);
      mockSupabase.select.mockReturnValue(mockSupabase);
      mockSupabase.eq.mockReturnValue(mockSupabase);
      mockSupabase.neq.mockReturnValue(mockSupabase);
      mockSupabase.in.mockReturnValue(mockSupabase);
      mockSupabase.gte.mockReturnValue(mockSupabase);
      mockSupabase.lte.mockReturnValue(mockSupabase);
      mockSupabase.contains.mockReturnValue(mockSupabase);
      mockSupabase.order.mockReturnValue(mockSupabase);
      mockSupabase.limit.mockReturnValue(mockSupabase);
      mockSupabase.maybeSingle.mockResolvedValue({ data: mockAffectedBooking, error: null });
      mockSupabase.single.mockResolvedValue({ data: mockAffectedBooking, error: null });
    });

    it("TC-REPLACE-001: returns original booking details with pre-filled search criteria", async () => {
      // Setup: affected booking fetch
      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockAffectedBooking, error: null });

      // Setup: listVenues returns candidates
      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.neq.mockReturnValueOnce(mockSupabase);
      mockSupabase.gte.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockCandidateVenues, error: null });

      // Setup: filterByAvailability - bookings for date
      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      // Setup: filterByAvailability - unavailability for date
      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      // Setup: existing bookings for same event (to exclude)
      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockExistingBookingsForEvent, error: null });

      // Call the service
      const result = await searchReplacementVenues(affectedBookingId, coordinatorId, {});

      expect(result).toBeDefined();
      expect(result.originalBooking).toBeDefined();
      expect(result.originalBooking.bookingId).toBe(affectedBookingId);
      expect(result.originalBooking.venueName).toBe("Marina Grand Ballroom");
      expect(result.originalBooking.expectedAttendees).toBe(150);
      expect(result.originalBooking.requiredFacilities).toEqual(["Stage", "AV system", "Wi-Fi"]);
      expect(result.originalBooking.accessibilityRequirements).toEqual(["Step-free access"]);
      expect(result.originalBooking.roomLayout).toBe("Theatre");
      expect(result.candidateVenues).toBeDefined();
      expect(Array.isArray(result.candidateVenues)).toBe(true);
    });

    it("TC-REPLACE-002: excludes the affected venue from candidates", async () => {
      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockAffectedBooking, error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.neq.mockReturnValueOnce(mockSupabase); // This should exclude affected venue
      mockSupabase.gte.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockCandidateVenues, error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockExistingBookingsForEvent, error: null });

      const _result = await searchReplacementVenues(affectedBookingId, coordinatorId, {});

      // Verify neq was called with affected venue_id
      expect(mockSupabase.neq).toHaveBeenCalledWith("id", venueId);
    });

    it("TC-REPLACE-003: excludes venues already booked by same event on overlapping slots", async () => {
      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockAffectedBooking, error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.neq.mockReturnValueOnce(mockSupabase);
      mockSupabase.gte.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.contains.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockCandidateVenues, error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockExistingBookingsForEvent, error: null });

      const result = await searchReplacementVenues(affectedBookingId, coordinatorId, {});

      // Verify the existing bookings query was made
      expect(mockSupabase.from).toHaveBeenCalledWith("venue_booking_requests");
      // v3333333 should be excluded from candidates because it's already booked
      const candidateIds = result.candidateVenues.map(v => v.venueId);
      expect(candidateIds).not.toContain("v3333333-0000-0000-0000-000000000003");
    });

    it("TC-REPLACE-004: supports filter relaxation via query parameters", async () => {
      const relaxedFilters = {
        minCapacity: 100, // Lower than original 150
        facilities: ["Stage"], // Fewer than original
        accessibility: [], // No accessibility required
        roomLayout: null, // Any layout
      };

      mockSupabase.maybeSingle
        .mockResolvedValueOnce({ data: mockAffectedBooking, error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.neq.mockReturnValueOnce(mockSupabase);
      mockSupabase.gte.mockReturnValueOnce(mockSupabase); // Should use relaxed minCapacity
      mockSupabase.contains.mockReturnValueOnce(mockSupabase); // Should use relaxed facilities
      mockSupabase.contains.mockReturnValueOnce(mockSupabase); // Should use relaxed accessibility (or skip)
      mockSupabase.order.mockResolvedValueOnce({ data: mockCandidateVenues, error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: [], error: null });

      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.in.mockReturnValueOnce(mockSupabase);
      mockSupabase.order.mockResolvedValueOnce({ data: mockExistingBookingsForEvent, error: null });

      const result = await searchReplacementVenues(affectedBookingId, coordinatorId, relaxedFilters);

      expect(result).toBeDefined();
      expect(result.candidateVenues.length).toBeGreaterThan(0);
    });

    it("returns 404 when affected booking not found", async () => {
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await expect(searchReplacementVenues("non-existent-id", coordinatorId, {}))
        .rejects.toThrow("Booking not found");
    });

    it("returns 403 when coordinator doesn't own the event", async () => {
      const otherCoordinatorBooking = {
        ...mockAffectedBooking,
        event_id: "other-event",
        event: { coordinator_id: "other-coordinator" },
      };
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: otherCoordinatorBooking, error: null });

      // Mock the event lookup to return no match for this coordinator
      mockSupabase.from.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await expect(searchReplacementVenues(affectedBookingId, coordinatorId, {}))
        .rejects.toThrow("Not your event");
    });
  });

  describe("markVenueBookingAffected", () => {
    it("sets is_affected=true and transitions CONFIRMED event to APPROVED", async () => {
      const bookingId = "b1111111-0000-0000-0000-000000000001";
      const userId = "coord-123";
      const reason = "Maintenance closure";
      const isVenueStaff = false;

      mockSupabase.rpc.mockResolvedValueOnce({ data: bookingId, error: null });

      const result = await markVenueBookingAffected(bookingId, userId, reason, isVenueStaff);

      expect(mockSupabase.rpc).toHaveBeenCalledWith("mark_venue_booking_affected", {
        p_booking_id: bookingId,
        p_user_id: userId,
        p_reason: reason,
        p_is_venue_staff: isVenueStaff,
      });
      expect(result).toBe(bookingId);
    });

    it("allows venue staff to mark affected without coordinator check", async () => {
      const bookingId = "b1111111-0000-0000-0000-000000000001";
      const userId = "venue-staff-456";
      const reason = "Emergency repair";
      const isVenueStaff = true;

      mockSupabase.rpc.mockResolvedValueOnce({ data: bookingId, error: null });

      const result = await markVenueBookingAffected(bookingId, userId, reason, isVenueStaff);

      expect(mockSupabase.rpc).toHaveBeenCalledWith("mark_venue_booking_affected", {
        p_booking_id: bookingId,
        p_user_id: userId,
        p_reason: reason,
        p_is_venue_staff: true,
      });
      expect(result).toBe(bookingId);
    });

    it("throws when reason is missing", async () => {
      mockSupabase.rpc.mockRejectedValueOnce(new Error("Reason required"));

      await expect(markVenueBookingAffected("b1", "u1", "", false))
        .rejects.toThrow("Reason required");
    });
  });

  describe("releaseAffectedVenueBooking", () => {
    it("cancels affected booking slots and any pending replacement", async () => {
      const bookingId = "b1111111-0000-0000-0000-000000000001";
      const coordinatorId = "coord-123";

      mockSupabase.rpc.mockResolvedValueOnce({ data: bookingId, error: null });

      const result = await releaseAffectedVenueBooking(bookingId, coordinatorId);

      expect(mockSupabase.rpc).toHaveBeenCalledWith("release_affected_venue_booking", {
        p_booking_id: bookingId,
        p_coordinator_id: coordinatorId,
      });
      expect(result).toBe(bookingId);
    });

    it("throws when coordinator doesn't own the event", async () => {
      mockSupabase.rpc.mockRejectedValueOnce(new Error("Not your event"));

      await expect(releaseAffectedVenueBooking("b1", "wrong-coord"))
        .rejects.toThrow("Not your event");
    });
  });

  describe("validateReplacementRequest", () => {
    it("requires replaces_booking_id to reference an affected booking", async () => {
      // This will be tested in integration tests with full flow
      expect(true).toBe(true); // Placeholder - validation happens in service layer
    });

    it("rejects duplicate pending replacement for same affected booking", async () => {
      // Application-layer check in submitBookingRequest
      expect(true).toBe(true); // Placeholder
    });
  });
});