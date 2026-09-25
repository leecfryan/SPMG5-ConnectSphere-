const { test, expect } = require('./support/fixtures.cjs');
const { authURL, publicKey } = require('./support/settings.cjs');
const bearer = (session) => ({ Authorization: 'Bearer ' + session.access_token });

test('[API-CONFIG-001] Health and public configuration expose no server credentials', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  const config = await request.get('/api/auth/config');
  expect(config.status()).toBe(200);
  expect(config.headers()['cache-control']).toBe('no-store');
  expect(await config.json()).toEqual({ supabaseUrl: authURL, publishableKey: publicKey });
});

for (const [index, value] of ['', 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer forged-token'].entries()) {
  test(`[API-AUTH-00${index + 1}] ${value || 'Missing authorization'} cannot access protected identity or staff data`, async ({ request }) => {
    for (const path of ['/api/auth/me', '/api/internal/access']) {
      const response = await request.get(path, { headers: value ? { Authorization: value } : {} });
      expect(response.status()).toBe(401);
      expect(response.headers()['cache-control']).toBe('no-store');
      const body = await response.json();
      expect(Object.keys(body)).toEqual(['message']);
      expect(body.message).not.toContain('Private provider');
    }
  });
}

test('[API-AUTH-006] Verified identity ignores caller-supplied roles and permissions', async ({ request, accounts }) => {
  const account = await accounts.create(['attendee'], { roles: ['event_coordinator'], user_type: 'internal' });
  const session = await accounts.session(account);
  const headers = { ...bearer(session), 'X-User-Role': 'event_coordinator', 'X-Permissions': 'clients.read' };
  const response = await request.get('/api/auth/me?role=event_coordinator&permissions=clients.read', { headers });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    user: { id: account.id, email: account.email, fullName: 'Playwright Staff', roles: ['attendee'], accountTypes: ['external'] }, permissions: [],
  });
  expect((await request.get('/api/internal/access?role=venue_staff', { headers })).status()).toBe(403);
});

test('[API-AUTH-007] Revocation is checked on the next request with the same token', async ({ request, accounts }) => {
  const account = await accounts.create();
  const headers = bearer(await accounts.session(account));
  expect((await request.get('/api/auth/me', { headers })).status()).toBe(200);
  await accounts.update(account, { revoked: true });
  for (const path of ['/api/auth/me', '/api/internal/access']) {
    expect((await request.get(path, { headers })).status()).toBe(401);
  }
});

test('[API-AUTH-008] Provider rate limiting fails closed without leaking upstream details', async ({ request, accounts }) => {
  const account = await accounts.create();
  const headers = bearer(await accounts.session(account));
  await accounts.update(account, { providerStatus: 429 });
  for (const path of ['/api/auth/me', '/api/internal/access']) {
    const response = await request.get(path, { headers });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ message: 'Unable to verify your session. Please try again.' });
  }
});

const permissions = ['venues.read', 'bookings.read', 'equipment.read', 'technical_requests.read', 'event_planning.read', 'attendees.read', 'clients.read', 'event_organisers.read'];
const matrix = [
  ['venue_staff', ['venues.read', 'bookings.read']],
  ['technical_support_staff', ['equipment.read', 'technical_requests.read']],
  ['event_coordinator', permissions],
  // SCRUM-26 grants managers internal access; organiser reads still require a record check.
  ['attendee', []], ['event_organiser', []], ['event_ops_manager', ['event_organisers.read']],
];
for (const [roleIndex, [role, allowed]] of matrix.entries()) {
  for (const [permissionIndex, permission] of permissions.entries()) {
    const id = String(roleIndex * permissions.length + permissionIndex + 1).padStart(3, '0');
    test(`[API-RBAC-${id}] ${role} ${allowed.includes(permission) ? 'may' : 'may not'} read ${permission} through HTTP`, async ({ request, accounts }) => {
      const account = await accounts.create([role]);
      const headers = bearer(await accounts.session(account));
      const response = await request.get('/api/internal/fixtures/' + permission + '/managed-event', { headers });
      expect(response.headers()['cache-control']).toBe('no-store');
      if (allowed.includes(permission)) {
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ id: 'managed-event', permission, information: 'Restricted fixture' });
        expect((await accounts.counts(account)).handler).toBe(1);
      } else {
        expect(response.status()).toBe(403);
        expect(Object.keys(await response.json())).toEqual(['message']);
        const counts = await accounts.counts(account);
        expect(counts.handler).toBe(0);
        expect(counts.record).toBe(0);
      }
    });
  }
}

