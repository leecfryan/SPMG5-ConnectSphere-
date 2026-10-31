const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

test('[E2E-CONFIRM-001] SCRUM-144: on a phone the coordinator sees what blocks confirmation, marks it non-essential and confirms', async ({ page, accounts, request }, testInfo) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  const officer = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create(['safety_officer']))).access_token };
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // SCRUM-144: retries use a separate day because a failed attempt may leave a confirmed fixture slot.
  const date = new Date(Date.now() + (53 + testInfo.retry * 1000) * 86400000).toISOString().slice(0, 10);
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const venue = await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['am'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  expect(venue.status(), await venue.text()).toBe(201);
  expect((await request.patch(`/api/venues/booking-requests/${(await venue.json()).data.id}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);
  // SCRUM-31: equipment_type replaces equipment_id - the fake's equipment()
  // gives each account exactly one unit, typed 'Projector ' + its own id.
  const equipment = await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers.first, data: {
    equipment_type: 'Projector ' + first.id, quantity_requested: 1, technical_requirement: 'Spare', borrow_start: date + 'T01:00:00Z', borrow_end: date + 'T03:00:00Z',
  } });
  const spare = (await equipment.json()).data[0].id;
  const mark = (isEssential) => request.patch(`/api/internal/events/${event.id}/arrangements/equipment/${spare}`, { headers: headers.first, data: { is_essential: isEssential } });
  // Through the safety check with the spare item waived, then essential again so it blocks.
  expect((await mark(false)).status()).toBe(200);
  expect((await request.post(`/api/internal/events/${event.id}/submit-safety-check`, { headers: headers.first })).status()).toBe(200);
  expect((await request.post(`/api/internal/safety-reviews/${event.id}/approve`, { headers: officer, data: {} })).status()).toBe(200);
  expect((await mark(true)).status()).toBe(200);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await signIn(page, first);
  await expect(page.getByRole('link', { name: 'My assigned events', exact: true })).toBeVisible();
  await page.goto(`/assigned-events/${event.id}`);

  await expect(page.locator('.request-detail-status .status-badge')).toHaveText('Preparation');
  const section = page.getByRole('region', { name: 'Confirm event' });
  const item = `Projector ${first.id}`;
  await expect(section.getByRole('list', { name: 'Missing arrangements' })).toContainText(item);
  await expect(section.getByRole('button', { name: 'Confirm event' })).toBeDisabled();

  await section.getByRole('button', { name: `Mark ${item} as non-essential` }).click();
  await expect(section.getByRole('list', { name: 'Non-essential arrangements' })).toContainText(item);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await section.getByRole('button', { name: 'Confirm event' }).click();

  await expect(page.locator('.request-detail-status .status-badge')).toHaveText('Confirmed');
  await expect(page.getByRole('region', { name: 'Confirm event' })).toHaveCount(0);
});
