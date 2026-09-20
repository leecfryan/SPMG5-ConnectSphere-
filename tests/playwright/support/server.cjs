// Test-only transport simulator. Never imported by backend/src/server.js or Docker.
// Real frontend/backend Supabase SDKs call this local HTTP service.
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const express = require('../../../backend/node_modules/express');
const cors = require('../../../backend/node_modules/cors');
const { createClient } = require('../../../backend/node_modules/@supabase/supabase-js');
const createApp = require('../../../backend/src/app');
const requirePermission = require('../../../backend/src/middleware/requirePermission');
const { frontendURL, backendPort, authPort, authURL, publicKey } = require('./settings.cjs');

if (!process.env.PW_CONTROL_KEY) throw new Error('Start using Playwright; control key is required.');
const accounts = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const auth = express();
auth.use(cors({ origin: frontendURL }));
auth.use(express.json());

auth.use('/__test', (req, res, next) => {
  if (req.get('X-Test-Control') !== process.env.PW_CONTROL_KEY) return res.sendStatus(403);
  next();
});
auth.post('/__test/accounts', (req, res) => {
  const id = randomUUID();
  const account = {
    id, email: id + '@example.test', password: 'Local-fixture-only-42!',
    roles: req.body.roles ?? ['venue_staff'], metadata: req.body.metadata ?? {},
    revoked: false, providerStatus: 200, loginStatus: 200,
    events: [], submissionFailure: false,
    counts: { login: 0, verification: 0, refresh: 0, logout: 0, record: 0, handler: 0 },
  };
  accounts.set(id, account);
  res.status(201).json({ id, email: account.email, password: account.password });
});
auth.patch('/__test/accounts/:id', (req, res) => {
  const account = accounts.get(req.params.id);
  if (!account) return res.sendStatus(404);
  for (const key of ['roles', 'revoked', 'providerStatus', 'loginStatus', 'submissionFailure']) {
    if (Object.hasOwn(req.body, key)) account[key] = req.body[key];
  }
  res.sendStatus(204);
});
// Assignment is fixture setup only; no assignment API is added to production.
auth.patch('/__test/events/:id', (req, res) => {
  const event = [...accounts.values()].flatMap(account => account.events).find(event => event.id === req.params.id);
  if (!event) return res.sendStatus(404);
  for (const key of ['end_time', 'coordinator_id']) if (Object.hasOwn(req.body, key)) event[key] = req.body[key];
  res.sendStatus(204);
});
auth.post('/__test/events/:id/assignment', (req, res) => {
  const event = [...accounts.values()].flatMap(account => account.events).find(event => event.id === req.params.id);
  if (!event || !accounts.has(req.body.coordinatorId)) return res.sendStatus(404);
  event.coordinator_id = req.body.coordinatorId;
  res.sendStatus(204);
});
auth.get('/__test/accounts/:id', (req, res) => {
  const account = accounts.get(req.params.id);
  if (!account) return res.sendStatus(404);
  res.json({ counts: account.counts, events: account.events });
});
function user(account) {
  return {
    id: account.id, email: account.email, aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'], roles: account.roles },
    user_metadata: { full_name: 'Playwright Staff', ...account.metadata },
    created_at: '2026-01-01T00:00:00.000Z',
  };
}
function issueSession(account) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [encode({ alg: 'HS256', typ: 'JWT' }), encode({
    sub: account.id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    role: 'authenticated', jti: randomUUID(),
  }), Buffer.from(randomUUID()).toString('base64url')].join('.');
  const refresh = randomUUID();
  accessTokens.set(token, account);
  refreshTokens.set(refresh, account);
  return { access_token: token, refresh_token: refresh, expires_in: 3600, token_type: 'bearer', user: user(account) };
}
function failure(res, status) {
  return res.status(status).json({ code: 'fixture_auth_failure', msg: 'Private provider fixture detail' });
}
auth.post('/auth/v1/token', (req, res) => {
  if (req.query.grant_type === 'refresh_token') {
    const account = refreshTokens.get(req.body.refresh_token);
    if (!account || account.revoked) return failure(res, 400);
    account.counts.refresh++;
    return res.json(issueSession(account));
  }
  const account = [...accounts.values()].find((item) => item.email === req.body.email);
  if (account) account.counts.login++;
  if (!account || req.body.password !== account.password || account.revoked) return failure(res, 400);
  if (account.loginStatus !== 200) return failure(res, account.loginStatus);
  res.json(issueSession(account));
});
auth.get('/auth/v1/user', (req, res) => {
  const account = accessTokens.get((req.get('Authorization') || '').replace(/^Bearer /i, ''));
  if (!account || account.revoked) return failure(res, 401);
  account.counts.verification++;
  if (account.providerStatus !== 200) return failure(res, account.providerStatus);
  res.json(user(account));
});
auth.post('/auth/v1/logout', (req, res) => {
  const account = accessTokens.get((req.get('Authorization') || '').replace(/^Bearer /i, ''));
  if (!account) return failure(res, 401);
  account.counts.logout++;
  // Match refresh revocation; do not claim already-issued JWTs instantly expire.
  for (const [token, owner] of refreshTokens) if (owner === account) refreshTokens.delete(token);
  res.sendStatus(204);
});

const client = createClient(authURL, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
// Only storage is substituted; event routing, validation, normalization and
// verified ownership are the production implementations.
const eventsRepository = {
  async createSubmitted(fields, organiserId) {
    const account = accounts.get(organiserId);
    if (!account || account.submissionFailure) throw new Error('Fixture event storage unavailable');
    const event = { ...fields, id: randomUUID(), organiser_id: organiserId, status: 'SUBMITTED', submitted_at: new Date().toISOString() };
    account.events.push(event);
    return event;
  },
};
const venuesService = require('./venue-storage.cjs')(accounts);
const equipmentDependencies = require('./equipment-storage.cjs')(accounts);
const app = createApp({ authClient: client, eventsRepository, venuesService, equipmentDependencies, supabaseUrl: authURL, publishableKey: publicKey, frontendOrigin: frontendURL });
// Fixture endpoints exercise real middleware; these are NOT production business endpoints.
const permissions = ['venues.read', 'equipment.read', 'bookings.read', 'technical_requests.read', 'event_planning.read', 'attendees.read', 'clients.read', 'event_organisers.read'];
for (const permission of permissions) {
  const recordCheck = ['venues.read', 'equipment.read'].includes(permission) ? undefined : async (req) => {
    accounts.get(req.user.id).counts.record++;
    if (req.params.id === 'provider-down') throw new Error('Private database fixture detail');
    if (req.params.id === 'truthy') return 'yes';
    return req.params.id === 'managed-event';
  };
  app.all('/api/internal/fixtures/' + permission + '/:id', requirePermission(permission, recordCheck), (req, res) => {
    accounts.get(req.user.id).counts.handler++;
    res.json({ id: req.params.id, permission, information: 'Restricted fixture' });
  });
}
async function main() {
  const authServer = auth.listen(authPort, '127.0.0.1');
  await once(authServer, 'listening');
  const backendServer = app.listen(backendPort, '127.0.0.1');
  await once(backendServer, 'listening');
  console.log('Local Playwright backend and Auth simulator ready.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    for (const server of [authServer, backendServer]) { server.close(); server.closeAllConnections(); }
    process.exit(0);
  });
}
main().catch((error) => { console.error(error); process.exit(1); });
