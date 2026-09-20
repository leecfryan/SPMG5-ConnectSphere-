const { test, expect } = require('./support/fixtures.cjs');
const { setupEquipment } = require('./support/equipment-fixtures.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const endpoints = [['get', '/equipment'], ['get', '/equipment/events'], ['get', `/events/${id}/equipment-requests`],
  ['post', `/events/${id}/equipment-requests`], ['get', '/technical-support/equipment-requests'], ['patch', `/equipment-requests/${id}/status`],
  ['get', `/events/${id}/messages`], ['post', `/events/${id}/messages`], ['patch', `/messages/${id}`]];

for (const role of [null, 'event_organiser', 'attendee', 'venue_staff', 'event_ops_manager', 'tech_support']) {
  test(`[EQUIPMENT-API-001] ${role || 'anonymous'} cannot bypass Equipment protection using role headers`, async ({ request, accounts }) => {
    const headers = { 'x-user-role': 'tech_support', 'x-permissions': 'equipment.review' };
    if (role) headers.Authorization = 'Bearer ' + (await accounts.session(await accounts.create([role]))).access_token;
    for (const [method, path] of endpoints) {
      const response = await request[method]('/api' + path, { headers, ...(method === 'get' ? {} : { data: {} }) });
      expect(response.status(), method + ' ' + path).toBe(role ? 403 : 401);
    }
  });
}

test('[EQUIPMENT-API-002] Assigned coordinator creates requests; unrelated coordinators cannot read or create them', async ({ request, accounts }) => {
  const { event, headers, fields, coordinator } = await setupEquipment(accounts, request);
  const picker = await request.get('/api/equipment/events', { headers: headers[1] });
  expect((await picker.json()).data.map(row => row.id)).toContain(event.id);
  const created = await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers[1], data: { ...fields, requested_by: 'forged', status: 'APPROVED' } });
  expect(created.status()).toBe(201);
  expect((await created.json()).data).toMatchObject({ requested_by: coordinator.id, status: 'PENDING', quantity_requested: 2 });
  expect((await request.get(`/api/events/${event.id}/equipment-requests`, { headers: headers[3] })).status()).toBe(403);
  expect((await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers[3], data: fields })).status()).toBe(403);
  expect((await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers[1], data: fields })).status()).toBe(409);
});
test('[EQUIPMENT-API-003] Technical staff review and revise arrangements; coordinators cannot review statuses', async ({ request, accounts }) => {
  const { event, headers, fields, coordinator } = await setupEquipment(accounts, request);
  const response = await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers[1], data: fields });
  const { data: row } = await response.json();
  const dashboard = await request.get('/api/technical-support/equipment-requests', { headers: headers[2] });
  expect(dashboard.status()).toBe(200);
  expect((await dashboard.json()).data.find(item => item.id === row.id)).toMatchObject({ event_name: event.name, requested_by_name: coordinator.email });
  expect((await request.get('/api/technical-support/equipment-requests', { headers: headers[1] })).status()).toBe(403);
  expect((await request.patch(`/api/equipment-requests/${row.id}/status`, { headers: headers[1], data: { status: 'APPROVED' } })).status()).toBe(403);
  for (const status of ['APPROVED', 'REJECTED', 'APPROVED']) {
    const changed = await request.patch(`/api/equipment-requests/${row.id}/status`, { headers: headers[2], data: { status } });
    expect(changed.status()).toBe(200);
    expect((await changed.json()).data.status).toBe(status);
  }
});
test('[EQUIPMENT-API-004] Clarifications enforce event relationships, author identity and retention', async ({ request, accounts }) => {
  const { event, headers, fields, technical } = await setupEquipment(accounts, request);
  const created = await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers[1], data: fields });
  const { data: row } = await created.json();
  const response = await request.post(`/api/events/${event.id}/messages`, { headers: headers[2], data: { equipment_request_id: row.id, body: 'Need an adapter?', author_id: 'forged', author_role: 'event_coordinator' } });
  expect(response.status()).toBe(201);
  const { data: message } = await response.json();
  expect(message).toMatchObject({ author_id: technical.id, author_role: 'tech_support' });
  expect((await request.get(`/api/events/${event.id}/messages`, { headers: headers[3] })).status()).toBe(403);
  expect((await request.patch(`/api/messages/${message.id}`, { headers: headers[1], data: { body: 'Changed' } })).status()).toBe(403);
  const edited = await request.patch(`/api/messages/${message.id}`, { headers: headers[2], data: { body: 'Need two adapters?' } });
  expect(edited.status()).toBe(200);
  const shared = await request.get(`/api/events/${event.id}/messages`, { headers: headers[1] });
  expect((await shared.json()).data[0].body).toBe('Need two adapters?');
  await accounts.updateEvent(event.id, { end_time: '2000-01-01T00:00:00Z' });
  expect((await (await request.get(`/api/events/${event.id}/messages`, { headers: headers[2] })).json()).data).toEqual([]);
  expect((await request.post(`/api/events/${event.id}/messages`, { headers: headers[2], data: { equipment_request_id: row.id, body: 'Too late' } })).status()).toBe(410);
  expect((await request.patch(`/api/messages/${message.id}`, { headers: headers[2], data: { body: 'Too late' } })).status()).toBe(410);
});
test('[EQUIPMENT-API-005] Revoking a role denies the next request with the same token', async ({ request, accounts }) => {
  const { technical, headers } = await setupEquipment(accounts, request);
  expect((await request.get('/api/technical-support/equipment-requests', { headers: headers[2] })).status()).toBe(200);
  await accounts.update(technical, { roles: ['attendee'] });
  expect((await request.get('/api/technical-support/equipment-requests', { headers: headers[2] })).status()).toBe(403);
});
