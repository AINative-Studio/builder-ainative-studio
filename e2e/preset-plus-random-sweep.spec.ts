import { test, expect } from '@playwright/test'

/**
 * Sweep of ALL 8 landing-page preset buttons + 5 random prompts, run against
 * production now that real Claude Sonnet 4.5 is live (was silently gpt-oss-20b).
 * The presets are AIKit-heavy (SwarmView, AIKitTable, GuardrailPanel, etc.) — a
 * strong test of the AIKit component pipeline.
 *
 * Pass = generation completes, no error overlay, real rendered content.
 * Also classifies graceful-fallback ("Refining your app") as non-crash.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PRESET_PROMPTS = [
  'Build an AINative agent monitoring dashboard with SwarmView showing active agents, MetricCards with sparklines for token usage and success rates, AgentTimeline for execution traces, GuardrailPanel for safety rules, and ConnectionStatus indicators',
  'Build an AINative AI chat interface with ChatBubble messages, StreamingIndicator for typing state, CodeDisplay for code responses, a conversation sidebar, and agent-optimized semantic HTML structure',
  'Build an AINative SaaS landing page with hero section, feature cards with Lucide icons, pricing tiers using AIKitPriceCard, testimonials, and agent-readable structured data throughout',
  'Build an AINative multi-agent swarm operations center with SwarmView, multiple AgentCards showing status and tasks, TokenUsageBar for budget tracking, SafetyBadge trust scores, and real-time AgentTimeline',
  'Build an AINative e-commerce storefront with AIKitProductCard grid, AIKitRating reviews, AIKitBreadcrumb navigation, AIKitPagination, and AIKitBanner for promotions, optimized for agent-first browsing',
  'Build an AINative admin panel with AIKitSidebar navigation, AIKitTable with sortable data, MetricCards for KPIs, AIKitStepper for workflows, AIKitBreadcrumb, and role-based access indicators',
  'Build an AINative analytics dashboard with AIKitSidebar, MetricCards with sparklineData, Recharts AreaChart and BarChart visualizations, AIKitTable for data, and AIKitTimeline for events',
  'Build an AINative AI safety and compliance dashboard with GuardrailPanel showing pass/fail rules, SafetyBadge trust scores, AgentTimeline for audit trail, TokenUsageBar for consumption, and AIKitBanner alerts',
]

const RANDOM_PROMPTS = [
  'Build a habit tracker with a weekly grid, streak counter, and add-habit button.',
  'Build a job board with filterable listings, company logos, and an apply button.',
  'Build an expense splitter for a group trip with members, expenses, and who-owes-who.',
  'Build a real estate listing page with property cards, photos, price, beds/baths, and a map placeholder.',
  'Build a event ticket booking page with seat selection, ticket tiers, and a checkout summary.',
]

const ALL = [
  ...PRESET_PROMPTS.map((p, i) => ({ p, tag: `preset-${i + 1}` })),
  ...RANDOM_PROMPTS.map((p, i) => ({ p, tag: `random-${i + 1}` })),
]

const ERROR_RE =
  /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely/i

test.describe('preset + random sweep (Sonnet 4.5)', () => {
  for (const [i, { p, tag }] of ALL.entries()) {
    test(`${tag}: ${p.slice(0, 40)}`, async ({ page }) => {
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
      await textarea.pressSequentially(p, { delay: 2 })
      const submit = page.locator('button[type="submit"]').last()
      await expect(submit).toBeEnabled({ timeout: 15_000 })
      await submit.click()

      await expect
        .poll(
          async () => {
            const body = (await page.locator('body').innerText().catch(() => '')) || ''
            return /\d+ of \d+ completed/i.test(body) && /Rate this generation|Refining your app/i.test(body)
          },
          { timeout: 240_000, intervals: [3_000] },
        )
        .toBe(true)

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
          { timeout: 75_000, intervals: [2_500] },
        )
        .not.toBe('pending')

      await page.screenshot({ path: `psweep-${tag}.png` }).catch(() => {})
      const outcome = errorSeen ? 'ERROR' : gracefulFallback ? 'FALLBACK' : previewEls > 0 ? 'RENDERED' : 'BLANK'
      console.log(`[PSWEEP] ${tag} ${outcome} error="${errorSeen}" els=${previewEls} :: ${p.slice(0, 40)}`)

      expect(errorSeen, `error overlay: ${errorSeen}`).toBe('')
      expect(outcome !== 'BLANK', 'blank preview').toBe(true)
    })
  }
})
