import { test, expect } from '@playwright/test'

/**
 * builder#64 regression — drive several real generations through the UI and
 * assert NONE produce a Sandpack syntax error ("Something went wrong" /
 * "already been declared"). The defect was intermittent (~25%), so we run a
 * handful of prompts prone to component-library imports.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  'Build a card-based analytics dashboard with several Card components, a header, and metric tiles.',
  'Build a pricing page with three pricing Cards, each with a title, price, and feature list.',
  'Build a settings panel using Card, CardHeader, CardTitle and CardContent with form fields.',
  'Build a product page with a Button that has outline and solid variants using conditional className styling.',
  'Build a user profile dashboard with Card components, tabs, and a variant-styled Button group.',
]

test.describe('codegen produces renderable output (#64)', () => {
  for (const [i, prompt] of PROMPTS.entries()) {
    test(`generation ${i + 1} renders without a syntax error`, async ({ page }) => {
      test.setTimeout(300_000)

      await page.goto(BASE, { waitUntil: 'domcontentloaded' })
      const textarea = page.getByPlaceholder('Describe your AINative application...')
      await expect(textarea).toBeVisible({ timeout: 30_000 })

      await textarea.click()
      await textarea.pressSequentially(prompt, { delay: 5 })

      const submit = page.locator('button[type="submit"]').last()
      await expect(submit).toBeEnabled({ timeout: 15_000 })
      await submit.click()

      // Wait for completion (Files N/N + rating UI)
      await expect
        .poll(
          async () => {
            const body = (await page.locator('body').innerText().catch(() => '')) || ''
            return /\d+ of \d+ completed/i.test(body) && /Rate this generation/i.test(body)
          },
          { timeout: 240_000, intervals: [3_000] },
        )
        .toBe(true)

      // Give Sandpack a moment to compile, then scan all frames for the error overlay.
      await page.waitForTimeout(8_000)
      let sawSyntaxError = false
      let errorText = ''
      for (const frame of page.frames()) {
        const txt = (await frame.locator('body').innerText().catch(() => '')) || ''
        if (/already been declared|Something went wrong|SyntaxError|Unexpected token/i.test(txt)) {
          sawSyntaxError = true
          errorText = txt.slice(0, 200)
          break
        }
      }

      console.log(
        `[E2E] gen ${i + 1}: ${sawSyntaxError ? '❌ SYNTAX ERROR: ' + errorText : '✅ rendered clean'}`,
      )
      expect(sawSyntaxError, `Generation ${i + 1} produced a Sandpack syntax error`).toBe(false)
    })
  }
})
