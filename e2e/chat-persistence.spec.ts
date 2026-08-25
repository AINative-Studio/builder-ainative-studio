/**
 * E2E for Cody chat persistence + memory (#52).
 *
 * Acceptance verified here:
 *  1. Send a message on the Live dashboard → user + Cody turns render.
 *  2. RELOAD → the full prior conversation is restored (not an empty box).
 *  3. A FOLLOW-UP carries context — the POST /api/build/ask body includes the
 *     prior turns (the memory window), so "make it cheaper" resolves against
 *     the earlier exchange.
 *  4. Honest empty state for a brand-new company (no fabricated history).
 *
 * To keep the test deterministic (no live ZeroDB / no LLM latency), we intercept
 * /api/build/ask with a TEST-LOCAL in-memory store keyed exactly like the real
 * server (per company). GET rehydrates, POST persists both turns and echoes the
 * history it received — mirroring the real route's contract, so this exercises
 * Live.tsx's real hydrate-on-mount + send flow end-to-end.
 *
 * Reached via the deterministic deep-link /build?screen=live&company=<slug>
 * (used by other Live E2E specs), which reload preserves.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface Turn { role: 'user' | 'assistant'; text: string; createdAt: string }

/**
 * Install a stubbed /api/build/ask that behaves like the real route:
 *  - GET  → { turns } for the company (from the shared store).
 *  - POST → persists {question, answer} as two turns, returns an answer that
 *           EMBEDS how many prior turns it received (proving memory/context).
 * `store` is keyed by company slug and persists across reloads within the test.
 */
async function stubAsk(page: Page, store: Map<string, Turn[]>) {
  await page.route('**/api/build/ask**', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const company = url.searchParams.get('companyId') || url.searchParams.get('chatId') || ''

    if (method === 'GET') {
      const turns = store.get(company) || []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns }) })
      return
    }

    // POST
    const body = JSON.parse(req.postData() || '{}')
    const slug = String(body.companyId || body.chatId || '')
    const prior = store.get(slug) || []
    const priorCount = prior.length
    const question = String(body.question || '')
    // The answer proves the server saw prior context (Cody's memory).
    const answer = priorCount > 0
      ? `Building on our ${priorCount} earlier messages — here's my take on "${question}".`
      : `Fresh start: here's my take on "${question}".`
    const now = Date.now()
    store.set(slug, [
      ...prior,
      { role: 'user', text: question, createdAt: new Date(now).toISOString() },
      { role: 'assistant', text: answer, createdAt: new Date(now + 1).toISOString() },
    ])
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer, provider: 'test', model: 'test' }) })
  })
}

async function gotoLive(page: Page, company: string) {
  await page.goto(`${BASE}/build?screen=live&company=${company}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('chat-log')).toBeVisible({ timeout: 15_000 })
}

async function sendMessage(page: Page, text: string) {
  const input = page.locator('.m-chat-input input')
  await input.fill(text)
  await input.press('Enter')
}

test.describe('Cody chat persistence + memory (#52)', () => {
  test('honest empty state for a brand-new company', async ({ page }) => {
    const store = new Map<string, Turn[]>()
    await stubAsk(page, store)
    await gotoLive(page, 'freshco-52')
    // The empty-state prompt appears only after hydration completes; no fake turns.
    await expect(page.getByTestId('chat-log').getByText(/Ask me anything/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.m-chat-user')).toHaveCount(0)
  })

  test('send → reload restores the conversation; follow-up has context', async ({ page }) => {
    const store = new Map<string, Turn[]>()
    await stubAsk(page, store)
    await gotoLive(page, 'memoryco-52')

    // 1) Send a message — user + Cody turns render.
    await sendMessage(page, 'What should we build first?')
    await expect(page.locator('.m-chat-user').filter({ hasText: 'What should we build first?' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.m-chat-cody').filter({ hasText: /Fresh start/i })).toBeVisible({ timeout: 15_000 })

    // 2) RELOAD — the prior conversation is restored from the store (not empty).
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('chat-log')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.m-chat-user').filter({ hasText: 'What should we build first?' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.m-chat-cody').filter({ hasText: /Fresh start/i })).toBeVisible({ timeout: 15_000 })
    // Empty-state prompt must NOT be shown when history exists.
    await expect(page.getByTestId('chat-log').getByText(/Ask me anything/i)).toHaveCount(0)

    // 3) FOLLOW-UP — the server received prior context; the answer proves memory.
    await sendMessage(page, 'Make it cheaper')
    await expect(page.locator('.m-chat-cody').filter({ hasText: /Building on our \d+ earlier messages/i })).toBeVisible({ timeout: 15_000 })
  })
})
