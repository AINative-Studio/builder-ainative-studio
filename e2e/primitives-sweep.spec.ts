import { test, expect } from '@playwright/test'

/**
 * AINative primitives sweep. Random prompts that ask for apps INTEGRATING the
 * real AINative primitives (per docs.ainative.studio): ZeroDB, ZeroMemory,
 * AIKit components, the Agent Framework / swarms, semantic search, multimodal,
 * A2UI, and the Zero* business APIs (ZeroInvoice/Commerce/Pipeline, OpenCap).
 *
 * This tests whether the builder can generate apps that surface AINative's own
 * capabilities — the product's core differentiator vs generic v0/Lovable output.
 *
 * Runs on production (real Sonnet 4.5). Pass = completes, no error overlay, real
 * rendered content; graceful "Refining your app" is a non-crash.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  // ZeroDB — persistent knowledge layer
  'Build a ZeroDB explorer dashboard that lists tables, shows row counts, and has a vector-search box with results ranked by similarity score.',
  // ZeroMemory — cognitive memory
  'Build a ZeroMemory inspector showing an agent\'s working, episodic, and semantic memory tiers as columns, with importance/decay scores and a consolidation timeline.',
  // AIKit streaming chat
  'Build an AIKit-powered agent chat using StreamingMessage, StreamingIndicator, and CodeBlock, with a token-usage meter and a safety/guardrail status badge.',
  // Agent Framework / multi-agent swarm
  'Build a multi-agent swarm control panel with a SwarmView of agents, per-agent status/task cards, a live AgentTimeline of tool calls, and a dispatch-task input.',
  // Semantic search & discovery
  'Build a semantic search interface that searches across agents, content, and events, with relevance scores, filter chips by type, and recommended results.',
  // Agent Cloud — registry + observability
  'Build an Agent Cloud registry dashboard listing deployed agents with health, replica count, OAuth scopes, request rate charts, and a deploy-new-agent button.',
  // ZeroInvoice
  'Build a ZeroInvoice dashboard with an invoice list, status badges (paid/pending/overdue), a create-invoice form, and total revenue and outstanding metric cards.',
  // ZeroPipeline (CRM)
  'Build a ZeroPipeline CRM with a deal pipeline kanban by stage, deal cards with value and score, a contacts sidebar, and pipeline value totals.',
  // Multimodal / audio
  'Build an audio transcription studio with a file upload area, a live transcript panel, speaker labels, and a translate-to-language dropdown.',
  // A2UI / agent-generated UI
  'Build an A2UI live-interface preview panel that shows an agent streaming a UI spec on the left and the rendered live interface on the right, with a JSON inspector.',
  // MCP servers
  'Build an MCP server console listing connected servers (ZeroDB, Memory, Design System) with their tool counts, a tool-call log, and a test-tool input form.',
  // OpenCap Stack
  'Build an OpenCap cap-table viewer with a stakeholders table, ownership pie chart, a share-class breakdown, and a fully-diluted total.',
]

const ERROR_RE =
  /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely/i

test.describe('AINative primitives sweep (Sonnet 4.5)', () => {
  for (const [i, prompt] of PROMPTS.entries()) {
    test(`prim #${i + 1}: ${prompt.slice(0, 44)}`, async ({ page }) => {
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

      await page.screenshot({ path: `prim-${String(i + 1).padStart(2, '0')}.png` }).catch(() => {})
      const outcome = errorSeen ? 'ERROR' : gracefulFallback ? 'FALLBACK' : previewEls > 0 ? 'RENDERED' : 'BLANK'
      console.log(`[PRIM] #${i + 1} ${outcome} error="${errorSeen}" els=${previewEls} :: ${prompt.slice(0, 40)}`)

      expect(errorSeen, `error overlay: ${errorSeen}`).toBe('')
      expect(outcome !== 'BLANK', 'blank preview').toBe(true)
    })
  }
})
