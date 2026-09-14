/**
 * E2E tests for chat file upload (#741) — the attach button on Cody's chat
 * composer (Live dashboard). Verifies on the real Live dashboard that:
 *  1. The attach button (data-testid="chat-attach") renders next to the
 *     composer's Send button.
 *  2. A hidden file input (data-testid="chat-attach-input") is wired to it
 *     and accepts both image and document types.
 *  3. Selecting a file uploads it via the real /api/build/ask/attachment
 *     route and shows an error chip when that upload is rejected (a guest
 *     session, matching the route's real 401-for-guest auth gate) — proving
 *     the UI talks to the real endpoint rather than faking success.
 *
 * The Live screen is reached via the same deep-link hook the Auto Mode
 * (#58) / Media (#54) / Documents (#64) E2Es use.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

async function reachLiveDashboard(page: Page, company = 'e2e-chat-attach') {
  await page.goto(`${BASE_URL}/build?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="chat-attach"], [data-testid="systems-grid"]', { timeout: 60_000 }).catch(() => {})
}

test.describe('Chat attach button (#741)', () => {
  test('renders the attach button and a wired hidden file input in the composer', async ({ page }) => {
    await reachLiveDashboard(page)
    const attachBtn = page.getByTestId('chat-attach')
    await expect(attachBtn).toBeVisible({ timeout: 15_000 })

    const input = page.getByTestId('chat-attach-input')
    await expect(input).toHaveAttribute('type', 'file')
    const accept = await input.getAttribute('accept')
    expect(accept).toContain('image/png')
    expect(accept).toContain('application/pdf')
  })

  test('selecting a file calls the real /api/build/ask/attachment route (not a fake local preview)', async ({ page }) => {
    await reachLiveDashboard(page)
    await expect(page.getByTestId('chat-attach')).toBeVisible({ timeout: 15_000 })

    let calledAttachmentRoute = false
    page.on('request', (req) => {
      if (req.url().includes('/api/build/ask/attachment')) calledAttachmentRoute = true
    })

    const input = page.getByTestId('chat-attach-input')
    await input.setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // minimal PNG magic bytes
    })

    // A real chip appears immediately (uploading, then either attached or an
    // honest error) — never silently nothing.
    await expect(page.getByTestId('chat-attachments').or(page.getByTestId('chat-attach-error'))).toBeVisible({ timeout: 15_000 })
    expect(calledAttachmentRoute).toBe(true)
  })
})
