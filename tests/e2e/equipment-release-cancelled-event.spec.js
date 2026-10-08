const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { execFileSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { setupEquipment, getAccessToken, updateEvent } = require("./support/live-equipment-fixtures");

// SCRUM-104: there is no cancellation endpoint to call (events.status is set
// directly in Supabase - see the task note's Q1). Two ways the release
// actually happens, both proven here against the real running backend +
// live Supabase project:
//   - the manual script, run as a real child process
//   - equipment reads self-healing on their own (releaseCancelledEventReservations
//     in equipment.controller.js), with no script run at all - this is what a
//     Technical Support Staff member sees if they just cancel an event in the
//     database and then check the equipment catalogue/availability
const SCRIPT = path.resolve(__dirname, "../../backend/scripts/releaseCancelledEvents.js");

function authHeader(token) {
  return { Authorization: "Bearer " + token };
}

test.describe("SCRUM-104: equipment reservations are released when an event is cancelled (live Supabase)", () => {
  let setup, tokens;

  test.beforeEach(async () => {
    setup = await setupEquipment();
    tokens = { technical: await getAccessToken(setup.technical), coordinator: await getAccessToken(setup.coordinator) };
  });
  test.afterEach(async () => { await setup.teardown(); });

  test("[TC-SCRUM-104-10] cancelling an event and running the release script frees its equipment", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, {
      headers: authHeader(tokens.coordinator),
      data: { equipment_id: setup.equipmentId, quantity_requested: 1, borrow_start: "2099-10-10T00:00:00Z", borrow_end: "2099-10-10T03:00:00Z" },
    });
    const { data: requestRow } = await created.json();
    await request.patch(`/api/equipment-requests/${requestRow.id}/status`, { headers: authHeader(tokens.technical), data: { status: "APPROVED" } });
    await request.patch(`/api/equipment/${setup.equipmentId}/status`, { headers: authHeader(tokens.technical), data: { status: "IN_USE" } });

    // AC1's trigger: the user cancels the event directly in the database (Q1).
    await updateEvent(setup.eventId, { status: "CANCELLED" });

    // The script's own count can legitimately read 0 here: every equipment
    // read now self-heals (TC-11 below), and this suite runs specs in
    // parallel against one shared backend - another spec's own GET call can
    // win the race and release this test's request before the script gets
    // to it. What must hold regardless of who did it is the state below.
    execFileSync("node", [SCRIPT, setup.eventId], { encoding: "utf8" });

    const requests = await request.get(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.technical) });
    const line = (await requests.json()).data.find((r) => r.id === requestRow.id);
    expect(line.status).toBe("RELEASED");

    const catalogue = await request.get("/api/equipment", { headers: authHeader(tokens.technical) });
    const unit = (await catalogue.json()).data.find((u) => u.id === setup.equipmentId);
    expect(unit.status).toBe("AVAILABLE");

    const params = new URLSearchParams({ start: "2099-10-10T00:00:00Z", end: "2099-10-10T03:00:00Z", type: setup.equipmentType, quantity: "1", location: "Test" });
    const availability = await request.get(`/api/equipment/availability?${params}`, { headers: authHeader(tokens.technical) });
    expect((await availability.json()).data.available_quantity).toBe(1);
  });

  test("[TC-SCRUM-104-11] cancelling an event in the database alone is enough - checking availability afterwards is all it takes", async ({ request }) => {
    const created = await request.post(`/api/events/${setup.eventId}/equipment-requests`, {
      headers: authHeader(tokens.coordinator),
      data: { equipment_id: setup.equipmentId, quantity_requested: 1, borrow_start: "2099-11-11T00:00:00Z", borrow_end: "2099-11-11T03:00:00Z" },
    });
    const { data: requestRow } = await created.json();
    await request.patch(`/api/equipment-requests/${requestRow.id}/status`, { headers: authHeader(tokens.technical), data: { status: "APPROVED" } });
    await request.patch(`/api/equipment/${setup.equipmentId}/status`, { headers: authHeader(tokens.technical), data: { status: "IN_USE" } });

    await updateEvent(setup.eventId, { status: "CANCELLED" });

    // No script run here - just the kind of read a Technical Support Staff
    // member would make anyway while checking the catalogue.
    const catalogue = await request.get("/api/equipment", { headers: authHeader(tokens.technical) });
    const unit = (await catalogue.json()).data.find((u) => u.id === setup.equipmentId);
    expect(unit.status).toBe("AVAILABLE");

    const requests = await request.get(`/api/events/${setup.eventId}/equipment-requests`, { headers: authHeader(tokens.technical) });
    const line = (await requests.json()).data.find((r) => r.id === requestRow.id);
    expect(line.status).toBe("RELEASED");
  });
});
