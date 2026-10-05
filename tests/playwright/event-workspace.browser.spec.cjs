const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');

test('[ACCESS-E2E-UI-001] Manager assigns through the UI; coordinators have separate workspaces', async ({ page, accounts, request }) => {
  const { manager, first, second, event, update } = await setupWorkflow(accounts, request);
  await page.goto('/event-management');
  await signIn(page, manager);
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expect(page.getByText('Private organiser notes')).toBeVisible();
  // SCRUM-98/99: the manager assigns a submitted request but cannot decide it.
  await expect(page.getByRole('button', { name: 'Accept event', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open registration', exact: true })).toHaveCount(0);
  await page.getByLabel('Event coordinator', { exact: true }).selectOption(first.id);
  await page.getByRole('button', { name: 'Save coordinator assignment' }).click();
  await expect(page.getByRole('button', { name: 'Save coordinator assignment' })).toBeDisabled();
  // Stands in for the assigned coordinator's approval (SCRUM-99), which unlocks arrangements.
  await accounts.updateEvent(event.id, { status: 'APPROVED' });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, first);
  await page.getByRole('link', { name: 'My assigned events', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expect(page.getByRole('link', { name: 'Arrange equipment and technical support' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse events' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: event.name })).toBeVisible();
  expect((await update('coordinator', { coordinatorId: second.id, expectedCoordinatorId: first.id })).status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh event', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Event not found.');
  await expect(page.getByText('Private organiser notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, second);

  // Confirm authentication has finished before navigating.
  await expect(
    page.getByRole('link', { name: 'My assigned events', exact: true })
  ).toBeVisible();

  await page.goto(`/assigned-events/${event.id}`);
  await expect(page.getByRole('heading', { name: event.name })).toBeVisible();
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('[ACCESS-E2E-UI-002] Dual responsibility account navigates both booking areas only', async ({ page, accounts }) => {
  const dual = await accounts.create(['venue_staff', 'technical_support_staff']);
  await page.goto('/account');
  await signIn(page, dual);
  await page.getByRole('link', { name: 'Venues', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Venue catalogue' })).toBeVisible();
  await page.getByRole('link', { name: 'Technical support', exact: true }).click();
  await expect(page).toHaveURL(/\/technical-support$/);
  await expect(page.getByRole('link', { name: 'Browse events' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My assigned events' })).toHaveCount(0);
  await page.goto('/assigned-events');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

// SCRUM-98/99: the assigned coordinator, not the manager, reviews and decides (discussions #80, #101).
async function signOut(page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}
async function expectDecision(page, outcome, approver, noteLabel, note) {
  const decision = page.getByRole('region', { name: 'Review decision' });
  const detail = (label) => decision.locator(`dt:text-is("${label}") + dd`);
  await expect(detail('Outcome')).toHaveText(outcome);
  await expect(detail('Decided by')).toHaveText(approver);
  await expect(detail('Decided on')).toHaveText(/\d{4}/);
  await expect(detail(noteLabel)).toHaveText(note);
}

test('[REVIEW-E2E-UI-001] TC-SCRUM-99-09 SCRUM-98/99: submit, assign, start review and approve; organiser and manager see the decision', async ({ page, accounts, request }) => {
  const { organiser, manager, first, event } = await setupWorkflow(accounts, request);
  const status = page.locator('dd .status-badge');

  await page.goto(`/event-management/${event.id}`);
  await signIn(page, manager);
  await expect(status).toHaveText('Submitted');
  await page.getByLabel('Event coordinator', { exact: true }).selectOption(first.id);
  await page.getByRole('button', { name: 'Save coordinator assignment' }).click();
  await expect(page.getByRole('button', { name: 'Save coordinator assignment' })).toBeDisabled();
  // Discussion #95: assignment alone does not start the review.
  await expect(status).toHaveText('Submitted');
  await signOut(page);

  await signIn(page, first);
  await page.getByRole('link', { name: 'My assigned events', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expect(page.getByText('Private organiser notes')).toBeVisible();
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(status).toHaveText('Under review');
  await page.getByLabel('Decision note').fill('All details supplied.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(status).toHaveText('Approved – planning');
  await expectDecision(page, 'Approved – planning', 'Coordinator One', 'Note', 'All details supplied.');
  await expect(page.getByRole('link', { name: 'Arrange venue bookings' })).toBeVisible();
  await signOut(page);

  await signIn(page, organiser);
  await page.getByRole('link', { name: 'My event requests', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();
  await expectDecision(page, 'Approved – planning', 'Coordinator One', 'Note', 'All details supplied.');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await signOut(page);

  await page.goto(`/event-management/${event.id}`);
  await signIn(page, manager);
  await expectDecision(page, 'Approved – planning', 'Coordinator One', 'Note', 'All details supplied.');
});

test('[REVIEW-E2E-UI-002] SCRUM-98 AC3: a rejection needs a reason; the coordinator and the organiser see Rejected with that reason', async ({ page, accounts, request }) => {
  const { organiser, first, event, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);

  await page.goto(`/assigned-events/${event.id}`);
  await signIn(page, first);
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Give a reason for rejecting this request.')).toBeVisible();
  await expect(page.locator('dd .status-badge')).toHaveText('Under review');
  await page.getByLabel('Decision note').fill('Dates clash with exams.');
  const rejected = page.waitForResponse(response => response.url().endsWith(`/events/${event.id}/reject`));
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  expect((await rejected).status()).toBe(200);
  await expect(page.locator('dd .status-badge')).toHaveText('Rejected');
  await expectDecision(page, 'Rejected', 'Coordinator One', 'Reason', 'Dates clash with exams.');
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Arrange venue bookings' })).toHaveCount(0);
  await page.getByRole('link', { name: 'My assigned events', exact: true }).click();
  await expect(page.getByRole('link', { name: event.name, exact: true })).toBeVisible();
  await signOut(page);

  await page.goto(`/my-event-requests/${event.id}`);
  await signIn(page, organiser);
  await expectDecision(page, 'Rejected', 'Coordinator One', 'Reason', 'Dates clash with exams.');
});

test('[REVIEW-E2E-UI-003] SCRUM-98 AC4: a coordinator not assigned to the event cannot find or review it', async ({ page, accounts, request }) => {
  const { first, second, event, update } = await setupWorkflow(accounts, request);
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);

  await page.goto('/assigned-events');
  await signIn(page, second);
  await expect(page.getByRole('heading', { name: 'My assigned events' })).toBeVisible();
  await expect(page.getByRole('link', { name: event.name, exact: true })).toHaveCount(0);
  await page.goto(`/assigned-events/${event.id}`);
  await expect(page.getByRole('alert')).toHaveText('Event not found.');
  await expect(page.getByRole('button', { name: 'Start review' })).toHaveCount(0);
  await expect(page.getByText('Private organiser notes')).toHaveCount(0);
});
