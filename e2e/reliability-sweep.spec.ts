import { test, expect } from '@playwright/test'

/**
 * 20-prompt reliability sweep against PRODUCTION. Measures how often a real user
 * gets a WORKING, rendered UI (no error overlay + real interactive content in the
 * preview frame). Each prompt is an independent test so Playwright workers run
 * them in parallel; the summary is the pass rate.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  'Build a todo list app with an input, add button, and checkable items.',
  'Build a weather dashboard with current conditions and a 5-day forecast in cards.',
  'Build a simple e-commerce product grid with product cards, prices, and add-to-cart buttons.',
  'Build a login form with email and password fields and a submit button.',
  'Build a kanban task board with three columns and draggable-looking task cards.',
  'Build a pricing page with three tiers, feature lists, and a call-to-action button per tier.',
  'Build a blog homepage with a hero, a grid of article cards, and a newsletter signup.',
  'Build an analytics dashboard with metric cards, a line chart, and a bar chart.',
  'Build a settings page with tabbed sections, toggles, and a save button.',
  'Build a contact form with name, email, message fields and validation styling.',
  'Build a team directory with member cards showing avatar, name, role, and contact.',
  'Build a restaurant menu page with categories, dishes, prices, and images.',
  'Build a SaaS landing page with hero, feature grid, testimonials, and footer.',
  'Build a calendar month view with day cells and event indicators.',
  'Build a chat interface with a message list, input box, and send button.',
  'Build a file manager UI with a sidebar, file list, and toolbar actions.',
  'Build a portfolio page with a hero, project gallery, and about section.',
  'Build an invoice page with line items, totals, and a print button.',
  'Build a notification center with a list of notifications and mark-as-read actions.',
  'Build a survey form with multiple question types and a progress bar.',
]

const ERROR_RE =
  /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely|try regenerating/i

test.describe('reliability sweep (production)', () => {
  for (const [i, prompt] of PROMPTS.entries()) {
    test(`#${i + 1}: ${prompt.slice(0, 44)}`, async ({ page }) => {
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
      await textarea.pressSequentially(prompt, { delay: 3 })
      const submit = page.locator('button[type="submit"]').last()
      await expect(submit).toBeEnabled({ timeout: 15_000 })
      await submit.click()

      // Wait for completion.
      await expect
        .poll(
          async () => {
            const body = (await page.locator('body').innerText().catch(() => '')) || ''
            return /\d+ of \d+ completed/i.test(body) && /Rate this generation/i.test(body)
          },
          { timeout: 240_000, intervals: [3_000] },
        )
        .toBe(true)

      // Actively wait for Sandpack to finish compiling+mounting — not a fixed
      // sleep. Poll the preview frame until it has real rendered content OR an
      // error overlay appears, up to 40s (Sandpack cold-boot can be slow).
      let errorSeen = ''
      let previewEls = 0
      await expect
        .poll(
          async () => {
            for (const frame of page.frames()) {
              const txt = (await frame.locator('body').innerText().catch(() => '')) || ''
              if (ERROR_RE.test(txt)) {
                errorSeen = txt.replace(/\s+/g, ' ').slice(0, 140)
                return 'error'
              }
              // Sandpack shows "[N/N] Starting" / a bundler status while booting.
              if (/\[\d\/\d\]\s*(Starting|Installing|Building)/i.test(txt)) continue
              if (/sandpack|codesandbox|\/preview\//i.test(frame.url())) {
                const c = await frame
                  .locator('button, input, a, h1, h2, h3, li, img, form, table')
                  .count()
                  .catch(() => 0)
                if (c > 0) { previewEls = Math.max(previewEls, c); return 'rendered' }
              }
            }
            return 'pending'
          },
          { timeout: 40_000, intervals: [2_000] },
        )
        .not.toBe('pending')

      await page.screenshot({ path: `sweep-${String(i + 1).padStart(2, '0')}.png` }).catch(() => {})
      const ok = !errorSeen && previewEls > 0
      console.log(`[SWEEP] #${i + 1} ${ok ? 'PASS' : 'FAIL'} error="${errorSeen}" els=${previewEls} :: ${prompt.slice(0, 40)}`)

      expect(errorSeen, `error overlay: ${errorSeen}`).toBe('')
      expect(previewEls, 'no rendered content in preview').toBeGreaterThan(0)
    })
  }
})
