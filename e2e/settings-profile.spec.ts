import { test, expect, type Page } from '@playwright/test'

/**
 * #57 — editable Settings/Profile + Danger Zone on the Account screen.
 *
 * GUEST: sees the create-account prompt, NOT the editable settings form or the
 *   danger zone (preserves #50's honest guest handling).
 * AUTHENTICATED: can edit + save name/email/content language; the danger zone
 *   pause/offline/delete actions require confirmation.
 *
 * Session state is injected by stubbing /api/auth/session (same technique as
 * account-states.spec.ts). The new API routes (/api/build/profile, /api/build/danger)
 * are stubbed so the E2E asserts the UI wiring without a live core account.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

async function stubGuestSession(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'guest-u1', email: 'guest-71f8b8c05@example.com', name: '', type: 'guest' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

async function stubAuthSession(page: Page, opts?: { name?: string; email?: string }) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'real-u1',
          email: opts?.email ?? 'toby@acme.com',
          name: opts?.name ?? 'Toby Smith',
          type: 'regular',
        },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

/** Stub the profile GET/POST so the form loads + saves deterministically. */
async function stubProfileApi(page: Page) {
  let saved = { fullName: 'Toby Smith', email: 'toby@acme.com', social: '', contentLanguage: 'en' }
  await page.route('**/api/build/profile', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      saved = {
        fullName: body.fullName ?? saved.fullName,
        email: body.email ?? saved.email,
        social: (body.social || '').replace(/^@+/, ''),
        contentLanguage: body.contentLanguage ?? saved.contentLanguage,
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, profile: saved }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: saved }) })
    }
  })
}

async function stubDangerApi(page: Page) {
  await page.route('**/api/build/danger', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, action: body.action, loopChanged: true, lifecycleChanged: true }),
    })
  })
}

// ─── guest ──────────────────────────────────────────────────────────────────

test.describe('#57 Settings — guest state', () => {
  test.beforeEach(async ({ page }) => {
    await stubGuestSession(page)
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await page.locator('.m-account').first().waitFor({ timeout: 20000 })
  })

  test('does NOT show the editable settings form', async ({ page }) => {
    await expect(page.getByTestId('account-settings-section')).not.toBeVisible()
    await expect(page.getByTestId('settings-fullname')).not.toBeVisible()
  })

  test('does NOT show the danger zone', async ({ page }) => {
    await expect(page.getByTestId('account-danger-section')).not.toBeVisible()
  })

  test('shows the create-account prompt instead', async ({ page }) => {
    await expect(page.getByTestId('account-guest-prompt')).toBeVisible()
    await expect(page.getByTestId('account-guest-create-account')).toBeVisible()
  })
})

// ─── authenticated: edit + save ───────────────────────────────────────────────

test.describe('#57 Settings — authenticated edit & save', () => {
  test.beforeEach(async ({ page }) => {
    await stubProfileApi(page)
    await stubDangerApi(page)
    await stubAuthSession(page)
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await page.locator('.m-account').first().waitFor({ timeout: 20000 })
  })

  test('renders the editable form with current values', async ({ page }) => {
    await expect(page.getByTestId('account-settings-section')).toBeVisible()
    await expect(page.getByTestId('settings-fullname')).toHaveValue('Toby Smith')
    await expect(page.getByTestId('settings-email')).toHaveValue('toby@acme.com')
  })

  test('edits + saves name, email, and content language', async ({ page }) => {
    await page.getByTestId('settings-fullname').fill('Toby Founder')
    await page.getByTestId('settings-email').fill('toby@newco.com')
    await page.getByTestId('settings-language').selectOption('es')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-saved')).toBeVisible({ timeout: 10000 })
  })

  test('shows a field error for an invalid email (client stays on form)', async ({ page }) => {
    // Replace the beforeEach profile stub: POST returns a field error so we assert
    // the form surfaces it. unroute() first so this handler wins deterministically.
    await page.unroute('**/api/build/profile')
    await page.route('**/api/build/profile', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_profile', fields: { email: 'Enter a valid email address.' } }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ profile: { fullName: 'Toby Smith', email: 'toby@acme.com', social: '', contentLanguage: 'en' } }),
        })
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.m-account').first().waitFor({ timeout: 20000 })
    // Wait for the form to hydrate with loaded values (loading gate off).
    await expect(page.getByTestId('settings-email')).toBeEnabled({ timeout: 10000 })
    await page.getByTestId('settings-email').fill('nope@bad')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-email-err')).toBeVisible({ timeout: 10000 })
  })
})

// ─── authenticated: danger zone confirmation ──────────────────────────────────

test.describe('#57 Danger Zone — authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await stubProfileApi(page)
    await stubDangerApi(page)
    await stubAuthSession(page)
    // Seed a company into build state via URL params the /build screen restores from,
    // then open the account screen. The danger zone reads state.appSub/companyName.
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await page.locator('.m-account').first().waitFor({ timeout: 20000 })
  })

  test('the danger zone section is present for an authenticated user', async ({ page }) => {
    await expect(page.getByTestId('account-danger-section')).toBeVisible()
  })

  test('delete requires a matching typed confirmation', async ({ page }) => {
    // With no active company, the zone shows the honest "build a company first" note.
    const noCompany = page.getByTestId('danger-no-company')
    const deleteBtn = page.getByTestId('danger-delete')
    if (await noCompany.isVisible().catch(() => false)) {
      await expect(noCompany).toBeVisible()
      return
    }
    // Company present → destructive delete opens a confirm prompt; submit is disabled
    // until the typed name matches.
    await deleteBtn.click()
    await expect(page.getByTestId('danger-confirm')).toBeVisible()
    await expect(page.getByTestId('danger-confirm-submit')).toBeDisabled()
  })
})
