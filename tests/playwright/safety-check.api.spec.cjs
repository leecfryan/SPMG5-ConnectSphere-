const { test, expect } = require('./support/fixtures.cjs');
const { setupWorkflow } = require('./support/event-workspace-fixtures.cjs');
const venueId = '11111111-1111-4111-8111-111111111111';

// SCRUM-139: readiness, submit and withdraw through the real app, with the
// venue and equipment lanes' own endpoints supplying the arrangements.
test('[SAFETY-E2E-API-001] SCRUM-139 AC1-AC4: submit only when arranged; arrangements locked until withdrawn', async ({ accounts, request }) => {
  const { event, first, second, headers, update } = await setupWorkflow(accounts, request);
  for (const role of ['venue_staff', 'technical_support_staff']) {
    headers[role] = { Authorization: 'Bearer ' + (await accounts.session(await accounts.create([role]))).access_token };
  }
  expect((await update('coordinator', { coordinatorId: first.id, expectedCoordinatorId: null })).status()).toBe(200);
  // A day no other spec books, so the shared fixture venue's confirmed slots never clash.
  const date = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  // Stands in for the assigned coordinator's approval (SCRUM-99).
  await accounts.updateEvent(event.id, { status: 'APPROVED', start_time: date + 'T00:00:00Z', end_time: date + 'T15:00:00Z' });
  const path = (action) => `/api/internal/events/${event.id}/${action}`;
  const act = (action, as) => action === 'safety-readiness' ? request.get(path(action), { headers: as }) : request.post(path(action), { headers: as });
  const status = async () => (await (await request.get(`/api/event-workspace/manager/${event.id}`, { headers: headers.manager })).json()).event.status;
  const requestEquipment = (equipmentId) => request.post(`/api/events/${event.id}/equipment-requests`, { headers: headers.first, data: {
    equipment_id: equipmentId, quantity_requested: 1, technical_requirement: 'HDMI', borrow_start: date + 'T01:00:00Z', borrow_end: date + 'T03:00:00Z',
  } });
  const requestVenue = (slot) => request.post(`/api/venues/${venueId}/booking-requests`, { headers: headers.first, data: {
    event_id: event.id, booking_date: date, slots: [slot], expected_attendees: 30, room_layout: 'Theatre', required_facilities: ['Projector'],
  } });

  for (const action of ['safety-readiness', 'submit-safety-check', 'withdraw-safety-check']) {
    for (const role of ['second', 'organiser', 'manager', 'venue_staff', 'technical_support_staff', 'attendee']) {
      expect((await act(action, headers[role])).status(), `${role} ${action}`).toBe(403);
    }
    expect((await act(action, undefined)).status(), `anonymous ${action}`).toBe(401);
  }

  // AC1/AC2: nothing arranged yet, so submission is refused with the reason.
  expect(await (await act('safety-readiness', headers.first)).json()).toEqual({
    ready: false, missing: [{ kind: 'venue', label: 'Venue', reason: 'No venue booking has been approved yet.' }],
  });
  const refused = await act('submit-safety-check', headers.first);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).missing).toHaveLength(1);
  expect(await status()).toBe('APPROVED');

  const venue = await requestVenue('pm');
  expect(venue.status()).toBe(201);
  const equipment = await requestEquipment(first.id);
  expect(equipment.status()).toBe(201);
  expect((await (await act('safety-readiness', headers.first)).json()).missing).toEqual([
    { kind: 'venue', label: `Integration Hall · ${date}`, reason: 'Waiting for Venue Staff to decide.' },
    { kind: 'equipment', label: `Projector ${first.id}`, reason: 'Waiting for Technical Support Staff to reserve it.' },
  ]);

  expect((await request.patch(`/api/venues/booking-requests/${(await venue.json()).data.id}/decision`, { headers: headers.venue_staff, data: { decision: 'confirmed' } })).status()).toBe(200);
  expect((await request.patch(`/api/equipment-requests/${(await equipment.json()).data.id}/status`, { headers: headers.technical_support_staff, data: { status: 'APPROVED' } })).status()).toBe(200);
  expect(await (await act('safety-readiness', headers.first)).json()).toEqual({ ready: true, missing: [] });

  // AC3
  const submitted = await act('submit-safety-check', headers.first);
  expect(submitted.status()).toBe(200);
  expect((await submitted.json()).event.status).toBe('SAFETY_REVIEW');
  expect(await status()).toBe('SAFETY_REVIEW');
  expect((await act('submit-safety-check', headers.first)).status()).toBe(409);

  // AC4: no new arrangements while under review.
  const lockedEquipment = await requestEquipment(second.id);
  expect(lockedEquipment.status()).toBe(409);
  expect(await lockedEquipment.json()).toEqual({ error: 'The event must be approved before requesting equipment.' });
  expect((await requestVenue('am')).status()).toBe(400);

  expect((await act('withdraw-safety-check', headers.first)).status()).toBe(200);
  expect(await status()).toBe('APPROVED');
  expect((await act('withdraw-safety-check', headers.first)).status()).toBe(409);
  expect((await requestEquipment(second.id)).status()).toBe(201);
});
