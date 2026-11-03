const { test, expect } = require("@playwright/test");
const { getAccessToken, setupVenueReplacement } = require("./support/venue-replacement-fixtures");
const supabase = require("../../backend/src/supabase");

test.describe("SCRUM-145 venue replacement live database", () => {
  test.setTimeout(120_000);
  let scenario;

  test.beforeEach(async () => {
    scenario = await setupVenueReplacement();
  });

  test.afterEach(async () => {
    await scenario?.teardown();
  });

  async function apiHeaders(account) {
    return { Authorization: `Bearer ${await getAccessToken(account)}` };
  }

  test("TC-SCRUM-145-01: an affected booking returns matching real venue candidates", async ({ request }) => {
    const headers = await apiHeaders(scenario.coordinator);
    const mark = await request.post(`http://localhost:3000/api/venues/booking-requests/${scenario.booking.id}/mark-affected`, {
      headers,
      data: { reason: "Live test maintenance closure" },
    });
    expect(mark.status(), await mark.text()).toBe(200);

    const search = await request.get(`http://localhost:3000/api/venues/booking-requests/${scenario.booking.id}/replacement-search`, { headers });
    expect(search.status(), await search.text()).toBe(200);
    const body = await search.json();
    expect(body.data.originalBooking.bookingId).toBe(scenario.booking.id);
    expect(body.data.candidateVenues.map((venue) => venue.venueId)).toContain(scenario.replacementVenue.id);
    expect(body.data.candidateVenues.map((venue) => venue.venueId)).not.toContain(scenario.venue.id);
  });

  test("TC-SCRUM-145-04: another coordinator cannot inspect an affected booking", async ({ request }) => {
    const coordinatorHeaders = await apiHeaders(scenario.coordinator);
    const mark = await request.post(`http://localhost:3000/api/venues/booking-requests/${scenario.booking.id}/mark-affected`, {
      headers: coordinatorHeaders,
      data: { reason: "Live test maintenance closure" },
    });
    expect(mark.status(), await mark.text()).toBe(200);

    const denied = await request.get(`http://localhost:3000/api/venues/booking-requests/${scenario.booking.id}/replacement-search`, {
      headers: await apiHeaders(scenario.outsider),
    });
    expect(denied.status()).toBe(403);
  });

  test("TC-SCRUM-145-07: release clears the affected flag and cancels the original slots", async ({ request }) => {
    const headers = await apiHeaders(scenario.coordinator);
    const mark = await request.post(`http://localhost:3000/api/venues/booking-requests/${scenario.booking.id}/mark-affected`, {
      headers,
      data: { reason: "Live test maintenance closure" },
    });
    expect(mark.status(), await mark.text()).toBe(200);

    const release = await request.post(`http://localhost:3000/api/venues/booking-requests/${scenario.booking.id}/release`, { headers });
    expect(release.status(), await release.text()).toBe(200);

    const { data: booking, error: bookingError } = await supabase
      .from("venue_booking_requests")
      .select("is_affected")
      .eq("id", scenario.booking.id)
      .single();
    expect(bookingError).toBeNull();
    expect(booking.is_affected).toBe(false);

    const { data: slots, error: slotsError } = await supabase
      .from("venue_bookings")
      .select("status")
      .eq("request_id", scenario.booking.id)
      .order("slot");
    expect(slotsError).toBeNull();
    expect(slots.map((slot) => slot.status)).toEqual(["cancelled", "cancelled"]);
  });
});
