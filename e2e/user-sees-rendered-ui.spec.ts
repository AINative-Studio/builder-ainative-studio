import { test, expect } from '@playwright/test'

/**
 * The real question: a user types a prompt and picks "generate" — does a
 * WORKING interface actually appear in the product's preview display area?
 * Not "no error text" — actual rendered, visible content.
 *
 * For each prompt we assert:
 *   1. generation completes (Files N/N, rating UI)
 *   2. the preview area shows NO error overlay
 *   3. the preview iframe body has real, visible rendered DOM (buttons, text,
 *      headings) — i.e. the app mounted, not a blank/white frame
 * and we screenshot exactly what the user would see.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  'Build a todo list app with an input, add button, and checkable items.',
  'Build a weather dashboard with current conditions and a 5-day forecast in cards.',
  'Build a simple e-commerce product grid with product cards, prices, and add-to-cart buttons.',
  'Build a login form with email and password fields and a submit button.',
]

test.describe('user sees a working rendered UI (real product experience)', () => {
  for (const [i, prompt] of PROMPTS.entries()) {
    test(`prompt ${i + 1}: "${prompt.slice(0, 40)}..."`, async ({ page }, testInfo) => {
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
      await textarea.pressSequentially(prompt, { delay: 4 })
      const submit = page.locator('button[type="submit"]').last()
      await expect(submit).toBeEnabled({ timeout: 15_000 })
      await submit.click()

      // 1) generation completes
      await expect
        .poll(
          async () => {
            const body = (await page.locator('body').innerText().catch(() => '')) || ''
            return /\d+ of \d+ completed/i.test(body) && /Rate this generation/i.test(body)
          },
          { timeout: 240_000, intervals: [3_000] },
        )
        .toBe(true)

      // Give Sandpack time to compile + mount
      await page.waitForTimeout(10_000)

      // 2) NO error overlay anywhere (main doc or any frame)
      let errorSeen = ''
      for (const frame of page.frames()) {
        const txt = (await frame.locator('body').innerText().catch(() => '')) || ''
        // Detect EVERY preview error overlay: parse/syntax errors, React runtime
        // errors ("Element type is invalid", hook errors), the validation-error
        // panel, and generic Sandpack crash text.
        if (/Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely|try regenerating/i.test(txt)) {
          errorSeen = txt.replace(/\s+/g, ' ').slice(0, 200)
          break
        }
      }

      // 3) the preview must have mounted real content IN THE PREVIEW AREA — not
      // the surrounding app chrome (the chat panel always has buttons). Only
      // count interactive DOM inside the Sandpack/preview iframe.
      let renderedSignal = 0
      for (const frame of page.frames()) {
        const url = frame.url()
        const isPreviewFrame = /sandpack|codesandbox|\/preview\//i.test(url)
        if (!isPreviewFrame) continue
        const els = await frame
          .locator('button, input, a, h1, h2, h3, li, img, [role="button"], form, table')
          .count()
          .catch(() => 0)
        renderedSignal = Math.max(renderedSignal, els)
      }

      // Screenshot exactly what the user sees
      await page.screenshot({ path: `user-preview-${i + 1}.png`, fullPage: false }).catch(() => {})

      console.log(
        `[E2E] prompt ${i + 1}: error=${errorSeen ? 'YES(' + errorSeen + ')' : 'none'} | previewInteractiveEls=${renderedSignal}`,
      )

      // A working generation = NO error overlay AND real content in the preview frame.
      expect(errorSeen, `Preview showed an error overlay: ${errorSeen}`).toBe('')
      expect(
        renderedSignal,
        'Preview frame had no rendered content (blank/unmounted app)',
      ).toBeGreaterThan(0)
    })
  }
})
