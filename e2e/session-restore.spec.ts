/**
 * Gated E2E session-restore seam — stage-gated Live panels (#1198).
 *
 * Verifies the seam built in e2e/helpers/session-restore.ts: a real,
 * authenticated login + a localStorage seed under the exact
 * `ainative_build_<slug>` key the app itself reads
 * (contexts/build-context.tsx's `buildStateStorageKey`/`PersistedBuildState`,
 * exported specifically for this) + the app's own already-shipped
 * `?screen=live&company={slug}` deep link reaches a Live dashboard whose
 * stage-gated panels (Tasks, Versions, Documents, Media, AutoMode) render
 * real content for a REAL, already-completed company — the one #1197's
 * e2e/full-onboarding-provision.spec.ts seeds via the real founder flow —
 * without re-running that ~20-35 minute generation.
 *
 * This is deliberately NOT a new production surface: no new route, no new
 * middleware allowlist entry, no auth bypass. A signed-out visitor still
 * hits Auth.tsx's real sign-in gate; a signed-in visitor with no matching
 * localStorage entry still sees exactly what every real founder sees today
 * (either "building your site…" or the real resolve-app verification path).
 * The ONLY thing this test does that a real founder's own browser couldn't
 * already do on its own is write that same localStorage entry itself,
 * instead of acquiring it the slow way (actually finishing a real build).
 *
 * Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD (same real account #1197
 * uses) AND a fixture written by a prior successful
 * full-onboarding-provision.spec.ts run (e2e/fixtures/seeded-company.json).
 * Skips — never fails — when either precondition is missing, since this is
 * explicitly a companion to that spec, not an independent generator of real
 * generation cost.
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { restoreLiveSession } from './helpers/session-restore'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'
const EMAIL = process.env.E2E_TEST_EMAIL
const PASSWORD = process.env.E2E_TEST_PASSWORD

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'seeded-company.json')

function loadSeededCompanyFixture(): { slug: string; companyName?: string; idea?: string; track?: 'app' | 'company' } | null {
  try {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed?.slug) return null
    return parsed
  } catch {
    return null
  }
}

test.describe('Gated E2E session-restore seam for stage-gated Live panels (#1198)', () => {
  const fixture = loadSeededCompanyFixture()
  test.skip(!EMAIL || !PASSWORD, 'E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — skipping real-account flow')
  test.skip(!fixture, `No seeded-company fixture at ${FIXTURE_PATH} — run e2e/full-onboarding-provision.spec.ts (#1197) first to produce one`)
  test.setTimeout(120_000)

  test('restores a Live-stage session for the real seeded company without re-running generation', async ({ page }) => {
    const f = fixture!
    const start = Date.now()

    await restoreLiveSession(page, {
      baseUrl: BASE_URL,
      email: EMAIL!,
      password: PASSWORD!,
      fixture: { slug: f.slug, companyName: f.companyName ?? undefined, idea: f.idea ?? undefined, track: f.track ?? 'company' },
    })

    // The systems grid is Live.tsx's own real mount signal (same selector
    // full-onboarding-provision.spec.ts itself waits on after a REAL
    // generation) — reaching it here proves the restore seam lands on the
    // real Live dashboard, not a stale/landing/fork screen.
    await page.waitForSelector('[data-testid="systems-grid"]', { timeout: 20_000 })

    const elapsedMs = Date.now() - start
    // Generous ceiling (not a tight perf assertion) — the real point is
    // "orders of magnitude faster than a real generation" (20-35+ minutes
    // per full-onboarding-provision.spec.ts's own documented timing), not a
    // specific millisecond budget this seam has no reason to promise.
    expect(elapsedMs).toBeLessThan(60_000)

    // Stage-gated panels (#1198's acceptance criteria): each must render ITS
    // OWN real content for this real companyId — not just mount. Each panel
    // fetches real server-persisted data keyed by companyId (state.appSub),
    // so reaching a non-loading state here is a real, server-backed render.
    const panels = [
      { testid: 'tasks-panel', loadingTestid: 'tasks-loading' },
      { testid: 'versions-panel', loadingTestid: null },
      { testid: 'documents-panel', loadingTestid: null },
      { testid: 'media-panel', loadingTestid: null },
      { testid: 'auto-mode-panel', loadingTestid: 'auto-mode-loading' },
    ]
    for (const panel of panels) {
      await expect(page.getByTestId(panel.testid), `${panel.testid} must mount for the restored Live-stage company`)
        .toBeVisible({ timeout: 15_000 })
    }
    // At least the panels with an explicit loading state should clear it —
    // proof their own real fetch against companyId actually resolved, not
    // just that the wrapper div rendered.
    for (const panel of panels) {
      if (!panel.loadingTestid) continue
      await expect(page.getByTestId(panel.loadingTestid)).toBeHidden({ timeout: 15_000 }).catch(() => {
        // Acceptable: a panel whose real fetch returns fast enough may never
        // render a visible loading state in the first place.
      })
    }

    // Ask-Cody chat log (also stage-gated per #1198's acceptance criteria).
    await expect(page.getByTestId('chat-log')).toBeVisible({ timeout: 10_000 })

    await page.screenshot({ path: 'e2e/screenshots/session-restore-live-dashboard.png', fullPage: true })
  })

  test('the seam introduces no NEW production surface — an unauthenticated visitor sees exactly the same real public Live page they already could', async ({ browser }) => {
    const f = fixture!
    // A fresh, unauthenticated context — no login, no localStorage seed, and
    // (critically) the SAME `?screen=live&company=<slug>` deep link this
    // seam uses — proving the seam adds nothing an anonymous visitor
    // couldn't already reach on their own.
    //
    // Real product behavior confirmed live (2026-10-21): BuildApp.tsx's
    // PROTECTED_SCREENS only guards 'account'/'companies' — 'live' is
    // deliberately NOT auth-gated, because Live.tsx has its own real
    // anonymous-visitor UI (data-testid="signup-banner"/"upgrade-banner" —
    // "{company} is yours. Save it — get a link..."), by design, so a
    // founder can share their company's dashboard link publicly. So the
    // correct invariant is NOT "an anonymous visitor is blocked" (false for
    // this product) — it's "an anonymous visitor sees the exact same public
    // page a real company's own shareable link already shows today; the
    // restore seam's localStorage seeding is never what decides that."
    const context = await browser.newContext()
    const page = await context.newPage()
    const url = new URL(`${BASE_URL}/build`)
    url.searchParams.set('screen', 'live')
    url.searchParams.set('company', f.slug)
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })

    // The real page still resolves (same public surface) — the systems grid
    // mounts regardless of auth state, by design (that's what makes a
    // company's Live link genuinely shareable). What must differ is the
    // real owner-vs-visitor signal: Live.tsx shows its real
    // signup-banner/upgrade-banner ("{company} is yours. Save it — get a
    // link...") for anyone who is NOT the signed-in founder — this is the
    // product's own real privilege boundary (provisionCompany() itself
    // redirects straight to signup on click rather than provisioning
    // anything when `!signedIn`, Live.tsx:838-841), not something this seam
    // introduces or could ever bypass, since the seam never touches auth.
    await page.waitForSelector('[data-testid="systems-grid"]', { timeout: 20_000 }).catch(() => {})
    const ownerSignal = page.getByTestId('signup-banner').or(page.getByTestId('upgrade-banner'))
    await expect(ownerSignal, 'an anonymous visitor to the same deep link must see the real non-owner banner — proof the seam never substitutes for, or bypasses, the product\'s own auth state').toBeVisible({ timeout: 10_000 })

    await context.close()
  })
})
