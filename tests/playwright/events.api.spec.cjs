const { test, expect } = require('./support/fixtures.cjs');

function eventBody() {
  const start = Date.now() + 7 * 86400000;
  return { name: '  Integrated event  ', purpose: 'Team meeting', description: 'Planning session',
    start_time: new Date(start).toISOString(), end_time: new Date(start + 3600000).toISOString(), expected_attendance: '25',
    venue_requirements: 'Accessible room', equipment_needs: 'Projector', accessibility_needs: 'Step-free access', other_comments: 'Tea provided' };
}

for (const [i, role] of ['attendee', 'venue_staff', 'technical_support_staff', 'event_coordinator', 'event_ops_manager'].entries()) {
  test(`[EVENT-API-00${i + 1}] ${role} cannot create an organiser event`, async ({ request, accounts }) => {
    const account = await accounts.create([role], { roles: ['event_organiser'] });
    const session = await accounts.session(account);
    const response = await request.post('/api/events?role=event_organiser', {
      headers: { Authorization: 'Bearer ' + session.access_token, 'X-User-Role': 'event_organiser' }, data: eventBody(),
    });
    expect(response.status()).toBe(403);
    expect(await accounts.events(account)).toEqual([]);
  });
}

test('[EVENT-API-006] Anonymous and forged-token submissions fail before persistence', async ({ request }) => {
  for (const headers of [{}, { Authorization: 'Bearer forged-token' }]) {
    const response = await request.post('/api/events', { headers, data: eventBody() });
    expect(response.status()).toBe(401);
    expect(await response.json()).not.toHaveProperty('event');
  }
});

test('[EVENT-API-007] Organiser submission preserves requirements and uses only verified ownership', async ({ request, accounts }) => {
  const account = await accounts.create(['event_organiser', 'attendee']);
  const session = await accounts.session(account);
  const response = await request.post('/api/events', {
    headers: { Authorization: 'Bearer ' + session.access_token },
    data: { ...eventBody(), organiser_id: 'someone-else', status: 'APPROVED', coordinator_id: 'someone-else' },
  });
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toBe('no-store');
  const { event } = await response.json();
  expect(event).toMatchObject({ name: 'Integrated event', organiser_id: account.id, status: 'SUBMITTED', expected_attendance: 25,
    venue_requirements: 'Accessible room', equipment_needs: 'Projector', accessibility_needs: 'Step-free access', other_comments: 'Tea provided' });
  expect(event).not.toHaveProperty('coordinator_id');
  expect(await accounts.events(account)).toEqual([event]);
});

test('[EVENT-API-008] Missing required fields return all validation errors without saving', async ({ request, accounts }) => {
  const account = await accounts.create(['event_organiser']);
  const session = await accounts.session(account);
  const response = await request.post('/api/events', { headers: { Authorization: 'Bearer ' + session.access_token }, data: {} });
  expect(response.status()).toBe(400);
  expect((await response.json()).errors.map((error) => error.field).sort()).toEqual(['description', 'end_time', 'expected_attendance', 'name', 'purpose', 'start_time']);
  expect(await accounts.events(account)).toEqual([]);
});

test('[EVENT-API-009] Storage failure preserves the generic error contract and saves nothing', async ({ request, accounts }) => {
  const account = await accounts.create(['event_organiser']);
  const session = await accounts.session(account);
  await accounts.update(account, { submissionFailure: true });
  const response = await request.post('/api/events', { headers: { Authorization: 'Bearer ' + session.access_token }, data: eventBody() });
  expect(response.status()).toBe(500);
  expect(await response.json()).toEqual({ error: 'Could not submit the event request. Please try again.' });
  expect(await accounts.events(account)).toEqual([]);
});
