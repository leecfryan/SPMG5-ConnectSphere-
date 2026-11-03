const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const supabase = require("../../backend/src/supabase");
const { createAccount, deleteAccount, getAccessToken } = require("./support/live-equipment-fixtures");

// SCRUM-147, live Supabase. The fakes cannot prove the two things this story
// assumes about the real schema: that an events row with only a name (every
// other form column null, no submitted_at) is accepted, and that the
// organisation workspace's status filter really excludes DRAFT rows.
// TC-SCRUM-147-15 in docs/event-request-tests.md.
test("[LIVE-DRAFT-001] SCRUM-147: a name-only draft is stored, kept out of the workspace, edited and submitted in the real events table", async ({ request }) => {
  const organiser = await createAccount(["event_organiser"]);
  try {
    const headers = { Authorization: "Bearer " + (await getAccessToken(organiser)) };
    const created = await request.post("/api/events/drafts", { headers, data: { name: "Live draft " + organiser.id.slice(0, 8) } });
    expect(created.status(), await created.text()).toBe(201);
    const { event: draft } = await created.json();

    const { data: stored, error } = await supabase.from("events")
      .select("status, organiser_id, submitted_at, purpose, description, start_time, end_time, expected_attendance")
      .eq("id", draft.id).single();
    expect(error).toBeNull();
    expect(stored).toEqual({
      status: "DRAFT", organiser_id: organiser.id, submitted_at: null,
      purpose: null, description: null, start_time: null, end_time: null, expected_attendance: null,
    });

    const workspace = await request.get("/api/event-workspace/organiser", { headers });
    expect(workspace.status(), await workspace.text()).toBe(200);
    expect((await workspace.json()).events.map(event => event.id)).not.toContain(draft.id);
    expect((await (await request.get("/api/events/drafts", { headers })).json()).drafts.map(d => d.id)).toEqual([draft.id]);

    expect((await request.patch(`/api/events/drafts/${draft.id}`, { headers, data: { purpose: "Live test purpose" } })).status()).toBe(200);
    const start = Date.now() + 30 * 86400000;
    const submitted = await request.post(`/api/events/drafts/${draft.id}/submit`, { headers, data: {
      description: "Created by an automated test - safe to delete.",
      start_time: new Date(start).toISOString(), end_time: new Date(start + 3600000).toISOString(), expected_attendance: 10,
    } });
    expect(submitted.status(), await submitted.text()).toBe(200);

    const { data: after } = await supabase.from("events").select("status, submitted_at, purpose").eq("id", draft.id).single();
    expect(after).toMatchObject({ status: "SUBMITTED", purpose: "Live test purpose" });
    expect(after.submitted_at).not.toBeNull();
  } finally {
    // Only this throwaway account's rows: it was created for this test.
    await supabase.from("events").delete().eq("organiser_id", organiser.id);
    await deleteAccount(organiser.id);
  }
});
