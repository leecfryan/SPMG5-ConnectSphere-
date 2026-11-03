const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const {
  createAccount,
  createEvent,
  updateEvent,
} = require("./support/live-equipment-fixtures");
const supabase = require("../../backend/src/supabase");

test("an attendee joins a full event, sees their position, and withdraws", async ({ page }) => {
  test.setTimeout(60_000);
  let organiser;
  let attendee;
  let eventId;
  try {
    organiser = await createAccount(["event_organiser"]);
    attendee = await createAccount(["attendee"]);
    eventId = await createEvent({
      organiserId: organiser.id,
      name: "Live waitlist interaction " + Date.now(),
    });
    await updateEvent(eventId, {
      expected_attendance: 1,
      enrolled_attendees: 1,
      registration_fields: [],
    });

    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(attendee.email);
    await page.getByLabel("Password", { exact: true }).fill(attendee.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 15000 });

    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole("heading", { name: "Event waitlist" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join waitlist" })).toBeVisible();

    const [joinResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith(`/api/waitlist/${eventId}`) &&
        response.request().method() === "POST"),
      page.getByRole("button", { name: "Join waitlist" }).click(),
    ]);
    expect(joinResponse.status(), await joinResponse.text()).toBe(201);
    await expect(page.getByRole("status")).toContainText("position: 1");

    const { data: entries, error: readError } = await supabase
      .from("event_waitlist_entries")
      .select("id, attendee_id, status")
      .eq("event_id", eventId);
    expect(readError).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ attendee_id: attendee.id, status: "active" });

    const [withdrawResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith(`/api/waitlist/${eventId}`) &&
        response.request().method() === "DELETE"),
      page.getByRole("button", { name: "Leave waitlist" }).click(),
    ]);
    expect(withdrawResponse.status()).toBe(204);
    await expect(page.getByRole("button", { name: "Join waitlist" })).toBeVisible();

    const { data: remaining, error: verifyError } = await supabase
      .from("event_waitlist_entries")
      .select("id")
      .eq("event_id", eventId);
    expect(verifyError).toBeNull();
    expect(remaining).toHaveLength(0);
  } finally {
    if (eventId) {
      const { error } = await supabase.from("events").delete().eq("id", eventId);
      if (error) throw new Error(`Could not remove live waitlist test event: ${error.message}`);
    }
    for (const account of [attendee, organiser].filter(Boolean)) {
      const { error } = await supabase.auth.admin.deleteUser(account.id);
      if (error) throw new Error(`Could not remove live waitlist test account: ${error.message}`);
    }
  }
});
