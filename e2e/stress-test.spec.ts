import { test, expect } from '@playwright/test'

/**
 * Stress + edge-case test. Beyond the happy-path sweep, this throws harder and
 * weirder prompts at production to surface lingering bugs: very complex apps,
 * ambiguous requests, prompts prone to the old failure classes, unusual asks,
 * and app types not covered by the mock-data categories.
 *
 * Each is an independent test → parallel workers apply concurrent load.
 * Pass = generation completes, no error overlay, real rendered content.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  // Complex / multi-feature (agent-territory)
  'Build a full CRM with a contacts table, deal pipeline kanban, activity feed, and a stats header.',
  'Build a project management app with a sidebar, task board, gantt-style timeline, and team member list.',
  // App types NOT in the mock-data categories (regression risk after the wrong-app fix)
  'Build a recipe app with a search bar, recipe cards showing image, title, cook time, and a favorite button.',
  'Build a music player with album art, play controls, a progress bar, and a playlist.',
  'Build a flashcard study app with a card that flips, next/previous buttons, and a progress counter.',
  'Build a quiz app with a question, four multiple-choice options, and a score at the end.',
  // Forms & focused single-purpose (the wrong-app class)
  'Build a multi-step signup wizard with progress indicator and validation.',
  'Build a feedback survey with star ratings, radio questions, and a text area.',
  'Build a booking form for a restaurant reservation with date, time, party size, and name.',
  // Data-heavy (charts / tables — recharts + duplicate-import risk)
  'Build a sales analytics dashboard with a revenue line chart, a category bar chart, and a data table.',
  'Build a crypto portfolio tracker with holdings table, total value, and a price chart.',
  // Edge / adversarial
  'Build a landing page with lots of sections: hero, features, pricing, testimonials, FAQ, and footer.',
  'Build a calculator with number buttons, operators, and a display.',
  'Build a pomodoro timer with start, pause, reset, and a session counter.',
  'Build a color palette generator that shows swatches with hex codes and a copy button.',
]

const ERROR_RE =
  /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely/i

test.describe('stress + edge-case test (production)', () => {
  for (const [i, prompt] of PROMPTS.entries()) {
    test(`stress #${i + 1}: ${prompt.slice(0, 44)}`, async ({ page }) => {
      test.setTimeout(300_000)

      await page.goto(BASE, { waitUntil: 'domcontentloaded' })
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

      // Completion (or graceful fallback, which is an acceptable non-crash).
      await expect
        .poll(
          async () => {
            const body = (await page.locator('body').innerText().catch(() => '')) || ''
            return /\d+ of \d+ completed/i.test(body) && /Rate this generation|Refining your app/i.test(body)
          },
          { timeout: 240_000, intervals: [3_000] },
        )
        .toBe(true)

      // Wait for Sandpack to actually render or error.
      let errorSeen = ''
      let previewEls = 0
      let gracefulFallback = false
      await expect
        .poll(
          async () => {
            const mainBody = (await page.locator('body').innerText().catch(() => '')) || ''
            if (/Refining your app/i.test(mainBody)) { gracefulFallback = true; return 'fallback' }
            for (const frame of page.frames()) {
              const txt = (await frame.locator('body').innerText().catch(() => '')) || ''
              if (ERROR_RE.test(txt)) { errorSeen = txt.replace(/\s+/g, ' ').slice(0, 140); return 'error' }
              if (/\[\d\/\d\]\s*(Starting|Installing|Building)/i.test(txt)) continue
              if (/sandpack|codesandbox|\/preview\//i.test(frame.url())) {
                const c = await frame.locator('button, input, a, h1, h2, h3, li, img, form, table').count().catch(() => 0)
                if (c > 0) { previewEls = Math.max(previewEls, c); return 'rendered' }
              }
            }
            return 'pending'
          },
          { timeout: 45_000, intervals: [2_000] },
        )
        .not.toBe('pending')

      await page.screenshot({ path: `stress-${String(i + 1).padStart(2, '0')}.png` }).catch(() => {})
      const outcome = errorSeen ? 'ERROR' : gracefulFallback ? 'FALLBACK' : previewEls > 0 ? 'RENDERED' : 'BLANK'
      console.log(`[STRESS] #${i + 1} ${outcome} error="${errorSeen}" els=${previewEls} :: ${prompt.slice(0, 40)}`)

      // A crash/blank is a real failure. Graceful fallback is acceptable (non-crash).
      expect(errorSeen, `error overlay: ${errorSeen}`).toBe('')
      expect(outcome !== 'BLANK', 'blank preview').toBe(true)
    })
  }
})
