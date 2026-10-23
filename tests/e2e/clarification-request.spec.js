const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const supabase = require("../../backend/src/supabase");
const { createAccount, deleteAccount, getAccessToken } = require("./support/live-equipment-fixtures");

// SCRUM-117: user-run only; proves installed PostgREST RPCs and queue triggers.
test("[LIVE-CLARIFICATION-001] SCRUM-117: returned request resubmits to its coordinator with stored changes and both queued notices", async ({ request }) => {
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
    const cycleId = (await detail.json()).event.activity.find(row=>row.action==="CHANGES_REQUESTED").id;
    expect((await request.patch(`/api/event-workspace/organiser/${eventId}`,{headers:ownerHeaders,data:{expected_attendance:45}})).status()).toBe(200);
    const resubmitted = await request.post(`/api/event-workspace/organiser/${eventId}/resubmit`,{headers:ownerHeaders,data:{cycleId}});
    expect(resubmitted.status(),await resubmitted.text()).toBe(200);
    expect((await resubmitted.json()).event).toMatchObject({status:"UNDER_REVIEW",coordinator_id:coordinator.id});
    const reviewed = await request.get(`/api/event-workspace/coordinator/${eventId}`,{headers:coordinatorHeaders});
    expect(reviewed.status()).toBe(200);
    expect((await reviewed.json()).event.activity.find(row=>row.action==="REQUEST_RESUBMITTED").changes)
      .toEqual([{field:"expected_attendance",before:30,after:45}]);
    const {data:queued,error} = await supabase.from("notification_outbox").select("workflow,recipient_id,payload").eq("event_id",eventId);
    expect(error).toBeNull();
    expect(queued).toEqual(expect.arrayContaining([
      expect.objectContaining({workflow:"event-changes-requested",recipient_id:organiser.id,payload:expect.objectContaining({message:"Please clarify attendance.",requestPath:"/my-event-requests/"+eventId})}),
      expect.objectContaining({workflow:"event-request-resubmitted",recipient_id:coordinator.id,payload:expect.objectContaining({changedFieldCount:1,requestPath:"/assigned-events/"+eventId})}),
    ]));
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
