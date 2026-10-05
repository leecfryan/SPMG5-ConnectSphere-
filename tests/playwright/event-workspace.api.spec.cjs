const { test, expect } = require('./support/fixtures.cjs');
const { setupWorkflow, setupOrganiserAccess } = require('./support/event-workspace-fixtures.cjs');
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

test('[EVENT-API-100] SCRUM-100: Client organiser sees own and same-company requests and denied edits leave complete records unchanged', async ({ accounts, request }) => {
  const { organiser, colleague, outsider, headers, events, beta } = await setupOrganiserAccess(accounts, request);
  const visible = await request.get('/api/event-workspace/organiser', { headers: headers.organiser });
  expect(visible.status()).toBe(200);
  expect((await visible.json()).events.map(event => event.id).sort()).toEqual([events.organiser.id, events.colleague.id].sort());
  expect((await request.get(`/api/event-workspace/organiser/${events.colleague.id}`, { headers: headers.organiser })).status()).toBe(200);
  const peerBefore = await accounts.events(colleague);
  expect((await request.patch(`/api/event-workspace/organiser/${events.colleague.id}`, { headers: headers.organiser, data: { name: 'Unauthorised peer change' } })).status()).toBe(403);
  expect(await accounts.events(colleague)).toEqual(peerBefore);
  const hiddenBefore = await accounts.events(outsider);
  const hidden = await request.get(`/api/event-workspace/organiser/${events.outsider.id}`, { headers: headers.organiser });
  expect(hidden.status()).toBe(404);
  expect(await hidden.json()).toEqual({ message: 'Event not found.' });
  expect((await request.patch(`/api/event-workspace/organiser/${events.outsider.id}`, { headers: headers.organiser, data: { name: 'Unauthorised outside change' } })).status()).toBe(404);
  expect(await accounts.events(outsider)).toEqual(hiddenBefore);
  const search = await request.get('/api/event-workspace/organiser', { headers: headers.organiser, params: { search: events.outsider.name, organisation_id: beta, organiser_id: outsider.id } });
  expect((await search.json()).events.map(event => event.id).sort()).toEqual([events.organiser.id, events.colleague.id].sort());
  const ownBefore = await accounts.events(organiser);
  const ownPath = `/api/event-workspace/organiser/${events.organiser.id}`;
  expect((await request.patch(ownPath, { headers: headers.organiser, data: { name: 'Forged change', organiser_id: colleague.id, status: 'APPROVED' } })).status()).toBe(400);
  expect(await accounts.events(organiser)).toEqual(ownBefore);
  const updated = await request.patch(ownPath, { headers: headers.organiser, data: { name: 'Updated own client request', equipment_needs: 'Two microphones' } });
  expect(updated.status()).toBe(200);
  const saved = (await request.get(ownPath, { headers: headers.organiser })).json();
  expect((await saved).event).toMatchObject({ name: 'Updated own client request', equipment_needs: 'Two microphones', organiser_id: organiser.id, status: 'SUBMITTED' });
  expect((await accounts.events(organiser))[0]).toMatchObject({ ...ownBefore[0], name: 'Updated own client request', equipment_needs: 'Two microphones' });
});

test('[EVENT-API-101] SCRUM-100: Untrusted profile company does not grant access and removed membership revokes peer access', async ({ accounts, request }) => {
  const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
  const outsiderView = await request.get('/api/event-workspace/organiser', { headers: headers.outsider });
  expect((await outsiderView.json()).events.map(event => event.id)).toEqual([events.outsider.id]);
  const me = await request.get('/api/auth/me', { headers: headers.organiser });
  expect((await me.json()).permissions).toEqual(['events.own.read', 'events.own.update', 'events.submit']);
  await accounts.update(organiser, { appMetadata: {} });
  expect((await request.get(`/api/event-workspace/organiser/${events.colleague.id}`, { headers: headers.organiser })).status()).toBe(404);
  expect((await request.get(`/api/event-workspace/organiser/${events.organiser.id}`, { headers: headers.organiser })).status()).toBe(200);
});

const organiserDeniedRoles = [
  ['attendee'], ['event_ops_manager'], ['event_coordinator'], ['venue_staff'],
  ['technical_support_staff'], ['venue_staff', 'technical_support_staff'],
];
for (const [index, roles] of organiserDeniedRoles.entries()) {
  test('[EVENT-API-' + (102 + index) + '] SCRUM-100: ' + roles.join(' + ') + ' cannot edit an organiser request', async ({ accounts, request }) => {
    const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
    const deniedAccount = await accounts.create(roles);
    const deniedSession = await accounts.session(deniedAccount);
    const eventPath = '/api/event-workspace/organiser/' + events.organiser.id;
    expect((await request.get(eventPath, { headers: headers.organiser })).status()).toBe(200);
    const before = await accounts.events(organiser);
    const denied = await request.patch(eventPath, {
      headers: { Authorization: 'Bearer ' + deniedSession.access_token },
      data: { name: 'Denied role edit', equipment_needs: 'Must not change' },
    });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toEqual({ message: 'You do not have permission to access this information.' });
    expect(await accounts.events(organiser)).toEqual(before);
  });
}

test('[EVENT-API-108] SCRUM-100: Missing and forged credentials cannot mutate any organiser request', async ({ accounts, request }) => {
  const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
  const eventPath = '/api/event-workspace/organiser/' + events.organiser.id;
  expect((await request.get(eventPath, { headers: headers.organiser })).status()).toBe(200);
  const before = await accounts.events(organiser);
  for (const deniedHeaders of [{}, { Authorization: 'Bearer forged-token' }]) {
    const denied = await request.patch(eventPath, { headers: deniedHeaders, data: { name: 'Anonymous change' } });
    expect(denied.status()).toBe(401);
    expect(await denied.text()).not.toContain(events.organiser.description);
    expect(await accounts.events(organiser)).toEqual(before);
  }
});

test('[EVENT-API-109] SCRUM-100: Revoked organiser role refuses an update using the previously valid token', async ({ accounts, request }) => {
  const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
  const eventPath = '/api/event-workspace/organiser/' + events.organiser.id;
  expect((await request.get(eventPath, { headers: headers.organiser })).status()).toBe(200);
  const before = await accounts.events(organiser);
  await accounts.update(organiser, { roles: [] });
  const denied = await request.patch(eventPath, { headers: headers.organiser, data: { name: 'Revoked change' } });
  expect(denied.status()).toBe(403);
  expect(await accounts.events(organiser)).toEqual(before);
});

test('[EVENT-API-110] SCRUM-100: Invalid bodies and malformed references return safe errors without a partial save', async ({ accounts, request }) => {
  const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
  const eventPath = '/api/event-workspace/organiser/' + events.organiser.id;
  const before = await accounts.events(organiser);
  for (const data of [{}, { name: '  ' }, { name: 'Partial change', expected_attendance: 0 }, { name: 'Partial change', start_time: 'invalid' }]) {
    const response = await request.patch(eventPath, { headers: headers.organiser, data });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toBe('Check the event details and try again.');
    expect(body.errors.length).toBeGreaterThan(0);
    expect(await accounts.events(organiser)).toEqual(before);
  }
  const malformed = await request.patch('/api/event-workspace/organiser/not-a-uuid', { headers: headers.organiser, data: { name: 'Invalid reference' } });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ message: 'Invalid event id.' });
  expect(await accounts.events(organiser)).toEqual(before);
});
