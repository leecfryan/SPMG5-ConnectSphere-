const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");

// True end-to-end: a real browser signs in against the real Supabase project
// and exercises the real backend - no fakes (contrast
// backend/tests/unit/equipment/equipment.functional.test.js, which
// deliberately fakes the data layer; see that file's header for why). That
// means this spec depends on state already existing in the shared dev
// Supabase project, none of which this repo seeds automatically:
//   1. A public.user_roles row giving the seeded coordinator account the
//      "event_coordinator" role (see backend/src/middleware/requireDbRole.js)
//      - without it every submission gets a 403, which this test reports as
//        a clear failure message rather than a confusing timeout.
//   2. At least one row in public.events to attach the request to.
// EVENT_ID below is a known-seeded event ("Tech Connect 2026"); override with
// EQUIPMENT_TEST_EVENT_ID if that row is ever removed.
const COORDINATOR_EMAIL = "coordinator.demo@example.com";
const EVENT_ID = process.env.EQUIPMENT_TEST_EVENT_ID || "aaaaaaaa-0001-0000-0000-000000000000";

test.beforeEach(async ({ page }) => {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SEED_USER_PASSWORD in the root .env (see backend/scripts/seedUsers.js) before running the e2e suite.",
    );
  }
  await page.goto("/");
  await page.locator("#email").fill(COORDINATOR_EMAIL);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("You’re signed in")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Request equipment")).toBeVisible();
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

  // An unrelated event id must show none of the first event's requests -
  // proves the list is actually filtered by event_id, not just unfiltered.
  await page
    .locator('input[placeholder="Paste the event\'s UUID"]')
    .fill("00000000-0000-0000-0000-000000000000");
  await expect(
    page.getByText("No equipment requests yet for this event."),
  ).toBeVisible({ timeout: 10000 });
});
