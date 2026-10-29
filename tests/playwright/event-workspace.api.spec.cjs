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
  expect(approved).toMatchObject({ status: 'APPROVED', approved_rejected_by: first.id, approval_rejection_remark: 'Ready for planning', approved_rejected_by_name: 'Coordinator One' });
  expect(Date.parse(approved.approved_rejected_at)).not.toBeNaN();
  expect((await act('reject', headers.first, { note: 'Too late' })).status()).toBe(409);
  expect((await status()).status).toBe('APPROVED');
});

// SCRUM-148: only the assigned coordinator may cancel, and only with a reason.
test('[REVIEW-E2E-API-002] SCRUM-148: only the assigned coordinator may cancel, and only with a reason', async ({ accounts, request }) => {
  const { event, first, second, headers, update } = await setupWorkflow(accounts, request);
  for (const role of ['venue_staff', 'technical_support_staff']) {
    headers[role] = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create([role]))).access_token };
  }
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  const cancel = (as, data) => request.post(`/api/internal/events/${event.id}/cancel`, { headers: as, data });

  for (const role of ['second', 'organiser', 'venue_staff', 'technical_support_staff', 'attendee']) {
    expect((await cancel(headers[role], { reason: 'Not allowed' })).status(), role).toBe(403);
  }
  expect((await cancel(undefined, { reason: 'No session' })).status()).toBe(401);
  expect((await cancel(headers.first, {})).status()).toBe(400);
  expect((await cancel(headers.first, { reason: '   ' })).status()).toBe(400);

  const response = await cancel(headers.first, { reason: 'Venue flooded' });
  expect(response.status()).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: 'CANCELLED', cancelled_by: first.id, cancellation_reason: 'Venue flooded' });
  expect((await cancel(headers.first, { reason: 'Again' })).status()).toBe(409);
});

// SCRUM-148: the coordinator lead may cancel any event, not just one assigned to them.
test('[REVIEW-E2E-API-003] SCRUM-148: the coordinator lead may cancel any event', async ({ accounts, request }) => {
  const { event, first, manager, headers, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  const cancel = (as, data) => request.post(`/api/internal/events/${event.id}/cancel`, { headers: as, data });

  const response = await cancel(headers.manager, { reason: 'Duplicate booking' });
  expect(response.status()).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: 'CANCELLED', cancelled_by: manager.id });
  expect((await cancel(headers.manager, { reason: 'Again' })).status()).toBe(409);
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
  // SCRUM-164 AC3: reason is now required for every PATCH to a SUBMITTED event.
  const updated = await request.patch(ownPath, { headers: headers.organiser, data: { name: 'Updated own client request', equipment_needs: 'Two microphones', reason: 'Correcting requirements' } });
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
  expect((await me.json()).permissions).toEqual([
    'events.own.read', 'events.own.update', 'events.submit',
    'events.managed.read', 'events.registrations.read', 'events.registration-window.update',
  ]);
  await accounts.update(organiser, { appMetadata: {} });
  expect((await request.get(`/api/event-workspace/organiser/${events.colleague.id}`, { headers: headers.organiser })).status()).toBe(404);
  expect((await request.get(`/api/event-workspace/organiser/${events.organiser.id}`, { headers: headers.organiser })).status()).toBe(200);
});

