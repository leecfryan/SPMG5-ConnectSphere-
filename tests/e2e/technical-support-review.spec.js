const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");

// True end-to-end, same reasoning as equipment-request.spec.js's header:
// a real browser against the real backend and Supabase project, no fakes.
// This spec depends on state already existing in the shared dev project,
// none of which this repo seeds automatically:
//   1. A public.user_roles row giving the seeded technical support account
//      the "tech_support" role, and one giving the seeded coordinator
//      account "event_coordinator" (see requireDbRole.js/requireAnyDbRole.js).
//   2. THREAD_TEST_EVENT_ID must already have at least one equipment_requests
//      row (every message links to a specific line - see messages.service.js)
//      AND its events.coordinator_id must equal the seeded coordinator
//      account's id (Scrum-28-Scrum66/AC4's ownership check - see
//      messages.controller.js's canAccessEvent).
// Override with THREAD_TEST_EVENT_ID if that seeded event is ever removed;
// defaults to "Community Workshop: Intro to Data Science", which already
// carries both.
const TECH_SUPPORT_EMAIL = "technical.demo@example.com";
const COORDINATOR_EMAIL = "coordinator.demo@example.com";
const EVENT_ID = process.env.THREAD_TEST_EVENT_ID || "aaaaaaaa-0002-0000-0000-000000000000";

async function signIn(page, email) {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SEED_USER_PASSWORD in the root .env (see backend/scripts/seedUsers.js) before running the e2e suite.",
    );
  }
  await page.goto("/");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("You’re signed in")).toBeVisible({ timeout: 15000 });
}

async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#email")).toBeVisible({ timeout: 15000 });
}

test("Scrum-28-Scrum63/64: Technical Support Staff reviews the dashboard and updates a line's status", async ({ page }) => {
  await signIn(page, TECH_SUPPORT_EMAIL);
  await expect(page.getByText("Technical support dashboard")).toBeVisible();

  const summary = page.locator(".eq-event-summary").first();
  await expect(summary).toBeVisible({ timeout: 10000 });
  await summary.click();

  const statusSelect = page.locator(".eq-line-status select").first();
  await expect(statusSelect).toBeVisible();
  const before = await statusSelect.inputValue();
  const target = before === "APPROVED" ? "REJECTED" : "APPROVED";

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/status") && res.request().method() === "PATCH"),
    statusSelect.selectOption(target),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  await expect(statusSelect).toHaveValue(target);

  await page.reload();
  await page.locator(".eq-event-summary").first().click();
  await expect(page.locator(".eq-line-status select").first()).toHaveValue(target, { timeout: 10000 });
});

test("Scrum-28-Scrum65/66: a Technical Support message is visible to, and answerable by, the Event Coordinator", async ({ page }) => {
  await signIn(page, TECH_SUPPORT_EMAIL);
  await page.locator(".eq-event-summary").first().click();

  const lineSelect = page.locator(".eq-thread-compose select");
  await expect(lineSelect).toBeVisible({ timeout: 10000 });
  await lineSelect.selectOption({ index: 1 });
  const messageText = `E2E check ${Date.now()}`;
  await page.locator(".eq-thread-compose textarea").fill(messageText);

  const [postResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/messages") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Send" }).click(),
  ]);
  expect(postResponse.status(), await postResponse.text()).toBe(201);
  await expect(page.getByText(messageText)).toBeVisible();

  await signOut(page);
  await signIn(page, COORDINATOR_EMAIL);
  await page.locator('input[placeholder="Paste the event\'s UUID"]').fill(EVENT_ID);

  // AC4: the Coordinator sees the same thread - proves it isn't Technical
  // Support-only storage/UI, and that this Coordinator is authorised for
  // this specific event (see messages.controller.js's canAccessEvent).
  await expect(page.getByText(messageText)).toBeVisible({ timeout: 10000 });

  const replyLineSelect = page.locator(".eq-thread-compose select");
  await replyLineSelect.selectOption({ index: 1 });
  const replyText = `E2E reply ${Date.now()}`;
  await page.locator(".eq-thread-compose textarea").fill(replyText);
  const [replyResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/messages") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Send" }).click(),
  ]);
  expect(replyResponse.status(), await replyResponse.text()).toBe(201);
  await expect(page.getByText(replyText)).toBeVisible();
});

test("Scrum-28-Scrum66 (AC4): the Event Organiser cannot read or post to the clarification thread", async ({ page }) => {
  await signIn(page, "organiser.demo@example.com");
  // The Technical Support dashboard is tech_support-only; TechnicalSupport
  // DashboardPage renders nothing at all on a 403 (see its isForbidden
  // handling) rather than showing an error to a user who never asked for it.
  await expect(page.getByText("Technical support dashboard")).not.toBeVisible();

  await page.locator('input[placeholder="Paste the event\'s UUID"]').fill(EVENT_ID);
  // Equipment requests themselves are visible to any authenticated user
  // (Scrum-27 AC4) - the thread is not. messages.controller.js denies an
  // Organiser (no tech_support/event_coordinator role) before any event
  // lookup, enforced server-side, not merely hidden by the UI.
  await expect(page.getByText("Requests for this event")).toBeVisible();
  await expect(page.locator(".eq-thread")).toContainText("permission", { timeout: 10000 });
});
