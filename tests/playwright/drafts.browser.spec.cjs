const { test, expect, signIn } = require('./support/fixtures.cjs');
const { randomUUID } = require('node:crypto');

test('[E2E-DRAFT-001] SCRUM-147: at phone width an organiser saves a name-only draft, returns to it, submits it, and a colleague never sees it', async ({ page, accounts }) => {
  const company = randomUUID();
  const owner = await accounts.create(['event_organiser'], {}, { organisation_id: company });
  const colleague = await accounts.create(['event_organiser'], {}, { organisation_id: company });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/events/new');
  await signIn(page, owner);

  // AC1/AC2: only the name, nothing else required.
  await page.getByLabel('Event name', { exact: false }).fill('Phone draft gala');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved at' })).toContainText('Only you can see it.');
  await expect(page).toHaveURL(/\/events\/new\?draft=[0-9a-f-]{36}$/);
  const draftUrl = page.url();
  await page.reload();
  await expect(page.getByLabel('Event name', { exact: false })).toHaveValue('Phone draft gala');

  // AC3: the draft is listed on My event requests, apart from submitted requests.
  await page.getByRole('link', { name: 'My event requests', exact: true }).click();
  const drafts = page.getByRole('region', { name: 'Your drafts' });
  await expect(drafts.getByText('Only you can see your drafts.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Events you are responsible for' }).getByRole('link', { name: 'Phone draft gala' })).toHaveCount(0);
  await drafts.getByRole('link', { name: 'Phone draft gala', exact: true }).click();

  // AC2: submitting runs the full checks; the draft stays open with each gap shown.
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(5);
  await page.getByLabel('Purpose', { exact: false }).fill('Bring the team together');
  await page.getByLabel('Description', { exact: false }).fill('A planning conference');
  const start = Date.now() + 7 * 86400000;
  await page.getByLabel('Starts', { exact: false }).fill(new Date(start).toISOString().slice(0, 16));
  await page.getByLabel('Ends', { exact: false }).fill(new Date(start + 3600000).toISOString().slice(0, 16));
  await page.getByLabel('Expected attendance', { exact: false }).fill('25');
  const submit = page.getByRole('button', { name: 'Submit request', exact: true });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await accounts.events(owner)).toEqual([expect.objectContaining({ name: 'Phone draft gala', status: 'SUBMITTED', expected_attendance: 25 })]);

  await page.getByRole('link', { name: 'My event requests', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your drafts' }).getByText('You have no drafts.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Events you are responsible for' }).getByRole('link', { name: 'Phone draft gala' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  // AC4: a second draft stays invisible to a colleague, even by its address.
  await signIn(page, owner);
  await page.getByRole('link', { name: 'New event request', exact: true }).click();
  await page.getByLabel('Event name', { exact: false }).fill('Secret plan');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\?draft=/);
  const secretUrl = page.url();
  expect(secretUrl).not.toBe(draftUrl);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  await signIn(page, colleague);
  await page.getByRole('link', { name: 'My event requests', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your drafts' }).getByText('You have no drafts.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Secret plan' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Phone draft gala', exact: true })).toBeVisible();
  await page.goto(secretUrl);
  await expect(page.getByRole('alert')).toHaveText('Draft not found.');
  await expect(page.getByLabel('Event name', { exact: false })).toHaveCount(0);
});
