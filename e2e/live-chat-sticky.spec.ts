/**
 * E2E tests for the Ask Cody chat rail's sticky positioning (#754).
 *
 * Real, direct user report: "make sure the chat column doesn't go below the
 * fold of the page, the user should be able to chat with Cody there, even if
 * the center column scrolls a lot more." A fullPage screenshot confirmed the
 * chat rail's `position: sticky` height (`calc(100vh - 24px)`, app/modernist.css)
 * assumed only ~24px of page chrome sits above `.m-live-grid`, when in reality
 * the masthead + funnel/provisioning banner + product card + hero metrics
 * total several hundred px — so the column overflowed the real viewport and
 * went unreachable as the founder scrolled the much-taller center column.
 *
 * These tests assert the chat input's REAL on-screen bounding-box position
 * after a real scroll — not just DOM presence, which would miss this whole
 * class of bug (the element was always in the DOM; it just rendered off-
 * screen/overflowing).
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

async function reachLiveDashboard(page: Page, company: string) {
  await page.goto(`${BASE_URL}/build?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="chat-attach"], [data-testid="systems-grid"]', { timeout: 60_000 }).catch(() => {})
}

/** Asserts the chat composer's Send button sits within the visible viewport
 *  bounds (not just present in the DOM, and not merely "some part visible" —
 *  its full box must be within [0, viewportHeight]). */
async function expectChatInputWithinViewport(page: Page) {
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()

  const chatInput = page.locator('.m-chat-input').first()
  await expect(chatInput).toBeVisible({ timeout: 15_000 })

  const box = await chatInput.boundingBox()
  expect(box).not.toBeNull()
  if (!box || !viewport) return

  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2) // +2px rounding slack
}

test.describe('Ask Cody chat rail stays on-screen while scrolling (#754)', () => {
  test('chat input bounding box stays within the viewport after scrolling the center column a realistic amount', async ({ page }) => {
    await reachLiveDashboard(page, 'e2e-chat-sticky')

    // Confirmed reachable at initial scroll position first — the pre-#754 bug
    // could ALSO overflow at scroll-top on tall banner states, but was most
    // reliably visible once the center column had genuinely scrolled.
    await expectChatInputWithinViewport(page)

    // Scroll the page down a realistic amount — the center column (Tasks &
    // Backlog, Website & Infrastructure, Build Ops, Documents, Growth, etc.)
    // is much taller than one viewport, exactly the case the user reported.
    await page.evaluate(() => window.scrollBy(0, 1200))
    await page.waitForTimeout(150) // let sticky positioning settle

    await expectChatInputWithinViewport(page)

    // Scroll further still, toward the bottom of the long center column.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(150)

    await expectChatInputWithinViewport(page)
  })

  test('the sticky chat column height genuinely accounts for real page chrome, not a fixed 24px assumption', async ({ page }) => {
    await reachLiveDashboard(page, 'e2e-chat-sticky-height')

    const chatCol = page.locator('.m-live-col-chat').first()
    await expect(chatCol).toBeVisible({ timeout: 15_000 })

    const isTablet = await page.evaluate(() => window.innerWidth <= 1024)
    test.skip(isTablet, 'sticky positioning is disabled on tablet/mobile by design (#754 preserves this)')

    const { headerHeightVar, chatColHeight, viewportHeight } = await page.evaluate(() => {
      const live = document.querySelector('.m-live') as HTMLElement | null
      const col = document.querySelector('.m-live-col-chat') as HTMLElement | null
      const varValue = live ? getComputedStyle(live).getPropertyValue('--live-header-h').trim() : ''
      return {
        headerHeightVar: varValue,
        chatColHeight: col ? col.getBoundingClientRect().height : 0,
        viewportHeight: window.innerHeight,
      }
    })

    // The measured header height must be a REAL, non-trivial value (the page
    // chrome above the grid is genuinely hundreds of px), not the unset/empty
    // fallback and not a token-24px-style guess.
    expect(headerHeightVar).toMatch(/^\d+px$/)
    const headerPx = parseInt(headerHeightVar, 10)
    expect(headerPx).toBeGreaterThan(100)

    // The chat column's rendered height must fit within the viewport once the
    // real header height is subtracted — proving the calc used the measured
    // value rather than a hardcoded 24px (which would render an overflowing,
    // too-tall column here).
    expect(chatColHeight).toBeLessThanOrEqual(viewportHeight - headerPx + 2)
  })
})
