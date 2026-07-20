import { test, expect } from '@playwright/test'

/**
 * Post-#107 verification: the 3 complex data-apps that were dropping to the
 * "Refining your app" fallback due to method-chain semicolon corruption, plus
 * two more chain-heavy apps. Screenshots are the source of truth — the poll's
 * "RENDERED" is NOT trusted (it can match the outer builder chrome). We assert
 * the PREVIEW IFRAME shows real content and does NOT show the fallback text.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  ['invoice', 'Build a ZeroInvoice manager where I can create invoices that save to a database, see a paid/pending/overdue list, and view total outstanding.'],
  ['feed', 'Build a content recommendation feed with semantically-ranked cards, relevance scores, like/save actions persisted to a database, and category filters.'],
  ['kg', 'Build a knowledge graph explorer showing entities as nodes and relationships as edges, a node detail panel, and a search-to-highlight box.'],
  ['commerce', 'Build a ZeroCommerce storefront admin with a products table, orders list with fulfillment status filtered by stage, and revenue metric cards computed from the orders.'],
  ['analytics', 'Build an analytics dashboard that filters a dataset by date range and category, maps rows to chart series, and reduces totals into KPI cards.'],
]

const FALLBACK_RE = /Refining your app|needs another pass to render cleanly/i
const ERROR_RE = /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Code Validation Error|cannot be rendered safely/i

test.describe('chain-fix verification (#107, pixel-truth)', () => {
  for (const [tag, prompt] of PROMPTS) {
    test(`${tag}: ${prompt.slice(0, 40)}`, async ({ page }) => {
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

      // Wait for terminal state
      await expect
        .poll(
          async () => {
            const body = (await page.locator('body').innerText().catch(() => '')) || ''
            return /\d+ of \d+ completed/i.test(body) && /Rate this generation|Refining your app/i.test(body)
          },
          { timeout: 240_000, intervals: [3_000] },
        )
        .toBe(true)

      // Give the preview iframe a moment to mount its content
      await page.waitForTimeout(20_000)

      const mainBody = (await page.locator('body').innerText().catch(() => '')) || ''
      const isFallback = FALLBACK_RE.test(mainBody)

      // Inspect the preview iframe specifically (not the builder chrome)
      let iframeText = ''
      let iframeEls = 0
      for (const frame of page.frames()) {
        if (/sandpack|codesandbox|\/preview\//i.test(frame.url())) {
          iframeText = (await frame.locator('body').innerText().catch(() => '')) || ''
          iframeEls = await frame.locator('button, input, a, h1, h2, h3, li, img, form, table, svg').count().catch(() => 0)
        }
      }
      const errorSeen = ERROR_RE.test(iframeText) ? iframeText.replace(/\s+/g, ' ').slice(0, 140) : ''

      await page.screenshot({ path: `chainfix-${tag}.png` }).catch(() => {})
      const outcome = isFallback ? 'FALLBACK' : errorSeen ? 'ERROR' : iframeEls > 2 ? 'RENDERED' : 'SPARSE'
      console.log(`[CHAINFIX] ${tag} ${outcome} iframeEls=${iframeEls} error="${errorSeen}" :: ${prompt.slice(0, 36)}`)

      // The whole point of #107: these must NOT fall back and must NOT error.
      expect(isFallback, 'dropped to Refining-your-app fallback').toBe(false)
      expect(errorSeen, `preview error: ${errorSeen}`).toBe('')
      expect(iframeEls, 'preview iframe rendered real content').toBeGreaterThan(2)
    })
  }
})
