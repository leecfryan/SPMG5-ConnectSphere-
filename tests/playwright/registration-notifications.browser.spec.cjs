const { createHmac } = require('node:crypto');
const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupRegistration } = require('./support/registration-fixtures.cjs');
const { authURL } = require('./support/settings.cjs');

async function deliveredTo(request, account) {
  const response = await request.post(authURL + '/__test/notification-deliveries/' + account.id,
    { headers: { 'X-Test-Control': process.env.PW_CONTROL_KEY } });
  expect(response.status()).toBe(200);
  const feed = await response.json();
  expect(feed.pending).toBe(0);
  return feed.notifications;
}

// SCRUM-43: the remote Novu feed renders only messages emitted by the real delivery worker.
async function checkInbox(browser, account, notifications, expectedBodies, absentBodies = []) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();
    let sessions = 0;
    await page.routeWebSocket('wss://**/*', () => {});
    await page.route('https://**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'api.novu.co') return route.abort();
      const pathname = url.pathname;
      if (pathname.endsWith('/inbox/session')) {
        const args = route.request().postDataJSON();
        expect(args.subscriber.subscriberId).toBe(account.id);
        expect(args.subscriberHash).toBe(createHmac('sha256', 'local-novu-fixture-only').update(account.id).digest('hex'));
        sessions++;
        return route.fulfill({ json: { data: { token: 'local-inbox-session', totalUnreadCount: notifications.length,
          unreadCount: { total: notifications.length, severity: { high: 0, medium: 0, low: 0, none: notifications.length } },
          removeNovuBranding: false, isDevelopmentMode: true, maxSnoozeDurationHours: 24, applicationIdentifier: 'fixture-app' } } });
      }
      if (pathname.endsWith('/notifications/count')) {
        const filters = JSON.parse(url.searchParams.get('filters'));
        return route.fulfill({ json: { data: filters.map(filter => ({ filter, count: notifications.length })) } });
      }
      if (pathname.endsWith('/notifications') && route.request().method() === 'GET') {
        return route.fulfill({ json: { data: notifications, hasMore: false, filter: { archived: false } } });
      }
      if (pathname.endsWith('/notifications/seen')) return route.fulfill({ status: 204 });
      if (pathname.endsWith('/preferences')) return route.fulfill({ json: { data: [] } });
      return route.abort();
    });
    await page.goto('/sign-in');
    await signIn(page, account);
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(page.getByText('Unread notifications: ' + notifications.length, { exact: true })).toBeVisible();
    for (const body of expectedBodies) await expect(page.getByText(body, { exact: true })).toBeVisible();
    for (const body of absentBodies) await expect(page.getByText(body, { exact: true })).toHaveCount(0);
    if (!notifications.length) await expect(page.getByText('You have no notifications yet.', { exact: true })).toBeVisible();
    expect(sessions).toBeGreaterThan(0);
    if (expectedBodies.length) {
      await page.getByText(expectedBodies.at(-1), { exact: true }).click();
      await expect(page).toHaveURL(/\/registrations\/me$/);
      await expect(page.getByRole('heading', { name: /my registrations/i })).toBeVisible();
    }
  } finally {
    await context.close();
  }
}


async function makeOffer(request, entryId, deadline) {
  const response = await request.post(authURL + '/__test/registration-offers/' + entryId, {
    headers: { 'X-Test-Control': process.env.PW_CONTROL_KEY }, data: { deadline },
  });
  expect(response.status()).toBe(204);
}

test('[TC-SCRUM-43-E01] Waitlist joining, offered promotion and accepted confirmation appear in the owning inbox', async ({ page, browser, accounts, request }) => {
  const f = await setupRegistration(accounts, request, []);
  await accounts.updateEvent(f.event.id, { enrolled_attendees: 10 });
  await page.goto('/sign-in');
  await signIn(page, f.attendee);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/events/' + f.event.id);
  await page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leave waitlist', exact: true })).toBeVisible();
  const state = await request.get('/api/waitlist/' + f.event.id, { headers: f.headers[1] });
  const { entry } = await state.json();
  const deadline = new Date(Date.now() + 86400000).toISOString();
  await makeOffer(request, entry.id, deadline);
  await page.reload();
  await page.getByRole('button', { name: 'Accept offer', exact: true }).click();
  await expect(page.getByText('Registration confirmed.', { exact: true })).toBeVisible();
  const feed = await deliveredTo(request, f.attendee);
  expect(feed).toHaveLength(3);
  expect(feed.map(item => item.data.changeType)).toEqual(['waitlisted', 'promoted', 'confirmed']);
  expect(feed.every(item => item.to.subscriberId === f.attendee.id && item.data.eventId === f.event.id)).toBe(true);
  await checkInbox(browser, f.attendee, feed, [
    'You have joined the waitlist for ' + f.event.name + '.',
    'A place is available for you at ' + f.event.name + '. Accept your offer by ' + deadline.slice(0, 19).replace('T', ' ') + ' UTC.',
    'Your registration for ' + f.event.name + ' is confirmed.',
  ]);
  const otherFeed = await deliveredTo(request, f.outsider);
  expect(otherFeed).toEqual([]);
  await checkInbox(browser, f.outsider, otherFeed, [], feed.map(item => item.body));
});

