const { expect } = require('./fixtures.cjs');
const { backendURL } = require('./settings.cjs');

async function setupWorkflow(accounts, request) {
  const organiser = await accounts.create(['event_organiser']);
  const manager = await accounts.create(['event_coordinator_lead']);
  const first = await accounts.create(['event_coordinator'], { full_name: 'Coordinator One' });
  const second = await accounts.create(['event_coordinator'], { full_name: 'Coordinator Two' });
  const dual = await accounts.create(['venue_staff', 'technical_support_staff']);
  const attendee = await accounts.create(['attendee']);
  const people = { organiser, manager, first, second, dual, attendee };
  const headers = {};
  for (const [name, account] of Object.entries(people)) headers[name] = { Authorization: 'Bearer ' + (await accounts.session(account)).access_token };
  const date = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const response = await request.post(backendURL + '/api/events', { headers: headers.organiser, data: {
    name: 'Assigned event ' + first.id, purpose: 'Planning access test', description: 'Event for the role workflow',
    start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z', expected_attendance: 30,
    venue_requirements: 'Theatre with projector', equipment_needs: 'Projector and microphone', other_comments: 'Private organiser notes',
  } });
  expect(response.status()).toBe(201);
  const { event } = await response.json();
  const update = (action, data) => request.patch(`${backendURL}/api/event-workspace/${event.id}/${action}`, { headers: headers.manager, data });
  return { ...people, headers, event, date, update };
}
// SCRUM-100 fixtures use a fresh organisation ID per run to isolate concurrent tests.
async function setupOrganiserAccess(accounts, request) {
  const { randomUUID } = require('node:crypto');
  const alpha = randomUUID(), beta = randomUUID();
  const organiser = await accounts.create(['event_organiser'], {}, { organisation_id: alpha });
  const colleague = await accounts.create(['event_organiser'], {}, { organisation_id: alpha });
  const outsider = await accounts.create(['event_organiser'], { organisation_id: alpha }, { organisation_id: beta });
  const people = { organiser, colleague, outsider };
  const headers = {}, events = {};
  for (const [name, account] of Object.entries(people)) {
    headers[name] = { Authorization: 'Bearer ' + (await accounts.session(account)).access_token };
    const response = await request.post(backendURL + '/api/events', { headers: headers[name], data: {
      name: name + ' request ' + account.id, purpose: 'Client planning', description: name + ' requirements',
      start_time: '2099-01-01T01:00:12.345Z', end_time: '2099-01-01T03:00:12.345Z', expected_attendance: 20,
      equipment_needs: 'Projector', other_comments: name + ' private notes',
    } });
    expect(response.status()).toBe(201);
    events[name] = (await response.json()).event;
  }
  return { ...people, headers, events, alpha, beta };
}
const FIXTURE_VENUE_ID = '11111111-1111-4111-8111-111111111111';
// SCRUM-141: shared setup - an approved event with one confirmed venue,
// submitted for the safety check by its assigned coordinator.
async function submittedForSafety(accounts, request, dayOffset) {
  const workflow = await setupWorkflow(accounts, request);
  const { event, first, headers, update } = workflow;
  headers.officer = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create(['safety_officer']))).access_token };
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // A day no other spec books, so the shared fixture venue's confirmed slots never clash.
  const date = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const venue = await request.post(`${backendURL}/api/venues/${FIXTURE_VENUE_ID}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['am'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  expect(venue.status()).toBe(201);
  expect((await request.patch(`${backendURL}/api/venues/booking-requests/${(await venue.json()).data.id}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);
  expect((await request.post(`${backendURL}/api/internal/events/${event.id}/submit-safety-check`, { headers: headers.first })).status()).toBe(200);
  return { ...workflow, date };
}
module.exports = { setupWorkflow, setupOrganiserAccess, submittedForSafety };
