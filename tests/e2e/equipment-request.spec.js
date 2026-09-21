const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");

// Manual live-Supabase suite: writes requests to the configured development database.
// Requires admin-managed app_metadata.roles=["event_coordinator"], a catalogue,
// and EQUIPMENT_TEST_EVENT_ID assigned to that coordinator. No automatic seeding.
const COORDINATOR_EMAIL = "coordinator.demo@example.com";
const EVENT_ID = process.env.EQUIPMENT_TEST_EVENT_ID;

test.beforeEach(async ({ page }) => {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || !EVENT_ID) {
    throw new Error(
      "Set SEED_USER_PASSWORD and EQUIPMENT_TEST_EVENT_ID in the root .env before running this live suite.",
    );
  }
  await page.goto("/equipment/requests?event=" + EVENT_ID);
  await page.locator("#email").fill(COORDINATOR_EMAIL);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Not "You're signed in" (only ever renders on /account) - SignInPage now
  // redirects straight back to the originally-requested page, so this
  // heading (not a generic account-page marker) is what actually confirms
  // sign-in completed and landed on the right destination.
  await expect(page.getByRole("heading", { name: "Request equipment", exact: true })).toBeVisible({ timeout: 15000 });
  await page.locator('input[placeholder="Paste the event\'s UUID"]').fill(EVENT_ID);
});

test("Scrum-27 AC1-3: a coordinator records equipment type, quantity and technical requirement on a new request", async ({ page }) => {
  const select = page.locator(".eq-form select");
  await select.selectOption({ index: 1 });
  const chosenType = (await select.locator("option:checked").textContent()).split("—")[0].trim();

  await page.locator('.eq-form input[type="number"]').fill("2");
  const requirementText = `E2E check ${Date.now()}`;
  await page.locator(".eq-form textarea").fill(requirementText);

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/equipment-requests") && res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Submit request" }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(201);

  const row = page.locator(".eq-request-row", { hasText: requirementText });
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row).toContainText(chosenType); // AC1: equipment type recorded
  await expect(row).toContainText("× 2"); // AC2: quantity recorded
  await expect(row).toContainText(requirementText); // AC3: technical requirement recorded
  await expect(row).toContainText("PENDING");
});

test("Scrum-27 AC4: the request list is scoped to its event, not global", async ({ page }) => {
  await expect(page.getByText("Requests for this event")).toBeVisible();

  // A missing event is reported as 404 and must not reveal prior event requests.
  await page
    .locator('input[placeholder="Paste the event\'s UUID"]')
    .fill("00000000-0000-0000-0000-000000000000");
  await expect(
    page.getByText("Could not load: Event not found"),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".eq-request-row")).toHaveCount(0);
});
