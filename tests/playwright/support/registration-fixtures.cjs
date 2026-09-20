const { expect } = require('./fixtures.cjs');
const { backendURL } = require('./settings.cjs');
async function setupRegistration(accounts, request, fields = [{ id: 'full_name', label: 'Full name', type: 'text', required: true }]) {
  const organiser = await accounts.create(['event_organiser']);
  const attendee = await accounts.create(['attendee']);
  const outsider = await accounts.create(['attendee']);
  const sessions = await Promise.all([organiser, attendee, outsider].map(account => accounts.session(account)));
  const headers = sessions.map(session => ({ Authorization: 'Bearer ' + session.access_token }));
  const response = await request.post(backendURL + '/api/events', { headers: headers[0], data: {
    name: 'Registration event ' + attendee.id, purpose: 'Meet the community', description: 'Attendee-facing information',
    start_time: '2099-10-10T10:00:00Z', end_time: '2099-10-10T15:00:00Z', expected_attendance: 10,
    other_comments: 'PRIVATE organiser planning notes', equipment_needs: 'PRIVATE planning equipment',
  } });
  expect(response.status()).toBe(201);
  const { event } = await response.json();
  await accounts.updateEvent(event.id, { status: 'APPROVED', registration_fields: fields });
  return { organiser, attendee, outsider, event, headers };
}
module.exports = { setupRegistration };
