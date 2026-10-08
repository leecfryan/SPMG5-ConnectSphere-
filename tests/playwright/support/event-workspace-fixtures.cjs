const { expect } = require('./fixtures.cjs');
const { backendURL } = require('./settings.cjs');

async function setupWorkflow(accounts, request) {
  const organiser = await accounts.create(['event_organiser']);
  const manager = await accounts.create(['event_ops_manager']);
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
module.exports = { setupWorkflow, setupOrganiserAccess };
