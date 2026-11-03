const { createHmac } = require('node:crypto');
const { test, expect, signIn } = require('./support/fixtures.cjs');
const { authURL, backendURL } = require('./support/settings.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';
const controls = () => ({ 'X-Test-Control': process.env.PW_CONTROL_KEY });
const stamp = value => value.slice(0, 19).replace('T', ' ') + ' UTC';
async function fixture(accounts, request, info, caseNumber) {
  const organiser = await accounts.create(['event_organiser']);
  const coordinator = await accounts.create(['event_coordinator']);
  const other = await accounts.create(['event_coordinator']);
  const staff = await accounts.create(['venue_staff']);
  const sessions = await Promise.all([organiser, coordinator, other, staff].map(account => accounts.session(account)));
  const headers = sessions.map(session => ({ Authorization: 'Bearer ' + session.access_token }));
  const date = new Date(Date.UTC(2099, 0, 1 + info.repeatEachIndex * 10 + caseNumber)).toISOString().slice(0, 10);
  const name = 'Community <Club> & ' + coordinator.id;
  const submitted = await request.post(backendURL + '/api/events', { headers: headers[0], data: {
    name, purpose: 'Venue planning', description: 'Hold notification acceptance', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z', expected_attendance: 40,
  } });
  expect(submitted.status()).toBe(201);
  const { event } = await submitted.json();
  await accounts.assignEvent(event.id, coordinator.id);
  await accounts.updateEvent(event.id, { status: 'APPROVED' });
  const deadline = new Date(Date.now() + 1800000).toISOString();
  const placed = await request.post(backendURL + '/api/venues/' + venueId + '/holds', { headers: headers[3],
    data: { event_id: event.id, event_name: name, coordinator_id: coordinator.id, booking_date: date, slots: ['am', 'pm'], expires_at: deadline } });
  expect(placed.status()).toBe(201);
  return { organiser, coordinator, other, staff, headers, date, name, event, deadline, holds: (await placed.json()).data };
}
async function delivered(request, account) {
  const response = await request.post(authURL + '/__test/notification-deliveries/' + account.id, { headers: controls() });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.pending).toBe(0);
  return result.notifications;
}
async function reservationSnapshot(request, f) {
  const holds = await request.get(backendURL + '/api/venues/' + venueId + '/holds', { headers: f.headers[3] });
  const bookings = await request.get(backendURL + '/api/venues/booking-requests?event_id=' + f.event.id, { headers: f.headers[3] });
  expect(holds.status()).toBe(200);
  expect(bookings.status()).toBe(200);
  return { holds: (await holds.json()).data.filter(row => f.holds.some(saved => saved.id === row.id)).sort((a, b) => a.id.localeCompare(b.id)),
    bookings: (await bookings.json()).data };
}
async function moveClock(request, account, now) {
  const response = await request.post(authURL + '/__test/venue-hold-time/' + account.id, { headers: controls(), data: { now } });
  expect(response.status()).toBe(204);
}
async function inbox(browser, account, feed, expectedBodies) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();
    await page.routeWebSocket('wss://**/*', () => {});
    await page.route('https://**/*', route => {
      const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
      if (url.hostname !== 'api.novu.co') return route.abort();
      if (pathname.endsWith('/inbox/session')) {
        const args = request.postDataJSON();
        expect(args.subscriber.subscriberId).toBe(account.id);
        expect(args.subscriberHash).toBe(createHmac('sha256', 'local-novu-fixture-only').update(account.id).digest('hex'));
        return route.fulfill({ json: { data: { token: 'local-session', totalUnreadCount: feed.length,
          unreadCount: { total: feed.length, severity: { high: 0, medium: 0, low: 0, none: feed.length } },
          removeNovuBranding: false, isDevelopmentMode: true, maxSnoozeDurationHours: 24, applicationIdentifier: 'fixture-app' } } });
      }
      if (pathname.endsWith('/notifications/count')) return route.fulfill({ json: { data: JSON.parse(url.searchParams.get('filters')).map(filter => ({ filter, count: feed.length })) } });
      if (pathname.endsWith('/notifications') && request.method() === 'GET') return route.fulfill({ json: { data: feed, hasMore: false, filter: { archived: false } } });
      if (pathname.endsWith('/notifications/seen')) return route.fulfill({ status: 204 });
      if (pathname.endsWith('/preferences')) return route.fulfill({ json: { data: [] } });
      return route.abort();
    });
    await page.goto('/sign-in');
    await signIn(page, account);
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(page.getByText('Unread notifications: ' + feed.length, { exact: true })).toBeVisible();
    for (const text of expectedBodies) await expect(page.getByText(text, { exact: true })).toBeVisible();
    if (expectedBodies.length) {
      await page.getByText(expectedBodies.at(-1), { exact: true }).click();
      await expect(page).toHaveURL(new RegExp('/venues/' + venueId + '/availability$'));
      await expect(page.getByRole('heading', { name: 'Integration Hall', exact: true })).toBeVisible();
    }
  } finally { await context.close(); }
}

