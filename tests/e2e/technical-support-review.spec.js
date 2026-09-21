const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");

// Manual live-Supabase suite: updates status and writes messages in a development DB.
// Requires trusted app_metadata.roles (technical_support_staff/event_coordinator),
// THREAD_TEST_EVENT_ID assigned to the coordinator, and at least one equipment line.
const TECH_SUPPORT_EMAIL = "technical.demo@example.com";
const COORDINATOR_EMAIL = "coordinator.demo@example.com";
const EVENT_ID = process.env.THREAD_TEST_EVENT_ID;

async function signIn(page, email) {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || !EVENT_ID) {
    throw new Error(
      "Set SEED_USER_PASSWORD and THREAD_TEST_EVENT_ID in the root .env before running this live suite.",
    );
  }
  await page.goto(email === TECH_SUPPORT_EMAIL ? "/technical-support" : "/equipment/requests?event=" + EVENT_ID);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Not "You're signed in" (that only ever renders on /account) -
  // SignInPage now redirects straight back to whichever protected page you
  // originally requested, so "Sign out" (rendered by WorkspaceLayout on
  // every protected page, /forbidden included) is the destination-agnostic
  // signal that sign-in actually completed.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15000 });
}

async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#email")).toBeVisible({ timeout: 15000 });
}

test("Scrum-28-Scrum63/64: Technical Support Staff reviews the dashboard and updates a line's status", async ({ page }) => {
  await signIn(page, TECH_SUPPORT_EMAIL);
  await expect(page.getByText("Technical support dashboard")).toBeVisible();

  const summary = page.locator(`[data-event-id="${EVENT_ID}"] .eq-event-summary`);
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
  await page.locator(`[data-event-id="${EVENT_ID}"] .eq-event-summary`).click();
  await expect(page.locator(".eq-line-status select").first()).toHaveValue(target, { timeout: 10000 });
});

test("Scrum-28-Scrum65/66: a Technical Support message is visible to, and answerable by, the Event Coordinator", async ({ page }) => {
  await signIn(page, TECH_SUPPORT_EMAIL);
  await page.locator(`[data-event-id="${EVENT_ID}"] .eq-event-summary`).click();

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
  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.locator(".eq-thread, .eq-request-row")).toHaveCount(0);
});
