const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

test('[E2E-SAFETY-REVIEW-001] SCRUM-140: the Safety Officer opens the queue on a phone and reads a submitted event, venue by venue', async ({ page, accounts, request }) => {
  const { first, event, headers, update } = await setupWorkflow(accounts, request);
  const officer = await accounts.create(['safety_officer']);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // A day no other spec books, so the shared fixture venue's confirmed slots never clash.
  const date = new Date(Date.now() + 48 * 86400000).toISOString().slice(0, 10);
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const venue = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['am'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  expect(venue.status()).toBe(201);
  expect((await request.patch(`/api/venues/booking-requests/${(await venue.json()).data.id}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);
  expect((await request.post(`/api/internal/events/${event.id}/submit-safety-check`, { headers: headers.first })).status()).toBe(200);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await signIn(page, officer);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Safety reviews', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();

  await expect(page.getByRole('heading', { name: event.name, level: 1 })).toBeVisible();
  const venues = page.getByRole('region', { name: 'Confirmed venues' });
  await expect(venues.getByRole('region')).toHaveCount(1);
  await expect(venues.getByRole('heading', { level: 3 })).toContainText('Integration Hall');
  await expect(venues.getByText('Venue capacity')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Reserved equipment' })).toContainText('No equipment is reserved for this event.');
  await expect(page.getByRole('button')).toHaveText(['Sign out']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
