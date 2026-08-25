import { test, expect } from '@playwright/test'

/**
 * #74 — email-verification UX on the /build auth surface.
 *
 * Bug being fixed: builder signup returned {ok:true} and the UI proceeded, but
 * core blocks login with AUTH_EMAIL_NOT_VERIFIED — a silent signup→login
 * dead-end. This spec asserts the honest UX:
 *   - signup that core flags verificationRequired → "check your email" panel + resend,
 *   - login rejected as AUTH_EMAIL_NOT_VERIFIED → same verify panel (not "wrong password"),
 *   - the resend button calls the register route's action:'resend' and confirms,
 *   - a genuine bad-password login still shows the generic credential error,
 *   - the OAuth button + normal signup happy-path are preserved (no regression to #49/#50/#57).
 *
 * Core is intercepted so the spec is deterministic and needs no live backend.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/**
 * Stub the next-auth (v5 beta) client handshake so signIn('credentials',
 * {redirect:false}) resolves to a FAILURE ({error}) without a live backend.
 * The client fetches /providers (must list the credentials provider), /csrf,
 * then POSTs the callback and reads `data.url` for `?error=`.
 */
async function stubNextAuthLoginFailure(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/providers', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ credentials: { id: 'credentials', name: 'Credentials', type: 'credentials', signinUrl: '', callbackUrl: '' } }),
    }),
  )
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'test-csrf' }) }),
  )
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  )
  await page.route('**/api/auth/callback/credentials**', (route) =>
    route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ url: `${BASE}/build?error=CredentialsSignin&code=credentials` }),
    }),
  )
}

test.describe('#74 signup — verification-required surfaces the verify panel', () => {
  test('shows "check your email" + resend when register returns verificationRequired', async ({ page }) => {
    await page.route('**/api/build/register', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.action === 'resend') {
        return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      }
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ ok: true, email: b.email, verificationRequired: true }),
      })
    })

    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('verify-me@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()

    // The verify panel replaces the form; the address is echoed back.
    await expect(page.getByTestId('auth-verify-panel')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('auth-verify-email')).toContainText('verify-me@acme.com')
    await expect(page.getByTestId('auth-resend')).toBeVisible()
  })

  test('resend button confirms after calling the register route', async ({ page }) => {
    let resendHit = false
    await page.route('**/api/build/register', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.action === 'resend') {
        resendHit = true
        return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      }
      return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, email: b.email, verificationRequired: true }) })
    })

    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('resend-me@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()
    await expect(page.getByTestId('auth-verify-panel')).toBeVisible({ timeout: 20000 })

    await page.getByTestId('auth-resend').click()
    await expect.poll(() => resendHit).toBe(true)
    await expect(page.getByTestId('auth-resend-note')).toContainText(/sent/i)
  })
})

test.describe('#74 login — AUTH_EMAIL_NOT_VERIFIED is handled explicitly', () => {
  test('an unverified login shows the verify panel, not "wrong password"', async ({ page }) => {
    // next-auth credentials sign-in fails (error), then the client classifies via
    // the register route's login-check → AUTH_EMAIL_NOT_VERIFIED.
    await stubNextAuthLoginFailure(page)
    await page.route('**/api/build/register', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.action === 'login-check') {
        return route.fulfill({ status: 200, body: JSON.stringify({ ok: false, errorCode: 'AUTH_EMAIL_NOT_VERIFIED' }) })
      }
      if (b.action === 'resend') return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
    })

    await page.goto(`${BASE}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('unverified@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()

    await expect(page.getByTestId('auth-verify-panel')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('auth-verify-email')).toContainText('unverified@acme.com')
    // It must NOT have shown the generic credential error.
    await expect(page.locator('.m-auth-error')).toHaveCount(0)
  })

  test('a genuine bad-password login still shows the credential error', async ({ page }) => {
    await stubNextAuthLoginFailure(page)
    await page.route('**/api/build/register', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      if (b.action === 'login-check') {
        return route.fulfill({ status: 401, body: JSON.stringify({ ok: false, errorCode: 'AUTH_INVALID_CREDENTIALS' }) })
      }
      return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
    })

    await page.goto(`${BASE}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('wrongpass@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()

    await expect(page.locator('.m-auth-error')).toContainText(/wrong email or password/i)
    await expect(page.getByTestId('auth-verify-panel')).toHaveCount(0)
  })
})

test.describe('#74 no regression — OAuth + verified happy path preserved', () => {
  test('the OAuth button is still present on signup', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('auth-oauth-ainative')).toBeVisible({ timeout: 20000 })
  })

  test('a verified signup (verificationRequired:false) proceeds to sign-in, no verify panel', async ({ page }) => {
    await page.route('**/api/build/register', (route) => {
      const b = JSON.parse(route.request().postData() || '{}')
      return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, email: b.email, verificationRequired: false }) })
    })
    // signIn succeeds → no error → the flow leaves the auth screen.
    await page.route('**/api/auth/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: null }) }),
    )
    await page.route('**/api/build/migrate', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ ok: true, migrated: [], skipped: [] }) }),
    )

    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('auth-email').fill('verified@acme.com')
    await page.getByTestId('auth-password').fill('longenough123')
    await page.getByTestId('auth-submit').click()

    // The verify panel must NOT appear for an already-verified builder signup.
    await expect(page.getByTestId('auth-verify-panel')).toHaveCount(0)
  })
})
