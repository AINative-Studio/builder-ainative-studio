/**
 * E2E regression test for #760 — real user report, with screenshots, on a
 * live company ("Lumeo"): after Cody's reply arrived, the response text
 * visibly rendered bleeding UP INTO / partially behind the "WHAT CODY HAS
 * LEARNED" summary card above it, instead of appearing cleanly in the
 * scrollable log area below both summary cards ("SINCE YOU WERE LAST HERE"
 * and "WHAT CODY HAS LEARNED").
 *
 * This test reproduces the exact reported scenario: both summary cards
 * present (a returning founder with a real chat summary AND an accumulated
 * ZeroMemory company profile), then sends a message and asserts Cody's
 * response text's bounding box does not visually intersect either summary
 * card's bounding box once the reply has fully rendered — the assertion
 * that would have caught the original bug.
 *
 * Deterministic: /api/build/ask is stubbed (no live ZeroDB/LLM), mirroring
 * chat-persistence.spec.ts's pattern — GET returns turns + summary + profile
 * so both .m-chat-summary cards render on load, matching the reported case.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

async function stubAskWithSummaryAndProfile(page: Page) {
  const priorTurns = [
    { role: 'user', text: 'What should we focus on this week?', createdAt: new Date(Date.now() - 60_000).toISOString() },
    { role: 'assistant', text: 'Let\'s ship the onboarding flow first — it is the biggest drop-off point.', createdAt: new Date(Date.now() - 55_000).toISOString() },
  ]

  await page.route('**/api/build/ask**', async (route: Route) => {
    const req = route.request()
    const method = req.method()

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          turns: priorTurns,
          // "SINCE YOU WERE LAST HERE" card — real handoff summary (#608).
          summary: 'Last time, we agreed to prioritize the onboarding flow before the billing page.',
          // "WHAT CODY HAS LEARNED" card — real synthesized profile (#693).
          profile: {
            summary: 'Lumeo is an early-stage B2B SaaS founder who prefers concise, action-first updates.',
            preferences: ['Prefers short, direct answers', 'Wants weekly progress emails'],
            behaviors: ['Checks the dashboard most mornings'],
            facts: ['Company is pre-revenue', 'Targeting SMB logistics teams'],
          },
        }),
      })
      return
    }

    // POST — a deliberately LONG multi-sentence answer, the shape most likely
    // to visually collide with the summary cards above if the overlap bug
    // were still present (a short one-liner would be too small to ever
    // visibly reach the cards above, masking the regression).
    const body = JSON.parse(req.postData() || '{}')
    const question = String(body.question || '')
    const answer =
      `Here's my take on "${question}": I'd start by tightening the onboarding checklist, ` +
      `then wire the real usage funnel so we can see exactly where founders drop off. ` +
      `Once that's live, I'll layer in a lightweight nudge email for anyone stalled past ` +
      `48 hours, and we can revisit pricing once we have real activation data instead of guessing.`
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer, provider: 'test', model: 'test' }),
    })
  })
}

async function gotoLive(page: Page, company: string) {
  await page.goto(`${BASE_URL}/build?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20_000 })
  // The chat log sits inside a sticky column that can start below the fold on
  // a short viewport before any scrolling — scroll it into view first (chat-
  // persistence.spec.ts's viewport happens to already fit it; this test's
  // asserted bounding boxes need the element genuinely on-screen either way).
  await page.getByTestId('chat-log').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('chat-log')).toBeVisible({ timeout: 15_000 })
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test.describe('Cody chat response never overlaps the summary cards (#760)', () => {
  test('both summary cards render (reproducing the reported scenario) and Cody\'s reply bounding box does not intersect either', async ({ page }) => {
    // A realistic desktop viewport. The chat rail is `position: sticky` with
    // its height computed from the real viewport minus the measured page
    // header (#754) — the default Playwright viewport (1280x720) is short
    // enough that, with BOTH summary cards present (this test's whole point),
    // the log's flex-allocated space can shrink to ~0px, which would make
    // this test's own assertions meaningless (nothing to measure) rather
    // than exercising the real reported scenario on a normal desktop screen.
    await page.setViewportSize({ width: 1440, height: 1000 })
    await stubAskWithSummaryAndProfile(page)
    await gotoLive(page, 'e2e-chat-overlap-760')

    // Confirm the reported scenario is actually reproduced: BOTH summary cards
    // present at once, exactly like the real "Lumeo" screenshots.
    const sinceCard = page.getByTestId('chat-summary')
    const learnedCard = page.getByTestId('company-profile')
    await expect(sinceCard).toBeVisible({ timeout: 15_000 })
    await expect(learnedCard).toBeVisible({ timeout: 15_000 })

    // Send a real message — triggers the "thinking…" placeholder, then the
    // real reply, exactly the moment the original bug appeared ("specifically
    // right when a response arrives").
    const input = page.getByPlaceholder('Message Cody…')
    await input.fill('What should we build next?')
    await input.press('Enter')

    // Wait for the reply to actually land (not just the placeholder).
    const replyLocator = page.locator('[data-testid^="chat-cody-message-"]').filter({ hasText: /tightening the onboarding checklist/i })
    await expect(replyLocator.last()).toBeVisible({ timeout: 15_000 })

    // Let layout/paint fully settle — the original bug was specifically a
    // rendering-timing race right as the reply replaced the placeholder.
    await page.waitForTimeout(300)

    const sinceBox = await sinceCard.boundingBox()
    const learnedBox = await learnedCard.boundingBox()
    const replyBox = await replyLocator.last().boundingBox()

    expect(sinceBox).not.toBeNull()
    expect(learnedBox).not.toBeNull()
    expect(replyBox).not.toBeNull()
    if (!sinceBox || !learnedBox || !replyBox) return

    expect(intersects(replyBox, sinceBox)).toBe(false)
    expect(intersects(replyBox, learnedBox)).toBe(false)

    // Additionally: the reply must render BELOW both cards (top edge at or
    // past their bottom edge) — the exact geometric relationship the report
    // says was violated ("bleeding UP INTO" the card above).
    expect(replyBox.y).toBeGreaterThanOrEqual(sinceBox.y + sinceBox.height - 1)
    expect(replyBox.y).toBeGreaterThanOrEqual(learnedBox.y + learnedBox.height - 1)
  })
})
