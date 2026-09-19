const { test: base, expect } = require('@playwright/test');
const { authURL } = require('./settings.cjs');

const test = base.extend({
  accounts: async ({ request }, use) => {
    const headers = { 'X-Test-Control': process.env.PW_CONTROL_KEY };
    await use({
      async create(roles = ['venue_staff'], metadata = {}) {
        const response = await request.post(authURL + '/__test/accounts', { headers, data: { roles, metadata } });
        expect(response.status()).toBe(201);
        return response.json();
      },
      async update(account, data) {
        const response = await request.patch(authURL + '/__test/accounts/' + account.id, { headers, data });
        expect(response.status()).toBe(204);
      },
      async counts(account) {
        const response = await request.get(authURL + '/__test/accounts/' + account.id, { headers });
        expect(response.ok()).toBeTruthy();
        return (await response.json()).counts;
      },
      async events(account) {
        const response = await request.get(authURL + '/__test/accounts/' + account.id, { headers });
        expect(response.ok()).toBeTruthy();
        return (await response.json()).events;
      },
      async session(account) {
        const response = await request.post(authURL + '/auth/v1/token?grant_type=password', {
          data: { email: account.email, password: account.password },
        });
        expect(response.ok()).toBeTruthy();
        return response.json();
      },
    });
  },
});
async function signIn(page, account, password = account.password) {
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
module.exports = { test, expect, signIn };
