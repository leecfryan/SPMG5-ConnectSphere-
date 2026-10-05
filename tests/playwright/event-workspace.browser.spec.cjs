const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow, setupOrganiserAccess } = require('./support/event-workspace-fixtures.cjs');

test('[ACCESS-E2E-UI-001] Manager assigns through the UI; coordinators have separate workspaces', async ({ page, accounts, request }) => {
  const { manager, first, second, event, update } = await setupWorkflow(accounts, request);
  await page.goto('/event-management');
  await signIn(page, manager);
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expect(page.getByText('Private organiser notes')).toBeVisible();
  // SCRUM-98/99: the manager assigns a submitted request but cannot decide it.
  await expect(page.getByRole('button', { name: 'Accept event', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open registration', exact: true })).toHaveCount(0);
  await page.getByLabel('Event coordinator', { exact: true }).selectOption(first.id);
  await page.getByRole('button', { name: 'Save coordinator assignment' }).click();
  await expect(page.getByRole('button', { name: 'Save coordinator assignment' })).toBeDisabled();
  // Stands in for the assigned coordinator's approval (SCRUM-99), which unlocks arrangements.
  await accounts.updateEvent(event.id, { status: 'APPROVED' });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, first);
  await page.getByRole('link', { name: 'My assigned events', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expect(page.getByRole('link', { name: 'Arrange equipment and technical support' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse events' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: event.name })).toBeVisible();
  expect((await update('coordinator', { coordinatorId: second.id, expectedCoordinatorId: first.id })).status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh event', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Event not found.');
  await expect(page.getByText('Private organiser notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, second);

  // Confirm authentication has finished before navigating.
  await expect(
    page.getByRole('link', { name: 'My assigned events', exact: true })
  ).toBeVisible();

  await page.goto(`/assigned-events/${event.id}`);
  await expect(page.getByRole('heading', { name: event.name })).toBeVisible();
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('[ACCESS-E2E-UI-002] Dual responsibility account navigates both booking areas only', async ({ page, accounts }) => {
  const dual = await accounts.create(['venue_staff', 'technical_support_staff']);
  await page.goto('/account');
  await signIn(page, dual);
  await page.getByRole('link', { name: 'Venues', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Venue catalogue' })).toBeVisible();
  await page.getByRole('link', { name: 'Technical support', exact: true }).click();
  await expect(page).toHaveURL(/\/technical-support$/);
  await expect(page.getByRole('link', { name: 'Browse events' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My assigned events' })).toHaveCount(0);
  await page.goto('/assigned-events');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('[E2E-EVENT-100] SCRUM-100: Client organiser edits their request, reads colleagues only and cannot find or open another client request', async ({ page, accounts, request }) => {
  const { organiser, colleague, headers, events } = await setupOrganiserAccess(accounts, request);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/my-event-requests');
  await signIn(page, organiser);
  await expect(page.getByRole('heading', { name: 'Events you are responsible for' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Other organisers’ event requests' })).toBeVisible();
  await expect(page.getByText('View-only requests from other organisers in your company.')).toBeVisible();
  await expect(page.getByRole('link', { name: events.organiser.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: events.colleague.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: events.outsider.name, exact: true })).toHaveCount(0);
  await page.getByLabel('Search events', { exact: true }).fill(events.outsider.name);
  await expect(page.getByText('No events match your search.')).toBeVisible();
  await page.getByLabel('Search events', { exact: true }).fill('');
  await page.getByRole('link', { name: events.organiser.name, exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit event', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByLabel('Event name', { exact: false }).fill('Client request updated in the browser');
  await page.getByLabel('Equipment needs', { exact: true }).fill('Two microphones');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Client request updated in the browser' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Client request updated in the browser' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const ownStored = (await accounts.events(organiser)).find(event => event.id === events.organiser.id);
  expect(ownStored).toMatchObject({ name: 'Client request updated in the browser', equipment_needs: 'Two microphones',
    organiser_id: organiser.id, status: 'SUBMITTED', start_time: events.organiser.start_time, end_time: events.organiser.end_time });
  await page.goto(`/my-event-requests/${events.colleague.id}`);
  await expect(page.getByRole('heading', { name: events.colleague.name })).toBeVisible();
  await expect(page.getByText('View only. Only the responsible organiser can edit this event.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
  const before = await accounts.events(colleague);
  expect((await request.patch(`/api/event-workspace/organiser/${events.colleague.id}`, { headers: headers.organiser, data: { name: 'Direct denied edit' } })).status()).toBe(403);
  expect(await accounts.events(colleague)).toEqual(before);
  await page.goto(`/my-event-requests/${events.outsider.id}`);
  await expect(page.getByRole('alert')).toHaveText('Event not found.');
  await expect(page.getByRole('heading', { name: events.outsider.name })).toHaveCount(0);
  await expect(page.getByText('outsider private notes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
});

test('[E2E-EVENT-101] SCRUM-100: Revocation while editing is refused by the real API, retains input and saves no fields', async ({ page, accounts }) => {
  const { organiser, events } = await setupOrganiserAccess(accounts, page.request);
  await page.goto('/my-event-requests/' + events.organiser.id);
  await signIn(page, organiser);
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page.getByLabel('Event name', { exact: false }).fill('Do not save this revoked edit');
  const before = await accounts.events(organiser);
  await accounts.update(organiser, { roles: [] });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/event-workspace/organiser/' + events.organiser.id) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await responsePromise).status()).toBe(403);
  await expect(page.getByRole('alert')).toHaveText('You do not have permission to access this information.');
  await expect(page.getByLabel('Event name', { exact: false })).toHaveValue('Do not save this revoked edit');
  expect(await accounts.events(organiser)).toEqual(before);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit event', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: events.organiser.name, exact: true })).toHaveCount(0);
});
