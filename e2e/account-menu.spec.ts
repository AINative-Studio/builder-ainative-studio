import { test, expect } from '@playwright/test'

/**
 * #56 — AccountMenu E2E: unified account nav dropdown.
 *
 * Tests the menu trigger, dropdown rendering, item presence, routing, and
 * honest auth state (guest vs authed) using the deep-link ?screen= query param
 * so we don't need a full codegen build to reach the workspace chrome.
 *
 * Guest surface:
 *   - Menu trigger present + opens dropdown on click.
 *   - Identity header shows "Guest Session".
 *   - Disabled items carry badges.
 *   - Help & Docs is enabled.
 *   - Bottom row = "Sign up / Log in".
 *
 * Auth state detection:
 *   - Unauthenticated /build session → guest menu (Sign up / Log in).
 *
 * Routing:
 *   - Clicking Help & Docs opens /help in a new tab.
 *   - Clicking Sign up / Log in navigates to the signup screen.
 *
 * Note: a real authenticated session requires live AINative credentials; those
 * flows are covered at the network/affordance boundary only. The AUTHED path
 * is asserted manually (see MANUAL_VERIFICATION below).
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('#56 AccountMenu — guest surface', () => {
  test.beforeEach(async ({ page }) => {
    // Deep-link to ws (workspace) screen so the WorkspaceShell chrome renders.
    await page.goto(`${BASE}/build?screen=ws`, { waitUntil: 'domcontentloaded' })
    // Wait for hydration: the account menu trigger should be visible.
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible({ timeout: 20000 })
  })

  test('account menu trigger is visible in the actbar', async ({ page }) => {
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible()
  })

  test('dropdown is hidden before clicking the trigger', async ({ page }) => {
    await expect(page.getByTestId('account-menu-dropdown')).not.toBeVisible()
  })

  test('clicking trigger opens the dropdown', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-dropdown')).toBeVisible()
  })

  test('identity header shows "Guest Session" for unauthenticated user', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-name')).toContainText('Guest Session')
  })

  test('guest-label "Temporary — not saved" is shown for guest', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-guest-label')).toBeVisible()
    await expect(page.getByTestId('account-menu-guest-label')).toContainText('Temporary')
  })

  test('portfolio item is present and shows a badge for guest', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-portfolio')).toBeVisible()
    await expect(page.getByTestId('account-menu-badge-portfolio')).toBeVisible()
  })

  test('credits item is present and shows a badge for guest', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-credits')).toBeVisible()
    await expect(page.getByTestId('account-menu-badge-credits')).toBeVisible()
  })

  test('billing item is present and shows a badge for guest', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-billing')).toBeVisible()
    await expect(page.getByTestId('account-menu-badge-billing')).toBeVisible()
  })

  test('settings item is present and shows a badge for guest', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-settings')).toBeVisible()
    await expect(page.getByTestId('account-menu-badge-settings')).toBeVisible()
  })

  test('help item is present and has no badge', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-help')).toBeVisible()
    await expect(page.getByTestId('account-menu-badge-help')).not.toBeAttached()
  })

  test('refer item is present and shows "Soon" badge', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-refer')).toBeVisible()
    await expect(page.getByTestId('account-menu-badge-refer')).toBeVisible()
  })

  test('auth row shows "Sign up / Log in" for guest (not "Log out")', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-item-auth')).toBeVisible()
    await expect(page.getByTestId('account-menu-item-auth')).toContainText(/Sign up/i)
    // Logout item must NOT be present for a guest.
    await expect(page.getByTestId('account-menu-item-logout')).not.toBeAttached()
  })

  test('pressing Escape closes the dropdown', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-dropdown')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('account-menu-dropdown')).not.toBeVisible()
  })

  test('clicking outside the dropdown closes it', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await expect(page.getByTestId('account-menu-dropdown')).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(page.getByTestId('account-menu-dropdown')).not.toBeVisible()
  })

  test('clicking Help & Docs opens /help (new tab)', async ({ page, context }) => {
    await page.getByTestId('account-menu-trigger').click()
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('account-menu-item-help').click(),
    ])
    await newPage.waitForLoadState('domcontentloaded')
    expect(newPage.url()).toContain('/help')
  })

  test('clicking Sign up / Log in navigates to signup screen', async ({ page }) => {
    await page.getByTestId('account-menu-trigger').click()
    await page.getByTestId('account-menu-item-auth').click()
    // The signup screen renders the auth-submit or auth-email test-id from #49.
    await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 10000 })
  })
})

/**
 * MANUAL_VERIFICATION: Authenticated state (requires live AINative credentials).
 *
 * For a signed-in founder:
 *   1. Navigate to /build (must already have a real session).
 *   2. Click the account-menu-trigger in the actbar (top-right chip).
 *   3. Dropdown opens. Identity header shows the real name + email.
 *   4. "My Portfolio" item is enabled (no badge) → clicking routes to companies screen.
 *   5. "Credits" item is enabled → clicking routes to account screen (usage meters).
 *   6. "Billing" item is enabled → clicking routes to pricing screen.
 *   7. "Settings" item is enabled → clicking routes to account screen (settings form).
 *   8. "Log out" item (not "Sign up / Log in") is visible.
 *   9. Clicking "Log out" triggers next-auth signOut().
 */
