import { test, expect } from '@playwright/test'

/**
 * Authoritative pass-rate sweep — CORRECTED methodology.
 *
 * Prior sweeps false-positived "RENDERED" because the poll returned as soon as
 * ANY frame had elements, matching the outer builder chrome. This spec:
 *   - waits for terminal state, then a 20s settle for slow Sandpack boots
 *   - inspects the PREVIEW IFRAME specifically (sandpack/preview URL)
 *   - classifies FALLBACK ("Refining your app") and ERROR (crash overlay) as
 *     NON-render; only real iframe content counts as RENDERED
 *   - screenshots every run so results can be pixel-verified, never trusting
 *     the automated tally alone.
 *
 * Covers the 8 real landing-page presets + 8 varied primitive/data apps.
 * Runs on production (Claude Sonnet 4.5, cody disabled).
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PRESETS: [string, string][] = [
  ['preset-monitor', 'Build an AINative agent monitoring dashboard with SwarmView showing active agents, MetricCards with sparklines for token usage and success rates, AgentTimeline for execution traces, GuardrailPanel for safety rules, and ConnectionStatus indicators'],
  ['preset-chat', 'Build an AINative AI chat interface with ChatBubble messages, StreamingIndicator for typing state, CodeDisplay for code responses, a conversation sidebar, and agent-optimized semantic HTML structure'],
  ['preset-landing', 'Build an AINative SaaS landing page with hero section, feature cards with Lucide icons, pricing tiers using AIKitPriceCard, testimonials, and agent-readable structured data throughout'],
  ['preset-swarm', 'Build an AINative multi-agent swarm operations center with SwarmView, multiple AgentCards showing status and tasks, TokenUsageBar for budget tracking, SafetyBadge trust scores, and real-time AgentTimeline'],
  ['preset-ecom', 'Build an AINative e-commerce storefront with AIKitProductCard grid, AIKitRating reviews, AIKitBreadcrumb navigation, AIKitPagination, and AIKitBanner for promotions, optimized for agent-first browsing'],
  ['preset-admin', 'Build an AINative admin panel with AIKitSidebar navigation, AIKitTable with sortable data, MetricCards for KPIs, AIKitStepper for workflows, AIKitBreadcrumb, and role-based access indicators'],
  ['preset-analytics', 'Build an AINative analytics dashboard with AIKitSidebar, MetricCards with sparklineData, Recharts AreaChart and BarChart visualizations, AIKitTable for data, and AIKitTimeline for events'],
  ['preset-safety', 'Build an AINative AI safety and compliance dashboard with GuardrailPanel showing pass/fail rules, SafetyBadge trust scores, AgentTimeline for audit trail, TokenUsageBar for consumption, and AIKitBanner alerts'],
]

const VARIED: [string, string][] = [
  ['var-invoice', 'Build a ZeroInvoice manager where I can create invoices that save to a database, see a paid/pending/overdue list, and view total outstanding.'],
  ['var-feed', 'Build a content recommendation feed with semantically-ranked cards, relevance scores, like/save actions persisted to a database, and category filters.'],
  ['var-kg', 'Build a knowledge graph explorer showing entities as nodes and relationships as edges, a node detail panel, and a search-to-highlight box.'],
  ['var-memory', 'Build a ZeroMemory inspector showing working, episodic, and semantic memory tiers as columns, with importance/decay scores and a consolidation timeline.'],
  ['var-habit', 'Build a habit tracker with a weekly grid, streak counter, and add-habit button that persists habits to a database.'],
  ['var-crm', 'Build a ZeroPipeline CRM with a deal pipeline kanban by stage, deal cards with value and score, a contacts sidebar, and pipeline value totals.'],
  ['var-opencap', 'Build an OpenCap equity manager with a stakeholders table, an ownership pie chart, and a fully-diluted total card.'],
  ['var-transcribe', 'Build an audio transcription studio with a file upload area, a live transcript panel, speaker labels, and a translate-to-language dropdown.'],
]

const ALL = [...PRESETS, ...VARIED]

const FALLBACK_RE = /Refining your app|needs another pass to render cleanly/i
const ERROR_RE = /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely/i

test.describe('authoritative sweep (pixel-truth, Sonnet 4.5)', () => {
  for (const [tag, prompt] of ALL) {
    test(`${tag}: ${prompt.slice(0, 36)}`, async ({ page }) => {
      test.setTimeout(320_000)

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

      // Wait for terminal state WITHOUT hard-throwing on timeout — a slow
      // generation should be recorded as TIMEOUT, not abort the batch.
      let completed = false
      try {
        await expect
          .poll(
            async () => {
              const body = (await page.locator('body').innerText().catch(() => '')) || ''
              return /\d+ of \d+ completed/i.test(body) && /Rate this generation|Refining your app/i.test(body)
            },
            { timeout: 240_000, intervals: [3_000] },
          )
          .toBe(true)
        completed = true
      } catch {
        completed = false
      }

      // Settle for slow Sandpack boots ([3/3] Starting) before snapshotting.
      await page.waitForTimeout(completed ? 20_000 : 3_000)

      const mainBody = (await page.locator('body').innerText().catch(() => '')) || ''
      const isFallback = FALLBACK_RE.test(mainBody)

      let iframeText = ''
      let iframeEls = 0
      for (const frame of page.frames()) {
        if (/sandpack|codesandbox|\/preview\//i.test(frame.url())) {
          iframeText = (await frame.locator('body').innerText().catch(() => '')) || ''
          iframeEls = Math.max(iframeEls, await frame.locator('button, input, a, h1, h2, h3, li, img, form, table, svg').count().catch(() => 0))
        }
      }
      // Capture ONLY the matched crash phrase (not a chrome-prefixed slice), and
      // prefer the iframe. The builder chrome ("Skip to main content …") must
      // never register as an error.
      const matchIn = (t: string) => {
        const m = t.match(ERROR_RE)
        return m ? m[0] : ''
      }
      const errorSeen = matchIn(iframeText) || matchIn(mainBody)

      await page.screenshot({ path: `authsweep-${tag}.png` }).catch(() => {})
      const outcome = !completed ? 'TIMEOUT' : errorSeen ? 'ERROR' : isFallback ? 'FALLBACK' : iframeEls > 2 ? 'RENDERED' : 'SPARSE'
      console.log(`[AUTH] ${tag} ${outcome} iframeEls=${iframeEls} error="${errorSeen}" :: ${prompt.slice(0, 34)}`)

      // Record-only: the [AUTH] log + screenshots are the measurement, so one
      // bad app never aborts the batch. Every app reaches the log line.
      expect(true).toBe(true)
    })
  }
})
