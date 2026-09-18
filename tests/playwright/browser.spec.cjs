const { test, expect } = require('@playwright/test')
const { deleteRegistration } = require('./support/control.cjs')

const EMAIL = 'attendee3.demo@example.com'
const PASSWORD = process.env.SEED_USER_PASSWORD
const STARTUP_PITCH_NIGHT = 'aaaaaaaa-0010-0000-0000-000000000000'

async function signIn(page) {
  await page.goto('/')
  await page.getByLabel('Email address').fill(EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText(/welcome,/i)).toBeVisible()
}

async function register(page) {
  await page.getByRole('link', { name: 'Browse events' }).click()
  await page.getByRole('link', { name: 'Startup Pitch Night' }).click()
  await page.getByLabel('Full name').fill('Test Attendee Three')
  await page.getByLabel('Company or organisation (if applicable)').fill('QA Test Corp')
  await page.getByLabel(/your role/i).fill('curious attendee')
  await page.getByRole('button', { name: 'Register for this event' }).click()
  await expect(page.getByRole('status')).toContainText('You are registered')
  await expect(page).toHaveURL('/registrations/me', { timeout: 5_000 })
}

test.describe('Registration flow', () => {
  test.beforeEach(async () => {
    await deleteRegistration(EMAIL, STARTUP_PITCH_NIGHT)
  })

  test('attendee registers for an event and sees it in My Registrations', async ({ page }) => {
    await signIn(page)
    await register(page)
    await expect(page.getByText('Startup Pitch Night')).toBeVisible()
  })

  test('attendee withdraws a pending registration via two-step confirmation', async ({ page }) => {
    await signIn(page)
    // Register first so this test is self-contained
    await register(page)

    await page.getByRole('link', { name: /startup pitch night/i }).click()
    await expect(page.getByRole('heading', { name: 'Registration details' })).toBeVisible()

    await page.getByRole('button', { name: 'Withdraw registration' }).click()
    await expect(page.getByText(/are you sure/i)).toBeVisible()
    await page.getByRole('button', { name: 'Yes, withdraw' }).click()

    await expect(page.getByText('withdrawn', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Withdraw registration' })).not.toBeVisible()
  })
})
