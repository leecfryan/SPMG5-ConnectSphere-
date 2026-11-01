const { test, expect, signIn } = require('./support/fixtures.cjs');
const { backendURL } = require('./support/settings.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');

// SCRUM-38: an accepted change request (SCRUM-36 -> SCRUM-165) re-validates the
// event's venue bookings with the production re-validation over fake storage.
// The fixture venue holds 200. Days 71 and 72 are booked by no other spec
// (53-55 belong to SCRUM-138/144), so parallel runs never clash on its AM slot.
const FIXTURE_VENUE_ID = '11111111-1111-4111-8111-111111111111';

async function approvedEventWithConfirmedVenue(accounts, request, dayOffset) {
  const workflow = await setupWorkflow(accounts, request);
  const { event, first, headers } = workflow;
  await accounts.assignEvent(event.id, first.id);
  const date = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const booked = await request.post(`${backendURL}/api/venues/${FIXTURE_VENUE_ID}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['am'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });
  expect(booked.status()).toBe(201);
  const bookingId = (await booked.json()).data.id;
  expect((await request.patch(`${backendURL}/api/venues/booking-requests/${bookingId}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);
  return { ...workflow, date, bookingId };
}

async function requestChange(request, headers, eventId, proposedChanges) {
  const response = await request.post(`${backendURL}/api/event-workspace/organiser/${eventId}/change-request`, {
    headers: headers.organiser, data: { proposed_changes: proposedChanges, reason: 'Plans changed' },
  });
  expect(response.status()).toBe(201);
}

async function booking(request, headers, bookingId) {
  const response = await request.get(`${backendURL}/api/venues/booking-requests/${bookingId}`, { headers: headers.first });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

test('[E2E-REVALIDATE-001] SCRUM-38: accepting a larger attendance flags the too-small venue, which stays booked but blocks the safety check', async ({ page, accounts, request }) => {
  const { first, event, headers, bookingId } = await approvedEventWithConfirmedVenue(accounts, request, 71);
  await requestChange(request, headers, event.id, { expected_attendance: 300 });

  await page.goto(`/assigned-events/${event.id}`);
  await signIn(page, first);
  const panel = page.getByRole('region', { name: 'Change request from organiser' });
  await expect(panel.getByRole('note')).toContainText('Venue bookings are re-checked against the new details straight away');
  await panel.getByLabel('Decision reason').fill('More guests confirmed');
  await panel.getByRole('button', { name: 'Approve change', exact: true }).click();
  await expect(panel).toHaveCount(0);

  // R2: flagged with the reason; the booking itself is still confirmed, not released.
  const flagged = await booking(request, headers, bookingId);
  expect(flagged.is_affected).toBe(true);
  expect(flagged.affected_reason).toMatch(/^After the event changed: /);
  expect(flagged.affected_reason).toMatch(/Over capacity: the venues booked on .* hold 200, fewer than the 300 people now expected\./);
  expect(flagged.slots).toEqual([expect.objectContaining({ slot: 'am', status: 'confirmed' })]);

  // Re-approval (Option A) keeps the venue; the safety check lists it as missing with its reason.
  expect((await request.post(`${backendURL}/api/internal/events/${event.id}/start-review`, { headers: headers.first })).status()).toBe(200);
  expect((await request.post(`${backendURL}/api/internal/events/${event.id}/approve`, { headers: headers.first, data: { note: 'Re-approved' } })).status()).toBe(200);
  expect((await booking(request, headers, bookingId)).slots).toEqual([expect.objectContaining({ status: 'confirmed' })]);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Missing arrangements' })).toContainText('Over capacity');
});

test('[E2E-REVALIDATE-002] SCRUM-38: accepting an equipment change re-checks the venue, which still fits and is left unchanged', async ({ accounts, request }) => {
  const { event, headers, bookingId } = await approvedEventWithConfirmedVenue(accounts, request, 72);
  await requestChange(request, headers, event.id, { equipment_needs: 'Two projectors and a lectern' });

  const decided = await request.post(`${backendURL}/api/internal/events/${event.id}/decide-change-request`, {
    headers: headers.first, data: { decision: 'approve', reason: 'Fine' },
  });
  expect(decided.status()).toBe(200);

  const unchanged = await booking(request, headers, bookingId);
  expect(unchanged.is_affected ?? false).toBe(false);
  expect(unchanged.affected_reason ?? null).toBeNull();
  expect(unchanged.slots).toEqual([expect.objectContaining({ slot: 'am', status: 'confirmed' })]);
});
