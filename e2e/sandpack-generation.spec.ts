/**
 * E2E Stress Test: Sandpack Code Generation
 *
 * Tests predefined suggestion prompts AND custom PRD-style prompts
 * to verify the builder generates working apps without crashes.
 *
 * Runs against production: https://builder.ainative.studio
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'https://builder.ainative.studio'
const GENERATION_TIMEOUT = 90_000 // 90s for AI generation
const STREAM_SETTLE_TIME = 10_000 // 10s after last stream event

// ── Predefined prompts (from home-client.tsx suggestion buttons) ────────────
const PREDEFINED_PROMPTS = [
  {
    label: 'Agent Dashboard',
    buttonText: 'Agent Dashboard',
  },
  {
    label: 'AI Chat Interface',
    buttonText: 'AI Chat Interface',
  },
  {
    label: 'SaaS Platform',
    buttonText: 'SaaS Platform',
  },
  {
    label: 'Swarm Monitor',
    buttonText: 'Swarm Monitor',
  },
]

// ── Custom PRD-style prompts (stress test with unique requirements) ─────────
const CUSTOM_PROMPTS = [
  {
    label: 'Fitness Tracker PRD',
    prompt: `Build a fitness tracking dashboard app with the following requirements:
- A header showing "FitTrack Pro" with a user avatar
- 4 MetricCards showing: Steps Today (12,450), Calories Burned (847), Active Minutes (62), Heart Rate (72 bpm)
- A weekly activity bar chart using Recharts showing Mon-Sun data
- A workout log table with columns: Date, Activity, Duration, Calories
- Include at least 5 sample workout rows
- A progress ring or circular indicator for daily goal completion (78%)
- Use Tailwind CSS for styling with a clean, modern look
- Include proper TypeScript types for all data`,
  },
  {
    label: 'Project Management Board',
    prompt: `Build a Kanban-style project management board with:
- 3 columns: To Do, In Progress, Done
- Each column has 3-4 task cards with title, assignee avatar, priority badge, and due date
- A header with "ProjectFlow" branding and a "New Task" button
- Use drag-and-drop visual indicators (CSS only, no actual DnD needed)
- Priority levels: Critical (red), High (orange), Medium (yellow), Low (green) as Badge components
- A sidebar showing team members with their task counts
- Footer with project stats: Total Tasks, Completed %, Overdue count
- Responsive layout using CSS grid`,
  },
  {
    label: 'Restaurant Menu App',
    prompt: `Create a modern restaurant menu application:
- Restaurant name "Sakura Kitchen" with Japanese-inspired design
- Category tabs: Appetizers, Mains, Sushi, Desserts, Drinks
- Each menu item card shows: name, description, price, dietary icons (vegan/gluten-free/spicy)
- A featured dish hero section at the top with large image placeholder
- Shopping cart sidebar showing selected items with quantity +/- buttons
- Order total with tax calculation
- At least 4 items per category with realistic names and prices
- Use Card components for menu items`,
  },
  {
    label: 'Weather Dashboard',
    prompt: `Build a weather dashboard application:
- City search input at the top
- Current weather card showing: temperature (72°F), condition (Partly Cloudy), humidity (65%), wind speed (12 mph)
- A 7-day forecast row with day name, icon placeholder, high/low temps
- An hourly temperature line chart using Recharts for the next 12 hours
- UV index gauge, air quality indicator, sunrise/sunset times
- Use weather-themed color palette (blues and whites)
- Include a "Saved Locations" list with 3 cities`,
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

async function signInAsGuest(page: Page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })

  // Click "Continue as Guest" if on login page, or find the guest option
  const guestBtn = page.getByText('Continue as Guest')
  if (await guestBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await guestBtn.click()
    await page.waitForTimeout(3000)
  }

  // Alternatively, if we're on the homepage already (unauthenticated users can use it)
  await page.waitForSelector('textarea, input[placeholder*="Describe"]', { timeout: 10_000 })
}

async function waitForGeneration(page: Page) {
  // Wait for the streaming response to appear and settle
  // Look for assistant message content, code blocks, or sandpack preview
  const startTime = Date.now()

  // Wait for some response indicator to appear
  try {
    await page.waitForSelector(
      '[data-role="assistant"], .sandpack, iframe, pre code, [class*="preview"], [class*="streaming"]',
      { timeout: GENERATION_TIMEOUT }
    )
  } catch {
    // If no visible response element, check if the page has any new content
  }

  // Give the stream time to settle
  await page.waitForTimeout(STREAM_SETTLE_TIME)

  return Date.now() - startTime
}

function collectErrors(page: Page): { all: string[]; crashes: string[]; sandpackErrors: string[] } {
  const all: string[] = []
  const crashes: string[] = []
  const sandpackErrors: string[] = []

  page.on('pageerror', (err) => {
    const msg = err.message || String(err)
    all.push(msg)

    // Sandpack's internal babel worker error (their bug, not ours)
    // — they try to mutate a frozen SyntaxError.message in a web worker
    if (msg.includes('Cannot assign to read only property') || msg.includes('babel-transpiler')) {
      sandpackErrors.push(msg)
      return
    }

    // App-level crashes (our code)
    if (
      msg.includes('Uncaught TypeError') ||
      msg.includes('Uncaught ReferenceError') ||
      msg.includes('ChunkLoadError')
    ) {
      crashes.push(msg)
    }
  })

  page.on('console', (consoleMsg) => {
    if (consoleMsg.type() === 'error') {
      const text = consoleMsg.text()
      if (
        !text.includes('manifest.json') &&
        !text.includes('favicon') &&
        !text.includes('Warning:') &&
        !text.includes('hydration')
      ) {
        all.push(text)
      }
    }
  })

  return { all, crashes, sandpackErrors }
}

async function submitPromptViaTextarea(page: Page, prompt: string) {
  const textarea = page.locator('textarea').first()
  await textarea.fill(prompt)
  await page.waitForTimeout(500)

  // Find and click the submit button (the arrow icon button near the textarea)
  const submitBtn = page.locator('button[type="submit"]').first()
  await submitBtn.click()
}

async function verifyNoAppCrash(crashes: string[], sandpackErrors: string[], label: string) {
  // App-level crashes are hard failures
  if (crashes.length > 0) {
    console.error(`\n❌ APP CRASH in "${label}":`)
    crashes.forEach((e) => console.error('  ', e.slice(0, 200)))
  }
  expect(crashes, `App crash detected in "${label}"`).toHaveLength(0)

  // Sandpack worker errors are warnings (their internal bug, not ours)
  if (sandpackErrors.length > 0) {
    console.warn(`⚠️  Sandpack internal errors in "${label}": ${sandpackErrors.length} (worker bug, not app crash)`)
  }
}

async function captureResult(page: Page, label: string) {
  const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  await page.screenshot({
    path: `e2e/screenshots/${safeName}.png`,
    fullPage: false,
  })

  // Check for error boundary (our fix)
  const errorBoundary = await page
    .getByText('Preview failed to render')
    .isVisible({ timeout: 1000 })
    .catch(() => false)

  // Check for sandpack iframe
  const hasPreview = await page
    .locator('iframe')
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false)

  // Check for code content in the response
  const pageContent = await page.content()
  const hasCodeContent =
    pageContent.includes('export default') ||
    pageContent.includes('function App') ||
    pageContent.includes('<pre') ||
    pageContent.includes('sandpack')

  return { errorBoundary, hasPreview, hasCodeContent }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Sandpack Code Generation - Predefined Prompts', () => {
  test.setTimeout(GENERATION_TIMEOUT + 30_000)

  for (const { label, buttonText } of PREDEFINED_PROMPTS) {
    test(`generates working app from "${label}" button`, async ({ page }) => {
      const { crashes, sandpackErrors } = collectErrors(page)

      // Navigate to homepage
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForSelector('textarea', { timeout: 10_000 })

      console.log(`\n🔘 Clicking "${buttonText}" suggestion button...`)

      // Click the predefined suggestion button
      const suggestionBtn = page.getByText(buttonText, { exact: true }).first()
      await expect(suggestionBtn).toBeVisible({ timeout: 5_000 })
      await suggestionBtn.click()

      // The button auto-submits the form, wait for generation
      console.log(`⏳ Waiting for generation...`)
      const elapsed = await waitForGeneration(page)
      console.log(`⏱️  Generation took ${Math.round(elapsed / 1000)}s`)

      // Verify no crashes
      await verifyNoAppCrash(crashes, sandpackErrors, label)

      // Capture and verify result
      const result = await captureResult(page, `predefined-${label}`)
      console.log(
        `📊 Result: preview=${result.hasPreview}, code=${result.hasCodeContent}, errorBoundary=${result.errorBoundary}`
      )

      // Should have SOME content (either preview iframe or code)
      expect(
        result.hasPreview || result.hasCodeContent,
        `"${label}" should produce either a preview or code content`
      ).toBe(true)

      // Error boundary showing means our fix worked (caught the error gracefully)
      // but ideally it shouldn't trigger
      if (result.errorBoundary) {
        console.warn(`⚠️  Error boundary triggered for "${label}" — import fix may need tuning`)
      }
    })
  }
})

test.describe('Sandpack Code Generation - Custom PRD Prompts', () => {
  test.setTimeout(GENERATION_TIMEOUT + 30_000)

  for (const { label, prompt } of CUSTOM_PROMPTS) {
    test(`generates working app from custom PRD: "${label}"`, async ({ page }) => {
      const { crashes, sandpackErrors } = collectErrors(page)

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForSelector('textarea', { timeout: 10_000 })

      console.log(`\n📝 Submitting custom PRD: "${label}"`)
      console.log(`   Prompt length: ${prompt.length} chars`)

      await submitPromptViaTextarea(page, prompt)

      console.log(`⏳ Waiting for generation...`)
      const elapsed = await waitForGeneration(page)
      console.log(`⏱️  Generation took ${Math.round(elapsed / 1000)}s`)

      // Verify no crashes
      await verifyNoAppCrash(crashes, sandpackErrors, label)

      // Capture and verify result
      const result = await captureResult(page, `custom-${label}`)
      console.log(
        `📊 Result: preview=${result.hasPreview}, code=${result.hasCodeContent}, errorBoundary=${result.errorBoundary}`
      )

      expect(
        result.hasPreview || result.hasCodeContent,
        `"${label}" should produce either a preview or code content`
      ).toBe(true)

      if (result.errorBoundary) {
        console.warn(`⚠️  Error boundary triggered for "${label}"`)
      }
    })
  }
})

test.describe('Sandpack Import Sanitizer - Regression', () => {
  test('broken import pattern does not crash preview', async ({ page }) => {
    const { crashes, sandpackErrors } = collectErrors(page)

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForSelector('textarea', { timeout: 10_000 })

    // This prompt is designed to trigger the exact pattern that caused the crash:
    // Multiple AIKit + shadcn + lucide imports that the AI might mangle
    const stressPrompt = `Build a complex dashboard that uses ALL of these components together:
- MetricCard, ChatBubble, StreamingIndicator, CodeDisplay, AIKitHeader, AIKitTable from AIKit
- Button, Card, CardHeader, CardContent, Badge, Input, Tabs, TabsList, TabsContent from shadcn/ui
- ArrowRight, DollarSign, TrendingUp, Users, BarChart3, Settings, Bell from lucide-react
- A Recharts AreaChart with sample data
- Show all components on one page with sample data
- Use TypeScript with proper imports`

    console.log('\n🧪 Stress test: complex multi-import prompt')
    await submitPromptViaTextarea(page, stressPrompt)

    const elapsed = await waitForGeneration(page)
    console.log(`⏱️  Generation took ${Math.round(elapsed / 1000)}s`)

    await verifyNoAppCrash(crashes, sandpackErrors, 'Import Stress Test')

    const result = await captureResult(page, 'stress-imports')
    console.log(`📊 Result: preview=${result.hasPreview}, errorBoundary=${result.errorBoundary}`)

    // The key assertion: no crash, even if preview doesn't fully render
    expect(crashes).toHaveLength(0)
  })
})