test('[TC-SCRUM-163-E01] A multi-slot hold produces one owned warning with venue, event, expiry and a working link', async ({ browser, accounts, request }, info) => {
  const f = await fixture(accounts, request, info, 1);
  const feed = await delivered(request, f.coordinator);
  expect(feed).toHaveLength(1);
  expect(feed[0].data).toMatchObject({ changeType: 'expiring', venueId, venueName: 'Integration Hall', eventId: f.event.id, eventName: f.name, expiresAt: f.deadline });
  expect(feed[0].data.stateIds).toHaveLength(2);
  expect(await delivered(request, f.coordinator)).toEqual(feed);
  expect(await delivered(request, f.other)).toEqual([]);
  expect(await delivered(request, f.staff)).toEqual([]);
  const text = 'Your tentative hold at Integration Hall for ' + f.name + ' on ' + f.date + ' expires at ' + stamp(f.deadline) + '. Open venue availability to review it.';
  expect(feed[0].data.message).toBe(text);
  await inbox(browser, f.coordinator, feed, [text]);
});

test('[TC-SCRUM-163-E02] Natural expiry releases the reservation and delivers one distinct expiry notice', async ({ browser, accounts, request }, info) => {
  const f = await fixture(accounts, request, info, 2);
  const before = await request.get(backendURL + '/api/venues/' + venueId + '/availability?from=' + f.date + '&to=' + f.date, { headers: f.headers[1] });
  expect((await before.json()).data.days[0].slots.am.status).toBe('tentative');
  await moveClock(request, f.coordinator, new Date(Date.parse(f.deadline) + 1).toISOString());
  const feed = await delivered(request, f.coordinator);
  expect(feed).toHaveLength(1);
  expect(feed[0].data.changeType).toBe('expired');
  const after = await request.get(backendURL + '/api/venues/' + venueId + '/availability?from=' + f.date + '&to=' + f.date, { headers: f.headers[1] });
  expect((await after.json()).data.days[0].slots.am.status).toBe('available');
  const beforeRefusal = await reservationSnapshot(request, f);
  const expiredConversion = await request.post(backendURL + '/api/venues/' + venueId + '/booking-requests', { headers: f.headers[1], data: {
    event_id: f.event.id, booking_date: f.date, slots: ['am', 'pm'], expected_attendees: 40, room_layout: 'Theatre', hold_ids: f.holds.map(row => row.id),
  } });
  expect(expiredConversion.status()).toBe(409);
  expect(await reservationSnapshot(request, f)).toEqual(beforeRefusal);
  const freshRequest = await request.post(backendURL + '/api/venues/' + venueId + '/booking-requests', { headers: f.headers[1], data: {
    event_id: f.event.id, booking_date: f.date, slots: ['am', 'pm'], expected_attendees: 40, room_layout: 'Theatre',
  } });
  expect(freshRequest.status()).toBe(201);
  const history = await request.get(backendURL + '/api/venues/' + venueId + '/holds', { headers: f.headers[3] });
  expect((await history.json()).data.filter(row => f.holds.some(saved => saved.id === row.id))).toHaveLength(2);
  expect(await delivered(request, f.coordinator)).toEqual(feed);
  const text = 'Your tentative hold at Integration Hall for ' + f.name + ' on ' + f.date + ' expired at ' + stamp(f.deadline) + '. The expired reservation has been released.';
  expect(feed[0].data.message).toBe(text);
  await inbox(browser, f.coordinator, feed, [text]);
});

test('[TC-SCRUM-163-E03] Confirming before expiry suppresses both stale warning and false expiry; denied owners change nothing', async ({ accounts, request }, info) => {
  const f = await fixture(accounts, request, info, 3);
  const beforeRefusal = await reservationSnapshot(request, f);
  const denied = await request.post(backendURL + '/api/venues/' + venueId + '/booking-requests', { headers: f.headers[2], data: {
    event_id: f.event.id, booking_date: f.date, slots: ['am', 'pm'], expected_attendees: 40, room_layout: 'Theatre', hold_ids: f.holds.map(row => row.id),
  } });
  expect(denied.status()).toBe(404);
  expect(await reservationSnapshot(request, f)).toEqual(beforeRefusal);
  const submitted = await request.post(backendURL + '/api/venues/' + venueId + '/booking-requests', { headers: f.headers[1], data: {
    event_id: f.event.id, booking_date: f.date, slots: ['am', 'pm'], expected_attendees: 40, room_layout: 'Theatre', hold_ids: f.holds.map(row => row.id),
  } });
  expect(submitted.status()).toBe(201);
  const booking = (await submitted.json()).data;
  const approved = await request.patch(backendURL + '/api/venues/booking-requests/' + booking.id + '/decision', { headers: f.headers[3], data: { decision: 'confirmed' } });
  expect(approved.status()).toBe(200);
  expect(await delivered(request, f.coordinator)).toEqual([]);
  await moveClock(request, f.coordinator, new Date(Date.parse(f.deadline) + 1).toISOString());
  expect(await delivered(request, f.coordinator)).toEqual([]);
  const history = await request.get(backendURL + '/api/venues/' + venueId + '/holds', { headers: f.headers[3] });
  expect((await history.json()).data.filter(row => f.holds.some(saved => saved.id === row.id))).toHaveLength(0);
});
