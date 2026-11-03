const { test, expect } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

// SCRUM-144: confirming an event, through the real SCRUM-139 submission, the
// real SCRUM-141 safety approval and the venue and equipment lanes' own endpoints.
test('[CONFIRM-API-001] SCRUM-144 AC1-AC4: confirm only after the safety pass, every essential venue booking approved, non-essential items left outstanding', async ({ accounts, request }) => {
  const { event, first, headers, update } = await setupWorkflow(accounts, request);
  headers.officer = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create(['safety_officer']))).access_token };
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // Two days no other spec books, so the shared fixture venue's confirmed slots never clash.
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const [dayOne, dayTwo] = [day(51), day(52)];
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: dayOne + 'T00:00:00Z', end_time: dayTwo + 'T15:00:00Z' });

  const bookVenue = async (date) => (await (await request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: ['am'], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } })).json()).data.id;
  const hallOne = await bookVenue(dayOne);
  const hallTwo = await bookVenue(dayTwo);
  // SCRUM-31: equipment_type replaces equipment_id; the response is now an
  // array of sibling rows (one here, since quantity_requested is 1).
  const equipment = await request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers.first, data: {
    equipment_type: 'Projector ' + first.id, quantity_requested: 1, technical_requirement: 'Spare, rear of hall', borrow_start: dayOne + 'T01:00:00Z', borrow_end: dayOne + 'T03:00:00Z',
  } });
  expect(equipment.status()).toBe(201);
  const spare = (await equipment.json()).data[0].id;
  expect((await request.patch(`/api/venues/booking-requests/${hallOne}/decision`, { headers: headers.dual, data: { decision: 'confirmed' } })).status()).toBe(200);

  const confirm = (as = headers.first) => request.post(`/api/internal/events/${event.id}/confirm`, { headers: as });
  const mark = (kind, id, isEssential, as = headers.first) =>
    request.patch(`/api/internal/events/${event.id}/arrangements/${kind}/${id}`, { headers: as, data: { is_essential: isEssential } });
  const readiness = async () => (await request.get(`/api/internal/events/${event.id}/safety-readiness`, { headers: headers.first })).json();
  const status = async () => (await (await request.get(`/api/event-workspace/coordinator/${event.id}`, { headers: headers.first })).json()).event.status;

  // AC1: an approved event has not passed the safety check, so it cannot be confirmed.
  expect((await confirm()).status()).toBe(409);
  // AC2: the second day's booking is still pending, and so is the equipment.
  expect((await readiness()).missing.map((item) => item.id)).toEqual([hallTwo, spare]);

  // AC4: during planning the coordinator marks both non-essential, so the safety check can go ahead.
  for (const [kind, id] of [['venue', hallTwo], ['equipment', spare]]) {
    const marked = await mark(kind, id, false);
    expect(marked.status(), kind).toBe(200);
    expect(await marked.json()).toEqual({ arrangement: { id, is_essential: false } });
  }
  expect(await readiness()).toMatchObject({ ready: true, missing: [] });
  expect((await readiness()).optional.map((item) => item.id)).toEqual([hallTwo, spare]);
  expect((await request.post(`/api/internal/events/${event.id}/submit-safety-check`, { headers: headers.first })).status()).toBe(200);

  // Locked during safety review: no marking, no confirming.
  expect((await mark('venue', hallTwo, true)).status()).toBe(409);
  expect((await confirm()).status()).toBe(409);
  expect((await request.post(`/api/internal/safety-reviews/${event.id}/approve`, { headers: headers.officer, data: {} })).status()).toBe(200);
  expect(await status()).toBe('PREPARATION');

  // AC2/AC3: once the second booking is essential again, confirmation is blocked and it is listed.
  expect((await mark('venue', hallTwo, true)).status()).toBe(200);
  const blocked = await confirm();
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toEqual({
    message: 'This event cannot be confirmed yet. Finish the essential arrangements listed.',
    missing: [{ kind: 'venue', id: hallTwo, label: `Integration Hall · ${dayTwo}`, reason: 'Waiting for Venue Staff to decide.' }],
  });
  expect(await status()).toBe('PREPARATION');

  // Access: only the assigned coordinator confirms or marks.
  for (const role of ['second', 'organiser', 'manager', 'officer', 'dual', 'attendee']) {
    expect((await confirm(headers[role])).status(), role).toBe(403);
    expect((await mark('venue', hallTwo, false, headers[role])).status(), role).toBe(403);
  }
  expect((await confirm(null)).status()).toBe(401);
  expect((await mark('venue', '00000000-0000-4000-8000-000000000000', false)).status()).toBe(404);

  // AC4: non-essential again, so the event is confirmed with both items still outstanding.
  expect((await mark('venue', hallTwo, false)).status()).toBe(200);
  const confirmed = await confirm();
  expect(confirmed.status()).toBe(200);
  expect((await confirmed.json()).event).toMatchObject({ id: event.id, status: 'CONFIRMED' });
  expect((await readiness()).optional.map((item) => item.id)).toEqual([hallTwo, spare]);

  // Once confirmed: not again, and the flags are locked.
  expect((await confirm()).status()).toBe(409);
  expect((await mark('equipment', spare, true)).status()).toBe(409);
});
