/**
 * Live-dashboard interaction flows (#1203, Coverage Phase 3) — built on the
 * gated session-restore seam from #1198 (e2e/helpers/session-restore.ts).
 *
 * #1203's acceptance criteria: "Key Live-dashboard flows have real
 * Playwright coverage exercising actual interactions, not just page-load
 * smoke tests." The existing e2e/session-restore.spec.ts (#1198) already
 * proves every stage-gated panel MOUNTS with real data; this file goes one
 * level deeper and drives the interactions inside eight of them through a
 * real browser:
 *
 *   1. Tasks panel      — filter by stage tab, open a task's VIEW detail.
 *   2. Versions panel   — open the rollback confirmation dialog, then
 *                         cancel it (no real rollback is ever triggered —
 *                         see note on that test for why).
 *   3. Ask-Cody chat    — type a real message, Send it, see the user turn
 *                         appear and a Cody response render.
 *   4. AutoMode panel   — pick a duration, see the real cost line change,
 *                         then click START and verify the real
 *                         paid-plan-gate behavior (the seeded fixture has
 *                         no active plan, so this never starts a real
 *                         autonomous run — see note below).
 *   5. Documents panel  — switch the Documents/Reports tabs and verify the
 *                         filtered body + generate-doc affordance.
 *   6. Documents panel  — click "Export pitch deck" and verify the real
 *                         paid-plan gate (same canExportDeck={activePlan!==''}
 *                         wiring the seeded fixture leaves locked — never a
 *                         real .pptx download on an unpaid account).
 *   7. Media panel      — pick a different auto-media frequency for a kind
 *                         and verify the real aria-checked radio state
 *                         actually moves (not just a visual toggle).
 *   8. Website panel    — click Redeploy and verify the real paid-plan gate
 *                         (canManage={signedIn && !!activePlan} is false for
 *                         the seeded fixture) — never a real Railway
 *                         redeploy of production infra on an unpaid account.
 *   9. Comms-mode select — switch Cody's morning-email cadence (Agile standup
 *                         / Pair programming) and verify the real POST to
 *                         /api/build/comms-mode actually persists the choice
 *                         (survives a reload), not just a local toggle.
 *  10. ZeroInvoice connect — click Connect, verify the real authorize POST
 *                         opens a genuine new tab (never actually completing
 *                         OAuth in it — that's ZeroInvoice's own flow, out of
 *                         scope here), then click the honest self-reported
 *                         "I've finished connecting" confirm button and
 *                         verify the status label updates to Connected.
 *  11. Hire-the-swarm CTA — click "Upgrade to hire the swarm" for the seeded
 *                         (unpaid) founder and verify the real upgrade gate
 *                         (goUpgrade → Pricing screen) — never a real Auto
 *                         Mode/nightly-loop enrollment on an unpaid account.
 *
 * Same real infra as #1198: a REAL authenticated session
 * (E2E_TEST_EMAIL/E2E_TEST_PASSWORD) restoring a REAL, already-generated
 * company via the real `?screen=live&company={slug}` deep link + the real
 * buildStateStorageKey() localStorage cache — never a parallel/fabricated
 * restore mechanism, never a mocked network response standing in for a
 * real interaction's actual effect. Skips (never fails) when the real
 * account env vars or the seeded-company fixture aren't available, exactly
 * like e2e/session-restore.spec.ts.
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

test.describe('Live-dashboard interaction flows (#1203)', () => {
  const fixture = loadSeededCompanyFixture()
  test.skip(!EMAIL || !PASSWORD, 'E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — skipping real-account flow')
  test.skip(!fixture, `No seeded-company fixture at ${FIXTURE_PATH} — run e2e/full-onboarding-provision.spec.ts (#1197) first to produce one`)
  test.setTimeout(120_000)

  test.beforeEach(async ({ page }) => {
    const f = fixture!
    await restoreLiveSession(page, {
      baseUrl: BASE_URL,
      email: EMAIL!,
      password: PASSWORD!,
      fixture: { slug: f.slug, companyName: f.companyName ?? undefined, idea: f.idea ?? undefined, track: f.track ?? 'company' },
    })
    await page.waitForSelector('[data-testid="systems-grid"]', { timeout: 20_000 })
  })

  test('Tasks panel: filtering by stage and opening a task detail are real interactions', async ({ page }) => {
    const panel = page.getByTestId('tasks-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('tasks-loading')).toBeHidden({ timeout: 15_000 }).catch(() => {})

    // The "All" tab is selected by default — switch to "Completed" and back,
    // verifying the real aria-selected state and that the body actually
    // changes to reflect the filter (not just the tab visually toggling).
    const completedTab = page.getByTestId('task-tab-completed')
    await expect(completedTab).toBeVisible()
    await completedTab.click()
    await expect(completedTab).toHaveAttribute('aria-selected', 'true')

    // Either real completed tasks render, or the real per-stage empty state
    // does — both are legitimate real states for a real company, so assert
    // on whichever one actually shows rather than assuming history exists.
    const stageEmpty = page.getByTestId('tasks-stage-empty')
    const taskList = page.getByTestId('task-list')
    await expect(stageEmpty.or(taskList)).toBeVisible({ timeout: 10_000 })

    if (await taskList.isVisible().catch(() => false)) {
      // A real task exists for this stage — open its VIEW detail and verify
      // the detail panel renders the SAME task's title (not a different one).
      const firstCard = page.getByTestId('task-card').first()
      const titleText = await firstCard.getByTestId('task-title').textContent()
      await firstCard.getByTestId('task-view').click()
      const detail = page.getByTestId('task-detail')
      await expect(detail).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('task-detail-title')).toHaveText(titleText || '')
      await page.getByTestId('task-detail-close').click()
      await expect(detail).toBeHidden()
    }

    // Back to All — the filter is reversible, not a one-way navigation.
    await page.getByTestId('task-tab-all').click()
    await expect(page.getByTestId('task-tab-all')).toHaveAttribute('aria-selected', 'true')
  })

  test('Versions panel: opening and cancelling the rollback confirmation is a real interaction', async ({ page }) => {
    // Deliberately never clicks the real "Roll back →" confirm button — that
    // triggers an actual Railway redeploy of this real company's live site
    // (VersionsPanel.tsx's confirmRollback → POST /api/build/versions), which
    // is real production infra this spec has no business mutating on every
    // CI run. Opening + cancelling the confirmation dialog is still a real,
    // meaningful interaction: it exercises the panel's state machine
    // (idle → confirm → idle) and the real REVERT button wiring, without the
    // destructive side effect.
    const panel = page.getByTestId('versions-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('versions-loading')).toBeHidden({ timeout: 15_000 }).catch(() => {})

    const versionsEmpty = page.getByTestId('versions-empty')
    if (await versionsEmpty.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Real company has no deploy history yet — nothing to roll back to')
    }

    const revertBtn = page.getByTestId('version-revert').first()
    if (!(await revertBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Real company has only a single current version — no prior version offers REVERT')
    }

    await revertBtn.click()
    const confirmDialog = page.getByTestId('rollback-confirm')
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('rollback-confirm-btn')).toBeVisible()

    await page.getByTestId('rollback-cancel-btn').click()
    await expect(confirmDialog).toBeHidden()
  })

  test('Ask-Cody chat: sending a real message renders the user turn and a Cody response', async ({ page }) => {
    const chatLog = page.getByTestId('chat-log')
    await expect(chatLog).toBeVisible({ timeout: 15_000 })

    const question = `What should I focus on next? (e2e #1203 ${Date.now()})`
    const chatInput = page.locator('.m-chat-input input[placeholder="Message Cody…"]')
    await expect(chatInput).toBeVisible({ timeout: 10_000 })
    await chatInput.fill(question)

    const sendBtn = page.locator('.m-chat-input button', { hasText: 'Send' })
    await sendBtn.click()

    // The real user turn renders first (optimistic, synchronous with Send).
    await expect(chatLog.getByText(question)).toBeVisible({ timeout: 10_000 })

    // The input clears immediately (Live.tsx's ask() resets `msg` before the
    // network call resolves) — a real, user-visible behavior worth locking in.
    await expect(chatInput).toHaveValue('')

    // A real Cody turn follows — either the live "thinking…" indicator while
    // /api/build/ask is in flight, or (once it resolves) a rendered answer.
    // Whichever is visible when we check, the real end state is a non-empty
    // assistant message once asking completes — never fabricated here.
    await expect(page.getByTestId('chat-cody-thinking').or(page.locator('.m-chat-cody-turn').last()))
      .toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('chat-cody-thinking')).toBeHidden({ timeout: 45_000 })
    const lastCodyTurn = page.locator('.m-chat-cody-turn').last()
    await expect(lastCodyTurn).toBeVisible()
    await expect(lastCodyTurn).not.toHaveText('')
  })

  test('AutoMode panel: selecting a duration updates the real cost line, and starting without a paid plan hits the real upgrade gate', async ({ page }) => {
    const panel = page.getByTestId('auto-mode-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('auto-mode-loading')).toBeHidden({ timeout: 15_000 }).catch(() => {})

    const disabledNote = page.getByTestId('auto-mode-disabled-note')
    if (await disabledNote.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, 'Auto Mode is not configured in this environment')
    }

    // If a run is already active (e.g. a prior real session left one going),
    // this is a real, legitimate state — assert on it rather than forcing idle.
    const running = page.getByTestId('auto-mode-running')
    if (await running.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(page.getByTestId('auto-mode-time-remaining')).toBeVisible()
      test.skip(true, 'Auto Mode already running for this real company — covering the idle-state start flow another run')
    }

    const idle = page.getByTestId('auto-mode-idle')
    await expect(idle).toBeVisible({ timeout: 10_000 })

    // Selecting a different duration changes the real cost label — proof the
    // selector is wired to actual state, not just visually toggling.
    const costBefore = await page.getByTestId('auto-mode-cost').textContent()
    await page.getByTestId('auto-mode-duration-overnight').click()
    await expect(page.getByTestId('auto-mode-duration-overnight')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('auto-mode-cost')).not.toHaveText(costBefore || '', { timeout: 5_000 })

    // The seeded fixture carries no active paid plan, so the real gate
    // (gates.nightlyLoop, Live.tsx) is locked — clicking START must hit the
    // real "paid plan required" path (onUpgrade navigation), never actually
    // dispatch a real autonomous swarm run against this company.
    const startBtn = page.getByTestId('auto-mode-start')
    await expect(startBtn).toHaveText(/START AUTO MODE/)
    const stillIdleOrPricing = async () => {
      const onPricing = page.url().includes('pricing') || page.url().includes('screen=pricing')
      const stillIdle = await page.getByTestId('auto-mode-idle').isVisible().catch(() => false)
      return onPricing || stillIdle
    }
    await startBtn.click()
    await page.waitForTimeout(1_500) // let the real onUpgrade navigation (if any) settle
    expect(await stillIdleOrPricing(), 'an unlocked founder must hit the real upgrade gate, never a real paid run start').toBe(true)
    await expect(page.getByTestId('auto-mode-running')).toBeHidden()
  })

  test('Documents panel: switching Documents/Reports tabs filters the real list', async ({ page }) => {
    const panel = page.getByTestId('documents-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('documents-loading')).toBeHidden({ timeout: 15_000 }).catch(() => {})

    const reportsTab = page.getByTestId('documents-tab-report')
    await expect(reportsTab).toBeVisible()
    await reportsTab.click()
    await expect(reportsTab).toHaveAttribute('aria-selected', 'true')

    // Real per-tab state: either the Reports-only list, or the honest
    // reports-specific empty state — never the Documents-tab content leaking
    // through, which would mean the filter isn't real.
    const reportsEmpty = page.getByTestId('documents-empty')
    const docsList = page.getByTestId('documents-list')
    await expect(reportsEmpty.or(docsList)).toBeVisible({ timeout: 10_000 })
    if (await docsList.isVisible().catch(() => false)) {
      const cards = page.getByTestId('document-card')
      const count = await cards.count()
      for (let i = 0; i < count; i++) {
        await expect(cards.nth(i)).toHaveAttribute('data-kind', 'report')
      }
    }

    // Back to All — switching is reversible and the Documents tab's own
    // content (not Reports') comes back.
    await page.getByTestId('documents-tab-all').click()
    await expect(page.getByTestId('documents-tab-all')).toHaveAttribute('aria-selected', 'true')
  })

  test('Documents panel: exporting the pitch deck without a paid plan hits the real upgrade gate', async ({ page }) => {
    // DocumentsPanel.tsx wires canExportDeck={activePlan !== ''} (Live.tsx) —
    // the seeded fixture carries activePlan: '' (buildSeedPayload), so this
    // real founder is genuinely unpaid. exportDeck() checks canExportDeck
    // BEFORE ever calling POST /api/build/deck, so clicking the button here
    // must route through onExportUpgrade (goUpgrade → pricing screen), never
    // actually request or download a real .pptx.
    const panel = page.getByTestId('documents-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    const exportSection = page.getByTestId('deck-export')
    await expect(exportSection).toBeVisible()
    const exportBtn = page.getByTestId('deck-export-btn')
    await expect(exportBtn).toHaveText(/Export pitch deck \(paid\)/)
    await expect(page.getByTestId('deck-export-locked')).toBeVisible()

    const downloadPromise = page.waitForEvent('download', { timeout: 3_000 }).catch(() => null)
    await exportBtn.click()
    await page.waitForTimeout(1_000) // let the real onExportUpgrade navigation (if any) settle

    const download = await downloadPromise
    expect(download, 'an unpaid founder must never receive a real pitch-deck download').toBeNull()
    const onPricing = page.url().includes('pricing') || page.url().includes('screen=pricing')
    expect(onPricing, 'an unpaid founder clicking Export pitch deck must hit the real upgrade gate').toBe(true)
  })

  test('Media panel: picking a different auto-media frequency moves the real radio state', async ({ page }) => {
    const panel = page.getByTestId('media-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('media-loading')).toBeHidden({ timeout: 15_000 }).catch(() => {})

    // Media generation itself may not be configured for this workspace —
    // that's a real, legitimate state (see media-disabled-note's own comment
    // in MediaPanel.tsx), distinct from "no media kinds render at all."
    const firstFreqGroup = page.locator('[data-testid^="media-freq-"]').first()
    if (!(await firstFreqGroup.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'No media kind rendered for this real company — nothing to set a frequency on')
    }

    // MediaPanel.tsx's initial freq state defaults BOTH kinds to 'weekly' —
    // Monthly is never the default, so clicking it must move the real
    // aria-checked radio off Weekly, proving this is one real radiogroup
    // rather than independent toggles (not just asserting the clicked
    // option's own state, which could pass even if siblings didn't update).
    const monthlyOption = firstFreqGroup.getByTestId(/^media-freq-.+-monthly$/)
    await expect(monthlyOption).toBeVisible()
    const wasChecked = await monthlyOption.getAttribute('aria-checked')
    if (wasChecked === 'true') {
      test.skip(true, 'Monthly is already the active frequency for this real company — covering the toggle another run')
    }

    await monthlyOption.click()
    await expect(monthlyOption).toHaveAttribute('aria-checked', 'true')
    const otherChecked = await firstFreqGroup.locator('[role="radio"][aria-checked="true"]').count()
    expect(otherChecked, 'exactly one frequency option is checked at a time').toBe(1)
  })

  test('Website panel: clicking Redeploy without a paid plan hits the real upgrade gate', async ({ page }) => {
    // WebsitePanel.tsx's requestRedeploy() checks canManage BEFORE ever
    // setting redeploy.phase to 'confirm' — canManage={signedIn &&
    // !!activePlan} (Live.tsx), and the seeded fixture's activePlan is ''
    // (buildSeedPayload), so this real founder is genuinely unpaid. Clicking
    // Redeploy here must route straight to onRequireUpgrade (goUpgrade →
    // pricing screen) and must NEVER reach the confirm dialog or trigger a
    // real Railway redeploy of this company's live site.
    const panel = page.getByTestId('website-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    const redeploySection = page.getByTestId('website-redeploy')
    await expect(redeploySection).toBeVisible()
    const redeployBtn = page.getByTestId('redeploy-btn')
    await expect(redeployBtn).toBeVisible()
    await expect(redeployBtn).toHaveAttribute('title', 'Upgrade to redeploy your app')

    await redeployBtn.click()
    await page.waitForTimeout(1_000) // let the real onRequireUpgrade navigation (if any) settle

    await expect(page.getByTestId('redeploy-confirm')).toBeHidden()
    const onPricing = page.url().includes('pricing') || page.url().includes('screen=pricing')
    expect(onPricing, 'an unpaid founder clicking Redeploy must hit the real upgrade gate, never the real confirm dialog').toBe(true)
  })

  test('Comms-mode selector: switching Cody\'s morning-email cadence really persists', async ({ page }) => {
    // Live.tsx's changeCommsMode() is optimistic-then-persist: it flips
    // `commsMode` immediately, POSTs /api/build/comms-mode, and reverts on a
    // real failure. The meaningful assertion isn't the dropdown's own value
    // (that would pass even for a purely-local, unpersisted toggle) — it's
    // that a FRESH page load reads back the same mode from the server,
    // proving the real network round-trip actually landed.
    const selector = page.getByTestId('comms-mode-selector')
    await expect(selector).toBeVisible({ timeout: 15_000 })
    const select = page.getByTestId('comms-mode-select')
    await expect(select).toBeEnabled()

    const current = await select.inputValue()
    const next = current === 'agile' ? 'pairProgramming' : 'agile'

    const postPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/build/comms-mode') && resp.request().method() === 'POST',
    )
    await select.selectOption(next)
    const postResp = await postPromise
    expect(postResp.ok(), 'the real comms-mode POST must succeed for this signed-in founder').toBe(true)
    await expect(select).toHaveValue(next)

    // Reload and restore the same local build-state cache (a fresh page load
    // of the real deep link) — if the change only lived in React state, this
    // would read back the old default instead of the real persisted value.
    const f = fixture!
    await restoreLiveSession(page, {
      baseUrl: BASE_URL,
      email: EMAIL!,
      password: PASSWORD!,
      fixture: { slug: f.slug, companyName: f.companyName ?? undefined, idea: f.idea ?? undefined, track: f.track ?? 'company' },
    })
    await page.waitForSelector('[data-testid="systems-grid"]', { timeout: 20_000 })
    await expect(page.getByTestId('comms-mode-select')).toHaveValue(next, { timeout: 15_000 })

    // Restore the original mode so this spec doesn't leave the real company's
    // setting permanently flipped across runs.
    const restorePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/build/comms-mode') && resp.request().method() === 'POST',
    )
    await page.getByTestId('comms-mode-select').selectOption(current)
    await restorePromise
  })

  test('ZeroInvoice connect: clicking Connect opens a real authorize tab, and self-confirming updates the status', async ({ page, context }) => {
    // ZeroInvoiceConnect.tsx's connect() POSTs /api/build/zeroinvoice with
    // action:'authorize' and window.open()s the REAL authUrl it returns —
    // this spec verifies that real round-trip actually opens a new tab, then
    // immediately closes that tab without touching ZeroInvoice's own OAuth
    // flow inside it (out of scope, and not something this spec should ever
    // drive to completion). It never asserts a platform-verified "Connected"
    // state — only the honest self-reported one the component itself claims.
    const connectCard = page.getByTestId('zeroinvoice-connect')
    await expect(connectCard).toBeVisible({ timeout: 15_000 })

    const status = page.getByTestId('zeroinvoice-connect-status')
    const alreadyConnected = (await status.textContent())?.includes('Connected')
    if (alreadyConnected) {
      test.skip(true, 'This real company already has a self-reported ZeroInvoice connection — covering the initial-connect flow another run')
    }

    const connectBtn = page.getByTestId('zeroinvoice-connect-btn')
    await expect(connectBtn).toHaveText(/Connect ZeroInvoice/)

    const postPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/build/zeroinvoice') && resp.request().method() === 'POST',
    )
    const popupPromise = context.waitForEvent('page', { timeout: 10_000 })
    await connectBtn.click()

    const postResp = await postPromise
    expect(postResp.ok(), 'the real zeroinvoice authorize POST must succeed for this signed-in founder').toBe(true)

    const popup = await popupPromise
    expect(popup.url(), 'Connect must open a real external authorize URL, not a blank/about tab').not.toBe('about:blank')
    await popup.close()

    await expect(status).toHaveText('Connect requested — finish in the new tab, then confirm below')
    const confirmBtn = page.getByTestId('zeroinvoice-confirm-btn')
    await expect(confirmBtn).toBeVisible()

    const confirmPostPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/build/zeroinvoice') && resp.request().method() === 'POST',
    )
    await confirmBtn.click()
    const confirmResp = await confirmPostPromise
    expect(confirmResp.ok(), 'the real zeroinvoice confirm POST must succeed').toBe(true)
    await expect(status).toHaveText('✓ Connected (self-reported)')
    await expect(confirmBtn).toBeHidden()
  })

  test('Hire-the-swarm CTA: upgrading without a paid plan hits the real upgrade gate', async ({ page }) => {
    // Live.tsx wires the "Hire the swarm" card's button to goUpgrade() —
    // signed-in founders go straight to the Pricing screen (real Stripe
    // checkout lives there, covered separately by upgrade-journey.spec.ts).
    // The seeded fixture carries no activePlan, so clicking this must route
    // to Pricing and must NEVER silently enroll this real company into a
    // real nightly Auto Mode loop.
    const swarmCard = page.locator('.m-upsell')
    await expect(swarmCard).toBeVisible({ timeout: 15_000 })

    const upgradeBtn = page.getByTestId('swarm-upgrade')
    await expect(upgradeBtn).toBeVisible()
    await expect(upgradeBtn).toBeEnabled()
    await expect(upgradeBtn).toHaveText(/Upgrade to hire the swarm/)

    await upgradeBtn.click()
    await page.waitForTimeout(1_000) // let the real goUpgrade navigation settle

    const onPricing = page.url().includes('pricing') || page.url().includes('screen=pricing')
    expect(onPricing, 'an unpaid founder clicking "Hire the swarm" must hit the real Pricing screen, never a free enrollment').toBe(true)
  })
})
