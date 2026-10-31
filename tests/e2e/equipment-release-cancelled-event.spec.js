const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const { setupEquipment, getAccessToken, updateEvent } = require("./support/live-equipment-fixtures");

// SCRUM-104/148: equipment reads self-heal on their own
// (releaseReservationsForTerminalEvents in equipment.controller.js) regardless
// of how an event reached CANCELLED - this is what a Technical Support Staff
// member sees if they check the equipment catalogue/availability after any
// cancellation, including one made through SCRUM-148's real cancel action,
// which also releases synchronously as part of that request (see
// review.service.js#cancel) - proven there, not here.

function authHeader(token) {
  return { Authorization: "Bearer " + token };
}

test.describe("SCRUM-104: equipment reservations are released when an event is cancelled (live Supabase)", () => {
  let setup, tokens;

  test.beforeEach(async () => {
    setup = await setupEquipment();
    const [technical, coordinator] = await Promise.all([getAccessToken(setup.technical), getAccessToken(setup.coordinator)]);
    tokens = { technical, coordinator };
  });
  test.afterEach(async () => { await setup.teardown(); });

  test("[TC-SCRUM-104-11] cancelling an event in the database alone is enough - checking availability afterwards is all it takes", async ({ request }) => {
    // SCRUM-31: equipment_type replaces equipment_id; the response is now an
    // array of sibling rows (one here, since quantity_requested is 1).
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, {
      headers: authHeader(tokens.coordinator),
      data: { equipment_type: setup.equipmentType, quantity_requested: 1, borrow_start: "2099-11-11T00:00:00Z", borrow_end: "2099-11-11T03:00:00Z" },
    });
    const { data: [requestRow] } = await created.json();
    // SCRUM-31: Reserve assigns the real unit and sets APPROVED - the old
    // status endpoint refuses APPROVED before a unit is assigned (TC-10),
    // and without it the request stays PENDING, which the release sweep
    // below never looks at.
    const reserved = await request.patch(`/api/equipment-requests/groups/${requestRow.group_id}/reserve`, { headers: authHeader(tokens.technical) });
    expect(reserved.status(), await reserved.text()).toBe(200);
    await request.patch(`/api/equipment/${setup.equipmentId}/status`, { headers: authHeader(tokens.technical), data: { status: "IN_USE" } });

    await updateEvent(setup.eventId, { status: "CANCELLED" });

    // No script run here - just the kind of read a Technical Support Staff
    // member would make anyway while checking the catalogue. Sequential, not
    // parallel: this GET is what triggers the self-heal
    // (releaseReservationsForTerminalEvents) that flips the request below to
    // RELEASED - running them together let the second one race ahead of it.
    const catalogue = await request.get("/api/equipment", { headers: authHeader(tokens.technical) });
    const unit = (await catalogue.json()).data.find((u) => u.id === setup.equipmentId);
    expect(unit.status).toBe("AVAILABLE");

    const requests = await request.get(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.technical) });
    const line = (await requests.json()).data.find((r) => r.id === requestRow.id);
    expect(line.status).toBe("RELEASED");
  });
});
