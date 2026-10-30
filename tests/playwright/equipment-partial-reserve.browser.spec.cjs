const { test, expect, signIn } = require('./support/fixtures.cjs');
const { setupEquipment } = require('./support/equipment-fixtures.cjs');

// SCRUM-31: the real HTTP + UI wiring, end to end in a browser - a
// coordinator asks for a type + quantity (no unit picked), Technical
// Support reserves the group and sees it move to reserved. The fake storage
// (equipment-storage.cjs) gives each account exactly one unit of its own
// type, so this proves the full-reserve path; the partial-fulfillment and
// essential-shortfall decisions themselves are already proven at the
// service layer (backend/tests/unit/equipment-group-reserve.service.test.js)
// - this spec exists to catch wiring bugs the unit tests can't see (wrong
// endpoint, a crash on render, a selector that doesn't match reality).
test('[E2E-EQUIP31-001] SCRUM-31: a coordinator requests a type+quantity and Technical Support reserves it', async ({ page, accounts, request }) => {
  const { coordinator, technical, event, fields } = await setupEquipment(accounts, request);

  // RequireAuth bounces an unauthenticated visit to /sign-in with the
  // original path in location.state.from; SignInPage redirects straight
  // back there once authenticated - going via /sign-in first and then
  // navigating again would race the auth state settling.
  await page.goto(`/equipment/requests?event=${event.id}`);
  await signIn(page, coordinator);

  await page.getByLabel('Equipment type').selectOption({ label: fields.equipment_type });
  await page.getByLabel('Technical requirement').fill(fields.technical_requirement);
  await page.getByRole('button', { name: 'Submit request' }).click();

  await expect(page.getByText(`${fields.equipment_type} × 1`)).toBeVisible();
  await expect(page.getByText('0 reserved, 0 unfulfilled, 1 pending')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/technical-support');
  await signIn(page, technical);

  await page.getByRole('button', { name: new RegExp(event.name) }).click();
  // A group of exactly one sibling shows its title both as the group header
  // and on the one sibling line below it (by design, for consistency with a
  // group of many) - .first() picks the group header specifically.
  await expect(page.getByText(`${fields.equipment_type} × 1`).first()).toBeVisible();
  await expect(page.getByText('0 reserved, 0 unfulfilled, 1 pending')).toBeVisible();

  await page.getByRole('button', { name: 'Reserve' }).click();

  await expect(page.getByText('1 reserved, 0 unfulfilled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reserve' })).toHaveCount(0);
});
