import { test, expect } from '@playwright/test'

/**
 * #50 — Honest guest vs authenticated states on the Account screen.
 *
 * GUEST assertions:
 *   - "Sign up / Log in" CTA is visible in the header (not "Sign out").
 *   - "Sign out all" button is absent.
 *   - The Security section (2FA, "Sign out all") is absent.
 *   - A guest prompt section is present explaining the temporary session.
 *   - Profile email line shows "Temporary — not saved" (not a guest-uuid address).
 *
 * AUTHENTICATED assertions (session simulated via next-auth cookie stub):
 *   - "Sign out" button is visible in the header.
 *   - "Sign up / Log in" CTA is absent.
 *   - The Security section is present.
 *   - A real identity (name/email) is shown — not a guest-uuid address.
 *   - "Sign out all" affordance is visible inside the Security section.
 *
 * The app serves the Account screen via ?screen=account. Next-auth session
 * state is injected by stubbing the /api/auth/session route that next-auth
 * calls on the client.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Stub next-auth's session endpoint to return a guest session. */
async function stubGuestSession(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'guest-u1',
          email: 'guest-71f8b8c05@example.com',
          name: '',
          type: 'guest',
        },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

/** Stub next-auth's session endpoint to return a real authenticated user. */
async function stubAuthSession(page: import('@playwright/test').Page, opts?: { name?: string; email?: string }) {
  const name = opts?.name ?? 'Toby Smith'
  const email = opts?.email ?? 'toby@acme.com'
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'real-u1',
          email,
          name,
          type: 'regular',
        },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

// ─── guest state ──────────────────────────────────────────────────────────────

test.describe('#50 Account page — guest state', () => {
  test.beforeEach(async ({ page }) => {
    await stubGuestSession(page)
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await page.locator('.m-account').first().waitFor({ timeout: 20000 })
  })

  test('shows Sign up / Log in CTA instead of Sign out', async ({ page }) => {
    await expect(page.getByTestId('account-guest-signup-cta')).toBeVisible()
    await expect(page.getByTestId('account-guest-signup-cta')).toContainText(/sign up.*log in/i)
  })

  test('does NOT show a Sign out button', async ({ page }) => {
    await expect(page.getByTestId('account-sign-out')).not.toBeVisible()
    // Belt-and-suspenders: no "Sign out" text at all in the header area.
    const headerSignOut = page.locator('.m-account-head button', { hasText: /^sign out$/i })
    await expect(headerSignOut).not.toBeVisible()
  })

  test('does NOT show Sign out all', async ({ page }) => {
    await expect(page.getByTestId('account-sign-out-all')).not.toBeVisible()
  })

  test('does NOT render the Security section (2FA + sign out all)', async ({ page }) => {
    await expect(page.getByTestId('account-security-section')).not.toBeVisible()
  })

  test('shows the guest prompt section', async ({ page }) => {
    await expect(page.getByTestId('account-guest-prompt')).toBeVisible()
    await expect(page.getByTestId('account-guest-prompt')).toContainText(/temporary guest session/i)
  })

  test('profile email line shows "Temporary — not saved" not a guest-uuid address', async ({ page }) => {
    await expect(page.getByTestId('account-guest-email-line')).toBeVisible()
    await expect(page.getByTestId('account-guest-email-line')).toContainText(/temporary/i)
    // The raw guest-uuid email must never be shown in the UI.
    await expect(page.getByTestId('account-guest-email-line')).not.toContainText('guest-71f8b8c05@example.com')
  })

  test('shows Create account and Log in links in the guest prompt', async ({ page }) => {
    await expect(page.getByTestId('account-guest-create-account')).toBeVisible()
    await expect(page.getByTestId('account-guest-login')).toBeVisible()
  })

  test('Create account button navigates to signup screen', async ({ page }) => {
    // We intercept client navigation via the build context dispatch — the screen
    // param in the URL is the observable side-effect.
    await page.getByTestId('account-guest-create-account').click()
    // The dispatcher triggers a React state change; the URL or visible element
    // confirms the target screen rendered.
    await expect(page.locator('.m-auth').first().or(page.locator('[data-testid="auth-email"]').first())).toBeVisible({ timeout: 5000 })
  })
})

// ─── authenticated state ──────────────────────────────────────────────────────

test.describe('#50 Account page — authenticated state', () => {
  test.beforeEach(async ({ page }) => {
    await stubAuthSession(page, { name: 'Toby Smith', email: 'toby@acme.com' })
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await page.locator('.m-account').first().waitFor({ timeout: 20000 })
  })

  test('shows Sign out in the header', async ({ page }) => {
    await expect(page.getByTestId('account-sign-out')).toBeVisible()
    await expect(page.getByTestId('account-sign-out')).toContainText(/sign out/i)
  })

  test('does NOT show Sign up / Log in CTA', async ({ page }) => {
    await expect(page.getByTestId('account-guest-signup-cta')).not.toBeVisible()
  })

  test('does NOT show the guest prompt section', async ({ page }) => {
    await expect(page.getByTestId('account-guest-prompt')).not.toBeVisible()
  })

  test('shows the real display name', async ({ page }) => {
    await expect(page.getByTestId('account-display-name')).toBeVisible()
    await expect(page.getByTestId('account-display-name')).toContainText('Toby Smith')
  })

  test('shows the real email (not a guest-uuid address)', async ({ page }) => {
    await expect(page.getByTestId('account-display-email')).toBeVisible()
    await expect(page.getByTestId('account-display-email')).toContainText('toby@acme.com')
    await expect(page.getByTestId('account-display-email')).not.toContainText('@example.com')
  })

  test('shows the Security section with Sign out all', async ({ page }) => {
    await expect(page.getByTestId('account-security-section')).toBeVisible()
    await expect(page.getByTestId('account-sign-out-all')).toBeVisible()
  })

  test('shows My companies link', async ({ page }) => {
    await expect(page.getByTestId('account-my-companies')).toBeVisible()
  })
})
