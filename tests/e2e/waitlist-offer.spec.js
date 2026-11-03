const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const {
  createAccount,
  createEvent,
} = require("./support/live-equipment-fixtures");
const supabase = require("../../backend/src/supabase");

test("an attendee sees an offer countdown update and can accept the released place", async ({ page }) => {
  test.setTimeout(60_000);
  let organiser;
  let attendee;
  let eventId;
  try {
    organiser = await createAccount(["event_organiser"]);
    attendee = await createAccount(["attendee"]);
    const initialStart = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
    eventId = await createEvent({
      organiserId: organiser.id,
      name: `Live waitlist offer ${Date.now()}`,
      startTime: initialStart,
      endTime: new Date(Date.parse(initialStart) + 2 * 60 * 60 * 1000).toISOString(),
    });

    const { error: capacityError } = await supabase
      .from("events")
      .update({
        expected_attendance: 1,
        enrolled_attendees: 1,
        registration_fields: [],
      })
      .eq("id", eventId);
    if (capacityError) throw new Error(`Could not configure offer event: ${capacityError.message}`);

    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(attendee.email);
    await page.getByLabel("Password", { exact: true }).fill(attendee.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 15_000 });

    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole("heading", { name: "Event waitlist" })).toBeVisible();
    await page.getByRole("button", { name: "Join waitlist" }).click();
    await expect(page.getByRole("status")).toContainText("position: 1");

    const { error: releaseError } = await supabase
      .from("events")
      .update({ enrolled_attendees: 0 })
      .eq("id", eventId);
    if (releaseError) throw new Error(`Could not release test seat: ${releaseError.message}`);

    await page.reload();
    const countdown = page.getByTestId("waitlist-offer-countdown");
    await expect(countdown).toBeVisible();
    await expect(countdown).toContainText(/\d+\s*days?.*\d+\s*hours?.*\d+\s*minutes?/i);
    const initialCountdown = await countdown.textContent();

    const earlierStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const { error: editError } = await supabase
      .from("events")
      .update({ start_time: earlierStart })
      .eq("id", eventId);
    if (editError) throw new Error(`Could not edit test event start time: ${editError.message}`);

    await page.reload();
    const updatedCountdown = page.getByTestId("waitlist-offer-countdown");
    await expect(updatedCountdown).toContainText(/\d+\s*days?.*\d+\s*hours?.*\d+\s*minutes?/i);
    await expect(updatedCountdown).not.toHaveText(initialCountdown);
    await expect(page.getByRole("button", { name: "Accept offer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline offer" })).toBeVisible();

    const [acceptResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith(`/api/waitlist/${eventId}/offer/accept`) &&
        response.request().method() === "POST"),
      page.getByRole("button", { name: "Accept offer" }).click(),
    ]);
    expect(acceptResponse.status(), await acceptResponse.text()).toBe(200);
    await expect(page.getByText(/registration confirmed/i)).toBeVisible();

    const { data: registration, error: registrationError } = await supabase
      .from("registrations")
      .select("id, attendee_id, status")
      .eq("event_id", eventId)
      .eq("attendee_id", attendee.id)
      .single();
    if (registrationError) throw new Error(`Could not verify accepted registration: ${registrationError.message}`);
    expect(registration.status).toBe("confirmed");
  } finally {
    if (eventId) {
      const waitlistResult = await supabase.from("event_waitlist_entries").delete().eq("event_id", eventId);
      const registrationResult = await supabase.from("registrations").delete().eq("event_id", eventId);
      const eventResult = await supabase.from("events").delete().eq("id", eventId);
      for (const [kind, result] of [
        ["waitlist entry", waitlistResult],
        ["registration", registrationResult],
        ["event", eventResult],
      ]) {
        if (result.error) throw new Error(`Could not clean up ${kind}: ${result.error.message}`);
      }
    }
    for (const account of [attendee, organiser].filter(Boolean)) {
      const { error } = await supabase.auth.admin.deleteUser(account.id);
      if (error) throw new Error(`Could not remove live offer test account: ${error.message}`);
    }
  }
});
