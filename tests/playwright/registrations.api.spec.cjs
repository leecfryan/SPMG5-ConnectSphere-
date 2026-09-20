const { test, expect } = require('./support/fixtures.cjs');
const { setupRegistration } = require('./support/registration-fixtures.cjs');

test('[REG-API-001] Approved event browsing excludes internal planning fields and draft events', async ({ request, accounts }) => {
  const { event, headers } = await setupRegistration(accounts, request);
  const list = await request.get('/api/events', { headers: headers[1] });
  expect(list.status()).toBe(200);
  expect((await list.json()).events.some(row => row.id === event.id)).toBe(true);
  const detail = await request.get('/api/events/' + event.id, { headers: headers[1] });
  expect(detail.status()).toBe(200);
  const body = await detail.json();
  expect(body.event.registration_fields[0].id).toBe('full_name');
  expect(JSON.stringify(body)).not.toContain('PRIVATE');
  for (const field of ['organiser_id', 'coordinator_id', 'other_comments', 'equipment_needs', 'venue_requirements']) expect(body.event).not.toHaveProperty(field);
  await accounts.updateEvent(event.id, { status: 'SUBMITTED' });
  expect((await request.get('/api/events/' + event.id, { headers: headers[1] })).status()).toBe(404);
  expect((await request.post('/api/registrations', { headers: headers[1], data: { eventId: event.id, registrationData: { full_name: 'Alice' } } })).status()).toBe(409);
});

test('[REG-API-002] Registration identity, duplicate handling and ownership stay enforced', async ({ request, accounts }) => {
  const { event, attendee, outsider, headers } = await setupRegistration(accounts, request);
  const data = { eventId: event.id, registrationData: { full_name: 'Alice' }, attendee_id: outsider.id, status: 'confirmed' };
  const response = await request.post('/api/registrations', { headers: headers[1], data });
  expect(response.status()).toBe(201);
  const { registration } = await response.json();
  expect(registration).toMatchObject({ attendee_id: attendee.id, event_id: event.id, status: 'pending' });
  expect((await request.post('/api/registrations', { headers: headers[1], data })).status()).toBe(409);
  const mine = await request.get('/api/registrations/me?attendee_id=' + attendee.id, { headers: headers[2] });
  expect((await mine.json()).registrations).toEqual([]);
  expect((await request.get('/api/registrations/me/' + registration.id, { headers: headers[2] })).status()).toBe(404);
  expect((await request.patch('/api/registrations/' + registration.id + '/withdraw', { headers: headers[2] })).status()).toBe(404);
  const withdrawn = await request.patch('/api/registrations/' + registration.id + '/withdraw', { headers: headers[1] });
  expect(withdrawn.status()).toBe(200);
  expect((await withdrawn.json()).registration).toMatchObject({ id: registration.id, event_id: event.id, status: 'withdrawn' });
  const retained = await request.get('/api/registrations/me/' + registration.id, { headers: headers[1] });
  expect((await retained.json()).registration.status).toBe('withdrawn');
});

for (const [index, status, hours, expected] of [[3, 'confirmed', 72, 403], [4, 'pending', -1, 409], [5, 'pending', 12, 409], [6, 'withdrawn', 72, 409]]) {
  test(`[REG-API-00${index}] Withdrawal rejects ${status} registration with event ${hours} hours away`, async ({ request, accounts }) => {
    const { event, headers } = await setupRegistration(accounts, request);
    const response = await request.post('/api/registrations', { headers: headers[1], data: { eventId: event.id, registrationData: { full_name: 'Alice' } } });
    const { registration } = await response.json();
    await accounts.updateRegistration(registration.id, { status });
    await accounts.updateEvent(event.id, { start_time: new Date(Date.now() + hours * 3600000).toISOString() });
    expect((await request.patch('/api/registrations/' + registration.id + '/withdraw', { headers: headers[1] })).status()).toBe(expected);
    const detail = await request.get('/api/registrations/me/' + registration.id, { headers: headers[1] });
    expect((await detail.json()).registration.status).toBe(status);
  });
}

test('[REG-API-007] Missing authentication and malformed dynamic details are rejected', async ({ request, accounts }) => {
  const { event, headers } = await setupRegistration(accounts, request);
  for (const path of ['/api/events', '/api/events/' + event.id, '/api/registrations/me', '/api/registrations/me/missing']) expect((await request.get(path)).status()).toBe(401);
  expect((await request.post('/api/registrations', { data: { eventId: event.id } })).status()).toBe(401);
  expect((await request.patch('/api/registrations/missing/withdraw')).status()).toBe(401);
  for (const registrationData of [{}, { full_name: '  ' }, { full_name: { unsafe: true } }, ['Alice'], 'Alice']) {
    expect((await request.post('/api/registrations', { headers: headers[1], data: { eventId: event.id, registrationData } })).status()).toBe(400);
  }
  expect((await request.post('/api/test/control', { data: { command: 'deleteRegistration' } })).status()).toBe(404);
});
