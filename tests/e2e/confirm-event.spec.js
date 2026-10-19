const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const { getAccessToken, updateEvent } = require("./support/live-equipment-fixtures");
const { setupConfirmation, readEssential, readEventStatus } = require("./support/live-confirmation-fixtures");

// SCRUM-144 live-DB check (AGENTS.md "Which end-to-end suite": a schema change made
// by hand this story). Proves the hand-added venue_booking_requests.is_essential and
// equipment_requests.is_essential columns match the code: findArrangements selects
// them through the real joins, setArrangementEssential writes them, and confirmation
// follows them. Behaviour and denials are covered by tests/playwright.
test.describe("SCRUM-144 confirm an event (live Supabase)", () => {
  let setup, headers;

  test.beforeEach(async () => {
    setup = await setupConfirmation();
    headers = { Authorization: "Bearer " + (await getAccessToken(setup.coordinator)) };
  });
  test.afterEach(async () => { await setup.teardown(); });

  test("non-essential flags are stored on the real request rows and let the event be confirmed", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, { headers, data: {
      equipment_id: setup.equipmentId, quantity_requested: 1, borrow_start: "2099-10-10T00:00:00Z", borrow_end: "2099-10-10T03:00:00Z",
    } });
    expect(created.status(), await created.text()).toBe(201);
    const equipmentRequestId = (await created.json()).data.id;
    const readiness = async () => {
      const response = await request.get(`/api/internal/events/${setup.eventId}/safety-readiness`, { headers });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };

    // New rows take the column default: both pending items block.
    expect(await readEssential("venue_booking_requests", setup.pendingRequestId)).toBe(true);
    expect(await readEssential("equipment_requests", equipmentRequestId)).toBe(true);
    expect((await readiness()).missing.map((item) => item.id)).toEqual([setup.pendingRequestId, equipmentRequestId]);

    for (const [kind, id] of [["venue", setup.pendingRequestId], ["equipment", equipmentRequestId]]) {
      const marked = await request.patch(`/api/internal/events/${setup.eventId}/arrangements/${kind}/${id}`, { headers, data: { is_essential: false } });
      expect(marked.status(), await marked.text()).toBe(200);
    }
    expect(await readEssential("venue_booking_requests", setup.pendingRequestId)).toBe(false);
    expect(await readEssential("equipment_requests", equipmentRequestId)).toBe(false);
    expect(await readEssential("venue_booking_requests", setup.bookedRequestId)).toBe(true);
    const ready = await readiness();
    expect(ready).toMatchObject({ ready: true, missing: [] });
    expect(ready.optional.map((item) => item.id)).toEqual([setup.pendingRequestId, equipmentRequestId]);

    // Stands in for the SCRUM-141 safety approval, which tests/playwright covers.
    await updateEvent(setup.eventId, { status: "PREPARATION" });
    const confirmed = await request.post(`/api/internal/events/${setup.eventId}/confirm`, { headers });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    expect(await readEventStatus(setup.eventId)).toBe("CONFIRMED");
  });
});
