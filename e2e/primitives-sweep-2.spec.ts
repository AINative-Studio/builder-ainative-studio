import { test, expect } from '@playwright/test'

/**
 * AINative primitives sweep v2 — BROADER primitive coverage, SINGLE-WORKER
 * (no self-inflicted concurrent load, for a true quality read). Per directive:
 * exercise more AINative primitives from docs.ainative.studio and verify apps
 * that persist use the ZeroDB serverless layer.
 *
 * Runs on production (Claude Sonnet 4.5). Pass = completes, no error overlay,
 * real rendered content; graceful "Refining your app" = non-crash.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'

const PROMPTS = [
  // Vector search / embeddings (ZeroDB)
  'Build a semantic document search app: an upload/paste box, an embed-and-store button, and a similarity-ranked results list with scores — persist documents to a database.',
  // ZeroMemory recall + reflect
  'Build an agent memory console with a "remember" input, a semantic "recall" search over stored memories, importance sliders, and a reflect/consolidate button.',
  // Agent Cloud + observability
  'Build an agent observability dashboard with per-agent latency and error-rate charts, a live request stream, token-cost totals, and an alerts panel.',
  // ZeroCommerce
  'Build a ZeroCommerce storefront admin with a products table (add/edit persisted to a database), orders list with fulfillment status, and revenue metric cards.',
  // ZeroInvoice + persistence
  'Build a ZeroInvoice manager where I can create invoices that save to a database, see a paid/pending/overdue list, and view total outstanding.',
  // ZeroVoice / audio (multimodal)
  'Build a voice notes app: record button, a list of transcribed notes saved to a database, playback controls, and a search box.',
  // Event streaming
  'Build a real-time event stream monitor with a live feed of agent events, filter chips by event type, per-type counts, and a pause/resume toggle.',
  // Agent402 payments (Hedera)
  'Build an autonomous agent payments dashboard (Agent402 style) with a transactions table, per-agent spend limits, a balance card, and an approve-payment queue.',
  // MCP + tool calls
  'Build an MCP tool playground listing available tools with parameter forms, a run button, and a call-history log with request/response JSON.',
  // RLHF feedback loop
  'Build an RLHF feedback console showing model generations with thumbs up/down, a rating distribution chart, edit-diff viewer, and a training-data export button.',
  // Semantic recommendations
  'Build a content recommendation feed with semantically-ranked cards, relevance scores, like/save actions persisted to a database, and category filters.',
  // Multi-agent swarm dispatch (deeper)
  'Build a swarm task orchestrator: a SwarmView of specialized agents, a task queue, drag-to-assign, live AgentTimeline, and per-agent GuardrailPanel status.',
  // Knowledge graph (ZeroMemory relate/graph)
  'Build a knowledge graph explorer showing entities as nodes and relationships as edges, a node detail panel, and a search-to-highlight box.',
  // OpenCap equity + persistence
  'Build an OpenCap equity manager with a stakeholders table (add stakeholders saved to a database), an ownership pie chart, and a fully-diluted total card.',
]

const ERROR_RE =
  /Something went wrong|already been declared|is not defined|Unexpected token|Unterminated|SyntaxError|Failed to compile|Element type is invalid|Cannot read propert|Objects are not valid as a React child|Rendered (more|fewer) hooks|Code Validation Error|cannot be rendered safely/i

test.describe('AINative primitives sweep v2 (single-worker, Sonnet 4.5)', () => {
  for (const [i, prompt] of PROMPTS.entries()) {
    test(`p2 #${i + 1}: ${prompt.slice(0, 44)}`, async ({ page }) => {
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

      await page.screenshot({ path: `p2-${String(i + 1).padStart(2, '0')}.png` }).catch(() => {})
      const outcome = errorSeen ? 'ERROR' : gracefulFallback ? 'FALLBACK' : previewEls > 0 ? 'RENDERED' : 'BLANK'
      console.log(`[P2] #${i + 1} ${outcome} error="${errorSeen}" els=${previewEls} :: ${prompt.slice(0, 40)}`)

      expect(errorSeen, `error overlay: ${errorSeen}`).toBe('')
      expect(outcome !== 'BLANK', 'blank preview').toBe(true)
    })
  }
})
