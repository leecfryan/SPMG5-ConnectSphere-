const { test, expect, signIn } = require('./support/fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');

// SCRUM-159: the Lead's unassigned queue, end to end. Storage is shared by
// parallel tests, so this asserts only on its own event, never on totals.
test('[E2E-QUEUE-001] SCRUM-159: a submitted request reaches the Lead\'s queue with its details and leaves once assigned', async ({ page, accounts, request }) => {
  const organiser = await accounts.create(['event_organiser'], { full_name: 'Olivia Ong' });
  const lead = await accounts.create(['event_coordinator_lead']);
  const coordinatorName = 'Quentin Queue ' + organiser.id.slice(0, 8);
  const coordinator = await accounts.create(['event_coordinator'], { full_name: coordinatorName });
  const bearer = async (account) => ({ Authorization: 'Bearer ' + (await accounts.session(account)).access_token });

  const eventName = 'Queue journey ' + organiser.id;
  const submitted = await request.post(backendURL + '/api/events', { headers: await bearer(organiser), data: {
    name: eventName, purpose: 'Unassigned queue', description: 'Waits for a coordinator',
    start_time: '2099-10-02T01:00:00Z', end_time: '2099-10-02T05:00:00Z', expected_attendance: 30,
  } });
  expect(submitted.status()).toBe(201);

  // AC3: a coordinator holds internal access but is refused the queue by the API itself.
  expect((await request.get(backendURL + '/api/internal/events/unassigned', { headers: await bearer(coordinator) })).status()).toBe(403);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/events/assignments');
  await signIn(page, lead);

  // AC1 and AC2: the request is queued with its name, organiser, proposed dates and attendance.
  const row = page.getByRole('button', { name: new RegExp(eventName) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Olivia Ong');
  await expect(row).toContainText('2099');
  await expect(row).toContainText('30 expected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // AC4: assigning it removes it, and a fresh read from the server agrees.
  await row.click();
  await page.getByRole('button', { name: 'Assign coordinator', exact: true }).click();
  await page.getByRole('radio', { name: 'Assign to ' + coordinatorName }).check();
  await page.getByRole('button', { name: 'Assign to ' + coordinatorName, exact: true }).click();
  await expect(page.getByText(`${eventName} is now assigned to ${coordinatorName}.`)).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Assign an Event Coordinator' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(eventName) })).toHaveCount(0);
  expect((await accounts.events(organiser))[0]).toMatchObject({ coordinator_id: coordinator.id, status: 'SUBMITTED' });
});
