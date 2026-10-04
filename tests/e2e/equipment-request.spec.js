const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { test, expect } = require("@playwright/test");
const {
  setupEquipment, createAccount, deleteAccount, createEquipmentUnit, deleteEquipmentUnit,
} = require("./support/live-equipment-fixtures");

// Live-Supabase suite. Replaces the retired tests/playwright/equipment.api.spec.cjs /
// equipment.browser.spec.cjs (fake in-memory simulator - incompatible with
// this story's changes anyway, since equipment_requests.requested_by/event_id
// are real foreign keys the fake simulator's synthetic ids could never
// satisfy) and fixes this file's own dependency on the "Paste the event's
// UUID" input, which Scrum-29 removed - coordinators now only select from
// their assigned-events dropdown.
async function signIn(page, account) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 15000 });
}

test.describe("Scrum-27 AC1-4: equipment request page", () => {
  let setup;
  test.beforeEach(async () => { setup = await setupEquipment(); });
  test.afterEach(async () => { await setup.teardown(); });

  // Scrum-30: rewritten for the two-step reserve flow - pick a type, review
  // the auto-assigned single unit, submit. No quantity field and no
  // per-unit picker exist in this form any more.
  test("Scrum-30: a coordinator reserves one unit of a type by picking the type and reviewing, not a specific unit", async ({ page }) => {
    await signIn(page, setup.coordinator);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/equipment/events")),
      page.goto("/equipment/requests"),
    ]);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/equipment?") && res.request().method() === "GET"),
      page.getByLabel("Assigned event").selectOption(setup.eventId),
    ]);
    await page.getByLabel("Equipment type").selectOption(setup.equipmentType);
    await expect(page.getByText(`You have requested 1 ${setup.equipmentType}.`)).toBeVisible();
    await expect(page.getByLabel("Quantity required")).toHaveCount(0);
    const requirementText = `E2E check ${Date.now()}`;
    await page.getByLabel("Technical requirement").fill(requirementText);

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/equipment-requests") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Submit request", exact: true }).click(),
    ]);
    expect(response.status(), await response.text()).toBe(201);
    expect((await response.json()).data).toMatchObject({ equipment_id: setup.equipmentId, quantity_requested: 1 });

    const row = page.locator(".eq-request-row", { hasText: requirementText });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("× 1");
    await expect(row).toContainText("PENDING");
  });

  test("AC4: an unrelated coordinator has no assigned events and cannot read this event's requests", async ({ page }) => {
    await signIn(page, setup.outsider);
    await page.goto("/equipment/requests");
    await expect(page.getByLabel("Assigned event").locator("option")).toHaveCount(1); // placeholder only

    await page.goto("/equipment/requests?event=" + setup.eventId);
    await expect(page.getByText("Could not load:", { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".eq-request-row")).toHaveCount(0);
  });
});

test.describe("Scrum-29 follow-up: availability-filtered dropdown and event-derived borrow window", () => {
  let setup;
  test.beforeEach(async () => { setup = await setupEquipment(); });
  test.afterEach(async () => { await setup.teardown(); });

  // Scrum-30: the dropdown is now type-level, built only from bookable units
  // for the window - a type disappears from it entirely once every one of
  // its units is unavailable, rather than one option among several per unit.
  test("a type with no AVAILABLE units at all for the window does not appear in the type dropdown", async ({ page }) => {
    const damagedOnlyType = `${setup.equipmentType}_DAMAGED_ONLY`;
    const damagedId = await createEquipmentUnit({ type: damagedOnlyType, status: "DAMAGED" });
    try {
      await signIn(page, setup.coordinator);
      await page.goto("/equipment/requests");
      await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/equipment?") && res.request().method() === "GET"),
        page.getByLabel("Assigned event").selectOption(setup.eventId),
      ]);
      const optionValues = await page.getByLabel("Equipment type").locator("option").evaluateAll((els) => els.map((e) => e.value));
      expect(optionValues).toContain(setup.equipmentType); // has an AVAILABLE unit
      expect(optionValues).not.toContain(damagedOnlyType); // every unit DAMAGED
    } finally {
      await deleteEquipmentUnit(damagedId);
    }
  });

  test("Borrow from/until default to the event's own timing (+/-30 minutes), not an unrelated hardcoded default", async ({ page }) => {
    await signIn(page, setup.coordinator);
    await page.goto("/equipment/requests");
    await page.getByLabel("Assigned event").selectOption(setup.eventId);

    const startValue = await page.getByLabel("Borrow from").inputValue();
    const endValue = await page.getByLabel("Borrow until").inputValue();
    // datetime-local values are local time; comparing via Date avoids
    // hardcoding this machine's timezone offset.
    expect(new Date(startValue).getTime()).toBe(new Date("2099-10-10T00:00:00Z").getTime() - 30 * 60 * 1000);
    expect(new Date(endValue).getTime()).toBe(new Date("2099-10-10T15:00:00Z").getTime() + 30 * 60 * 1000);
  });
});

test.describe("Scrum-29 follow-up: equipment catalogue page", () => {
  test("lists a freshly created unit with its live status", async ({ page }) => {
    const setup = await setupEquipment();
    try {
      await signIn(page, setup.technical);
      await page.goto("/equipment/catalogue");
      const row = page.locator(".eq-request-row", { hasText: setup.equipmentType });
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row).toContainText("AVAILABLE");
    } finally {
      await setup.teardown();
    }
  });
});

test.describe("role gating: direct URL access", () => {
  for (const [role, route] of [
    ["event_organiser", "/equipment/requests"],
    ["technical_support_staff", "/equipment/requests"],
    ["event_coordinator", "/technical-support"],
    ["venue_staff", "/technical-support"],
    // Scrum-30: the catalogue page moved from equipment.read to
    // equipment.review - a Coordinator no longer has a route to it, nor to
    // the add/edit management routes (equipment.manage). The guard runs
    // before any id is looked up, so a placeholder id is enough for /edit.
    ["event_coordinator", "/equipment/catalogue"],
    ["event_coordinator", "/equipment/catalogue/new"],
    ["event_coordinator", "/equipment/catalogue/00000000-0000-0000-0000-000000000000/edit"],
  ]) {
    test(`${role} cannot open ${route} directly`, async ({ page }) => {
      const account = await createAccount([role]);
      try {
        await signIn(page, account);
        await page.goto(route);
        await expect(page).toHaveURL(/\/forbidden$/);
      } finally {
        await deleteAccount(account.id);
      }
    });
  }
});
