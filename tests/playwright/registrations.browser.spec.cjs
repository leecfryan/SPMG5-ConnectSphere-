const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupRegistration } = require('./support/registration-fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');

async function registerThroughPage(page, setup) {
  await page.goto('/events/' + setup.event.id);
  await signIn(page, setup.attendee);
  await expect(page.getByRole('heading', { name: setup.event.name, exact: true })).toBeVisible();
  await page.getByLabel('Full name', { exact: true }).fill('Test Attendee');
  await page.getByRole('button', { name: 'Register for this event', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('You are registered');
  await expect(page).toHaveURL(/\/registrations\/me$/);
}

test('[REG-E2E-001] Attendee registers, sees submitted details and withdraws with confirmation', async ({ page, accounts, request }) => {
  const setup = await setupRegistration(accounts, request);
  await registerThroughPage(page, setup);
  const card = page.getByRole('link', { name: new RegExp(setup.event.name) });
  await expect(card).toContainText('Pending');
  await card.click();
  await expect(page.getByRole('heading', { name: 'Registration details' })).toBeVisible();
  await expect(page.getByText('Test Attendee', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw registration', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw registration', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, withdraw', exact: true }).click();
  await expect(page.getByText('Withdrawn', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw registration', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Withdrawn', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Back to my registrations/ }).click();
  await expect(card).toContainText('Withdrawn');
});

test('[REG-E2E-002] Browse approved events, reject duplicates and keep internal pages protected', async ({ page, accounts, request }) => {
  const setup = await setupRegistration(accounts, request);
  await page.goto('/events');
  await signIn(page, setup.attendee);
  await page.getByRole('link', { name: new RegExp(setup.event.name) }).click();
  await expect(page.getByText('PRIVATE', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Register for this event', exact: true }).click();
  await expect(page.getByLabel('Full name')).toBeFocused();
  await page.getByLabel('Full name').fill('Test Attendee');
  await page.getByRole('button', { name: 'Register for this event', exact: true }).click();
  await expect(page).toHaveURL(/\/registrations\/me$/);
  await page.goto('/events/' + setup.event.id);
  await page.getByLabel('Full name').fill('Test Attendee');
  await page.getByRole('button', { name: 'Register for this event', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('You are already registered for this event.');
  for (const route of ['/events/new', '/venues', '/technical-support', '/equipment/requests']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/forbidden$/);
  }
});

test('[REG-E2E-003] Private registration stays hidden from another attendee and after sign-out', async ({ page, accounts, request }) => {
  const setup = await setupRegistration(accounts, request);
  const response = await request.post(backendURL + '/api/registrations', { headers: setup.headers[1], data: { eventId: setup.event.id, registrationData: { full_name: 'Private attendee' } } });
  const { registration } = await response.json();
  await page.goto('/registrations/me/' + registration.id);
  await signIn(page, setup.outsider);
  await expect(page.getByRole('alert')).toHaveText('Registration not found.');
  await expect(page.getByText('Private attendee', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'My registrations', exact: true }).click();
  await expect(page.getByText('You have not registered for any events yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.goto('/registrations/me/' + registration.id);
  await expect(page.getByLabel('Email address')).toBeVisible();
});

test('[REG-E2E-004] Registration list recovers from an API outage using retry', async ({ page, accounts, request }) => {
  const setup = await setupRegistration(accounts, request);
  await page.route('**/api/registrations/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Try again after the outage.' }) }));
  await page.goto('/registrations/me');
  await signIn(page, setup.attendee);
  await expect(page.getByRole('alert')).toHaveText('Try again after the outage.');
  await page.unroute('**/api/registrations/me');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('You have not registered for any events yet.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('[REG-E2E-005] Confirmed registrations show the withdrawal restriction', async ({ page, accounts, request }) => {
  const setup = await setupRegistration(accounts, request);
  const response = await request.post(backendURL + '/api/registrations', { headers: setup.headers[1], data: { eventId: setup.event.id, registrationData: { full_name: 'Confirmed attendee' } } });
  const { registration } = await response.json();
  await accounts.updateRegistration(registration.id, { status: 'confirmed' });
  await page.goto('/registrations/me/' + registration.id);
  await signIn(page, setup.attendee);
  await expect(page.getByText('Your registration has been confirmed. Contact the organiser to withdraw.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw registration', exact: true })).toHaveCount(0);
});

for (const [id, status] of [['006', 'SUBMITTED'], ['007', 'REJECTED']]) {
  test(`[REG-E2E-${id}] AC1/AC2/AC5: ${status} events are hidden from browsing and direct page links`, async ({ page, accounts, request }) => {
    const available = await setupRegistration(accounts, request);
    const hidden = await setupRegistration(accounts, request);
    await accounts.updateEvent(hidden.event.id, { status });

    await page.goto('/events');
    await signIn(page, available.attendee);
    const events = page.getByRole('list', { name: 'Available events' });
    await expect(events).toBeVisible();
    await expect(events.getByText(hidden.event.name, { exact: true })).toHaveCount(0);
    await events.getByRole('link', { name: new RegExp(available.event.name) }).click();
    await expect(page.getByRole('heading', { name: available.event.name, exact: true })).toBeVisible();
    await expect(page.getByLabel('Full name', { exact: true })).toBeVisible();
    await expect(page.getByText('PRIVATE', { exact: false })).toHaveCount(0);

    // Knowing the ID must not bypass the same restriction enforced by the listing.
    await page.goto('/events/' + hidden.event.id);
    await expect(page.getByRole('alert')).toHaveText('Event not found.');
    await expect(page.getByText(hidden.event.name, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Register for this event', exact: true })).toHaveCount(0);
    await expect(page.getByText('PRIVATE', { exact: false })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText('Event not found.');
    await page.getByRole('link', { name: /Back to events$/ }).click();
    await expect(events).toBeVisible();
    await expect(events.getByRole('link', { name: new RegExp(available.event.name) })).toBeVisible();
    await expect(events.getByText(hidden.event.name, { exact: true })).toHaveCount(0);
  });
}
