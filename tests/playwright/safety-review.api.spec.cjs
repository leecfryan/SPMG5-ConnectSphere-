const { test, expect } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

// SCRUM-140: the Safety Officer's read-only view, fed by the coordinator's
// real SCRUM-139 submission and the venue and equipment lanes' own endpoints.
test('[SAFETY-REVIEW-API-001] SCRUM-140 AC1-AC4: the officer lists and reads a submitted event, sees only confirmed arrangements and can change nothing', async ({ accounts, request }) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  headers.officer = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create(['safety_officer']))).access_token };
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // A day no other spec books, so the shared fixture venue's confirmed slots never clash.
  const date = new Date(Date.now() + 47 * 86400000).toISOString().slice(0, 10);
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const list = (as = headers.officer) => request.get('/api/internal/safety-reviews', { headers: as });
  const detail = (as = headers.officer) => request.get(`/api/internal/safety-reviews/${event.id}`, { headers: as });
  const queued = async () => (await (await list()).json()).events.some((row) => row.id === event.id);

  const booked = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['pm'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  const pending = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['night'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  const equipment = await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers.first, data: {
    equipment_id: first.id, quantity_requested: 1, technical_requirement: 'Rear of the hall', borrow_start: date + 'T01:00:00Z', borrow_end: date + 'T03:00:00Z',
  } });
  for (const response of [booked, pending, equipment]) expect(response.status()).toBe(201);
  expect((await request.patch(`/api/venues/booking-requests/${(await booked.json()).data.id}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);
  expect((await request.patch(`/api/venues/booking-requests/${(await pending.json()).data.id}/decision`, { headers: headers.dual, data: { decision: 'rejected', note: 'Night slot is closed for maintenance.' } })).status()).toBe(200);
  expect((await request.patch(`/api/equipment-requests/${(await equipment.json()).data.id}/status`, { headers: headers.dual, data: { status: 'APPROVED' } })).status()).toBe(200);

  // AC1: not in the queue until the coordinator submits it.
  expect(await queued()).toBe(false);
  expect((await detail()).status()).toBe(404);
  expect((await request.post(`/api/internal/events/${event.id}/submit-safety-check`, { headers: headers.first })).status()).toBe(200);
  expect(await queued()).toBe(true);

  // AC2/AC3: one confirmed venue with its own facts; the rejected one is absent.
  const review = await detail();
  expect(review.status()).toBe(200);
  const body = await review.json();
  expect(body.event).toMatchObject({ id: event.id, expected_attendance: 30, other_comments: 'Private organiser notes' });
  expect(body.event).not.toHaveProperty('organiser_id');
  expect(body.event).not.toHaveProperty('coordinator_id');
  expect(body.venues).toEqual([{
    id: (await booked.json()).data.id, name: 'Integration Hall', booking_date: date, slots: ['pm'], expected_attendees: 30, capacity: 200,
    room_layout: 'Theatre', accessibility_requirements: [], accessibility_features: ['Lift'], notes: '',
  }]);
  expect(body.equipment).toEqual([{ id: (await equipment.json()).data.id, type: `Projector ${first.id}`, quantity_requested: 1, technical_requirement: 'Rear of the hall' }]);

  // Access: only the Safety Officer reads it.
  for (const role of ['first', 'second', 'organiser', 'manager', 'dual', 'attendee']) {
    expect((await list(headers[role])).status(), role).toBe(403);
    expect((await detail(headers[role])).status(), role).toBe(403);
  }
  expect((await list(null)).status()).toBe(401);

  // AC4: the officer can change nothing, and the event is still awaiting review.
  for (const method of ['post', 'patch', 'put', 'delete']) {
    expect((await request[method](`/api/internal/safety-reviews/${event.id}`, { headers: headers.officer, data: { status: 'PREPARATION' } })).status(), method).toBe(403);
  }
  for (const action of ['withdraw-safety-check', 'cancel', 'postpone', 'approve']) {
    expect((await request.post(`/api/internal/events/${event.id}/${action}`, { headers: headers.officer, data: { reason: 'Not mine' } })).status(), action).toBe(403);
  }
  expect((await request.patch(`/api/event-workspace/organiser/${event.id}`, { headers: headers.officer, data: { name: 'Changed' } })).status()).toBe(403);
  expect(await queued()).toBe(true);

  // Withdrawing takes it out of the queue again.
  expect((await request.post(`/api/internal/events/${event.id}/withdraw-safety-check`, { headers: headers.first })).status()).toBe(200);
  expect(await queued()).toBe(false);
});
