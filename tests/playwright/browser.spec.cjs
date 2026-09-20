const { test, expect, signIn } = require('./support/fixtures.cjs');

test('[E2E-AUTH-001] Valid sign-in displays the verified identity and survives reload', async ({ page, accounts }) => {
  const account = await accounts.create();
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  await expect(page.getByText('Venue Staff', { exact: true })).toBeVisible();
  const before = (await accounts.counts(account)).verification;
  await page.reload();
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  expect((await accounts.counts(account)).verification).toBeGreaterThan(before);
});

test('[E2E-AUTH-002] Wrong password leaves protected pages inaccessible and permits retry', async ({ page, accounts }) => {
  const account = await accounts.create();
  await page.goto('/account');
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, account, 'incorrect-password');
  await expect(page.getByRole('alert')).toHaveText('Unable to sign in. Check your email and password and try again.');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
  expect((await accounts.counts(account)).verification).toBe(0);
  await signIn(page, account);
  await expect(page).toHaveURL(/\/account$/);
});

test('[E2E-AUTH-003] Browser validation prevents empty and invalid-email requests', async ({ page, accounts }) => {
  const account = await accounts.create();
  const tokenRequests = [];
  page.on('request', (request) => { if (request.url().includes('/auth/v1/token')) tokenRequests.push(request.url()); });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect(await page.getByLabel('Email address').evaluate((element) => element.validity.valueMissing)).toBe(true);
  await page.getByLabel('Email address').fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect(await page.getByLabel('Email address').evaluate((element) => element.validity.typeMismatch)).toBe(true);
  expect((await accounts.counts(account)).login).toBe(0);
  expect(tokenRequests).toEqual([]);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('[E2E-AUTH-004] Sign-out removes persisted session across reload and browser history', async ({ page, accounts }) => {
  const account = await accounts.create();
  await page.goto('/sign-in');
  await signIn(page, account);
  await page.getByRole('link', { name: 'Responsibilities', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goBack();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Email address')).toBeVisible();
  expect((await accounts.counts(account)).logout).toBe(1);
});

test('[E2E-AUTH-005] Provider verification outage hides identity and allows recovery', async ({ page, accounts }) => {
  const account = await accounts.create();
  // 429 avoids SDK exponential retries while exercising the backend's 503 mapping.
  await accounts.update(account, { providerStatus: 429 });
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page.getByRole('heading', { name: 'Let’s reconnect' })).toBeVisible();
  await expect(page.getByText(account.email, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).not.toContainText('Private provider');
  await accounts.update(account, { providerStatus: 200 });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
});

test('[E2E-AUTH-006] Revoked session cannot restore identity on reload', async ({ page, accounts }) => {
  const account = await accounts.create();
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/account$/);
  await accounts.update(account, { revoked: true });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Your session is no longer valid');
  await expect(page.getByText(account.email, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
});

test('[E2E-AUTH-007] A new browser tab restores the session and receives cross-tab sign-out', async ({ page, context, accounts }) => {
  const account = await accounts.create();
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/account$/);
  const second = await context.newPage();
  await second.goto('/account');
  await expect(second.getByText(account.email, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(second.getByLabel('Email address')).toBeVisible();
  await expect(second.getByText(account.email, { exact: true })).toHaveCount(0);
});

test('[E2E-AUTH-008] Expiring persisted session is refreshed by the SDK before verified access resumes', async ({ page, accounts }) => {
  const account = await accounts.create();
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/account$/);
  // Age the real SDK's persisted session instead of waiting an hour. No identity or
  // permissions are injected: a new token must come from the Auth HTTP endpoint.
  const oldToken = await page.evaluate((id) => {
    for (const key of Object.keys(localStorage)) {
      let session;
      try { session = JSON.parse(localStorage.getItem(key)); } catch { continue; }
      if (session?.user?.id !== id || !session.refresh_token) continue;
      const oldToken = session.access_token;
      session.expires_at = Math.floor(Date.now() / 1000) - 1;
      localStorage.setItem(key, JSON.stringify(session));
      return oldToken;
    }
    throw new Error('Persisted SDK session was not found.');
  }, account.id);
  const verification = page.waitForRequest((request) => request.url().endsWith('/api/auth/me'));
  await page.reload();
  const request = await verification;
  expect(request.headers().authorization).toMatch(/^Bearer /);
  expect(request.headers().authorization).not.toBe('Bearer ' + oldToken);
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  expect((await accounts.counts(account)).refresh).toBe(1);
});

const staffCases = [
  ['E2E-RBAC-001', 'venue_staff', ['Venue information and availability', 'Venue booking information']],
  ['E2E-RBAC-002', 'technical_support_staff', ['Equipment information and availability', 'Technical requirements and arrangements']],
  ['E2E-RBAC-003', 'event_coordinator', ['Venue information and availability', 'Venue booking information', 'Equipment information and availability', 'Technical requirements and arrangements', 'Internal event planning', 'Event registration information', 'Client information for managed events', 'Event organiser information for managed events']],
];
for (const [id, role, labels] of staffCases) {
  test(`[${id}] ${role} follows a protected deep link and sees only permitted responsibilities`, async ({ page, accounts }) => {
    const account = await accounts.create([role]);
    await page.goto('/staff/responsibilities?source=bookmark#details');
    await expect(page).toHaveURL(/\/sign-in$/);
    await signIn(page, account);
    await expect(page).toHaveURL(/\/staff\/responsibilities\?source=bookmark#details$/);
    await expect(page.getByRole('listitem')).toHaveText(labels);
    await page.reload();
    await expect(page.getByRole('listitem')).toHaveText(labels);
    await page.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(page.getByText(account.email, { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('listitem')).toHaveText(labels);
  });
}

for (const [index, role] of ['attendee', 'event_organiser', 'event_ops_manager'].entries()) {
  test(`[E2E-RBAC-00${index + 4}] ${role} cannot bypass the internal gate with a direct URL`, async ({ page, accounts }) => {
    const account = await accounts.create([role]);
    await page.goto('/staff/responsibilities');
    await signIn(page, account);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Responsibilities', exact: true })).toHaveCount(0);
    await expect(page.getByRole('listitem')).toHaveCount(0);
  });
}

test('[E2E-RBAC-007] Removed roles are enforced by the backend before frontend permissions refresh', async ({ page, accounts }) => {
  const account = await accounts.create();
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page).toHaveURL(/\/account$/);
  await accounts.update(account, { roles: ['attendee'] });
  const denied = page.waitForResponse((response) => response.url().endsWith('/api/internal/access') && response.status() === 403);
  await page.getByRole('link', { name: 'Responsibilities', exact: true }).click();
  await denied;
  await expect(page.getByRole('alert')).toContainText('Your staff access is unavailable');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole('link', { name: 'Responsibilities', exact: true })).toHaveCount(0);
});

test('[E2E-RBAC-008] User-editable profile roles cannot elevate an attendee', async ({ page, accounts }) => {
  const account = await accounts.create(['attendee'], { roles: ['event_coordinator'], permissions: ['internal.access'], user_type: 'internal' });
  await page.goto('/sign-in');
  await signIn(page, account);
  await expect(page.getByText('External user', { exact: true })).toBeVisible();
  await expect(page.getByText('Attendee', { exact: true })).toBeVisible();
  await page.goto('/staff/responsibilities');
  await expect(page).toHaveURL(/\/forbidden$/);
});

test('[E2E-ROUTE-001] Unknown routes display a recoverable not-found page', async ({ page }) => {
  await page.goto('/unknown-feature');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to home' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
});
