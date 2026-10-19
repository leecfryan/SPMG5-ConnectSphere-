/**
 * Live-DB E2E tests for SCRUM-145: Venue Replacement
 * Tests against the real Supabase database with manual schema applied.
 * 
 * @see tests/e2e/support/venue-replacement-fixtures.js
 */
const { test, expect } = require('@playwright/test');
const { setupVenueReplacement, markBookingAffected, releaseBookingAffected } = require('../support/venue-replacement-fixtures');
const { getAccessToken } = require('../support/venue-replacement-fixtures');

test.describe('SCRUM-145: Venue Replacement - Live DB', () => {
  test.beforeEach(async ({ }, testInfo) => {
    // Each test gets its own fresh venue replacement setup
    const { organiser, coordinator, venueStaff, outsider, venue, event, booking, teardown } = await setupVenueReplacement();
    testInfo.setTimeout(120000); // Live DB tests take longer
    // Store teardown in test context for afterEach
    testInfo.parameters.teardown = teardown;
  });

  test.afterEach(async ({ }, testInfo) => {
    const teardown = testInfo.parameters.teardown;
    if (teardown) {
      await teardown();
    }
  });

  test('TC-SCRUM-145-01: Coordinator can search for replacement venues against real booking', async ({ }, testInfo) => {
    const { coordinator, venue, event, booking } = testInfo.parameters;
    const token = await getAccessToken(coordinator);
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/booking-requests/${booking.id}/replacement-search?minCapacity=100`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
        },
      }
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(data.data.originalBooking.bookingId).toBe(booking.id);
    expect(data.data.originalBooking.venueName).toBe(venue.name);
  });

  test('TC-SCRUM-145-02: Marking a booking as affected transitions event status', async ({ }, testInfo) => {
    const { coordinator, venue, event, booking } = testInfo.parameters;
    const token = await getAccessToken(coordinator);
    
    // First mark as affected
    const affectedResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/booking-requests/${booking.id}/mark-affected`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'E2E test: venue maintenance' }),
      }
    );
    expect(affectedResponse.status).toBe(200);
    
    // Verify the booking is now affected
    const getResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/venue_booking_requests?id=eq.${booking.id}`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
        },
      }
    );
    const bookings = await getResponse.json();
    expect(bookings.data[0].is_affected).toBe(true);
    expect(bookings.data[0].affected_reason).toContain('maintenance');
  });

  test('TC-SCRUM-145-03: Releasing an affected booking clears the affected flag', async ({ }, testInfo) => {
    const { coordinator, venue, event, booking } = testInfo.parameters;
    const token = await getAccessToken(coordinator);
    
    // First mark as affected
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/booking-requests/${booking.id}/mark-affected`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'E2E test' }),
      }
    );
    
    // Then release it
    const releaseResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/booking-requests/${booking.id}/release`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
          'Content-Type': 'application/json',
        },
      }
    );
    expect(releaseResponse.status).toBe(200);
    
    // Verify the booking is no longer affected
    const getResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/venue_booking_requests?id=eq.${booking.id}`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
        },
      }
    );
    const bookings = await getResponse.json();
    expect(bookings.data[0].is_affected).toBe(false);
  });

  test('TC-SCRUM-145-04: Different coordinator cannot search another's replacement', async ({ }, testInfo) => {
    const { coordinator, outsider, venue, event, booking } = testInfo.parameters;
    const outsiderToken = await getAccessToken(outsider);
    
    // Outsider tries to search the booking
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/booking-requests/${booking.id}/replacement-search`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + outsiderToken,
          'apikey': process.env.SUPABASE_URL,
        },
      }
    );
    expect(response.status).toBe(403); // Forbidden - not their event
  });

  test('TC-SCRUM-145-05: Venue staff can mark any affected booking', async ({ }, testInfo) => {
    const { venueStaff, venue, event, booking } = testInfo.parameters;
    const token = await getAccessToken(venueStaff);
    
    // Venue staff marks the booking as affected
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/booking-requests/${booking.id}/mark-affected`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': process.env.SUPABASE_URL,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'E2E: venue staff marked affected' }),
      }
    );
    expect(response.status).toBe(200);
  });
});