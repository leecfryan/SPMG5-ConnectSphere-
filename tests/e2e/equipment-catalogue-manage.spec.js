const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const { setupEquipment, deleteEquipmentUnit } = require("./support/live-equipment-fixtures");

// Scrum-30 AC1: add/update/retire a catalogue record, driven through the
// real browser UI against the real dev Supabase project - same live-DB
// pattern as equipment-request.spec.js, not a fake/mocked backend.
async function signIn(page, account) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 15000 });
}

test.describe("Scrum-30 AC1: Technical Support Staff add, update and retire equipment records", () => {
  let setup;
  test.beforeEach(async () => { setup = await setupEquipment(); });
  test.afterEach(async () => { await setup.teardown(); });

  test("adding a new unit through the catalogue's Add entry point makes it appear in the list", async ({ page }) => {
    await signIn(page, setup.technical);
    await page.goto("/equipment/catalogue");

    await page.getByRole("link", { name: "Add equipment" }).click();
    await expect(page).toHaveURL(/\/equipment\/catalogue\/new$/);

    const freshType = "SCRUM30_E2E_ADD_" + Date.now();
    await page.getByLabel("Type").fill(freshType);
    await page.getByLabel("Location").fill("E2E Store Room");
    await page.getByLabel("Description").fill("Added by an automated test - safe to delete.");

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/api/equipment") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Add equipment" }).click(),
    ]);
    const createdId = (await response.json()).data.id;
    try {
      await expect(page).toHaveURL(/\/equipment\/catalogue$/);

      const row = page.locator(".eq-request-row", { hasText: freshType });
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row).toContainText("E2E Store Room");
      await expect(row).toContainText("AVAILABLE");
    } finally {
      await deleteEquipmentUnit(createdId);
    }
  });

  test("retiring a unit requires confirmation, then hides it by default and shows it greyed when revealed", async ({ page }) => {
    await signIn(page, setup.technical);
    await page.goto("/equipment/catalogue");

    const row = page.locator(".eq-request-row", { hasText: setup.equipmentType });
    await row.getByRole("button", { name: "Retire" }).click();
    await expect(row.getByText("Retire this equipment?", { exact: false })).toBeVisible();

    // Cancel first, to prove the confirm step actually gates the action.
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(row.getByText("Retire this equipment?", { exact: false })).not.toBeVisible();

    await row.getByRole("button", { name: "Retire" }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/retire") && res.request().method() === "PATCH"),
      row.getByRole("button", { name: "Yes, retire" }).click(),
    ]);

    await expect(page.locator(".eq-request-row", { hasText: setup.equipmentType })).toHaveCount(0, { timeout: 10000 });

    await page.getByLabel("Show retired equipment").check();
    const retiredRow = page.locator(".eq-request-row", { hasText: setup.equipmentType });
    await expect(retiredRow).toBeVisible();
    await expect(retiredRow).toHaveClass(/eq-request-row-retired/);
    await expect(retiredRow).toContainText("UNAVAILABLE");
  });
});
