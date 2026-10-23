const { test, expect } = require("@playwright/test");
const { setupHoldConversion } = require("./support/live-hold-conversion-fixtures");
const supabase = require("../../backend/src/supabase");

// SCRUM-162: live-DB test for the decide_venue_booking_request constraint fix.
//
// Justification for a live test: the exclusion constraint on (venue_id,
// booking_date, slot) where status = 'confirmed' is a real Postgres constraint.
// The fake storage in tests/playwright does not enforce it, so the browser spec
// VENUE-E2E-007 cannot catch the 23P01 violation. Only a run against the real
// schema proves the function cancels hold rows before confirming booking rows.

test.describe("SCRUM-162 hold conversion — database constraint", () => {
  test.setTimeout(60_000);
  let scenario;

  test.beforeEach(async () => {
    scenario = await setupHoldConversion();
  });

  test.afterEach(async () => {
    await scenario?.teardown();
  });

  async function slotStatuses(requestId) {
    const { data, error } = await supabase
      .from("venue_bookings")
      .select("status")
      .eq("request_id", requestId)
      .order("status");
    if (error) throw new Error("slotStatuses failed: " + error.message);
    return data.map((r) => r.status).sort();
  }

  // TC-SCRUM-162-12: the core constraint test. Before the fix, this RPC call
  // would fail with 23P01 because the function tried to confirm both the
  // pending booking row and the hold row in one UPDATE statement.
  test("TC-SCRUM-162-12: approving a converted hold does not violate the exclusion constraint", async () => {
    const { data, error } = await supabase.rpc("decide_venue_booking_request", {
      p_request_id: scenario.request.id,
      p_decision: "confirmed",
      p_decided_by: scenario.venueStaff.id,
      p_note: null,
    });

    expect(error, `RPC error (likely 23P01 constraint): ${error?.message}`).toBeNull();
    expect(data).toBe(scenario.request.id);

    // Booking row confirmed, hold row cancelled — in that order of logic
    expect(await slotStatuses(scenario.request.id)).toEqual(["cancelled", "confirmed"]);
  });

  // TC-SCRUM-162-13: on rejection the hold's request_id is cleared (not cancelled)
  // so the coordinator can convert it again with a new request.
  test("TC-SCRUM-162-13: rejecting a converted request releases the hold for retry", async () => {
    const { data, error } = await supabase.rpc("decide_venue_booking_request", {
      p_request_id: scenario.request.id,
      p_decision: "rejected",
      p_decided_by: scenario.venueStaff.id,
      p_note: null,
    });

    expect(error, error?.message).toBeNull();
    expect(data).toBe(scenario.request.id);

    // Booking row is rejected (still linked to the request)
    expect(await slotStatuses(scenario.request.id)).toEqual(["rejected"]);

    // Hold row had its request_id cleared — still active, coordinator can retry
    const { data: hold } = await supabase
      .from("venue_bookings")
      .select("status, request_id")
      .eq("id", scenario.holdRow.id)
      .single();
    expect(hold.status).toBe("hold");
    expect(hold.request_id).toBeNull();
  });
});
