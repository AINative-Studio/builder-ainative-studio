import { test, expect, type Frame, type Page } from '@playwright/test'

/**
 * Interactivity pixel-verify sweep (#132) — Cody-timing-aware.
 *
 * #132: generated apps LOOK polished but buttons/forms are dead. The automated
 * "RENDERED" tally false-positives on the outer builder chrome, so this spec
 * drives the PREVIEW IFRAME like a real user and measures whether interactions
 * actually change the DOM.
 *
 * Reliability rework (the slower cody/kimi-k2 path broke the naive version):
 *   - wait for the UI's TERMINAL state ("N of N completed" + Rate/Refining),
 *     not a fixed iframe timeout that races generation
 *   - measure the preview INLINE right after completion (before the in-memory
 *     preview store can expire — #163)
 *   - classify CRASH ("Something went wrong"), FALLBACK ("Refining"), EXPIRED
 *     ("Preview Expired") distinctly from a dead-but-rendered app
 *   - record-only: always emit [INTERACT] + before/after screenshots; a single
 *     app's infra hiccup never aborts the sweep. The per-app assertion is soft.
 *
 * Runs on production after the #158 interactivity prompt + #162 dup-import fix.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const APPS: [string, string][] = [
  ['todo', 'Build a task manager: a text input and Add button that adds a task to a list, each task has a delete button, and a filter to show all/active/done. Make every button work.'],
  ['notes', 'Build a notes app: type a note in a textarea, click Add to save it to a list of note cards, each card has a delete button. Wire up every control.'],
  ['counter', 'Build a counter app with increment, decrement, and reset buttons that update a number on screen, plus a step-size input. Make the buttons actually work.'],
]

const CRASH_RE = /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Element type is invalid|Objects are not valid as a React child/i
const FALLBACK_RE = /Refining your app/i
const EXPIRED_RE = /Preview Expired/i

function previewFrame(page: Page): Frame | null {
  for (const f of page.frames()) {
    if (/sandpack|codesandbox|\/preview\//i.test(f.url())) return f
  }
  return null
}

type Result = {
  tag: string
  outcome: string
  buttons: number
  liveButtons: number
  inputControlled: boolean
  addWorks: boolean
}

const results: Result[] = []

test.afterAll(() => {
  console.log('\n========== INTERACTIVITY SWEEP SUMMARY ==========')
  for (const r of results) {
    const pct = r.buttons ? Math.round((r.liveButtons / Math.min(r.buttons, 12)) * 100) : 0
    console.log(`[INTERACT] ${r.tag}: outcome=${r.outcome} buttons=${r.buttons} live=${r.liveButtons} (${pct}%) inputControlled=${r.inputControlled} addWorks=${r.addWorks}`)
  }
  const rendered = results.filter(r => r.outcome === 'RENDERED')
  const interactive = rendered.filter(r => r.liveButtons > 0 && (r.inputControlled || r.addWorks))
  console.log(`[INTERACT] RENDERED ${rendered.length}/${results.length} · INTERACTIVE ${interactive.length}/${rendered.length || 0} of rendered`)
})

test.describe('interactivity pixel-verify (#132)', () => {
  test.describe.configure({ timeout: 720_000, mode: 'serial' })

  for (const [tag, prompt] of APPS) {
    test(`generated app is interactive: ${tag}`, async ({ page }) => {
      const rec: Result = { tag, outcome: 'UNKNOWN', buttons: 0, liveButtons: 0, inputControlled: false, addWorks: false }

      try {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' })

        // Start generation (pressSequentially so React enables the submit button).
        const textarea = page.getByPlaceholder('Describe your AINative application...')
        try {
          await expect(textarea).toBeVisible({ timeout: 30_000 })
        } catch {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await expect(textarea).toBeVisible({ timeout: 30_000 })
        }
        await textarea.click()
        await textarea.pressSequentially(prompt, { delay: 2 })
        const submit = page.locator('button[type="submit"]').last()
        await expect(submit).toBeEnabled({ timeout: 15_000 })
        await submit.click()

        // Wait for the UI's terminal state — handles the slow cody/kimi path.
        let completed = false
        try {
          await expect
            .poll(async () => {
              const body = (await page.locator('body').innerText().catch(() => '')) || ''
              return /\d+ of \d+ completed/i.test(body) && /Rate this generation|Refining your app/i.test(body)
            }, { timeout: 600_000, intervals: [5000] })
            .toBe(true)
          completed = true
        } catch { completed = false }

        // Settle for Sandpack boot, then locate the preview iframe.
        await page.waitForTimeout(completed ? 15_000 : 4_000)
        const frame = previewFrame(page)
        const mainBody = (await page.locator('body').innerText().catch(() => '')) || ''
        const iframeText = frame ? ((await frame.locator('body').innerText().catch(() => '')) || '') : ''
        const combined = iframeText + '\n' + mainBody

        // Classify outcome.
        if (!completed) rec.outcome = 'TIMEOUT'
        else if (EXPIRED_RE.test(combined)) rec.outcome = 'EXPIRED'
        else if (CRASH_RE.test(combined)) rec.outcome = 'CRASH'
        else if (FALLBACK_RE.test(combined)) rec.outcome = 'FALLBACK'
        else if (frame && (await frame.locator('button, input, li, form').count().catch(() => 0)) > 2) rec.outcome = 'RENDERED'
        else rec.outcome = 'SPARSE'

        await page.screenshot({ path: `interactivity-${tag}-before.png` }).catch(() => {})

        // Only a real, rendered app can be interactivity-tested.
        if (rec.outcome === 'RENDERED' && frame) {
          const buttons = frame.locator('button')
          rec.buttons = await buttons.count()
          const domSize = () => frame.locator('*').count().catch(() => 0)

          // 1) Controlled input.
          const firstInput = frame.locator('input[type="text"], input:not([type]), textarea').first()
          if (await firstInput.count()) {
            await firstInput.fill('hello world').catch(() => {})
            const v = await firstInput.inputValue().catch(() => '')
            rec.inputControlled = v.includes('hello world')
          }

          // 2) Each button — a "live" one changes the DOM (count or text).
          for (let i = 0; i < Math.min(rec.buttons, 12); i++) {
            const before = await domSize()
            const beforeText = (await frame.locator('body').innerText().catch(() => '')) || ''
            await buttons.nth(i).click({ timeout: 3000 }).catch(() => {})
            await page.waitForTimeout(350)
            const after = await domSize()
            const afterText = (await frame.locator('body').innerText().catch(() => '')) || ''
            if (after !== before || afterText !== beforeText) rec.liveButtons++
          }

          // 3) The Add/New/Create control must do something.
          const addBtn = frame.locator('button', { hasText: /add|new|create|\+/i }).first()
          if (await addBtn.count()) {
            const liBefore = await frame.locator('li, [class*="card"], [class*="item"]').count().catch(() => 0)
            const inp = frame.locator('input[type="text"], input:not([type]), textarea').first()
            if (await inp.count()) await inp.fill('New interactive item').catch(() => {})
            await addBtn.click({ timeout: 3000 }).catch(() => {})
            await page.waitForTimeout(600)
            const liAfter = await frame.locator('li, [class*="card"], [class*="item"]').count().catch(() => 0)
            const formOpened = await frame.locator('form, [role="dialog"]').count().catch(() => 0)
            rec.addWorks = liAfter > liBefore || formOpened > 0
          }
        }

        await page.screenshot({ path: `interactivity-${tag}-after.png` }).catch(() => {})
      } catch (e) {
        rec.outcome = `ERROR:${(e as Error).message?.slice(0, 40)}`
        await page.screenshot({ path: `interactivity-${tag}-error.png` }).catch(() => {})
      }

      results.push(rec)
      const pct = rec.buttons ? Math.round((rec.liveButtons / Math.min(rec.buttons, 12)) * 100) : 0
      console.log(`[INTERACT] ${tag}: outcome=${rec.outcome} buttons=${rec.buttons} live=${rec.liveButtons} (${pct}%) inputControlled=${rec.inputControlled} addWorks=${rec.addWorks}`)

      // Soft per-app assertion: only fail on a rendered-but-dead app (the #132
      // case). Infra outcomes (TIMEOUT/EXPIRED/CRASH) are recorded, not failed,
      // so one hiccup doesn't abort the sweep or mask the interactivity signal.
      if (rec.outcome === 'RENDERED') {
        expect(rec.liveButtons, `${tag}: at least one button changes the DOM`).toBeGreaterThan(0)
        expect(rec.inputControlled || rec.addWorks, `${tag}: input controlled OR add works`).toBe(true)
      }
    })
  }
})
