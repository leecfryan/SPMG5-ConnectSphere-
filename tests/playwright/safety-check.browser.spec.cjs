const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

test('[E2E-SAFETY-001] SCRUM-139: the coordinator sees what is missing, submits once arranged, then withdraws', async ({ page, accounts, request }) => {
  const { first, event, headers, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // A day no other spec books, so the shared fixture venue's confirmed slots never clash.
  const date = new Date(Date.now() + 46 * 86400000).toISOString().slice(0, 10);
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const venue = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['pm'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  expect(venue.status()).toBe(201);
  const status = page.locator('dd .status-badge');
  const submit = page.getByRole('button', { name: 'Submit for safety check', exact: true });

  await page.goto(`/assigned-events/${event.id}`);
  await signIn(page, first);
  await expect(status).toHaveText('Approved – planning');
  await expect(page.getByRole('list', { name: 'Missing arrangements' })).toHaveText(`Integration Hall · ${date}: Waiting for Venue Staff to decide.`);
  await expect(submit).toBeDisabled();

  // Venue Staff confirm the booking through the venue lane's own endpoint.
  expect((await request.patch(`/api/venues/booking-requests/${(await venue.json()).data.id}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(status).toHaveText('Safety review');
  await expect(page.getByText(/arrangements are locked until you withdraw it/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Arrange venue bookings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Arrange equipment and technical support' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Withdraw from safety check', exact: true }).click();
  await expect(status).toHaveText('Approved – planning');
  await expect(page.getByRole('link', { name: 'Arrange venue bookings' })).toBeVisible();
});