const organiserDeniedRoles = [
  ['attendee'], ['event_coordinator_lead'], ['event_coordinator'], ['venue_staff'],
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

// SCRUM-150 (a later, unrelated story) changed what postpone() itself does:
// it now releases equipment via equipmentService.releaseReservationsForEvent,
// same as cancel. This test's original title and assertion ("keeps equipment
// until cancellation") were true for SCRUM-142's role rename verification at
// the time it was written, and are updated here to match postpone's new
// behaviour - not a change to anything this test actually verifies (venue
// release, the lead/ops-manager postpone path itself), just the one fact
// about postpone that moved under it.
// SCRUM-36 AC1/AC5: organiser submits a change request for an UNDER_REVIEW event;
// the event name is unchanged, pending_change_request is set with the right shape.
test('[SCRUM-36-API-001] SCRUM-36: organiser submits a change request and event content stays unchanged', async ({ accounts, request }) => {
  const { event, organiser, headers } = await setupWorkflow(accounts, request);
  await accounts.updateEvent(event.id, { status: 'UNDER_REVIEW' });
  const before = (await (await request.get(`/api/event-workspace/organiser/${event.id}`, { headers: headers.organiser })).json()).event;
  const response = await request.post(`/api/event-workspace/organiser/${event.id}/change-request`, {
    headers: headers.organiser,
    data: { proposed_changes: { name: 'Updated title for coordinator review' }, reason: 'Coordinator requested a clearer title' },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.event.pending_change_request).toMatchObject({
    proposed_changes: { name: 'Updated title for coordinator review' },
    reason: 'Coordinator requested a clearer title',
    requested_by: organiser.id,
  });
  expect(body.event.name).toBe(before.name);
  expect(body.event.status).toBe('UNDER_REVIEW');
});

// SCRUM-36 AC7: the change-request endpoint lives under /organiser/:id — a
// coordinator has events.assigned.read, not events.own.update, so the guard returns 403.
test('[SCRUM-36-API-002] SCRUM-36: coordinator is denied the change-request endpoint with 403', async ({ accounts, request }) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  await accounts.updateEvent(event.id, { status: 'UNDER_REVIEW' });
  const denied = await request.post(`/api/event-workspace/organiser/${event.id}/change-request`, {
    headers: headers.first,
    data: { proposed_changes: { name: 'Coordinator attempt' }, reason: 'Should be denied' },
  });
  expect(denied.status()).toBe(403);
});

for (const [id, role] of [['001', 'event_coordinator_lead'], ['002', 'event_ops_manager']]) {
  test(`[SCRUM-142-MERGE-API-${id}] ${role} postpones another coordinator's event and releases its equipment`, async ({ accounts, request }) => {
    const { headers, event, first, date, update } = await setupWorkflow(accounts, request);
    expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
    await accounts.updateEvent(event.id, { status: 'APPROVED' });
    const equipmentPath = `/api/events/${event.id}/equipment-requests`;
    const equipmentResponse = await request.post(equipmentPath, { headers: headers.first, data: {
      equipment_id: first.id, quantity_requested: 1, technical_requirement: 'HDMI',
      borrow_start: date + 'T01:00:00Z', borrow_end: date + 'T03:00:00Z',
    } });
    expect(equipmentResponse.status()).toBe(201);
    const equipmentId = (await equipmentResponse.json()).data.id;
    const bookingResponse = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
      event_id: event.id, booking_date: date, slots: ['pm'], expected_attendees: 30,
      room_layout: 'Theatre', required_facilities: ['Projector'],
    } });
    expect(bookingResponse.status()).toBe(201);
    const bookingId = (await bookingResponse.json()).data.id;
    const lead = await accounts.create([role]);
    const leadHeaders = { Authorization: 'Bearer ' + (await accounts.session(lead)).access_token };
    const postpone = await request.post(`/api/internal/events/${event.id}/postpone`, { headers: leadHeaders, data: { reason: 'Date pending' } });
    expect(postpone.status()).toBe(200);
    expect((await postpone.json()).event).toMatchObject({ status: 'POSTPONED', postponed_by: lead.id, postponement_reason: 'Date pending' });
    const booking = await request.get(`/api/venues/booking-requests/${bookingId}`, { headers: headers.first });
    expect(booking.status()).toBe(200);
    expect((await booking.json()).data.slots.map(slot => slot.status)).toEqual(['cancelled']);
    const equipment = await request.get(equipmentPath, { headers: headers.first });
    expect(equipment.status()).toBe(200);
    expect((await equipment.json()).data.find(item => item.id === equipmentId).status).toBe('RELEASED');
    expect((await request.post(`/api/internal/events/${event.id}/postpone`, { headers: leadHeaders, data: { reason: 'Repeat' } })).status()).toBe(409);
    const cancel = await request.post(`/api/internal/events/${event.id}/cancel`, { headers: leadHeaders, data: { reason: 'No replacement date' } });
    expect(cancel.status()).toBe(200);
    expect((await cancel.json()).event).toMatchObject({ status: 'CANCELLED', postponement_reason: 'Date pending', cancellation_reason: 'No replacement date' });
    const released = await request.get(equipmentPath, { headers: headers.first });
    expect(released.status()).toBe(200);
    expect((await released.json()).data.find(item => item.id === equipmentId).status).toBe('RELEASED');
  });
}

// SCRUM-164: update event information during planning.
test('[TC-SCRUM-164-E2E-API-01] AC2: edit is locked once the event moves past SUBMITTED', async ({ accounts, request }) => {
  const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
  const eventPath = `/api/event-workspace/organiser/${events.organiser.id}`;
  await accounts.updateEvent(events.organiser.id, { status: 'UNDER_REVIEW' });
  const locked = await request.patch(eventPath, { headers: headers.organiser, data: { name: 'Must not save', reason: 'Testing lock' } });
  expect(locked.status()).toBe(409);
  expect((await locked.json()).message).toMatch(/no longer accepted/i);
  expect((await accounts.events(organiser))[0].name).not.toBe('Must not save');
});

test('[TC-SCRUM-164-E2E-API-02] AC3: valid edit with reason creates an activity log entry', async ({ accounts, request }) => {
  const { organiser, headers, events } = await setupOrganiserAccess(accounts, request);
  const eventPath = `/api/event-workspace/organiser/${events.organiser.id}`;
  const res = await request.patch(eventPath, { headers: headers.organiser, data: { name: 'Updated name', reason: 'Correcting a typo' } });
  expect(res.status()).toBe(200);
  const detail = await request.get(eventPath, { headers: headers.organiser });
  const activity = (await detail.json()).event.activity;
  expect(activity).not.toBeNull();
  const edit = activity.find(entry => entry.action === 'EDIT');
  expect(edit).toBeDefined();
  expect(edit.note).toBe('Correcting a typo');
});

test('[TC-SCRUM-164-E2E-API-03] AC3: missing reason is rejected with a 400', async ({ accounts, request }) => {
  const { headers, events } = await setupOrganiserAccess(accounts, request);
  const locked = await request.patch(`/api/event-workspace/organiser/${events.organiser.id}`, {
    headers: headers.organiser, data: { name: 'No reason' },
  });
  expect(locked.status()).toBe(400);
  const body = await locked.json();
  expect(body.errors.some(err => err.field === 'reason')).toBe(true);
});
