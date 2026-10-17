const { createHmac } = require('node:crypto');
const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const { authURL } = require('./support/settings.cjs');

async function deliveredTo(request, account) {
  const response = await request.post(authURL + '/__test/notification-deliveries/' + account.id,
    { headers: { 'X-Test-Control': process.env.PW_CONTROL_KEY } });
  expect(response.status()).toBe(200);
  const feed = await response.json();
  expect(feed.pending).toBe(0);
  return feed.notifications;
}

// SCRUM-155: the remote Novu feed renders only messages emitted by the real delivery worker.
async function checkInbox(browser, account, notifications, expectedBodies, absentBodies = []) {
  const context = await browser.newContext();
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
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await expect(page.getByText('Unread notifications: ' + notifications.length, { exact: true })).toBeVisible();
    for (const body of expectedBodies) await expect(page.getByText(body, { exact: true })).toBeVisible();
    for (const body of absentBodies) await expect(page.getByText(body, { exact: true })).toHaveCount(0);
    if (!notifications.length) await expect(page.getByText('You have no notifications yet.', { exact: true })).toBeVisible();
    expect(sessions).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
}

async function saveAssignment(page, coordinatorId) {
  await page.getByLabel('Event coordinator', { exact: true }).selectOption(coordinatorId);
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/coordinator')),
    page.getByRole('button', { name: 'Save coordinator assignment', exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Save coordinator assignment', exact: true })).toBeDisabled();
}

test('[TC-SCRUM-155-E01] UI assignment notifies only the assigned coordinator with the event and assigner names', async ({ page, browser, accounts, request }) => {
  const f = await setupWorkflow(accounts, request);
  await page.goto('/event-management');
  await signIn(page, f.manager);
  await page.getByRole('link', { name: f.event.name, exact: true }).click();
  await saveAssignment(page, f.first.id);
  const notifications = await deliveredTo(request, f.first);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ to: { subscriberId: f.first.id }, data: {
    eventId: f.event.id, eventName: f.event.name, assignedById: f.manager.id,
    assignedByName: 'Playwright Staff', assignmentType: 'assigned',
  } });
  const body = `Event “${f.event.name}” was assigned to you by Playwright Staff.`;
  await checkInbox(browser, f.first, notifications, [body]);
  const unrelated = await deliveredTo(request, f.second);
  expect(unrelated).toEqual([]);
  await checkInbox(browser, f.second, unrelated, [], [body]);
  expect(await deliveredTo(request, f.organiser)).toEqual([]);
  expect((await accounts.events(f.organiser)).find(event => event.id === f.event.id))
    .toMatchObject({ coordinator_id: f.first.id, status: 'SUBMITTED' });
});

test('[TC-SCRUM-155-E02] UI reassignment notifies incoming and outgoing coordinators with the new assigner name', async ({ page, browser, accounts, request }) => {
  const f = await setupWorkflow(accounts, request);
  const lead = await accounts.create(['event_coordinator_lead'], { full_name: 'Ben Lead' });
  await page.goto('/event-management');
  await signIn(page, f.manager);
  await page.getByRole('link', { name: f.event.name, exact: true }).click();
  await saveAssignment(page, f.first.id);
  expect(await deliveredTo(request, f.first)).toHaveLength(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, lead);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.goto('/event-management/' + f.event.id);
  await saveAssignment(page, f.second.id);

  const outgoing = await deliveredTo(request, f.first);
  const incoming = await deliveredTo(request, f.second);
  expect(outgoing).toHaveLength(2);
  expect(incoming).toHaveLength(1);
  expect(outgoing.map(item => item.data.assignmentType).sort()).toEqual(['assigned', 'reassigned-away']);
  const removed = outgoing.find(item => item.data.assignmentType === 'reassigned-away');
  for (const [item, recipient, type] of [[removed, f.first, 'reassigned-away'], [incoming[0], f.second, 'reassigned']]) {
    expect(item).toMatchObject({ to: { subscriberId: recipient.id }, data: { eventId: f.event.id,
      eventName: f.event.name, assignedById: lead.id, assignedByName: 'Ben Lead', assignmentType: type } });
  }
  expect(removed.data.assignmentChangeId).toBe(incoming[0].data.assignmentChangeId);
  const outgoingBody = `Event “${f.event.name}” was reassigned from you by Ben Lead.`;
  const incomingBody = `Event “${f.event.name}” was reassigned to you by Ben Lead.`;
  await checkInbox(browser, f.first, outgoing, [outgoingBody], [incomingBody]);
  await checkInbox(browser, f.second, incoming, [incomingBody], [outgoingBody]);
  expect(await deliveredTo(request, f.attendee)).toEqual([]);
  expect(await deliveredTo(request, f.first)).toHaveLength(2);
  expect(await deliveredTo(request, f.second)).toHaveLength(1);
  expect((await accounts.events(f.organiser)).find(event => event.id === f.event.id))
    .toMatchObject({ coordinator_id: f.second.id, status: 'SUBMITTED' });
});
