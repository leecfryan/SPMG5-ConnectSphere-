const { test, expect, signIn } = require('./support/fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

test('[VENUE-E2E-001] Staff navigate catalogue, edit, calendar and review pages with refresh and Back', async ({ page, accounts }) => {
  const staff = await accounts.create(['venue_staff']);
  await page.goto('/venues');
  await signIn(page, staff);
  await expect(page.getByRole('heading', { name: 'Venue catalogue' })).toBeVisible();
  await page.getByLabel('City', { exact: true }).fill('No such city');
  await expect(page.getByText('No venues match those filters.')).toBeVisible();
  await page.getByLabel('City', { exact: true }).fill('Singapore');
  await page.getByRole('button', { name: 'Integration Hall', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`));
  await page.getByRole('button', { name: 'Edit operating information' }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel('Setup (minutes)', { exact: false }).fill('45');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`));
  await page.reload();
  await expect(page.getByText('45minutes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View availability calendar' }).click();
  await expect(page).toHaveURL(/\/availability$/);
  await expect(page.getByRole('button', { name: 'Request a booking', exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`));
  await page.getByRole('link', { name: 'Venues', exact: true }).click();
  await page.getByRole('button', { name: 'Review booking requests', exact: true }).click();
  await expect(page).toHaveURL(/\/venues\/booking-requests$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Venue booking requests' })).toBeVisible();
});

test('[VENUE-E2E-002] Submitted event flows into an assigned coordinator booking and staff review', async ({ page, accounts, request }) => {
  const organiser = await accounts.create(['event_organiser']);
  const coordinator = await accounts.create(['event_coordinator']);
  const outsider = await accounts.create(['event_coordinator']);
  const staff = await accounts.create(['venue_staff']);
  const session = await accounts.session(organiser);
  const eventName = 'Integrated event ' + organiser.id;
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const response = await request.post(backendURL + '/api/events', { headers: { Authorization: 'Bearer ' + session.access_token }, data: {
    name: eventName, purpose: 'Planning', description: 'Cross-feature integration', start_time: date + 'T00:00:00Z',
    end_time: date + 'T15:00:00Z', expected_attendance: 50,
  } });
  expect(response.status()).toBe(201);
  const { event } = await response.json();
  await accounts.assignEvent(event.id, coordinator.id);
  await page.goto(`/venues/${venueId}/booking-request`);
  await signIn(page, coordinator);
  await page.getByRole('combobox', { name: 'Event', exact: true }).selectOption(event.id);
  await page.getByRole('combobox', { name: 'Room layout', exact: true }).selectOption('Theatre');
  await page.getByRole('checkbox', { name: /^AM / }).check();
  await page.getByRole('button', { name: 'Submit booking request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Booking request submitted' })).toBeVisible();
  const outsiderSession = await accounts.session(outsider);
  const unrelated = await request.get(backendURL + '/api/venues/booking-requests', { headers: { Authorization: 'Bearer ' + outsiderSession.access_token } });
  expect(unrelated.status()).toBe(200);
  expect((await unrelated.json()).data).toEqual([]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/venues/booking-requests');
  await signIn(page, staff);
  await expect(page.getByText(eventName, { exact: true })).toBeVisible();
});

for (const role of ['event_organiser', 'attendee', 'technical_support_staff']) {
  test(`[VENUE-E2E-003] ${role} cannot enter protected venue pages`, async ({ page, accounts }) => {
    const account = await accounts.create([role]);
    await page.goto(`/venues/${venueId}/edit`);
    await signIn(page, account);
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole('link', { name: 'Venues', exact: true })).toHaveCount(0);
  });
}

test('[VENUE-E2E-004] Venue Staff cannot enter coordinator-only booking URLs', async ({ page, accounts }) => {
  const staff = await accounts.create(['venue_staff']);
  await page.goto(`/venues/${venueId}/booking-request`);
  await signIn(page, staff);
  await expect(page).toHaveURL(/\/forbidden$/);
});
