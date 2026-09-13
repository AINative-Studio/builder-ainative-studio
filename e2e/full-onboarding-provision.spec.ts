/**
 * Full onboarding → generation → provisioning E2E (2026-09-13).
 *
 * Real gap this closes: no existing e2e spec drove the complete real founder
 * path all the way through — landing-funnel.spec.ts covers Landing → Start →
 * Build → Intake but stops before submitting an idea; live-vs-planned.spec.ts
 * guesses at stale selectors and gracefully skips if it can't reach Live. A
 * verification pass claimed "Cody built a real company using AINative
 * primitives" by calling /api/chat-ws directly with a made-up chatId — which
 * never goes through Intake's real submit (POST /api/build/brand, credits
 * metering, START_BUILD) or Live's real "Provision cloud" action (POST
 * /api/build/provision, which actually issues per-company primitive
 * credentials). A company built that way has generated CODE that calls real
 * primitive endpoints, but no real credentials behind them — a materially
 * weaker claim than "a founder can build a company end-to-end and it works."
 *
 * This spec drives the ACTUAL UI a signed-in founder uses: log in → My
 * Companies → "+ New company" → Fork ("Build a Company →") → Intake (type +
 * submit a real idea) → wait for real generation → Live dashboard → click
 * "Provision cloud" → confirm the systems grid's real/planned badges reflect
 * genuine provisioning, not a fabricated state.
 *
 * Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD env vars for a real account —
 * skips (not fails) when absent, since this hits real production infra and
 * spends real generation cost; not meant for casual/CI-on-every-push runs.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'
const EMAIL = process.env.E2E_TEST_EMAIL
const PASSWORD = process.env.E2E_TEST_PASSWORD

test.describe('Full onboarding → generation → provisioning (real account)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — skipping real-account flow')
  // The Company track drafts 7 real documents (design, thesis, wedge,
  // businessModel, positioning, landing, plan30 — lib/build/state.ts's
  // COMPANY_VIEWS) via real LLM calls before it ever reaches app generation.
  // Confirmed live (2026-09-13, multiple real runs): all 7 documents alone
  // consistently take 7+ minutes, and the two CONCURRENT app generations
  // that follow (company-app + company-product, each a full agent-timeout →
  // fallback → validation → repair cycle contending for the same LLM
  // capacity) can themselves take 8+ minutes. Sum of every step's own
  // timeout below is ~30 minutes worst case — 35 minutes total, with margin.
  test.setTimeout(2_100_000)

  async function login(page: Page) {
    await page.goto(`${BASE_URL}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="auth-email"]').fill(EMAIL!)
    await page.locator('[data-testid="auth-password"]').fill(PASSWORD!)
    await page.locator('[data-testid="auth-submit"]').click()
    // signIn() only updates the session in place (redirect: false) — the real
    // success signal is afterAuth() actually navigating this signed-in
    // account to My Companies (it already has companies). Waiting on that
    // real screen, not a fixed sleep or an immediate deep-link past login,
    // avoids racing the session write (confirmed live: a premature ?screen=
    // navigation here landed back on signup, since Intake's own auth check
    // hadn't yet seen the session as authenticated).
    await expect(page.getByText('My companies')).toBeVisible({ timeout: 15_000 })
  }

  test('real founder path: idea → generation → Live → Provision cloud → real primitive status', async ({ page }) => {
    // Direct network visibility into /api/build/company-app — server-side
    // Railway logs alone left it ambiguous whether this route was ever even
    // called on a run vs. called-but-still-running, since it only logs on
    // failure. This confirms definitively.
    page.on('response', (res) => {
      if (res.url().includes('/api/build/company-app')) {
        console.log(`[company-app response] status=${res.status()} url=${res.url()}`)
        res.json().then((b) => console.log(`[company-app body] ${JSON.stringify(b)}`)).catch(() => {})
      }
      if (res.url().includes('/api/build/resolve-app')) {
        res.json().then((b) => console.log(`[resolve-app poll] ${JSON.stringify(b)}`)).catch(() => {})
      }
    })

    await login(page)

    // Real authenticated re-entry into the funnel: My Companies → "+ New
    // company" → Fork → "Build a Company →" → Intake. This is what a signed-in
    // founder with existing companies actually clicks — NOT the logged-out
    // Start/Build funnel (Sales-role picker only exists in that path).
    await page.getByRole('button', { name: '+ New company' }).click()
    await expect(page.getByText("Don't build from scratch.")).toBeVisible({ timeout: 10_000 })
    // This real re-entry path (pickTrack('company') with no role arg) has no
    // Sales/Marketing/Operations role picker — that only exists in the
    // logged-out Start→Build funnel. The idea text itself is written to
    // clearly trigger ZeroPipeline/ZeroInvoice via primitive-catalog.ts's
    // keyword matching regardless.
    await page.getByRole('button', { name: 'Build a Company →', exact: true }).click()

    // Intake: type a real idea that clearly warrants ZeroPipeline/ZeroInvoice.
    // A unique suffix per run is REQUIRED, not cosmetic: real bug found live
    // (2026-09-13) — re-running this exact idea text repeatedly against the
    // same brand-derived slug ("ridgeline") caused real, concurrent
    // /api/build/company-app generations to keep re-firing for the SAME
    // company across separate test runs/reloads, each one racing the
    // registry entry a prior run's Live.tsx mount had already set up. The
    // symptom: "building your site…" never resolved even after 3+ minutes,
    // and Railway logs showed 4 separate real generations landing in the
    // showcase for the same slug within one run. A fresh idea → fresh
    // brand-generated slug avoids colliding with any prior run's state.
    const idea =
      `A B2B sales CRM for roofing contractors (run ${Date.now()}) — track leads, ` +
      'move deals through a pipeline from quote to signed contract, log calls ' +
      'with customers, and send invoices once a job is done.'
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await textarea.fill(idea)
    await page.getByRole('button', { name: /Let Cody build it/i }).click()

    // Real interrupt 1/2: DesignPicker (lib/build/useAutoplay.ts's
    // INTERRUPT_VIEWS — the only two views the whole Company track pauses
    // on for a real founder decision). "Skip — let Cody pick" is the
    // fastest genuine path through it; this is a real dispatch
    // (SKIP_DESIGN_SYSTEM), not a bypass of the step.
    // Scoped by DesignPicker's own real wrapper class (components/build/
    // artifacts/DesignPicker.tsx's `m-wedge-confirm` div) rather than a bare
    // global button-text match — "Keep building →" is reused verbatim by
    // BOTH DesignPicker's and Wedge's confirm panels, and this workspace
    // re-renders frequently (thesis auto-drafting in the background), which
    // detaches a locator resolved via a generic `..` parent walk mid-click
    // (confirmed live: a 10-minute "element detached from the DOM" loop).
    // clickConfirmIfPresent: this workspace auto-advances FAST once a real
    // interrupt is resolved (thesis auto-drafts within seconds of design
    // being skipped; businessModel/positioning likewise right after wedge is
    // picked) — confirmed live, repeatedly: DesignPicker's/Wedge's own
    // "Keep building →" confirm screen can already be replaced by the NEXT
    // real artifact view before this even gets a chance to run. That's
    // genuine forward progress, not a failure — so this is fully best-
    // effort: if the confirm text or button never appears within a short
    // window, or a click on it detaches mid-action, that means the app
    // already advanced past this waypoint on its own. Only re-throw an
    // error the pattern doesn't recognize as one of those benign races.
    async function clickConfirmIfPresent(confirmText: string) {
      try {
        const confirmed = page.getByText(confirmText)
        const seen = await confirmed.isVisible({ timeout: 5_000 }).catch(() => false)
        if (!seen) return // already moved past this confirm screen — fine
        await page.locator('.m-wedge-confirm').getByRole('button', { name: 'Keep building →' }).click({ timeout: 8_000 })
      } catch (e) {
        if (!/detached|Timeout/i.test(String(e))) throw e
      }
    }

    // Real interrupt 1/2: DesignPicker (lib/build/useAutoplay.ts's
    // INTERRUPT_VIEWS — the only two views the whole Company track pauses
    // on for a real founder decision). "Skip — let Cody pick" is the
    // fastest genuine path through it; this is a real dispatch
    // (SKIP_DESIGN_SYSTEM), not a bypass of the step.
    const designSkip = page.getByTestId('design-picker-skip')
    await expect(designSkip).toBeVisible({ timeout: 60_000 })
    await designSkip.click()
    await clickConfirmIfPresent("Got it — I'll pick a look that fits your idea.")

    // thesis: auto-drafts and auto-advances (not an INTERRUPT_VIEW) — no
    // click needed, just wait for it to clear into the next real interrupt.

    // Real interrupt 2/2: Wedge — pick the drafted wedge, then confirm.
    const wedgeOpt = page.getByText('This is the right wedge')
    await expect(wedgeOpt).toBeVisible({ timeout: 120_000 })
    await wedgeOpt.click()
    await clickConfirmIfPresent('Sharper.')

    // businessModel, positioning, landing, plan30: all auto-draft and
    // auto-advance (real LLM calls, no manual step) through the document
    // pipeline. IMPORTANT — useAutoplay.ts does NOT auto-advance past
    // plan30 for the Company track (its own comment: "Company track:
    // plan30's own 'See it live →' CTA fires COMPANY_DONE"). That's a real,
    // explicit third manual step (components/build/artifacts/
    // company-artifacts.tsx's Plan30 component) this spec initially missed —
    // confirmed live: without clicking it, the workspace sits genuinely
    // complete (7/7 artifacts drafted) but never proceeds to Live or fires
    // any real app generation (no /api/build/company-app call ever reaches
    // the server), indefinitely.
    //
    // Log real progress every 20s ("N/7 artifacts drafted") so a genuinely
    // stuck draft is visible in CI output instead of only a full-timeout
    // failure with no insight into WHERE.
    const progressPoll = setInterval(async () => {
      try {
        const text = await page.locator('text=/\\d+\\/7 artifacts drafted/').first().textContent({ timeout: 2_000 })
        if (text) console.log(`[progress] ${text}`)
      } catch { /* page may be mid-transition — skip this tick */ }
    }, 20_000)
    try {
      const seeLive = page.getByRole('button', { name: 'See it live →' })
      await expect(seeLive).toBeVisible({ timeout: 600_000 }) // all 7 real document drafts
      await seeLive.click()

      // Real generation + drafting runs — wait for the Live dashboard's
      // systems grid, not a fixed sleep. This is the actual product surface.
      await page.waitForSelector('[data-testid="systems-grid"]', { timeout: 300_000 })
    } finally {
      clearInterval(progressPoll)
    }
    const grid = page.locator('[data-testid="systems-grid"]')
    await expect(grid).toBeVisible()

    // Real, likely-genuine race found live (2026-09-13): the systems grid
    // renders immediately, but app registration (Live.tsx's own POST
    // /api/build/company-app, which is what makes resolveApp(slug).chatId
    // resolve) is a separate, slower async call. Clicking "Provision cloud"
    // before it resolves gets a real 404 {"ok":false,"reason":"not_registered"}
    // from app/api/build/provision/route.ts, confirmed via the response
    // body — a founder clicking fast could plausibly hit this same race in
    // production; tracked separately (not fixed here — this spec's job is
    // to verify the real flow, not patch the product). Wait for the site
    // link's own real "ready" signal (appReady — the same state gating its
    // text between "building your site…" and the live URL) before
    // attempting to provision.
    // Confirmed live (2026-09-13, multiple real runs): company-app and
    // company-product ALWAYS fire concurrently (both mount-time fetches in
    // Live.tsx's same effect) — each running its own full real cody-cli-
    // agent-timeout(240s) → Bedrock-fallback → validation → possible
    // obedience-repair cycle, genuinely contending for the same underlying
    // LLM capacity. Confirmed via direct ZeroDB queries: two apparently-
    // "stuck" generations from an earlier run (never resolved within 4
    // minutes) were later confirmed to have genuinely succeeded and
    // registered — just much slower than a single isolated generation. This
    // is real, load-bearing production behavior (every Company-track
    // founder's dashboard mount triggers this same dual generation), not a
    // test artifact. Confirmed live: one real run's registration landed at
    // the ~8min mark, missing an 8-minute wait here by mere seconds — 10
    // minutes of real margin.
    await expect(page.getByText('building your site…')).toBeHidden({ timeout: 600_000 })

    // Before provisioning: every founder-scoped primitive should read
    // "Planned" (not silently claiming to be live with no real credential).
    const plannedBefore = await grid.locator('[data-testid="system-status-badge"][data-status="planned"]').count()
    expect(plannedBefore).toBeGreaterThan(0)

    // Click the real "Provision cloud" action — this is what actually issues
    // per-company primitive credentials (POST /api/build/provision), not a
    // cosmetic state flip. Wait on the REAL network response (not just the
    // button's text flipping) — confirmed live: a plain .click() here left
    // no /api/build/provision request in server logs at all on one run,
    // most likely because the systems grid's own background refresh
    // (Live.tsx's /api/build/systems re-fetch) re-rendered this exact button
    // out from under an in-flight click, same class of race as the earlier
    // DesignPicker/Wedge confirm-button issue.
    const provisionBtn = page.getByRole('button', { name: /Provision cloud/i })
    await expect(provisionBtn).toBeVisible({ timeout: 10_000 })
    // Confirmed live: the click genuinely lands and provisionCompany() genuinely
    // starts (button flips to "Provisioning…", a real busy state) well within
    // 60s — but the real call itself (a ZeroDB project create + up to 6 real
    // founder-scoped primitive credential captures, per provision/route.ts)
    // can take longer than that to actually resolve. 3 minutes of margin.
    const [provisionResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/build/provision') && res.request().method() === 'POST', { timeout: 180_000 }),
      provisionBtn.click(),
    ])
    const provisionBody = await provisionResponse.json().catch(() => null)
    if (!provisionResponse.ok()) {
      console.log(`[provision] status=${provisionResponse.status()} body=${JSON.stringify(provisionBody)}`)
    }
    expect(provisionResponse.ok()).toBe(true)
    expect(provisionBody?.ok).toBe(true)

    // The button's own text should now reflect the real, just-confirmed state.
    await expect(page.getByRole('button', { name: /Cloud provisioned/i })).toBeVisible({ timeout: 15_000 })

    // After provisioning: at least one system should now read "Live" — a real
    // status change driven by a real credential, not fabricated. Real gap
    // found live: provisionCompany() (Live.tsx) fires the systems-grid
    // refresh (GET /api/build/systems) as a SEPARATE, unawaited fetch AFTER
    // setProvision() already resolved — so the "Cloud provisioned" button
    // text and the honest "Pipeline & Invoices read live data" banner (both
    // driven by the synchronous provision state) can be visible well before
    // the systems grid's own badges have actually re-rendered from their
    // independent refetch. Wait on that real network response explicitly,
    // not just the button text.
    await page.waitForResponse((res) => res.url().includes('/api/build/systems') && res.status() === 200, { timeout: 30_000 }).catch(() => {})
    await expect(async () => {
      const liveAfter = await grid.locator('[data-testid="system-status-badge"][data-status="live"]').count()
      expect(liveAfter).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    await page.screenshot({ path: 'e2e/screenshots/full-onboarding-provisioned.png', fullPage: true })
  })
})
