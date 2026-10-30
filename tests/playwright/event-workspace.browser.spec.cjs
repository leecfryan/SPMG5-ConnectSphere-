const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupWorkflow, setupOrganiserAccess } = require('./support/event-workspace-fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');

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

test('[E2E-EVENT-100] SCRUM-100: Client organiser edits their request, reads colleagues only and cannot find or open another client request', async ({ page, accounts, request }) => {
  const { organiser, colleague, headers, events } = await setupOrganiserAccess(accounts, request);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/my-event-requests');
  await signIn(page, organiser);
  await expect(page.getByRole('heading', { name: 'Events you are responsible for' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Other organisers’ event requests' })).toBeVisible();
  await expect(page.getByText('View-only requests from other organisers in your company.')).toBeVisible();
  await expect(page.getByRole('link', { name: events.organiser.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: events.colleague.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: events.outsider.name, exact: true })).toHaveCount(0);
  await page.getByLabel('Search events', { exact: true }).fill(events.outsider.name);
  await expect(page.getByText('No events match your search.')).toBeVisible();
  await page.getByLabel('Search events', { exact: true }).fill('');
  await page.getByRole('link', { name: events.organiser.name, exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit event', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByLabel('Event name', { exact: false }).fill('Client request updated in the browser');
  await page.getByLabel('Equipment needs', { exact: true }).fill('Two microphones');
  // SCRUM-164 AC3: reason is required; Save stays disabled until it is filled.
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByLabel('Why are you making these changes?').fill('Updating requirements for the venue');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Client request updated in the browser' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Client request updated in the browser' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const ownStored = (await accounts.events(organiser)).find(event => event.id === events.organiser.id);
  expect(ownStored).toMatchObject({ name: 'Client request updated in the browser', equipment_needs: 'Two microphones',
    organiser_id: organiser.id, status: 'SUBMITTED', start_time: events.organiser.start_time, end_time: events.organiser.end_time });
  await page.goto(`/my-event-requests/${events.colleague.id}`);
  await expect(page.getByRole('heading', { name: events.colleague.name })).toBeVisible();
  await expect(page.getByText('View only. Only the responsible organiser can edit this event.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
  const before = await accounts.events(colleague);
  expect((await request.patch(`/api/event-workspace/organiser/${events.colleague.id}`, { headers: headers.organiser, data: { name: 'Direct denied edit' } })).status()).toBe(403);
  expect(await accounts.events(colleague)).toEqual(before);
  await page.goto(`/my-event-requests/${events.outsider.id}`);
  await expect(page.getByRole('alert')).toHaveText('Event not found.');
  await expect(page.getByRole('heading', { name: events.outsider.name })).toHaveCount(0);
  await expect(page.getByText('outsider private notes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
});

test('[E2E-EVENT-101] SCRUM-100: Revocation while editing is refused by the real API, retains input and saves no fields', async ({ page, accounts }) => {
  const { organiser, events } = await setupOrganiserAccess(accounts, page.request);
  await page.goto('/my-event-requests/' + events.organiser.id);
  await signIn(page, organiser);
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page.getByLabel('Event name', { exact: false }).fill('Do not save this revoked edit');
  // SCRUM-164 AC3: fill reason to enable Save before the role is revoked.
  await page.getByLabel('Why are you making these changes?').fill('Fixing the name');
  const before = await accounts.events(organiser);
  await accounts.update(organiser, { roles: [] });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/event-workspace/organiser/' + events.organiser.id) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await responsePromise).status()).toBe(403);
  await expect(page.getByRole('alert')).toHaveText('You do not have permission to access this information.');
  await expect(page.getByLabel('Event name', { exact: false })).toHaveValue('Do not save this revoked edit');
  expect(await accounts.events(organiser)).toEqual(before);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit event', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: events.organiser.name, exact: true })).toHaveCount(0);
});

for (const [id, role, status] of [['001', 'event_coordinator_lead', 'SUBMITTED'], ['002', 'event_ops_manager', 'SAFETY_REVIEW']]) {
  test(`[SCRUM-142-MERGE-BROWSER-${id}] ${role} can postpone a ${status} event, refresh and cancel it`, async ({ page, accounts, request }) => {
    const { event, first, update } = await setupWorkflow(accounts, request);
    expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
    await accounts.updateEvent(event.id, { status });
    const lead = await accounts.create([role]);
    await page.goto(`/event-management/${event.id}`);
    await signIn(page, lead);
    await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();
    const postpone = page.getByRole('region', { name: 'Postpone event', exact: true });
    await postpone.getByLabel('Reason', { exact: true }).fill('New date pending');
    await postpone.getByRole('button', { name: 'Postpone event', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Postponement', exact: true })).toBeVisible();
    await expect(page.getByText('New date pending', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Postpone event', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Postponement', exact: true })).toBeVisible();
    const cancel = page.getByRole('region', { name: 'Cancel event', exact: true });
    await cancel.getByLabel('Reason', { exact: true }).fill('No replacement date');
    await cancel.getByRole('button', { name: 'Cancel event', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cancellation', exact: true })).toBeVisible();
    await expect(page.getByText('New date pending', { exact: true })).toBeVisible();
    await expect(page.getByText('No replacement date', { exact: true })).toBeVisible();
  });
}

// SCRUM-161 AC1/AC2: the workload overview sits inside Manage event requests.
// Four events: one per coordinator, one awaiting a coordinator, one cancelled -
// the cancelled one is what proves the retained status view.
test('[E2E-EVENT-102] SCRUM-161: the Lead filters assignments by coordinator and status, then opens an event', async ({ page, accounts, request }) => {
  const { manager, first, second, event, headers, update } = await setupWorkflow(accounts, request);
  const day = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);
  const create = async (name) => {
    const response = await request.post(backendURL + '/api/events', { headers: headers.organiser, data: {
      name, purpose: 'Workload overview', description: 'Event for the coordinator workload overview',
      start_time: day + 'T01:00:00Z', end_time: day + 'T05:00:00Z', expected_attendance: 20,
      venue_requirements: 'One room', equipment_needs: 'Projector', other_comments: 'Overview fixture',
    } });
    expect(response.status()).toBe(201);
    return (await response.json()).event;
  };
  const forTwo = await create('Overview event for two ' + second.id);
  const waiting = await create('Overview event awaiting a coordinator ' + first.id);
  const closed = await create('Overview event that was cancelled ' + second.id);
  const assign = (id, coordinatorId) => request.patch(`${backendURL}/api/event-workspace/${id}/coordinator`,
    { headers: headers.manager, data: { coordinatorId, expectedCoordinatorId: null } });

  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  expect((await assign(forTwo.id, second.id)).status()).toBe(200);
  expect((await assign(closed.id, first.id)).status()).toBe(200);
  await accounts.updateEvent(forTwo.id, { status: 'APPROVED' });
  expect((await request.post(`${backendURL}/api/internal/events/${closed.id}/cancel`,
    { headers: headers.manager, data: { reason: 'Venue no longer available' } })).status()).toBe(200);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/event-management');
  await signIn(page, manager);

  const link = name => page.getByRole('link', { name, exact: true });
  const row = name => page.getByRole('row').filter({ has: link(name) });
  await expect(link(event.name)).toBeVisible();
  await expect(link(forTwo.name)).toBeVisible();
  await expect(link(waiting.name)).toBeVisible();
  await expect(link(closed.name)).toHaveCount(0);
  await expect(row(event.name)).toContainText('Coordinator One');
  await expect(row(forTwo.name)).toContainText('Coordinator Two');
  await expect(row(waiting.name)).toContainText('Awaiting coordinator');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByLabel('Coordinator', { exact: true }).selectOption(first.id);
  await expect(link(event.name)).toBeVisible();
  await expect(link(forTwo.name)).toHaveCount(0);
  await expect(link(waiting.name)).toHaveCount(0);
  await expect(link(closed.name)).toHaveCount(0);

  await page.getByLabel('Coordinator', { exact: true }).selectOption('all');
  await page.getByLabel('Event status', { exact: true }).selectOption('APPROVED');
  await expect(link(forTwo.name)).toBeVisible();
  await expect(link(event.name)).toHaveCount(0);

  await page.getByLabel('Event status', { exact: true }).selectOption('all');
  await expect(link(closed.name)).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(link(closed.name)).toHaveCount(0);
  await link(event.name).click();
  await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();
});

// SCRUM-165 TC-SCRUM-165-16/17: coordinator sees a pending change request and can approve or reject it.
// Helper: create an event with a pending change request by having the organiser submit one via the UI.
async function submitChangeRequest(page, accounts, organiser, event, proposedName, requestReason) {
  await accounts.updateEvent(event.id, { status: 'UNDER_REVIEW' });
  await page.goto(`/my-event-requests/${event.id}`);
  await signIn(page, organiser);
  await page.getByRole('button', { name: 'Request a change', exact: true }).click();
  await page.getByLabel('Event name', { exact: true }).fill(proposedName);
  await page.getByLabel('Reason for change', { exact: true }).fill(requestReason);
  await page.getByRole('button', { name: 'Submit change request', exact: true }).click();
  await expect(page.getByText(/awaiting review/i)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}

// TC-SCRUM-165-16: coordinator approves a change request; proposed name is applied.
test('[TC-SCRUM-165-16] SCRUM-165: coordinator approves change request; proposed changes applied and history records decision', async ({ page, accounts }) => {
  const { organiser, first, event } = await setupWorkflow(accounts, page.request);
  await accounts.assignEvent(event.id, first.id);
  await submitChangeRequest(page, accounts, organiser, event, 'Annual Gala – revised', 'Venue requested a name update');

  await signIn(page, first);
  await page.getByRole('link', { name: 'My assigned events', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Change request from organiser', exact: true })).toBeVisible();
  await expect(page.getByText(/venue requested a name update/i)).toBeVisible();
  await page.getByLabel('Decision reason', { exact: true }).fill('Approved – name update looks fine.');
  await page.getByRole('button', { name: 'Approve change', exact: true }).click();

  // After reload: proposed name applied, change request gone, decision in history.
  await expect(page.getByRole('heading', { name: 'Annual Gala – revised', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Change request from organiser' })).toHaveCount(0);
  await expect(page.getByText('Change request approved')).toBeVisible();
  await expect(page.getByText(/approved.*name update looks fine/i)).toBeVisible();
});

// TC-SCRUM-165-17: coordinator rejects a change request; organiser sees the rejection reason in history.
test('[TC-SCRUM-165-17] SCRUM-165: coordinator rejects change request; organiser sees reason in activity history', async ({ page, accounts }) => {
  const { organiser, first, event } = await setupWorkflow(accounts, page.request);
  await accounts.assignEvent(event.id, first.id);
  await submitChangeRequest(page, accounts, organiser, event, 'Annual Gala – renamed', 'Want a shorter name');

  await signIn(page, first);
  await page.getByRole('link', { name: 'My assigned events', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();

  await page.getByLabel('Decision reason', { exact: true }).fill('Name change is out of scope at this stage.');
  await page.getByRole('button', { name: 'Reject change', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Change request from organiser' })).toHaveCount(0);
  // Event name unchanged after rejection.
  await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  // Organiser sees the rejection and the coordinator's reason in activity history.
  await signIn(page, organiser);
  // Wait for auth before navigating — same pattern as ACCESS-E2E-UI-001.
  await page.getByRole('link', { name: 'My event requests', exact: true }).click();
  await page.getByRole('link', { name: event.name, exact: true }).click();
  // Reason appears in both the inline rejection banner (ChangeRequestControls) and
  // the activity history (EventActivityHistory); either presence satisfies AC3.
  await expect(page.getByText(/coordinator.*reason/i)).toBeVisible();
  await expect(page.getByText('Change request rejected')).toBeVisible();
});

// SCRUM-36 AC5/AC6: submitting a change request stores it without touching the
// event, and the pending view persists on page refresh.
test('[SCRUM-36-UI-001] SCRUM-36: organiser submits a change request and sees awaiting-review after refresh', async ({ page, accounts }) => {
  const { organiser, event } = await setupWorkflow(accounts, page.request);
  await accounts.updateEvent(event.id, { status: 'UNDER_REVIEW' });

  await page.goto(`/my-event-requests/${event.id}`);
  await signIn(page, organiser);

  await page.getByRole('button', { name: 'Request a change', exact: true }).click();
  await page.getByLabel('Event name', { exact: true }).fill('Annual Gala – revised');
  await page.getByLabel('Reason for change', { exact: true }).fill('Venue requested a name update');
  await page.getByRole('button', { name: 'Submit change request', exact: true }).click();

  await expect(page.getByText(/awaiting review/i)).toBeVisible();
  await expect(page.getByText(/venue requested a name update/i)).toBeVisible();
  // The event's own name is unchanged — the proposal is stored separately.
  await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(/awaiting review/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request a change' })).toHaveCount(0);
});
