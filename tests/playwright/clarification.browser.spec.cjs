const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const { backendURL, authURL } = require('./support/settings.cjs');

test('[E2E-CLARIFICATION-001] SCRUM-117: coordinator returns a request and organiser reads the saved message on mobile', async ({ page, accounts, request }) => {
  const { event, first, organiser, headers, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  expect((await request.post(backendURL + '/api/internal/events/' + event.id + '/start-review', { headers: headers.first })).status()).toBe(200);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await signIn(page, first);
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await page.goto('/assigned-events/' + event.id);
  await page.getByLabel('Decision note').fill('Please clarify the room layout and attendance.');
  await page.getByRole('button', { name: 'Return for changes' }).click();
  await expect(page.locator('.status-badge')).toHaveText('Changes requested');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Clarification requested' })).toContainText('Please clarify the room layout and attendance.');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, organiser);
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await page.goto('/my-event-requests/' + event.id);
  await expect(page.getByRole('region', { name: 'Clarification requested' })).toContainText('Please clarify the room layout and attendance.');
  await expect(page.getByRole('button', { name: 'Edit event', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return for changes' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const detail = await request.get(backendURL + '/api/event-workspace/coordinator/' + event.id, { headers: headers.first });
  const saved = (await detail.json()).event;
  expect(saved.status).toBe('CHANGES_REQUESTED');
  expect(saved.coordinator_id).toBe(first.id);
  expect(saved.activity.filter(row => row.action === 'CHANGES_REQUESTED')).toHaveLength(1);
});


test('[E2E-CLARIFICATION-002] SCRUM-117: owner receives the worker notice and follows its link; others receive nothing', async ({ page, accounts, request }) => {
  const f = await setupWorkflow(accounts, request);
  expect((await f.update('coordinator', { coordinatorId: f.first.id, expectedCoordinatorId: null })).status()).toBe(200);
  expect((await request.post(backendURL + '/api/internal/events/' + f.event.id + '/start-review', { headers: f.headers.first })).status()).toBe(200);
  const note = 'Please clarify the room layout & attendance.';
  const action = () => request.post(backendURL + '/api/internal/events/' + f.event.id + '/request-changes', { headers: f.headers.first, data: { note } });
  expect((await action()).status()).toBe(200);
  expect((await action()).status()).toBe(409);
  async function deliveries(account) {
    const response = await request.post(authURL + '/__test/notification-deliveries/' + account.id, { headers: { 'X-Test-Control': process.env.PW_CONTROL_KEY } });
    expect(response.status()).toBe(200);
    const result = await response.json(); expect(result.pending).toBe(0); return result.notifications;
  }
  let feed = await deliveries(f.organiser);
  let subscriberId = f.organiser.id;
  expect(feed).toHaveLength(1);
  expect(feed[0]).toMatchObject({ to: { subscriberId: f.organiser.id }, body: note,
    redirect: { url: '/my-event-requests/' + f.event.id, target: '_self' },
    data: { eventId: f.event.id, eventName: f.event.name, message: note } });
  expect(feed[0].id).toBe(feed[0].data.cycleId);
  expect(await deliveries(f.organiser)).toHaveLength(1);
  expect(await deliveries(f.attendee)).toEqual([]);
  expect(await deliveries(f.second)).toEqual([]);
  await page.routeWebSocket('wss://**/*', () => {});
  await page.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'api.novu.co') return route.abort();
    const path = url.pathname;
    if (path.endsWith('/inbox/session')) {
      expect(route.request().postDataJSON().subscriber.subscriberId).toBe(subscriberId);
      return route.fulfill({ json: { data: { token: 'local-inbox-session', totalUnreadCount: 1,
        unreadCount: { total: 1, severity: { high: 0, medium: 0, low: 0, none: 1 } },
        removeNovuBranding: false, isDevelopmentMode: true, maxSnoozeDurationHours: 24, applicationIdentifier: 'fixture-app' } } });
    }
    if (path.endsWith('/notifications/count')) return route.fulfill({ json: { data: JSON.parse(url.searchParams.get('filters')).map(filter => ({ filter, count: 1 })) } });
    if (path.endsWith('/notifications') && route.request().method() === 'GET') return route.fulfill({ json: { data: feed, hasMore: false, filter: { archived: false } } });
    if (path.endsWith('/notifications/seen') || path.endsWith('/read')) return route.fulfill({ status: 204 });
    if (path.endsWith('/preferences')) return route.fulfill({ json: { data: [] } });
    return route.abort();
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in'); await signIn(page, f.organiser);
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('Unread notifications: 1', { exact: true })).toBeVisible();
  await page.getByText(note, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/my-event-requests/' + f.event.id + '$'));
  await expect(page.getByRole('region', { name: 'Clarification requested' })).toContainText(note);
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page.getByLabel('Expected attendance', { exact: false }).fill('45');
  await page.getByLabel('Venue requirements', { exact: false }).fill('Round tables with a central aisle');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Event changes saved.', { exact: true })).toBeVisible();
  await expect(page.locator('.status-badge')).toHaveText('Changes requested');
  await page.getByRole('button', { name: 'Resubmit request', exact: true }).click();
  await expect(page.locator('.status-badge')).toHaveText('Under review');
  const detail = (await (await request.get(backendURL + '/api/event-workspace/coordinator/' + f.event.id, { headers: f.headers.first })).json()).event;
  expect(detail.coordinator_id).toBe(f.first.id);
  const changes = detail.activity.find(row => row.action === 'REQUEST_RESUBMITTED').changes;
  expect(changes).toEqual([
    { field: 'expected_attendance', before: 30, after: 45 },
    { field: 'venue_requirements', before: 'Theatre with projector', after: 'Round tables with a central aisle' },
  ]);
  feed = (await deliveries(f.first)).filter(item => item.data.cycleId);
  expect(feed).toHaveLength(1);
  expect(feed[0]).toMatchObject({ subject: 'Request resubmitted', to: { subscriberId: f.first.id },
    redirect: { url: '/assigned-events/' + f.event.id, target: '_self' }, data: { changedFieldCount: 2 } });
  subscriberId = f.first.id;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, f.first);
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  await page.getByText('Request resubmitted', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/assigned-events/' + f.event.id + '$'));
  const comparison = page.getByRole('region', { name: 'Changes on resubmission' });
  await expect(comparison).toContainText('Expected attendance');
  await expect(comparison).toContainText('30');
  await expect(comparison).toContainText('45');
  await expect(comparison).toContainText('Theatre with projector');
  await expect(comparison).toContainText('Round tables with a central aisle');
  await expect(comparison.getByRole('heading', { level: 3 })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('[E2E-CLARIFICATION-003] SCRUM-117: saved edits are visible before a return, retained on resubmission and review can continue', async ({ page, accounts, request }) => {
  const f = await setupWorkflow(accounts, request);
  expect((await f.update('coordinator', { coordinatorId: f.first.id, expectedCoordinatorId: null })).status()).toBe(200);
  expect((await request.post(backendURL + '/api/internal/events/' + f.event.id + '/start-review', { headers: f.headers.first })).status()).toBe(200);
  await page.goto('/sign-in');
  await signIn(page, f.organiser);
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await page.goto('/my-event-requests/' + f.event.id);
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page.getByLabel('Expected attendance', { exact: false }).fill('45');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Event changes saved.', { exact: true })).toBeVisible();
  await expect(page.locator('.status-badge')).toHaveText('Under review');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, f.first);
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await page.goto('/assigned-events/' + f.event.id);
  let current = page.getByRole('region', { name: 'Saved organiser changes' });
  await expect(current).toContainText('30');
  await expect(current).toContainText('45');
  await expect(page.getByRole('region', { name: 'Changes on resubmission' })).toHaveCount(0);
  await page.getByLabel('Decision note').fill('Please confirm the saved attendance.');
  await page.getByRole('button', { name: 'Return for changes', exact: true }).click();
  await expect(page.locator('.status-badge')).toHaveText('Changes requested');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, f.organiser);
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await page.goto('/my-event-requests/' + f.event.id);
  await page.getByRole('button', { name: 'Resubmit request', exact: true }).click();
  await expect(page.locator('.status-badge')).toHaveText('Under review');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, f.first);
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await page.goto('/assigned-events/' + f.event.id);
  const historical = page.getByRole('region', { name: 'Changes on resubmission' });
  await expect(historical).toContainText('30');
  await expect(historical).toContainText('45');
  await expect(page.getByRole('region', { name: 'Saved organiser changes' })).toHaveCount(0);
  expect((await request.patch(backendURL + '/api/event-workspace/organiser/' + f.event.id,
    { headers: f.headers.organiser, data: { expected_attendance: 50 } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh event', exact: true }).click();
  current = page.getByRole('region', { name: 'Saved organiser changes' });
  await expect(current).toContainText('45');
  await expect(current).toContainText('50');
  await expect(historical).toContainText('30');
  await expect(historical).not.toContainText('50');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.locator('.status-badge')).toHaveText('Approved – planning');
  await expect(page.getByRole('link', { name: 'Arrange venue bookings' })).toBeVisible();
});