test('[API-RBAC-049] Combined roles return unique capabilities and removal immediately removes access', async ({ request, accounts }) => {
  const account = await accounts.create(['venue_staff', 'technical_support_staff', 'attendee', 'venue_staff']);
  const headers = bearer(await accounts.session(account));
  const identity = await request.get('/api/auth/me', { headers });
  expect((await identity.json()).permissions).toEqual(['venues.update', 'bookings.decide', 'equipment.review', 'equipment.messages', 'internal.access', 'venues.read', 'bookings.read', 'equipment.read', 'technical_requests.read']);
  const access = await request.get('/api/internal/access', { headers });
  expect(access.status()).toBe(200);
  expect((await access.json()).responsibilities.map((item) => item.permission)).toEqual(permissions.slice(0, 4));
  await accounts.update(account, { roles: ['attendee'] });
  expect((await request.get('/api/internal/access', { headers })).status()).toBe(403);
  expect((await (await request.get('/api/auth/me', { headers })).json()).permissions).toEqual([]);
});

test('[API-RBAC-050] Operations manager access remains limited to its permissions and authorised records', async ({ request, accounts }) => {
  const account = await accounts.create(['event_ops_manager']);
  const headers = bearer(await accounts.session(account));
  const identity = await request.get('/api/auth/me', { headers });
  expect(identity.status()).toBe(200);
  expect((await identity.json()).permissions.sort()).toEqual([
    'event_organisers.read', 'events.assign_coordinator', 'internal.access',
  ]);

  for (const path of ['/api/venues', '/api/equipment', '/api/equipment/events', '/api/technical-support/equipment-requests']) {
    expect((await request.get(path, { headers })).status()).toBe(403);
  }
  // These fixture endpoints exercise the real record guard, not production event storage.
  for (const id of ['unrelated-event', 'missing-event', 'truthy', 'provider-down']) {
    const response = await request.get('/api/internal/fixtures/event_organisers.read/' + id, { headers });
    expect(response.status()).toBe(id === 'provider-down' ? 503 : 403);
    expect(Object.keys(await response.json())).toEqual(['message']);
  }
  const counts = await accounts.counts(account);
  expect(counts.record).toBe(4);
  expect(counts.handler).toBe(0);
});

for (const [index, roles] of [[], ['superadmin', '__proto__'], 'venue_staff', null].entries()) {
  test(`[API-DENY-00${index + 1}] Role fixture ${JSON.stringify(roles)} grants no internal access`, async ({ request, accounts }) => {
    const account = await accounts.create();
    await accounts.update(account, { roles });
    const headers = bearer(await accounts.session(account));
    expect((await (await request.get('/api/auth/me', { headers })).json()).permissions).toEqual([]);
    expect((await request.get('/api/internal/access', { headers })).status()).toBe(403);
  });
}

for (const [index, method] of ['POST', 'PUT', 'PATCH', 'DELETE'].entries()) {
  test(`[API-WRITE-00${index + 1}] Read permission cannot authorize ${method} even with caller role claims`, async ({ request, accounts }) => {
    const account = await accounts.create();
    const response = await request.fetch('/api/internal/fixtures/venues.read/venue-a', {
      method, headers: bearer(await accounts.session(account)), data: { roles: ['event_coordinator'] },
    });
    expect(response.status()).toBe(403);
    expect((await accounts.counts(account)).handler).toBe(0);
  });
}

for (const [index, id] of ['unrelated-event', 'missing-event', 'truthy', 'provider-down'].entries()) {
  test(`[API-RECORD-00${index + 1}] ${id} record check exposes no attendee or client data`, async ({ request, accounts }) => {
    const account = await accounts.create(['event_coordinator']);
    const headers = bearer(await accounts.session(account));
    for (const permission of ['attendees.read', 'clients.read']) {
      const response = await request.get('/api/internal/fixtures/' + permission + '/' + id + '?managed=true', { headers });
      expect(response.status()).toBe(id === 'provider-down' ? 503 : 403);
      const body = await response.json();
      expect(Object.keys(body)).toEqual(['message']);
      expect(body.message).not.toContain('Private database');
    }
    expect((await accounts.counts(account)).handler).toBe(0);
  });
}

test('[API-SCOPE-001] Venue and equipment access is independent of unrelated profile location metadata', async ({ request, accounts }) => {
  const account = await accounts.create(['venue_staff', 'technical_support_staff'], { venue_id: 'venue-a', equipment_type: 'projector', location: 'West' });
  const headers = bearer(await accounts.session(account));
  for (const path of ['venues.read/venue-b', 'venues.read/east-location', 'equipment.read/microphone']) {
    expect((await request.get('/api/internal/fixtures/' + path, { headers })).status()).toBe(200);
  }
});
