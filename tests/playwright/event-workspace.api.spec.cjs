const { test, expect } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

test('[ACCESS-E2E-API-001] Real assignment, bookings and reassignment preserve responsibility scopes', async ({ accounts, request }) => {
  const { headers, event, first, second, date, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // Stands in for the assigned coordinator's approval (SCRUM-99); bookings need an approved event.
  await accounts.updateEvent(event.id, { status: 'APPROVED' });
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

// SCRUM-98/99: the manager only assigns; approval is the coordinator's, and when
// registration opens is the Registration lane's start time, not a manager action.
test('[ACCESS-E2E-API-002] Assignment alone neither approves an event nor opens it to attendees', async ({ accounts, request }) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  const register = () => request.post('/api/registrations', { headers: headers.attendee, data: { eventId: event.id, registrationData: {} } });
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  const managerView = await request.get(`/api/event-workspace/manager/${event.id}`, { headers: headers.manager });
  expect((await managerView.json()).event.status).toBe('SUBMITTED');
  expect((await request.get(`/api/events/${event.id}`, { headers: headers.attendee })).status()).toBe(404);
  expect((await register()).status()).toBe(409);
  expect((await update('decision', { decision: 'accept' })).status()).toBe(404);
  expect((await update('publication', { openRegistration: true })).status()).toBe(404);
});

// SCRUM-98 AC4: only the assigned coordinator can start, approve or reject a review.
test('[REVIEW-E2E-API-001] SCRUM-98/99 review actions: assigned coordinator only, in lifecycle order', async ({ accounts, request }) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  for (const role of ['venue_staff', 'technical_support_staff']) {
    headers[role] = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create([role]))).access_token };
  }
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  const act = (action, as, data) => request.post(`/api/internal/events/${event.id}/${action}`, { headers: as, data });
  const status = async () => (await (await request.get(`/api/event-workspace/manager/${event.id}`, { headers: headers.manager })).json()).event;

  for (const action of ['start-review', 'approve', 'reject']) {
    for (const role of ['second', 'organiser', 'manager', 'venue_staff', 'technical_support_staff', 'attendee']) {
      expect((await act(action, headers[role], { note: 'Not allowed' })).status(), `${role} ${action}`).toBe(403);
    }
    expect((await act(action, undefined, { note: 'No session' })).status(), `anonymous ${action}`).toBe(401);
  }
  expect((await status()).status).toBe('SUBMITTED');

  // SCRUM-99 AC1: approval only follows a started review.
  expect((await act('approve', headers.first)).status()).toBe(409);
  expect((await act('start-review', headers.first)).status()).toBe(200);
  expect((await status()).status).toBe('UNDER_REVIEW');
  expect((await act('approve', headers.first, { note: 'Ready for planning' })).status()).toBe(200);
  const approved = await status();
  expect(approved).toMatchObject({ status: 'APPROVED', decided_by: first.id, decision_note: 'Ready for planning', decided_by_name: 'Coordinator One' });
  expect(Date.parse(approved.decided_at)).not.toBeNaN();
  expect((await act('reject', headers.first, { note: 'Too late' })).status()).toBe(409);
  expect((await status()).status).toBe('APPROVED');
});
