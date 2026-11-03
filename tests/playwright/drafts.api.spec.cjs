const { test, expect } = require('./support/fixtures.cjs');
const { randomUUID } = require('node:crypto');

function completeDetails() {
  const start = Date.now() + 7 * 86400000;
  return { purpose: 'Team meeting', description: 'Planning session', start_time: new Date(start).toISOString(),
    end_time: new Date(start + 3600000).toISOString(), expected_attendance: '25' };
}

// Owner and colleague share an organisation, so the colleague already sees the
// owner's submitted requests (SCRUM-100) - the case drafts must not follow.
async function organisation(accounts) {
  const company = randomUUID();
  const people = {
    owner: await accounts.create(['event_organiser'], {}, { organisation_id: company }),
    colleague: await accounts.create(['event_organiser'], {}, { organisation_id: company }),
  };
  const headers = {};
  for (const [name, account] of Object.entries(people)) {
    headers[name] = { Authorization: 'Bearer ' + (await accounts.session(account)).access_token };
  }
  return { ...people, headers };
}

test('[DRAFT-API-001] SCRUM-147 AC1-AC3: a name-only draft is saved, edited, refused while incomplete, then submitted', async ({ request, accounts }) => {
  const { owner, headers } = await organisation(accounts);
  const created = await request.post('/api/events/drafts', { headers: headers.owner, data: { name: '  Draft gala  ', status: 'APPROVED', organiser_id: 'someone-else' } });
  expect(created.status()).toBe(201);
  const { event: draft } = await created.json();
  expect(draft).toMatchObject({ name: 'Draft gala', status: 'DRAFT', organiser_id: owner.id });
  expect(draft).not.toHaveProperty('submitted_at');

  const edited = await request.patch(`/api/events/drafts/${draft.id}`, { headers: headers.owner, data: { purpose: 'Team meeting' } });
  expect(edited.status()).toBe(200);
  expect((await edited.json()).event).toMatchObject({ status: 'DRAFT', name: 'Draft gala', purpose: 'Team meeting' });
  expect((await (await request.get('/api/events/drafts', { headers: headers.owner })).json()).drafts.map(d => d.id)).toEqual([draft.id]);

  const incomplete = await request.post(`/api/events/drafts/${draft.id}/submit`, { headers: headers.owner, data: {} });
  expect(incomplete.status()).toBe(400);
  expect((await incomplete.json()).errors.map(e => e.field).sort()).toEqual(['description', 'end_time', 'expected_attendance', 'start_time']);
  expect((await accounts.events(owner))[0].status).toBe('DRAFT');

  const submitted = await request.post(`/api/events/drafts/${draft.id}/submit`, { headers: headers.owner, data: completeDetails() });
  expect(submitted.status()).toBe(200);
  expect((await submitted.json()).event).toMatchObject({ id: draft.id, status: 'SUBMITTED', name: 'Draft gala', purpose: 'Team meeting', expected_attendance: 25 });
  const [stored] = await accounts.events(owner);
  expect(stored.submitted_at).toEqual(expect.any(String));
  expect((await (await request.get('/api/events/drafts', { headers: headers.owner })).json()).drafts).toEqual([]);
  // A submitted request is no longer a draft: the draft endpoints stop answering for it.
  expect((await request.patch(`/api/events/drafts/${draft.id}`, { headers: headers.owner, data: { name: 'Late edit' } })).status()).toBe(404);
  expect((await (await request.get('/api/event-workspace/organiser', { headers: headers.owner })).json()).events.map(e => e.id)).toEqual([draft.id]);
});

test('[DRAFT-API-002] SCRUM-147 AC4: a colleague in the same company can neither list, open, edit nor submit the draft', async ({ request, accounts }) => {
  const { owner, headers } = await organisation(accounts);
  const { event: draft } = await (await request.post('/api/events/drafts', { headers: headers.owner, data: { name: 'Private draft', ...completeDetails() } })).json();

  expect((await (await request.get('/api/events/drafts', { headers: headers.colleague })).json()).drafts).toEqual([]);
  for (const [method, path, data] of [['get', ''], ['patch', '', { name: 'Taken over' }], ['post', '/submit', {}]]) {
    const response = await request[method](`/api/events/drafts/${draft.id}${path}`, { headers: headers.colleague, data });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ message: 'Draft not found.' });
  }
  // Nor through the shared company view, which the owner's own drafts also stay out of.
  for (const viewer of ['colleague', 'owner']) {
    const list = await (await request.get('/api/event-workspace/organiser', { headers: headers[viewer] })).json();
    expect(list.events.map(e => e.id)).not.toContain(draft.id);
    expect((await request.get(`/api/event-workspace/organiser/${draft.id}`, { headers: headers[viewer] })).status()).toBe(404);
  }
  expect(await accounts.events(owner)).toEqual([expect.objectContaining({ id: draft.id, name: 'Private draft', status: 'DRAFT' })]);
});

for (const [index, role] of ['attendee', 'event_coordinator', 'event_coordinator_lead', 'venue_staff'].entries()) {
  test(`[DRAFT-API-00${index + 3}] SCRUM-147 AC4: ${role} cannot list or save drafts`, async ({ request, accounts }) => {
    const account = await accounts.create([role]);
    const headers = { Authorization: 'Bearer ' + (await accounts.session(account)).access_token };
    expect((await request.get('/api/events/drafts', { headers })).status()).toBe(403);
    expect((await request.post('/api/events/drafts', { headers, data: { name: 'Not mine to make' } })).status()).toBe(403);
    expect(await accounts.events(account)).toEqual([]);
  });
}

test('[DRAFT-API-007] SCRUM-147: anonymous and forged-token draft requests fail before storage', async ({ request }) => {
  for (const headers of [{}, { Authorization: 'Bearer forged-token' }]) {
    expect((await request.get('/api/events/drafts', { headers })).status()).toBe(401);
    expect((await request.post('/api/events/drafts', { headers, data: { name: 'Anonymous' } })).status()).toBe(401);
  }
});
