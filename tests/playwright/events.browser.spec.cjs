const { test, expect, signIn } = require('./support/fixtures.cjs');

async function fillEvent(page) {
  await page.getByLabel('Event name', { exact: false }).fill('Team conference');
  await page.getByLabel('Purpose', { exact: false }).fill('Bring the team together');
  await page.getByLabel('Description', { exact: false }).fill('A planning conference');
  const start = Date.now() + 7 * 86400000;
  await page.getByLabel('Starts', { exact: false }).fill(new Date(start).toISOString().slice(0, 16));
  await page.getByLabel('Ends', { exact: false }).fill(new Date(start + 3600000).toISOString().slice(0, 16));
  await page.getByLabel('Expected attendance', { exact: false }).fill('25');
  await page.getByLabel('Venue requirements').fill('Meeting room');
  await page.getByLabel('Accessibility needs').fill('Step-free access');
  await page.getByLabel('Equipment needs').fill('Two microphones');
  await page.getByLabel('Other comments').fill('Tea provided');
}

test('[EVENT-E2E-001] Organiser signs in to a bookmarked request form and submits all details', async ({ page, accounts }) => {
  const account = await accounts.create(['event_organiser']);
  await page.goto('/events/new');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(page.getByRole('link', { name: 'New event request' })).toBeVisible();
  await fillEvent(page);
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  const events = await accounts.events(account);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ organiser_id: account.id, name: 'Team conference', status: 'SUBMITTED', expected_attendance: 25,
    venue_requirements: 'Meeting room', accessibility_needs: 'Step-free access', equipment_needs: 'Two microphones', other_comments: 'Tea provided' });
  await page.getByRole('button', { name: 'Submit another request' }).click();
  await expect(page.getByLabel('Event name', { exact: false })).toHaveValue('');
});

test('[EVENT-E2E-002] Server validation displays all missing fields and permits correction', async ({ page, accounts }) => {
  const account = await accounts.create(['event_organiser']);
  await page.goto('/events/new');
  await signIn(page, account);
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(6);
  expect(await accounts.events(account)).toEqual([]);
  await fillEvent(page);
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
});

for (const [index, role] of ['attendee', 'venue_staff', 'event_coordinator'].entries()) {
  test(`[EVENT-E2E-00${index + 3}] ${role} cannot open the organiser form through a direct URL`, async ({ page, accounts }) => {
    const account = await accounts.create([role]);
    await page.goto('/events/new');
    await signIn(page, account);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole('link', { name: 'New event request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit request' })).toHaveCount(0);
  });
}

test('[EVENT-E2E-006] Storage failure retains input and supports retry', async ({ page, accounts }) => {
  const account = await accounts.create(['event_organiser']);
  await accounts.update(account, { submissionFailure: true });
  await page.goto('/events/new');
  await signIn(page, account);
  await fillEvent(page);
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not submit the event request. Please try again.');
  await expect(page.getByLabel('Event name', { exact: false })).toHaveValue('Team conference');
  expect(await accounts.events(account)).toEqual([]);
  await accounts.update(account, { submissionFailure: false });
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
});

test('[EVENT-E2E-007] Revoked organiser permission blocks a form that is already open', async ({ page, accounts }) => {
  const account = await accounts.create(['event_organiser']);
  await page.goto('/events/new');
  await signIn(page, account);
  await fillEvent(page);
  await accounts.update(account, { roles: ['attendee'] });
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('You do not have permission to access this information.');
  expect(await accounts.events(account)).toEqual([]);
  await page.reload();
  await expect(page).toHaveURL(/\/forbidden$/);
});
