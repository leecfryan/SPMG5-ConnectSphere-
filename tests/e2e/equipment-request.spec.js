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

  // SCRUM-31: rewritten - the form reopened the quantity field SCRUM-30 had
  // removed (its own comment anticipated exactly this reversal). No unit is
  // picked at submission any more; Technical Support's Reserve action
  // assigns real units later.
  test("SCRUM-31: a coordinator requests a type and quantity, no unit picked at submission", async ({ page }) => {
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
    await page.getByLabel("Quantity").fill("1");
    const requirementText = `E2E check ${Date.now()}`;
    await page.getByLabel("Technical requirement").fill(requirementText);

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/equipment-requests") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Submit request", exact: true }).click(),
    ]);
    expect(response.status(), await response.text()).toBe(201);
    const created = (await response.json()).data;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ equipment_type: setup.equipmentType, quantity_requested: 1, equipment_id: null, is_essential: false });

    const row = page.locator(".eq-request-row", { hasText: requirementText });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("× 1");
    await expect(row).toContainText("0 reserved, 0 unfulfilled, 1 pending");
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

  // SCRUM-169 AC3 (was Scrum-30 until this story reversed it): the dropdown
  // is now built from the full catalogue, not just bookable units for the
  // window - a type with zero AVAILABLE units stays selectable so it can
  // show "Out of Stock" instead of disappearing entirely, which would make
  // AC3 unreachable for it.
  test("a type with no AVAILABLE units at all for the window still appears in the type dropdown, flagged Out of Stock", async ({ page }) => {
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
      expect(optionValues).toContain(damagedOnlyType); // every unit DAMAGED, but still listed

      await page.getByLabel("Equipment type").selectOption(damagedOnlyType);
      await expect(page.getByText("Out of Stock", { exact: true })).toBeVisible();
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
