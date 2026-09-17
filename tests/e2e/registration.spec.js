import { test, expect } from '@playwright/test'

// Uses attendee3.demo@example.com — no registrations in the seed data, so
// the first run is always clean. Re-registration after withdrawal is blocked
// by the backend; to rerun this spec cleanly, delete the row from Supabase
// or run a fresh seed.
const EMAIL = 'attendee3.demo@example.com'
const PASSWORD = process.env.SEED_USER_PASSWORD

async function signIn(page) {
  await page.goto('/')
  await page.getByLabel('Email address').fill(EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText(/welcome,/i)).toBeVisible()
}

test.describe('Registration flow', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('attendee registers for an event and sees it in My Registrations', async ({ page }) => {
    // Navigate to the events list from the workspace
    await page.getByRole('link', { name: 'Browse events' }).click()
    await expect(page).toHaveURL('/events')
    await expect(page.getByRole('heading', { name: 'Open for registration' })).toBeVisible()

    // Open Startup Pitch Night (APPROVED, fields: full_name / company / role)
    await page.getByRole('link', { name: 'Startup Pitch Night' }).click()
    await expect(page.getByRole('heading', { name: 'Startup Pitch Night' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Register for this event' })).toBeVisible()

    // Fill the registration form with real field IDs from the seed
    await page.getByLabel('Full name').fill('Test Attendee Three')
    await page.getByLabel('Company or organisation (if applicable)').fill('QA Test Corp')
    await page.getByLabel(/your role/i).fill('curious attendee')
    await page.getByRole('button', { name: 'Register for this event' }).click()

    // Confirmation message, then redirect to My Registrations
    await expect(page.getByRole('status')).toContainText('You are registered')
    await expect(page).toHaveURL('/registrations/me', { timeout: 5_000 })
    await expect(page.getByText('Startup Pitch Night')).toBeVisible()
  })

  test('attendee opens a registration and withdraws it', async ({ page }) => {
    await page.goto('/registrations/me')
    await expect(page.getByRole('heading', { name: 'My registrations' })).toBeVisible()

    // The registration from the previous test should be here
    await page.getByRole('link', { name: /startup pitch night/i }).click()
    await expect(page.getByRole('heading', { name: 'Registration details' })).toBeVisible()

    // Two-step withdrawal confirmation
    await page.getByRole('button', { name: 'Withdraw registration' }).click()
    await expect(page.getByText(/are you sure/i)).toBeVisible()
    await page.getByRole('button', { name: 'Yes, withdraw' }).click()

    // Status badge updates to withdrawn
    await expect(page.getByText('withdrawn', { exact: false })).toBeVisible()
    // Withdraw button is gone
    await expect(page.getByRole('button', { name: 'Withdraw registration' })).not.toBeVisible()
  })
})
