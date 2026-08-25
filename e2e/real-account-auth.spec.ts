import { test, expect } from '@playwright/test'

/**
 * #49 — real AINative account registration + login on the /build surface.
 *
 * Covers the deterministic, creds-free parts of the KEYSTONE auth flow:
 *   - Signup screen: every field renders, client validation fires, submit wires
 *     to /api/build/register, and the "Continue with AINative" OAuth button is
 *     present and starts the OAuth flow.
 *   - Login screen: fields + validation + OAuth button.
 *   - Guest → account migration: a guest build's slug is posted to
 *     /api/build/migrate on sign-in (the request is asserted; a real session is
 *     required for the server to actually re-key, see MANUAL VERIFICATION).
 *   - Logout affordance present on the Account screen.
 *
 * The core register/login + OAuth token exchange need LIVE AINative creds; those
 * steps are asserted at the network/affordance boundary here and called out for
 * manual verification. We intercept /api/build/register + /api/auth/* so the
 * spec is deterministic and never depends on a real backend.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('#49 real account auth — signup screen', () => {
  test('renders email + password fields, the submit CTA, and the OAuth button', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('auth-password')).toBeVisible()
    await expect(page.getByTestId('auth-submit')).toBeVisible()
    await expect(page.getByTestId('auth-submit')).toContainText(/create account/i)
    // The OAuth entry point (LinkedIn/GitHub both supported by core via "Sign in
    // with AINative") MUST be present.
    await expect(page.getByTestId('auth-oauth-ainative')).toBeVisible()
    await expect(page.getByTestId('auth-oauth-ainative')).toContainText(/ainative/i)
  })

  test('rejects an invalid email before any network call', async ({ page }) => {
    let registerCalled = false
    await page.route('**/api/build/register', (route) => {
      registerCalled = true
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, email: 'x@y.com' }) })
    })
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('not-an-email')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()
    await expect(page.locator('.m-auth-error')).toContainText(/valid email/i)
    expect(registerCalled).toBe(false)
  })

  test('rejects a too-short password before any network call', async ({ page }) => {
    let registerCalled = false
    await page.route('**/api/build/register', (route) => {
      registerCalled = true
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
    })
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('founder@acme.com')
    await page.getByTestId('auth-password').fill('short')
    await page.getByTestId('auth-submit').click()
    await expect(page.locator('.m-auth-error')).toContainText(/at least 8/i)
    expect(registerCalled).toBe(false)
  })

  test('surfaces "already registered" from the register API', async ({ page }) => {
    await page.route('**/api/build/register', (route) =>
      route.fulfill({ status: 409, body: JSON.stringify({ ok: false, error: 'email already registered' }) }),
    )
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('taken@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()
    await expect(page.locator('.m-auth-error')).toContainText(/already registered/i)
  })

  test('valid submit calls /api/build/register with the entered email', async ({ page }) => {
    let body: any = null
    await page.route('**/api/build/register', async (route) => {
      body = JSON.parse(route.request().postData() || '{}')
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, email: body.email }) })
    })
    // Stub next-auth credentials sign-in so the spec doesn't need a real backend.
    await page.route('**/api/auth/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: null }) }),
    )
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('newfounder@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()
    await expect.poll(() => body?.email).toBe('newfounder@acme.com')
  })
})

test.describe('#49 real account auth — login screen', () => {
  test('renders fields, the log-in CTA, and the OAuth button', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('auth-password')).toBeVisible()
    await expect(page.getByTestId('auth-submit')).toContainText(/log in/i)
    await expect(page.getByTestId('auth-oauth-ainative')).toBeVisible()
    // Cross-links to signup + forgot exist.
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible()
  })

  test('validation fires on the login form too', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('bad')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()
    await expect(page.locator('.m-auth-error')).toContainText(/valid email/i)
  })
})

test.describe('#49 OAuth button starts the AINative OAuth flow', () => {
  test('clicking "Continue with AINative" navigates to /api/auth/ainative/authorize', async ({ page }) => {
    // The authorize route 302s to core's /oauth/authorize (or 501 if OAuth isn't
    // configured). We intercept it so the test is deterministic and asserts the
    // button targets the correct endpoint (the redirect chain needs live client creds).
    let authorizeHit = false
    await page.route('**/api/auth/ainative/authorize', (route) => {
      authorizeHit = true
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>oauth-stub</body></html>' })
    })
    await page.goto(`${BASE}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-oauth-ainative').click()
    await expect.poll(() => authorizeHit).toBe(true)
  })
})

test.describe('#49 guest → account migration', () => {
  test('a guest build posts its company slug to /api/build/migrate on sign-in', async ({ page }) => {
    let migrateBody: any = null
    await page.route('**/api/build/register', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, email: 'founder@acme.com' }) }),
    )
    await page.route('**/api/build/migrate', async (route) => {
      migrateBody = JSON.parse(route.request().postData() || '{}')
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, migrated: migrateBody.slugs, skipped: [] }) })
    })
    // Stub next-auth so the credentials sign-in "succeeds" without a backend.
    await page.route('**/api/auth/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: null }) }),
    )

    // Land as a guest already building a company (deep-link seeds appSub + a
    // localStorage build-state key), then register.
    await page.goto(`${BASE}/build?screen=signup&company=guestco`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('auth-email')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('auth-email').fill('founder@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()

    // The migration request carried the guest's in-progress company slug.
    await expect.poll(() => migrateBody?.slugs).toContain('guestco')
  })
})

test.describe('#49 account screen logout affordance', () => {
  test('Account screen shows a sign-out / log-in affordance', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.m-account').first()).toBeVisible({ timeout: 20000 })
    // Anonymous → a "Log in" affordance; authenticated → "Sign out". At least one
    // of the two must be present (both are buttons in the header).
    const logIn = page.getByRole('button', { name: /^log in$/i }).first()
    const signOut = page.getByRole('button', { name: /sign out/i }).first()
    await expect(logIn.or(signOut).first()).toBeVisible()
    // The account profile block renders an identity line (real email once signed
    // in; "Not signed in" while anonymous).
    await expect(page.locator('.m-profile-email')).toBeVisible()
  })
})
