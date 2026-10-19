const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

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
  await accounts.updateEvent(event.id, { status: 'APPROVED' });
  await page.goto(`/venues/${venueId}/booking-request`);
  await signIn(page, coordinator);
  await page.getByRole('combobox', { name: 'Event', exact: true }).selectOption(event.id);
  await page.getByRole('combobox', { name: 'Room layout', exact: true }).selectOption('Theatre');
  await page.getByRole('checkbox', { name: /^AM / }).check();
  await page.locator('label.v-field').filter({ hasText: 'Purpose' }).locator('textarea').fill('Planning and coordination session');
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


test('[VENUE-E2E-005] SCRUM-138: each booking of an event is checked on its own, and only the blocked venue is flagged', async ({ page, accounts, request }) => {
  const { first, headers, event, update } = await setupWorkflow(accounts, request);
  // Stands in for the lead assigning the coordinator (SCRUM-99).
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);

  // Two far-future days no other spec books, so the shared fixture venue's slots
  // are free for this event. The event spans both, which the booking must fit.
  const cleanDate = new Date(Date.now() + 54 * 86400000).toISOString().slice(0, 10);
  const blockedDate = new Date(Date.now() + 55 * 86400000).toISOString().slice(0, 10);
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: cleanDate + 'T00:00:00Z', end_time: blockedDate + 'T15:00:00Z' });

  const booking = (date) => ({ event_id: event.id, booking_date: date, slots: ['am'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'] });
  expect((await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: booking(cleanDate) })).status()).toBe(201);
  expect((await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: booking(blockedDate) })).status()).toBe(201);

  // SCRUM-133: Venue Staff block the venue for maintenance after the booking was
  // made. This is the arrangement that makes only one booking's check fail.
  expect((await request.post(`/api/venues/${venueId}/unavailability`, { headers: headers.dual, data: {
    start_date: blockedDate, end_date: blockedDate, slots: ['am'], reason: 'Deep cleaning',
  } })).status()).toBe(201);

  await page.goto(`/venues/booking-requests?event=${event.id}`);
  await signIn(page, first);
  await expect(page.getByRole('heading', { name: 'Venue bookings for this event' })).toBeVisible();

  await page.getByRole('button', { name: 'Check venue bookings' }).click();

  const report = page.getByRole('region', { name: 'Check each venue booking' });
  await expect(report.locator('article')).toHaveCount(2);

  // The blocked booking is named, with the reason, on its own card.
  const blocked = report.locator('article').filter({ hasText: 'Deep cleaning' });
  await expect(blocked.getByRole('heading', { level: 3 })).toHaveText('Integration Hall');
  await expect(blocked.getByText('Failed').first()).toBeVisible();
  await expect(blocked.getByText('AM is recorded unavailable (Deep cleaning).')).toBeVisible();

  // The other booking of the same event is still checked and still passes (AC3).
  const clean = report.locator('article').filter({ hasNotText: 'Deep cleaning' });
  await expect(clean.getByText('Passed').first()).toBeVisible();
  await expect(clean.getByText('Conflicts')).toBeVisible();

  // Checking changed nothing: the requests below still wait for a decision.
  await expect(page.locator('article.v-request')).toHaveCount(2);
  await expect(page.locator('article.v-request').first().getByText('Pending review')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('[VENUE-E2E-006] SCRUM-136: affected bookings panel shown when a new period overlaps a confirmed booking', async ({ page, accounts, request }) => {
  const organiser = await accounts.create(['event_organiser']);
  const coordinator = await accounts.create(['event_coordinator']);
  const staff = await accounts.create(['venue_staff']);
  const orgSession = await accounts.session(organiser);
  const coordSession = await accounts.session(coordinator);
  const staffSession = await accounts.session(staff);

  // Use a date range that no other browser spec touches.
  const bookingDate = futureDate(95);

  const eventResp = await request.post('/api/events', {
    headers: { Authorization: 'Bearer ' + orgSession.access_token },
    data: {
      name: 'Conference 136',
      purpose: 'Testing',
      description: 'Browser spec for SCRUM-136',
      start_time: bookingDate + 'T00:00:00Z',
      end_time: bookingDate + 'T15:00:00Z',
      expected_attendance: 50,
    },
  });
  expect(eventResp.status()).toBe(201);
  const { event } = await eventResp.json();

  await accounts.assignEvent(event.id, coordinator.id);
  await accounts.updateEvent(event.id, { status: 'APPROVED' });

  const bookingResp = await request.post(`/api/venues/${venueId}/booking-requests`, {
    headers: { Authorization: 'Bearer ' + coordSession.access_token },
    data: {
      event_id: event.id,
      booking_date: bookingDate,
      slots: ['am'],
      expected_attendees: 50,
      room_layout: 'Theatre',
      required_facilities: [],
    },
  });
  expect(bookingResp.status()).toBe(201);
  const { data: bookingRequest } = await bookingResp.json();

  expect((await request.patch(`/api/venues/booking-requests/${bookingRequest.id}/decision`, {
    headers: { Authorization: 'Bearer ' + staffSession.access_token },
    data: { decision: 'confirmed' },
  })).status()).toBe(200);

  // Navigate to the venue unavailability page and sign in as the same staff member.
  await page.goto(`/venues/${venueId}/unavailability`);
  await signIn(page, staff);
  await expect(page.getByRole('heading', { name: 'Manage unavailability' })).toBeVisible();

  // Open the create form and fill in a period that covers the booking date and slot.
  await page.getByRole('button', { name: 'Add period' }).click();
  await expect(page.getByRole('heading', { name: 'Add unavailability period' })).toBeVisible();
  await page.getByLabel('Start date').fill(bookingDate);
  await page.getByLabel('End date').fill(bookingDate);
  await page.getByLabel('AM (08:00 – 12:00)').check();
  await page.getByLabel('Reason').fill('Deep clean');
  await page.getByRole('button', { name: 'Add period' }).click();

  // AC2: the affected panel shows the reason for unavailability, the event name
  // and the booking date. AC4: the advisory confirms no bookings were modified.
  await expect(page.getByText(/Period added — Deep clean/)).toBeVisible();
  await expect(page.getByText('Conference 136')).toBeVisible();
  await expect(page.getByText(new RegExp(bookingDate))).toBeVisible();
  await expect(page.getByText(/bookings below have not been changed/)).toBeVisible();

  // Done dismisses the creation panel and returns to the period list.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/bookings below have not been changed/)).not.toBeVisible();
  // Period reason visible in the list. exact: true avoids matching "Deep cleaning" left by earlier tests.
  await expect(page.getByText('Deep clean', { exact: true })).toBeVisible();
  // AC3: the affected booking is still visible under the period row after Done.
  await expect(page.getByText('Conference 136')).toBeVisible();
});
