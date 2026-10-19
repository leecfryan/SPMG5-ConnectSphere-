// SCRUM-136: affected bookings in the POST /unavailability 201 response.
// Each test sets up real confirmed bookings via the API to prove the overlap
// logic end-to-end — from submission → approval → period creation → affected list.
const { test, expect } = require('./support/fixtures.cjs');

const venueId = '11111111-1111-4111-8111-111111111111';

// Creates an organiser, coordinator, and venue_staff account, submits an event,
// assigns the coordinator, approves the event, submits and approves a booking
// request so its slot is confirmed.
// Returns { requestId, coordinatorId, staffSession, bookingDate }.
async function setupConfirmedBooking(accounts, request, { bookingDate, slot = 'am' } = {}) {
  const organiser = await accounts.create(['event_organiser']);
  const coordinator = await accounts.create(['event_coordinator']);
  const staff = await accounts.create(['venue_staff']);
  const orgSession = await accounts.session(organiser);
  const coordSession = await accounts.session(coordinator);
  const staffSession = await accounts.session(staff);

  const eventResp = await request.post('/api/events', {
    headers: { Authorization: 'Bearer ' + orgSession.access_token },
    data: {
      name: 'SCRUM-136 test event ' + Date.now(),
      purpose: 'Testing affected bookings',
      description: 'Integration test for SCRUM-136',
      start_time: bookingDate + 'T00:00:00Z',
      end_time: bookingDate + 'T15:00:00Z',
      expected_attendance: 50,
    },
  });
  expect(eventResp.status()).toBe(201);
  const { event } = await eventResp.json();

  await accounts.assignEvent(event.id, coordinator.id);
  await accounts.updateEvent(event.id, { status: 'APPROVED' });

  const bookingResp = await request.post(`/api/venues/${venueId}/booking-requests`, {
    headers: { Authorization: 'Bearer ' + coordSession.access_token },
    data: {
      event_id: event.id,
      booking_date: bookingDate,
      slots: [slot],
      expected_attendees: 50,
      room_layout: 'Theatre',
      required_facilities: [],
    },
  });
  expect(bookingResp.status()).toBe(201);
  const { data: bookingRequest } = await bookingResp.json();

  const decisionResp = await request.patch(`/api/venues/booking-requests/${bookingRequest.id}/decision`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { decision: 'confirmed' },
  });
  expect(decisionResp.status()).toBe(200);

  return { requestId: bookingRequest.id, coordinatorId: coordinator.id, staffSession, bookingDate };
}

function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

test('[TC-SCRUM-136-07] No confirmed bookings in the period date range: affected is empty', async ({ accounts, request }) => {
  const staff = await accounts.create(['venue_staff']);
  const staffSession = await accounts.session(staff);

  const start = futureDate(80);
  const res = await request.post(`/api/venues/${venueId}/unavailability`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { start_date: start, end_date: start, slots: ['am'], reason: 'Maintenance' },
  });
  expect(res.status()).toBe(201);
  const json = await res.json();
  expect(Array.isArray(json.affected)).toBe(true);
  expect(json.affected).toHaveLength(0);
});

test('[TC-SCRUM-136-08] Confirmed booking on the period date and slot appears in affected with coordinator_id', async ({ accounts, request }) => {
  const date = futureDate(82);
  const { coordinatorId, staffSession } = await setupConfirmedBooking(accounts, request, { bookingDate: date, slot: 'am' });

  const res = await request.post(`/api/venues/${venueId}/unavailability`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { start_date: date, end_date: date, slots: ['am'], reason: 'Deep cleaning' },
  });
  expect(res.status()).toBe(201);
  const json = await res.json();
  expect(json.affected.length).toBeGreaterThanOrEqual(1);
  const match = json.affected.find(r => r.booking_date === date && r.slots.some(s => s.slot === 'am' && s.status === 'confirmed'));
  expect(match).toBeDefined();
  expect(match.event.coordinator_id).toBe(coordinatorId);
});

test('[TC-SCRUM-136-09] Pending-only booking in the period date range is not in affected (AC1)', async ({ accounts, request }) => {
  const date = futureDate(84);
  const organiser = await accounts.create(['event_organiser']);
  const coordinator = await accounts.create(['event_coordinator']);
  const staff = await accounts.create(['venue_staff']);
  const orgSession = await accounts.session(organiser);
  const coordSession = await accounts.session(coordinator);
  const staffSession = await accounts.session(staff);

  const eventResp = await request.post('/api/events', {
    headers: { Authorization: 'Bearer ' + orgSession.access_token },
    data: {
      name: 'SCRUM-136 pending test ' + Date.now(),
      purpose: 'Testing pending bookings',
      description: 'Should not appear in affected',
      start_time: date + 'T00:00:00Z',
      end_time: date + 'T15:00:00Z',
      expected_attendance: 50,
    },
  });
  expect(eventResp.status()).toBe(201);
  const { event } = await eventResp.json();
  await accounts.assignEvent(event.id, coordinator.id);
  await accounts.updateEvent(event.id, { status: 'APPROVED' });

  const bookingResp = await request.post(`/api/venues/${venueId}/booking-requests`, {
    headers: { Authorization: 'Bearer ' + coordSession.access_token },
    data: { event_id: event.id, booking_date: date, slots: ['pm'], expected_attendees: 50, room_layout: 'Theatre', required_facilities: [] },
  });
  expect(bookingResp.status()).toBe(201);
  // Intentionally not approving — slots stay pending

  const res = await request.post(`/api/venues/${venueId}/unavailability`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { start_date: date, end_date: date, slots: ['pm'], reason: 'Renovation' },
  });
  expect(res.status()).toBe(201);
  const json = await res.json();
  // No confirmed slots on this date — the pending booking must not appear in affected
  const pendingOnlyAffected = json.affected.filter(r =>
    r.booking_date === date && r.slots.every(s => s.status !== 'confirmed')
  );
  expect(pendingOnlyAffected).toHaveLength(0);
});

test('[TC-SCRUM-136-10] Booking outside the period date range is not in affected', async ({ accounts, request }) => {
  const bookingDate = futureDate(86);
  const periodDate = futureDate(90); // different date — booking is outside the period
  const { staffSession } = await setupConfirmedBooking(accounts, request, { bookingDate, slot: 'am' });

  const res = await request.post(`/api/venues/${venueId}/unavailability`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { start_date: periodDate, end_date: periodDate, slots: ['am'], reason: 'Maintenance' },
  });
  expect(res.status()).toBe(201);
  const json = await res.json();
  expect(json.affected.filter(r => r.booking_date === bookingDate)).toHaveLength(0);
});

test('[TC-SCRUM-136-11] Creating a period does not cancel or modify affected bookings (AC4)', async ({ accounts, request }) => {
  const date = futureDate(88);
  const { requestId, staffSession } = await setupConfirmedBooking(accounts, request, { bookingDate: date, slot: 'am' });

  const res = await request.post(`/api/venues/${venueId}/unavailability`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { start_date: date, end_date: date, slots: ['am'], reason: 'Inspection' },
  });
  expect(res.status()).toBe(201);

  // The booking request is still confirmed after the period was created
  const getResp = await request.get(`/api/venues/booking-requests/${requestId}`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
  });
  expect(getResp.status()).toBe(200);
  const { data: readBack } = await getResp.json();
  expect(readBack.slots.every(s => s.status === 'confirmed')).toBe(true);
});
