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
  // capacity) can themselves take 8+ minutes. Confirmed live again
  // (2026-10-22, two consecutive real runs): that pair's own real ceiling is
  // higher than first measured — each is bounded by its own real 780s (13min)
  // AbortSignal, and a run genuinely took 17.5min without either aborting or
  // completing. The "building your site…" wait below was widened to 30
  // minutes of real margin to match; raise this overall budget to keep
  // matching headroom above it.
  test.setTimeout(2_700_000)

  /**
   * Returns true when login landed on My Companies (the account already has
   * at least one company), false when it landed on the Fork/"Don't build
   * from scratch." front door (a zero-company account — confirmed live
   * 2026-10-21 against builder-e2e-test@ainative.studio, the exact #1197
   * starting state this spec exists to fix).
   *
   * BuildApp.tsx's shouldRouteToCompaniesIndex only redirects a signed-in
   * founder on the landing screen to 'companies' when their real
   * /api/build/my-companies response has at least one entry — a founder
   * with zero companies correctly stays on the landing/funnel front door
   * instead (Polsia-parity front door, builder#1037's own doc comment). The
   * old version of this helper assumed the account always already had
   * companies, which stopped being true and left this whole spec unable to
   * even get past login.
   */
  async function login(page: Page): Promise<boolean> {
    await page.goto(`${BASE_URL}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="auth-email"]').fill(EMAIL!)
    await page.locator('[data-testid="auth-password"]').fill(PASSWORD!)
    await page.locator('[data-testid="auth-submit"]').click()
    // signIn() only updates the session in place (redirect: false) — the real
    // success signal is the post-login screen actually resolving one of the
    // two real destinations above. Waiting on that, not a fixed sleep or an
    // immediate deep-link past login, avoids racing the session write
    // (confirmed live: a premature ?screen= navigation here landed back on
    // signup, since Intake's own auth check hadn't yet seen the session as
    // authenticated).
    const myCompanies = page.getByText('My companies')
    const forkFrontDoor = page.getByText("Don't build from scratch.")
    await expect(myCompanies.or(forkFrontDoor)).toBeVisible({ timeout: 15_000 })
    return await myCompanies.isVisible().catch(() => false)
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

    const hadExistingCompanies = await login(page)

    // Real authenticated re-entry into the funnel: My Companies → "+ New
    // company" → Fork → "Build a Company →" → Intake. This is what a signed-in
    // founder with existing companies actually clicks — NOT the logged-out
    // Start/Build funnel (Sales-role picker only exists in that path).
    //
    // A zero-company account (confirmed live 2026-10-21 — see login() above)
    // lands directly on the Fork front door after login, so there is no
    // "+ New company" button to click — that control only exists on the My
    // Companies screen this account doesn't have yet.
    if (hadExistingCompanies) {
      await page.getByRole('button', { name: '+ New company' }).click()
    }
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

    // Real kickoff step found live (2026-10-21, not present when this spec was
    // first written): KickoffQuestions.tsx now inserts exactly 3 one-at-a-time
    // questions ("Who would you like to help?" etc — lib/build/kickoff-
    // questions.ts's COMPANY_NEW_BUSINESS_QUESTIONS, always length 3 for every
    // track/path) between Intake's submit and the real START_BUILD dispatch.
    // "Not sure yet" (data-testid="kickoff-not-sure") answers each question
    // with no opinion and is always present — the real, fastest genuine path
    // through a step kickoff's own doc comment calls "never a hard gate".
    //
    // Each click must be followed by a real wait for the QUESTION TEXT to
    // change before the next click — confirmed live (2026-10-21): clicking
    // "Not sure yet" back-to-back with no wait left the screen showing
    // question 1 ("Who would you like to help?") even after 5 rapid clicks,
    // because KickoffQuestions.tsx's own answer() does a fire-and-forget
    // fetch to /api/build/anon-draft before any of this screen's state
    // visibly changes, and the "Not sure yet" button's data-testid is
    // identical across all 3 questions (so a fast click-after-click can
    // resolve against the same pre-transition DOM node/handler closure
    // rather than genuinely progressing one question at a time). Bounded at
    // 5 (comfortably above the real max of 3 questions) so a genuine product
    // regression here fails loudly instead of looping forever.
    // Real bug found live (2026-10-21) across SEVERAL earlier attempts at
    // this loop, root-caused by direct diagnostic observation (a separate
    // spec that polled the raw DOM every 2s with no clicks at all, proving
    // kickoff is a genuinely static screen that never auto-advances or
    // flickers on its own — so every prior stuck-at-question-1 failure was
    // this spec's own bug, never the product's):
    //
    // `Locator.isVisible({ timeout })` is NOT a poll-until-true wait —
    // unlike `expect(locator).toBeVisible({ timeout })` or
    // `locator.waitFor({ state: 'visible', timeout })`, it evaluates the
    // CURRENT DOM snapshot near-immediately; the `timeout` option only
    // bounds its own actionability probing, not a real retry loop. Every
    // earlier version of this block used `isVisible({ timeout })` (or no
    // timeout at all) expecting it to wait for kickoff to first render —
    // it doesn't, so the very first check routinely raced Intake's own real
    // /api/build/brand LLM call (the brand-naming step that runs BEFORE
    // GOTO_SCREEN('kickoff') ever dispatches) and read `false` simply
    // because kickoff hadn't mounted YET. That broke the loop immediately,
    // and DesignPicker's subsequent 60s wait then silently burned its whole
    // budget while the real kickoff screen sat untouched at question 1 the
    // entire time — explaining the exact, repeated symptom.
    //
    // `waitFor({ state: 'visible', timeout })` genuinely polls, which is
    // what both the "did kickoff arrive" check and the "did it advance"
    // check actually need. Bounded at 5 iterations (comfortably above the
    // real max of 3 questions) so a genuine product regression fails loudly
    // instead of looping forever.
    const kickoffArrived = await page.getByTestId('kickoff-not-sure')
      .waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)
    console.log(`[kickoff] arrived=${kickoffArrived}`)
    for (let i = 0; i < 5 && kickoffArrived; i++) {
      const notSure = page.getByTestId('kickoff-not-sure')
      const stillOnKickoff = await notSure.isVisible().catch(() => false)
      console.log(`[kickoff] iteration ${i}: stillOnKickoff=${stillOnKickoff}`)
      if (!stillOnKickoff) break
      const questionText = await page.locator('.m-chat-cody-turn').first().textContent().catch(() => null)
      console.log(`[kickoff] iteration ${i}: questionText=${JSON.stringify(questionText)}`)
      await notSure.click()
      // Wait for real forward progress: either the question text changes
      // (next kickoff question) or the kickoff screen is gone entirely
      // (proceed() fired START_BUILD and the workspace advanced).
      //
      // Confirmed live (2026-10-21): questions 1-2 advance (via plain
      // setIndex) well under 10s, but the LAST question's click calls
      // KickoffQuestions.tsx's own proceed() instead — a real async chain
      // (getSession() + a POST to /api/build/credits) before GOTO_SCREEN
      // ever fires, genuinely slower than a local state update. 30s gives
      // that real round-trip real margin without being so long it masks an
      // actual regression on the fast (non-last-question) path.
      try {
        await expect(async () => {
          const stillThere = await page.getByTestId('kickoff-not-sure').isVisible().catch(() => false)
          if (!stillThere) return // kickoff screen is gone — real forward progress
          const nowText = await page.locator('.m-chat-cody-turn').first().textContent().catch(() => null)
          expect(nowText).not.toBe(questionText)
        }).toPass({ timeout: 30_000 })
      } catch (e) {
        console.log(`[kickoff] iteration ${i}: no forward progress detected within 30s — ${String(e).slice(0, 200)}`)
        throw e
      }
    }

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

    // #1196 added a real coach-recommendation turn right after the 3
    // kickoff questions, before DesignPicker — "Looks good, build it" calls
    // the same proceed() the no-recommendation path already used (see
    // KickoffQuestions.tsx's data-testid="kickoff-coach-accept"). Not every
    // idea matches a team-eligible primitive, so this screen is skipped
    // entirely in that case — best-effort, same pattern as
    // clickConfirmIfPresent above.
    const coachAccept = page.getByTestId('kickoff-coach-accept')
    const coachSeen = await coachAccept.isVisible({ timeout: 10_000 }).catch(() => false)
    if (coachSeen) {
      await coachAccept.click()
    }

    // Real interrupt 1/2: DesignPicker (lib/build/useAutoplay.ts's
    // INTERRUPT_VIEWS — the only two views the whole Company track pauses
    // on for a real founder decision, not counting the coach turn above).
    // "Skip — let Cody pick" is the fastest genuine path through it; this is
    // a real dispatch (SKIP_DESIGN_SYSTEM), not a bypass of the step.
    const designSkip = page.getByTestId('design-picker-skip')
    await expect(designSkip).toBeVisible({ timeout: 60_000 })
    await designSkip.click()
    await clickConfirmIfPresent("Got it — I'll pick a look that fits your idea.")

    // thesis: auto-drafts and auto-advances (not an INTERRUPT_VIEW) — no
    // click needed, just wait for it to clear into the next real interrupt.
    //
    // Real timing found live (2026-10-21), root-caused by reading
    // lib/build/useAutoplay.ts directly rather than guessing: thesis is a
    // GENERATED_VIEWS prose artifact (generateArtifact(), same file) with up
    // to 5 real attempts, each independently bounded at 25s
    // (ATTEMPT_TIMEOUT_MS) plus capped exponential backoff between them
    // (0.8s/1.6s/3.2s/6.4s) — a worst-case single-artifact budget of roughly
    // 125s + 12s ≈ 137s BEFORE the wedge interrupt is even reached. Once
    // reached, useAutoplay.ts's own wedge-draft fetch (its dedicated
    // `fetch('/api/build/artifact', { view: 'wedge', ... })` call, lines
    // ~319-343) has NO retry loop and NO explicit timeout of its own — just
    // one real LLM call relying on the platform's own request timeout. The
    // original 120s wait here only covered time AFTER DesignPicker, with no
    // margin for thesis's own worst case landing first — confirmed live:
    // screenshotting the actual timeout showed the fully-drafted THESIS
    // artifact on screen (not Wedge.tsx's content at all), meaning thesis
    // alone had already consumed most/all of the budget. 5 minutes covers
    // thesis's real worst case plus a real wedge draft fetch with margin.
    //
    // Real blocker found live (2026-10-21), root-caused from the real page
    // snapshot at a timeout (not guessed): a CodyNudge card ("Cody suggests
    // · Data Marketplace" — components/build/CodyNudge.tsx, rendered by
    // CodyFeed.tsx whenever PRIMITIVE_MAP[state.view]?.nudge exists and
    // hasn't been answered) appeared after thesis finished drafting.
    // useAutoplay.ts's own guard (the `currentNudge && ... && state.view !==
    // next` check, ~line 290) deliberately HOLDS autoplay — refuses to
    // advance the view away — while a nudge for the CURRENT view is
    // unanswered, exactly so a founder doesn't miss it mid-transition. A
    // real founder dismisses or accepts it; this spec always dismisses
    // ("Not now" — CodyNudge.tsx's own real NUDGE/dismissed dispatch, not a
    // bypass) since accepting would start a real, billable market-data
    // enrichment flow outside this spec's scope. No data-testid exists on
    // this button (CodyNudge.tsx is plain text), so this polls for the
    // exact copy and clicks it whenever it shows up, running CONCURRENTLY
    // with the wedge wait below (not just once) because a nudge can appear
    // at more than one artifact view as the document pipeline advances —
    // confirmed by PRIMITIVE_MAP associating nudges with specific views,
    // not just 'thesis'.
    let dismissingNudges = true
    const dismissNudgesLoop = (async () => {
      while (dismissingNudges) {
        const notNow = page.getByRole('button', { name: 'Not now' })
        const seen = await notNow.isVisible().catch(() => false)
        if (seen) {
          console.log('[nudge] dismissing a Cody suggestion card')
          await notNow.click().catch(() => {})
        }
        await page.waitForTimeout(3_000)
      }
    })()

    const wedgeOpt = page.getByText('This is the right wedge')
    try {
      await expect(wedgeOpt).toBeVisible({ timeout: 300_000 })
    } finally {
      dismissingNudges = false
      await dismissNudgesLoop
    }
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
    // failure with no insight into WHERE. Also keeps dismissing any further
    // CodyNudge card (same real "Not now" mechanism as the wedge wait above
    // — PRIMITIVE_MAP associates nudges with several different views, not
    // just 'thesis', so businessModel/positioning/landing/plan30 can each
    // independently trigger one and autoplay HOLDS on each until answered).
    const progressPoll = setInterval(async () => {
      try {
        const text = await page.locator('text=/\\d+\\/7 artifacts drafted/').first().textContent({ timeout: 2_000 })
        if (text) console.log(`[progress] ${text}`)
      } catch { /* page may be mid-transition — skip this tick */ }
      try {
        const notNow = page.getByRole('button', { name: 'Not now' })
        if (await notNow.isVisible({ timeout: 1_000 }).catch(() => false)) {
          console.log('[nudge] dismissing a Cody suggestion card')
          await notNow.click().catch(() => {})
        }
      } catch { /* benign — next tick will retry */ }
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
    // minutes of real margin. Confirmed live again (2026-10-22): a 10-minute
    // margin itself was insufficient on a real run — the dashboard shell was
    // fully rendered (B2B is yours — setting it up now., all panels present)
    // while registration was still genuinely in flight, not hung. Widened to
    // 15 minutes, then confirmed STILL insufficient on a second real run
    // (17.5min). Traced the real ceiling: app/api/build/company-app/route.ts
    // and company-product/route.ts each bound their own chat-ws call with
    // `signal: AbortSignal.timeout(780_000)` (13 real minutes), run fully
    // concurrently, and chat-ws's own internal pipeline (primary Claude
    // agent → quota/fallback → AINative path → validation → auto-retry →
    // obedience/decomposition repair passes) can itself chain several real
    // LLM calls inside that 13-minute envelope before either resolves or
    // aborts. 15 minutes of margin is not safely above a real 13-minute×2
    // concurrent ceiling plus network/DB overhead — widened to 30 minutes of
    // real margin, which IS safely above it. This is genuine production
    // latency, not a hang: provisionCompany()'s own auto-retry (Live.tsx,
    // MAX_AUTO_PROVISION_ATTEMPTS=8, linear backoff) independently confirms
    // generation recovers on its own without this test's involvement.
    await expect(page.getByText('building your site…')).toBeHidden({ timeout: 1_800_000 })

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

    // #1197 — persist the real seeded company's identity so other specs (in
    // particular #1198's e2e/session-restore.spec.ts) can pick it up without
    // ever re-running this ~20-35 minute real generation themselves.
    //
    // Real bug found live (2026-10-23): this used to read `?company=` off
    // page.url(), on the premise that contexts/build-context.tsx's #648
    // URL-sync effect (computeSyncedUrl) keeps it in sync with Live.tsx's
    // own `companyId`. Traced the real code — computeSyncedUrl only ever
    // SETS `?screen=` and conditionally DELETES `?company=`/`?view=` on
    // screens with no company context (SCREENS_WITHOUT_COMPANY_CONTEXT);
    // it never SETS `?company=`. Confirmed live: a real, fully-provisioned
    // run ("Cloud provisioned", live primitives, working /build/{slug} link)
    // had no `?company=` in the URL at all — Live.tsx's own `companyId`
    // (state.appSub || …) never depended on the URL param to begin with,
    // since this screen is reached by in-app navigation, not a `?company=`
    // deep link. The "View site ↗" link's real href (liveHref in Live.tsx,
    // always `/build/{companyId}`) is the same real value Live.tsx resolved
    // and was on-screen the whole time — read the slug from there instead.
    const viewSiteHref = await page.getByRole('link', { name: /View site/i }).getAttribute('href')
    const seededSlug = viewSiteHref ? viewSiteHref.replace(/^\/build\//, '') : null
    expect(seededSlug, 'Live screen must show a real "View site" link carrying the /build/{slug} once generation completes').toBeTruthy()
    const fixture = {
      slug: seededSlug,
      companyName: await page.locator('h1, h2').first().textContent().catch(() => null),
      idea,
      track: 'company' as const,
      seededAt: new Date().toISOString(),
    }
    const fs = await import('fs')
    const path = await import('path')
    const fixturePath = path.join(__dirname, 'fixtures', 'seeded-company.json')
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true })
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2))
    console.log(`[seed] wrote real seeded-company fixture: ${JSON.stringify(fixture)}`)
  })
})
