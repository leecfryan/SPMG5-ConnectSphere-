const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const supabase = require("../../backend/src/supabase");
const { createAccount, deleteAccount, getAccessToken } = require("./support/live-equipment-fixtures");

// SCRUM-117: user-run only; proves installed RPCs and durable request history.
// Pending outbox rows can be consumed by any backend on the shared project.
// Exact enqueue contracts are checked in the disposable PostgreSQL suite.
test("[LIVE-CLARIFICATION-001] SCRUM-117: returned request resubmits to its coordinator with durable saved changes and history", async ({ request }) => {
  const accounts = [];
  let eventId;
  try {
    const organiser = await createAccount(["event_organiser"]); accounts.push(organiser);
    const coordinator = await createAccount(["event_coordinator"]); accounts.push(coordinator);
    const ownerHeaders = { Authorization: "Bearer " + await getAccessToken(organiser) };
    const coordinatorHeaders = { Authorization: "Bearer " + await getAccessToken(coordinator) };
    const created = await request.post("/api/events", { headers: ownerHeaders, data: {
      name: "Live SCRUM-117 " + organiser.id, purpose: "Clarification smoke test", description: "Temporary test request",
      start_time: "2099-01-01T01:00:00Z", end_time: "2099-01-01T03:00:00Z", expected_attendance: 30,
    } });
    expect(created.status(), await created.text()).toBe(201);
    eventId = (await created.json()).event.id;
    const { error: prepareError } = await supabase.from("events").update({ status: "UNDER_REVIEW", coordinator_id: coordinator.id }).eq("id",eventId);
    expect(prepareError).toBeNull();
    const returned = await request.post(`/api/internal/events/${eventId}/request-changes`, { headers:coordinatorHeaders,data:{note:"Please clarify attendance."} });
    expect(returned.status(), await returned.text()).toBe(200);
    const detail = await request.get(`/api/event-workspace/organiser/${eventId}`,{headers:ownerHeaders});
    expect(detail.status()).toBe(200);
    const returnedEvent = (await detail.json()).event;
    expect(returnedEvent).toMatchObject({ status: "CHANGES_REQUESTED", coordinator_id: coordinator.id });
    const returnedCycle = returnedEvent.activity.find(row => row.action === "CHANGES_REQUESTED");
    expect(returnedCycle).toMatchObject({
      action: "CHANGES_REQUESTED", from_status: "UNDER_REVIEW", to_status: "CHANGES_REQUESTED",
      note: "Please clarify attendance.",
    });
    const cycleId = returnedCycle.id;
    expect((await request.patch(`/api/event-workspace/organiser/${eventId}`,{headers:ownerHeaders,data:{expected_attendance:45}})).status()).toBe(200);
    const resubmitted = await request.post(`/api/event-workspace/organiser/${eventId}/resubmit`,{headers:ownerHeaders,data:{cycleId}});
    expect(resubmitted.status(),await resubmitted.text()).toBe(200);
    expect((await resubmitted.json()).event).toMatchObject({status:"UNDER_REVIEW",coordinator_id:coordinator.id});
    const reviewed = await request.get(`/api/event-workspace/coordinator/${eventId}`,{headers:coordinatorHeaders});
    expect(reviewed.status()).toBe(200);
    const reviewedEvent = (await reviewed.json()).event;
    expect(reviewedEvent).toMatchObject({
      status: "UNDER_REVIEW", coordinator_id: coordinator.id, expected_attendance: 45,
    });
    expect(reviewedEvent.activity.find(row => row.id === cycleId)).toEqual(returnedCycle);
    const resubmissions = reviewedEvent.activity.filter(row => row.action === "REQUEST_RESUBMITTED");
    expect(resubmissions).toHaveLength(1);
    expect(resubmissions[0]).toMatchObject({
      from_status: "CHANGES_REQUESTED", to_status: "UNDER_REVIEW",
      changes: [{ field: "expected_attendance", before: 30, after: 45 }],
    });
  } finally {
    if(eventId) {
      for(const table of ["notification_outbox","event_activity_log"]) {
        const {error}=await supabase.from(table).delete().eq("event_id",eventId);
        if(error) throw error;
      }
      const {error}=await supabase.from("events").delete().eq("id",eventId);
      if(error) throw error;
    }
    for(const account of accounts) await deleteAccount(account.id);
  }
});