test('[TC-SCRUM-43-E02] A due offer has one reminder; forged owners and denied actions do not redirect notifications', async ({ browser, accounts, request }) => {
  const f = await setupRegistration(accounts, request, []);
  await accounts.updateEvent(f.event.id, { enrolled_attendees: 10 });
  const joined = await request.post('/api/waitlist/' + f.event.id, {
    headers: f.headers[1], data: { attendee_id: f.outsider.id },
  });
  expect(joined.status()).toBe(201);
  const { entry } = await joined.json();
  expect(entry.attendee_id).toBe(f.attendee.id);
  const deadline = new Date(Date.now() + 1800000).toISOString();
  await makeOffer(request, entry.id, deadline);
  const denied = await request.post('/api/waitlist/' + f.event.id + '/offer/accept', {
    headers: f.headers[2], data: { attendee_id: f.attendee.id },
  });
  expect(denied.status()).toBe(404);
  const staff = await accounts.create(['venue_staff']);
  const staffSession = await accounts.session(staff);
  expect((await request.post('/api/waitlist/' + f.event.id, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token }, data: { attendee_id: f.attendee.id },
  })).status()).toBe(403);
  expect(await deliveredTo(request, staff)).toEqual([]);
  expect((await request.post('/api/waitlist/' + f.event.id + '/offer/accept')).status()).toBe(401);
  const config = await request.get('/api/notifications/inbox-config?subscriberId=' + f.attendee.id, { headers: f.headers[2] });
  expect((await config.json()).subscriberId).toBe(f.outsider.id);
  const afterDenial = await request.get('/api/waitlist/' + f.event.id, { headers: f.headers[1] });
  expect((await afterDenial.json()).entry).toMatchObject({ id: entry.id, status: 'active', offer_state: 'offered' });
  const feed = await deliveredTo(request, f.attendee);
  const reminders = feed.filter(item => item.data.changeType === 'offer-expiring');
  expect(reminders).toHaveLength(1);
  expect(reminders[0].data.effectiveDeadline).toBe(deadline);
  expect(await deliveredTo(request, f.attendee)).toEqual(feed);
  const expectedReminder = 'Your place offer for ' + f.event.name + ' expires at ' + deadline.slice(0, 19).replace('T', ' ') + ' UTC. Open My Registrations to accept or decline.';
  expect(reminders[0].body).toBe(expectedReminder);
  expect(reminders[0].data).toMatchObject({ eventId: f.event.id, eventName: f.event.name, changeType: 'offer-expiring', requestPath: '/registrations/me' });
  const promotion = feed.find(item => item.data.changeType === 'promoted');
  expect(promotion.data.effectiveDeadline).toBe(deadline);
  expect(promotion.data.changeId).toBeTruthy();
  expect(reminders[0].data.offerChangeId).toBe(promotion.data.changeId);
  await checkInbox(browser, f.attendee, feed, [expectedReminder]);
  expect(await deliveredTo(request, f.outsider)).toEqual([]);
  expect((await request.post('/api/waitlist/' + f.event.id + '/offer/accept', { headers: f.headers[1] })).status()).toBe(200);
  const finalFeed = await deliveredTo(request, f.attendee);
  expect(finalFeed).toHaveLength(4);
  expect(finalFeed.filter(item => item.data.changeType === 'offer-expiring')).toHaveLength(1);
});

test('[TC-SCRUM-43-E03] Reminder eligibility honours cancellation and a missing event start time', async ({ accounts, request }) => {
  const f = await setupRegistration(accounts, request, []);
  await accounts.updateEvent(f.event.id, { enrolled_attendees: 10 });
  const joined = await request.post('/api/waitlist/' + f.event.id, { headers: f.headers[1], data: {} });
  expect(joined.status()).toBe(201);
  const { entry } = await joined.json();
  await makeOffer(request, entry.id, new Date(Date.now() + 1800000).toISOString());
  await accounts.updateEvent(f.event.id, { cancelled_at: new Date().toISOString() });
  const cancelledFeed = await deliveredTo(request, f.attendee);
  expect(cancelledFeed).toHaveLength(2);
  expect(cancelledFeed.some(item => item.data.changeType === 'offer-expiring')).toBe(false);
  await accounts.updateEvent(f.event.id, { cancelled_at: null, start_time: null });
  expect(await deliveredTo(request, f.attendee)).toEqual(cancelledFeed);
  await accounts.updateEvent(f.event.id, { start_time: '2099-10-10T10:00:00Z' });
  const validFeed = await deliveredTo(request, f.attendee);
  expect(validFeed).toHaveLength(3);
  expect(validFeed.filter(item => item.data.changeType === 'offer-expiring')).toHaveLength(1);
});
