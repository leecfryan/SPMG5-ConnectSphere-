const { test, expect } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

test('[ACCESS-E2E-API-001] Real assignment, bookings and reassignment preserve responsibility scopes', async ({ accounts, request }) => {
  const { headers, event, first, second, date, update } = await setupWorkflow(accounts, request);
  expect((await update('decision', { decision: 'accept' })).status()).toBe(200);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  const equipmentFields = { equipment_id: first.id, quantity_requested: 1, technical_requirement: 'HDMI', borrow_start: date + 'T01:00:00Z', borrow_end: date + 'T03:00:00Z' };
  const equipmentPath = `/api/events/${event.id}/equipment-requests`;
  const equipment = await request.post(equipmentPath, { headers: headers.first, data: equipmentFields });
  expect(equipment.status()).toBe(201);
  const equipmentId = (await equipment.json()).data.id;
  const venueFields = { event_id: event.id, booking_date: date, slots: ['pm'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'] };
  const venue = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: venueFields });
  expect(venue.status()).toBe(201);
  const venueBookingId = (await venue.json()).data.id;
  for (const path of [equipmentPath, `/api/events/${event.id}/messages`]) {
    expect((await request.get(path, { headers: headers.second })).status()).toBe(403);
    expect((await request.get(path, { headers: headers.dual })).status()).toBe(200);
  }
  expect((await request.post(equipmentPath, { headers: headers.second, data: equipmentFields })).status()).toBe(403);
  expect((await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.second, data: venueFields })).status()).toBe(404);
  expect((await request.get(`/api/venues/booking-requests/${venueBookingId}`, { headers: headers.second })).status()).toBe(404);
  expect((await request.get(`/api/venues/booking-requests/${venueBookingId}`, { headers: headers.dual })).status()).toBe(200);
  const dashboard = await request.get('/api/technical-support/equipment-requests', { headers: headers.dual });
  expect((await dashboard.json()).data.map(row => row.id)).toContain(equipmentId);
  expect((await request.get(`/api/event-workspace/coordinator/${event.id}`, { headers: headers.dual })).status()).toBe(403);
  expect((await request.get('/api/events', { headers: headers.dual })).status()).toBe(403);
  expect((await update('coordinator', { coordinatorId: second.id, expectedCoordinatorId: first.id })).status()).toBe(200);
  expect((await request.get(`/api/event-workspace/coordinator/${event.id}`, { headers: headers.first })).status()).toBe(404);
  expect((await request.get(equipmentPath, { headers: headers.first })).status()).toBe(403);
  expect((await request.get(`/api/venues/booking-requests/${venueBookingId}`, { headers: headers.first })).status()).toBe(404);
  expect((await request.get(equipmentPath, { headers: headers.second })).status()).toBe(200);
  expect((await request.get(`/api/venues/booking-requests/${venueBookingId}`, { headers: headers.second })).status()).toBe(200);
});

test('[ACCESS-E2E-API-002] Registration remains unavailable until manager publication', async ({ accounts, request }) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  const register = () => request.post('/api/registrations', { headers: headers.attendee, data: { eventId: event.id, registrationData: {} } });
  expect((await register()).status()).toBe(409);
  expect((await update('decision', { decision: 'accept' })).status()).toBe(200);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  expect((await request.get(`/api/events/${event.id}`, { headers: headers.attendee })).status()).toBe(404);
  expect((await register()).status()).toBe(409);
  expect((await update('publication', { openRegistration: true })).status()).toBe(200);
  expect((await request.get(`/api/events/${event.id}`, { headers: headers.attendee })).status()).toBe(200);
  expect((await register()).status()).toBe(201);
});
