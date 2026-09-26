const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');

test('[ACCESS-E2E-UI-001] Manager accepts and assigns through the UI; coordinators have separate workspaces', async ({ page, accounts, request }) => {
  const { manager, first, second, event, update } = await setupWorkflow(accounts, request);
  await page.goto('/event-management');
  await signIn(page, manager);
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expect(page.getByText('Private organiser notes')).toBeVisible();
  await page.getByRole('button', { name: 'Accept event', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open registration', exact: true })).toBeDisabled();
  await page.getByLabel('Event coordinator', { exact: true }).selectOption(first.id);
  await page.getByRole('button', { name: 'Save coordinator assignment' }).click();
  await expect(page.getByRole('button', { name: 'Open registration', exact: true })).toBeEnabled();
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
