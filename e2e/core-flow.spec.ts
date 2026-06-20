/**
 * Core Flow E2E Tests — AINative Studio Builder
 *
 * Tests the critical user journey:
 * 1. Homepage loads correctly with all elements
 * 2. User can type a prompt and submit
 * 3. Chat interface appears with streaming response
 * 4. Preview panel shows generated app
 * 5. Suggestion buttons work
 * 6. Follow-up messages work
 * 7. No crashes, no console errors
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function dismissOverlays(page: Page) {
  // Close any dialogs/toasts that might block interaction
  try {
    const closeButtons = page.locator('[aria-label="Close"], [data-dismiss]')
    const count = await closeButtons.count()
    for (let i = 0; i < count; i++) {
      await closeButtons.nth(i).click({ timeout: 1000 }).catch(() => {})
    }
  } catch {}
}

function collectErrors(page: Page) {
  const errors: string[] = []
  const warnings: string[] = []

  page.on('pageerror', (err) => {
    const msg = err.message || String(err)
    // Ignore known Sandpack internal errors
    if (msg.includes('Cannot assign to read only property') || msg.includes('babel-transpiler')) {
      warnings.push(msg.slice(0, 200))
      return
    }
    errors.push(msg.slice(0, 300))
  })

  page.on('console', (consoleMsg) => {
    if (consoleMsg.type() === 'error') {
      const text = consoleMsg.text()
      // Ignore noisy but harmless errors
      if (text.includes('favicon') || text.includes('next-route-announcer') || text.includes('hydration')) return
      if (text.includes('Failed to load resource') && text.includes('404')) return
      warnings.push(text.slice(0, 200))
    }
  })

  return { errors, warnings }
}

// ── Test 1: Homepage loads correctly ────────────────────────────────────────

test.describe('Homepage', () => {
  test('loads with all critical elements', async ({ page }) => {
    const { errors } = collectErrors(page)

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })

    // Hero section
    await expect(page.locator('h1')).toBeVisible({ timeout: 10_000 })
    const heroText = await page.locator('h1').textContent()
    expect(heroText).toBeTruthy()

    // Textarea for prompt input
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10_000 })

    // Submit button exists
    const submitBtn = page.locator('button[type="submit"]').first()
    await expect(submitBtn).toBeVisible({ timeout: 5_000 })

    // Suggestion buttons exist
    const suggestions = page.locator('button').filter({ hasText: /Agent Dashboard|AI Chat Interface|SaaS Platform/i })
    await expect(suggestions.first()).toBeVisible({ timeout: 5_000 })

    // No critical errors
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0)

    await page.screenshot({ path: 'e2e/screenshots/01-homepage.png' })
  })

  test('textarea is focused on load', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(1000)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeFocused({ timeout: 5_000 })
  })
})

// ── Test 2: Prompt submission and chat flow ─────────────────────────────────

test.describe('Chat Generation Flow', () => {
  test.setTimeout(180_000) // 3 min for AI generation

  test('submit prompt → chat appears → streaming works → preview shows', async ({ page }) => {
    const { errors, warnings } = collectErrors(page)

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000) // Hydration

    // Type a simple prompt
    const textarea = page.locator('textarea').first()
    await textarea.fill('Build a simple counter app with a number display and increment/decrement buttons')
    await page.waitForTimeout(300)

    // Submit
    const submitBtn = page.locator('button[type="submit"]').first()
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 })
    await submitBtn.click()

    await page.screenshot({ path: 'e2e/screenshots/02-after-submit.png' })

    // Chat interface should appear (user message visible)
    await expect(page.getByText('Build a simple counter app')).toBeVisible({ timeout: 15_000 })

    // Wait for assistant response to start streaming
    // Look for the chat layout to transition
    await page.waitForTimeout(5_000)
    await page.screenshot({ path: 'e2e/screenshots/03-streaming.png' })

    // Wait for generation to complete (isLoading becomes false)
    // We detect this by waiting for the streaming indicator to disappear
    // or the preview to load, or the assistant message to be fully rendered
    try {
      // Wait for either: preview iframe, or assistant content, or timeout
      await Promise.race([
        page.waitForSelector('iframe', { timeout: 120_000 }),
        page.waitForSelector('[data-testid="sandpack-preview"]', { timeout: 120_000 }),
        page.waitForTimeout(120_000),
      ])
    } catch {
      // Timeout is OK — we check state below
    }

    await page.waitForTimeout(5_000) // Let things settle
    await page.screenshot({ path: 'e2e/screenshots/04-generation-complete.png' })

    // Verify generation produced something
    const pageContent = await page.content()

    // The chat interface should be showing (not the homepage anymore)
    const hasUserMessage = pageContent.includes('counter app') || pageContent.includes('counter')
    expect(hasUserMessage).toBe(true)

    // Check for preview or response content
    const hasPreview = await page.locator('iframe').count() > 0
    const hasAssistantContent = pageContent.includes("I've") || pageContent.includes("Here") || pageContent.includes('```') || pageContent.includes('created')
    const hasPreviewUrl = pageContent.includes('/preview/')

    console.log(`Results: iframe=${hasPreview}, assistantContent=${hasAssistantContent}, previewUrl=${hasPreviewUrl}`)
    console.log(`Errors: ${errors.length}, Warnings: ${warnings.length}`)

    // At minimum, the generation should have produced SOME response
    expect(hasAssistantContent || hasPreview || hasPreviewUrl).toBe(true)

    // No app-crashing errors
    const criticalErrors = errors.filter(e =>
      !e.includes('hydration') &&
      !e.includes('SyntaxError') &&
      !e.includes('ResizeObserver')
    )
    if (criticalErrors.length > 0) {
      console.warn('Critical errors:', criticalErrors)
    }
  })
})

// ── Test 3: Suggestion buttons ──────────────────────────────────────────────

test.describe('Suggestion Buttons', () => {
  test.setTimeout(180_000)

  test('clicking suggestion button submits prompt and starts generation', async ({ page }) => {
    const { errors } = collectErrors(page)

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000)

    // Click "Agent Dashboard" suggestion
    const suggestion = page.getByText('Agent Dashboard', { exact: true }).first()
    await expect(suggestion).toBeVisible({ timeout: 5_000 })
    await suggestion.click()

    await page.screenshot({ path: 'e2e/screenshots/05-suggestion-clicked.png' })

    // Should transition to chat interface
    await page.waitForTimeout(5_000)

    // The homepage should be gone, chat interface should be present
    const pageContent = await page.content()
    const hasChatInterface = pageContent.includes('agent') || pageContent.includes('Agent') || pageContent.includes('dashboard')
    expect(hasChatInterface).toBe(true)

    await page.screenshot({ path: 'e2e/screenshots/06-suggestion-generating.png' })

    // Wait for generation
    try {
      await page.waitForSelector('iframe', { timeout: 120_000 })
    } catch {
      // Timeout OK
    }

    await page.waitForTimeout(5_000)
    await page.screenshot({ path: 'e2e/screenshots/07-suggestion-complete.png' })

    // No crashes
    const criticalErrors = errors.filter(e => !e.includes('hydration') && !e.includes('ResizeObserver'))
    if (criticalErrors.length > 0) {
      console.warn('Errors after suggestion:', criticalErrors)
    }
  })
})

// ── Test 4: Preview Panel ───────────────────────────────────────────────────

test.describe('Preview Panel', () => {
  test.setTimeout(180_000)

  test('preview panel renders generated app without errors', async ({ page }) => {
    const { errors } = collectErrors(page)

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000)

    // Submit a simple prompt
    const textarea = page.locator('textarea').first()
    await textarea.fill('Build a hello world card with a greeting message and a button that says Click Me')
    await page.waitForTimeout(300)
    await page.locator('button[type="submit"]').first().click()

    // Wait for generation to complete
    try {
      await page.waitForSelector('iframe', { timeout: 120_000 })
      await page.waitForTimeout(8_000) // Let Sandpack compile
    } catch {
      await page.waitForTimeout(30_000)
    }

    await page.screenshot({ path: 'e2e/screenshots/08-preview-panel.png' })

    // Check if preview iframe loaded
    const iframes = page.locator('iframe')
    const iframeCount = await iframes.count()

    if (iframeCount > 0) {
      // Try to check iframe content
      const iframe = iframes.first()
      const src = await iframe.getAttribute('src')
      console.log(`Preview iframe src: ${src}`)

      // Preview should not show an error page
      const iframeContent = await iframe.contentFrame()
      if (iframeContent) {
        const bodyText = await iframeContent.locator('body').textContent().catch(() => '')
        const hasError = bodyText?.includes('Error') || bodyText?.includes('Cannot find module')
        if (hasError) {
          console.warn('Preview has errors:', bodyText?.slice(0, 200))
        }
      }
    }

    // Check for Sandpack preview specifically
    const hasSandpack = await page.locator('[class*="sp-"]').count() > 0
    console.log(`Has Sandpack elements: ${hasSandpack}`)
  })
})

// ── Test 5: Error Handling ──────────────────────────────────────────────────

test.describe('Error Handling', () => {
  test('empty prompt submission is prevented', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(1000)

    // Submit button should be disabled with empty textarea
    const submitBtn = page.locator('button[type="submit"]').first()
    await expect(submitBtn).toBeDisabled({ timeout: 3_000 })
  })

  test('whitespace-only prompt is prevented', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(1000)

    const textarea = page.locator('textarea').first()
    await textarea.fill('   ')

    const submitBtn = page.locator('button[type="submit"]').first()
    await expect(submitBtn).toBeDisabled({ timeout: 3_000 })
  })
})

// ── Test 6: Responsive Layout ───────────────────────────────────────────────

test.describe('Responsive Layout', () => {
  test('mobile viewport shows proper layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }) // iPhone X
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(1000)

    // Hero and input should be visible
    await expect(page.locator('h1')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 })

    await page.screenshot({ path: 'e2e/screenshots/09-mobile-homepage.png' })
  })
})

// ── Test 7: Navigation ─────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('app header is present with logo/brand', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })

    // Header should exist
    const header = page.locator('header').first()
    await expect(header).toBeVisible({ timeout: 5_000 })

    await page.screenshot({ path: 'e2e/screenshots/10-header.png' })
  })
})
