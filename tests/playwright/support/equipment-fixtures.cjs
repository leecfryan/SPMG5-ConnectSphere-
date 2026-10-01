const { expect } = require('./fixtures.cjs');
const { backendURL } = require('./settings.cjs');
async function setupEquipment(accounts, request) {
  const organiser = await accounts.create(['event_organiser']);
  const coordinator = await accounts.create(['event_coordinator']);
  const technical = await accounts.create(['technical_support_staff']);
  const outsider = await accounts.create(['event_coordinator']);
  const sessions = await Promise.all([organiser, coordinator, technical, outsider].map(account => accounts.session(account)));
  const headers = sessions.map(session => ({ Authorization: 'Bearer ' + session.access_token }));
  const response = await request.post(backendURL + '/api/events', { headers: headers[0], data: {
    name: 'Equipment event ' + coordinator.id, purpose: 'Integration', description: 'Shared feature workflow',
    start_time: '2099-10-10T00:00:00Z', end_time: '2099-10-10T15:00:00Z', expected_attendance: 10,
  } });
  expect(response.status()).toBe(201);
  const { event } = await response.json();
  await accounts.assignEvent(event.id, coordinator.id);
  await accounts.updateEvent(event.id, { status: 'ACCEPTED' });
  const fields = { equipment_id: coordinator.id, quantity_requested: 2, technical_requirement: 'HDMI and microphone',
    borrow_start: '2099-10-10T00:00:00Z', borrow_end: '2099-10-10T03:00:00Z' };
  return { organiser, coordinator, technical, outsider, event, headers, fields };
}
module.exports = { setupEquipment };
