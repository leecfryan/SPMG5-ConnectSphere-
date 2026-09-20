const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupEquipment } = require('./support/equipment-fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');

async function seedRequest(request, setup) {
  const response = await request.post(backendURL + '/api/events/' + setup.event.id + '/equipment-requests', {
    headers: setup.headers[1], data: setup.fields,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

test('[EQUIPMENT-E2E-001] Assigned coordinator submits equipment through its routed page and refreshes', async ({ page, accounts, request }) => {
  const setup = await setupEquipment(accounts, request);
  await page.goto('/equipment/requests');
  await signIn(page, setup.coordinator);
  await page.getByLabel('Assigned event').selectOption(setup.event.id);
  await page.getByLabel('Equipment type').selectOption(setup.coordinator.id);
  await page.getByLabel('Quantity required').fill('2');
  await page.getByLabel('Technical requirement').fill('HDMI and microphone');
  await page.getByLabel('Borrow from').fill('2099-10-10T10:00');
  await page.getByLabel('Borrow until').fill('2099-10-10T13:00');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  const row = page.locator('.eq-request-row');
  await expect(row).toContainText('HDMI and microphone');
  await expect(row).toContainText('× 2');
  await expect(row).toContainText('PENDING');
  await expect(page).toHaveURL(new RegExp('/equipment/requests\\?event=' + setup.event.id));
  await page.reload();
  await expect(row).toContainText('HDMI and microphone');
  await expect(page.getByRole('link', { name: 'Technical support', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.eq-request-row')).toHaveCount(0);
});

test('[EQUIPMENT-E2E-002] Technical support reviews status and both roles share editable clarification messages', async ({ page, accounts, request }) => {
  const setup = await setupEquipment(accounts, request);
  const line = await seedRequest(request, setup);
  await page.goto('/technical-support');
  await signIn(page, setup.technical);
  const card = page.locator('.eq-event-card').filter({ hasText: setup.event.name });
  await card.getByRole('button', { expanded: false }).click();
  await card.getByLabel('Status for', { exact: false }).selectOption('APPROVED');
  await expect(card.getByLabel('Status for', { exact: false })).toHaveValue('APPROVED');
  await page.reload();
  await card.getByRole('button', { expanded: false }).click();
  await expect(card.getByLabel('Status for', { exact: false })).toHaveValue('APPROVED');
  await card.getByRole('combobox', { name: 'About', exact: true }).selectOption(line.id);
  await card.getByLabel('Message', { exact: true }).fill('Which HDMI cable is needed?');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Which HDMI cable is needed?', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await card.getByLabel('Edit message').fill('Please confirm the HDMI cable length.');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByText('Please confirm the HDMI cable length.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.goto('/equipment/requests?event=' + setup.event.id);
  await signIn(page, setup.coordinator);
  await expect(page.getByText('Please confirm the HDMI cable length.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'About', exact: true }).selectOption(line.id);
  await page.getByLabel('Message', { exact: true }).fill('A two metre cable, please.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('A two metre cable, please.', { exact: true })).toBeVisible();
  await expect(page.locator('.eq-request-row')).toContainText('APPROVED');
  await page.reload();
  await expect(page.getByText('A two metre cable, please.', { exact: true })).toBeVisible();
});

for (const [index, role, route] of [
  [3, 'event_organiser', '/equipment/requests'],
  [4, 'venue_staff', '/technical-support'],
  [5, 'event_coordinator', '/technical-support'],
  [6, 'technical_support_staff', '/equipment/requests'],
]) {
  test(`[EQUIPMENT-E2E-00${index}] ${role} cannot open ${route} directly`, async ({ page, accounts }) => {
    const account = await accounts.create([role]);
    await page.goto(route);
    await signIn(page, account);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.locator('.eq-form, .eq-event-card')).toHaveCount(0);
  });
}

test('[EQUIPMENT-E2E-007] Unassigned coordinator cannot see another event requests or messages', async ({ page, accounts, request }) => {
  const setup = await setupEquipment(accounts, request);
  await seedRequest(request, setup);
  await page.goto('/equipment/requests?event=' + setup.event.id);
  await signIn(page, setup.outsider);
  await expect(page.getByLabel('Assigned event').locator('option')).toHaveCount(1);
  await expect(page.getByText('Could not load:', { exact: false })).toBeVisible();
  await expect(page.locator('.eq-request-row, .eq-thread-message')).toHaveCount(0);
  await expect(page.getByText('Could not load thread:', { exact: false })).toBeVisible();
});
