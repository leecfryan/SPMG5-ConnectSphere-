const { createHmac } = require('node:crypto');
const { test, expect, signIn } = require('./support/fixtures.cjs');

// SCRUM-143: real Novu React UI; only remote transport is replaced, with dummy keys.
async function inboxTransport(page, account) {
  let current = account;
  let failed = false;
  let readFailed = false;
  let empty = false;
  let notification = makeNotification();
  const sessions = [];
  function makeNotification() {
    return {
      id: 'fixture-notification-' + current.id, transactionId: 'fixture-transaction',
      subject: 'Fixture event update for ' + current.email, body: 'An event needs your attention.',
      to: { subscriberId: current.id }, isRead: false, isSeen: false,
      isArchived: false, isSnoozed: false, channelType: 'in_app', severity: 'none',
      createdAt: new Date().toISOString(), tags: [], data: {},
    };
  }
  const hash = id => createHmac('sha256', 'local-novu-fixture-only').update(id).digest('hex');
  await page.route('**/api/notifications/inbox-config', route => route.fulfill({ json: {
    applicationIdentifier: 'fixture-app', subscriberId: current.id, subscriberHash: hash(current.id),
  } }));
  await page.routeWebSocket('wss://**/*', () => {});
  await page.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'api.novu.co') return route.abort();
    const pathname = url.pathname;
    if (pathname.endsWith('/inbox/session')) {
      const args = route.request().postDataJSON();
      sessions.push(args);
      expect(args.subscriber.subscriberId).toBe(current.id);
      expect(args.subscriberHash).toBe(hash(current.id));
      return route.fulfill({ json: { data: {
        token: 'local-inbox-session', totalUnreadCount: empty || notification.isRead ? 0 : 1,
        unreadCount: { total: empty || notification.isRead ? 0 : 1, severity: { high: 0, medium: 0, low: 0, none: 1 } },
        removeNovuBranding: false, isDevelopmentMode: true, maxSnoozeDurationHours: 24,
        applicationIdentifier: 'fixture-app',
      } } });
    }
    if (pathname.endsWith('/notifications/count')) {
      const filters = JSON.parse(url.searchParams.get('filters'));
      return route.fulfill({ json: { data: filters.map(filter => ({
        filter, count: empty || (filter.read === false && notification.isRead) ? 0 : 1,
      })) } });
    }
    if (pathname.endsWith('/notifications') && route.request().method() === 'GET') {
      if (failed) return route.fulfill({ status: 503, json: { message: 'PRIVATE provider diagnostic' } });
      return route.fulfill({ json: { data: empty ? [] : [notification], hasMore: false, filter: { archived: false } } });
    }
    if (pathname.endsWith('/' + notification.id + '/read')) {
      if (readFailed) return route.fulfill({ status: 503, json: { message: 'PRIVATE read diagnostic' } });
      notification = { ...notification, isRead: true, readAt: new Date().toISOString() };
      return route.fulfill({ json: { data: notification } });
    }
    if (pathname.endsWith('/notifications/seen')) return route.fulfill({ status: 204 });
    if (pathname.endsWith('/preferences')) return route.fulfill({ json: { data: [] } });
    return route.abort();
  });
  return {
    sessions,
    subject: () => notification.subject,
    fail: value => { failed = value; },
    failRead: value => { readFailed = value; },
    isRead: () => notification.isRead,
    empty: () => { empty = true; },
    switchTo: next => { current = next; empty = false; notification = makeNotification(); },
  };
}

async function openInbox(page, account) {
  await page.goto('/sign-in');
  await signIn(page, account);
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
}

test('[TC-SCRUM-143-14] Real inbox shows history, updates unread after reading, and fits 375px with keyboard access', async ({ page, accounts }) => {
  const account = await accounts.create([]);
  const transport = await inboxTransport(page, account);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await signIn(page, account);
  const link = page.getByRole('link', { name: 'Notifications', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Unread notifications: 1', { exact: true })).toBeVisible();
  await expect(page.getByText(transport.subject(), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByText('Unread notifications: 0', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(transport.sessions.length).toBeGreaterThan(0);
});

test('[TC-SCRUM-143-15] Sign-out and a second account never render the previous inbox, including a direct URL', async ({ page, accounts }) => {
  const first = await accounts.create([]);
  const second = await accounts.create([]);
  const transport = await inboxTransport(page, first);
  await openInbox(page, first);
  const oldSubject = transport.subject();
  await expect(page.getByText(oldSubject, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByText(oldSubject, { exact: true })).toHaveCount(0);
  await page.goto('/notifications');
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toHaveCount(0);
  transport.switchTo(second);
  await signIn(page, second);
  await expect(page.getByText(transport.subject(), { exact: true })).toBeVisible();
  await expect(page.getByText(oldSubject, { exact: true })).toHaveCount(0);
  expect(transport.sessions.at(-1).subscriber.subscriberId).toBe(second.id);
});

test('[TC-SCRUM-143-16] Novu list outage is safe and retry recovers to an empty inbox with zero unread', async ({ page, accounts }) => {
  const account = await accounts.create([]);
  const transport = await inboxTransport(page, account);
  transport.fail(true);
  await openInbox(page, account);
  await expect(page.getByRole('alert')).toHaveText('Your notifications could not be loaded. Please try again.');
  await expect(page.getByText('PRIVATE provider diagnostic')).toHaveCount(0);
  transport.fail(false);
  transport.empty();
  await page.getByRole('button', { name: 'Retry notifications' }).click();
  await expect(page.getByText('Unread notifications: 0', { exact: true })).toBeVisible();
  await expect(page.getByText('You have no notifications yet.', { exact: true })).toBeVisible();
});


test('[TC-SCRUM-143-17] Refused read leaves the notification unread and supports a successful retry', async ({ page, accounts }) => {
  const account = await accounts.create([]);
  const transport = await inboxTransport(page, account);
  transport.failRead(true);
  await openInbox(page, account);
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This notification could not be marked as read. Please reload your notifications.');
  await expect(page.getByText(transport.subject(), { exact: true })).toHaveCount(0);
  expect(transport.isRead()).toBe(false);
  transport.failRead(false);
  await page.getByRole('button', { name: 'Retry notifications' }).click();
  await expect(page.getByText('Unread notifications: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByText('Unread notifications: 0', { exact: true })).toBeVisible();
  expect(transport.isRead()).toBe(true);
});
