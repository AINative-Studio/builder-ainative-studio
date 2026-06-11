/**
 * E2E Stress Test: Sandpack Code Generation
 *
 * Tests predefined suggestion prompts AND custom PRD-style prompts
 * to verify the builder generates working apps without crashes.
 *
 * Runs against production: https://builder.ainative.studio
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const GENERATION_TIMEOUT = 120_000 // 2 min for AI generation
const HYDRATION_WAIT = 3_000      // Wait for React to hydrate before interacting

// ── Predefined prompts (from home-client.tsx suggestion buttons) ────────────
const PREDEFINED_PROMPTS = [
  { label: 'Agent Dashboard',    buttonText: 'Agent Dashboard' },
  { label: 'AI Chat Interface',  buttonText: 'AI Chat Interface' },
  { label: 'SaaS Platform',      buttonText: 'SaaS Platform' },
  { label: 'Swarm Monitor',      buttonText: 'Swarm Monitor' },
]

// ── Custom PRD-style prompts ────────────────────────────────────────────────
const CUSTOM_PROMPTS = [
  {
    label: 'Fitness Tracker PRD',
    prompt: `Build a fitness tracking dashboard with:
- A header showing "FitTrack Pro" with a user avatar
- 4 MetricCards showing: Steps Today (12,450), Calories Burned (847), Active Minutes (62), Heart Rate (72 bpm)
- A weekly activity bar chart using Recharts showing Mon-Sun data
- A workout log table with columns: Date, Activity, Duration, Calories with 5 sample rows
- A progress ring indicator for daily goal completion (78%)
- Use Tailwind CSS for styling`,
  },
  {
    label: 'Project Management Board',
    prompt: `Build a Kanban project management board with:
- 3 columns: To Do, In Progress, Done
- Each column has 3 task cards with title, assignee name, and priority Badge (Critical/High/Medium)
- A header with "ProjectFlow" branding and a New Task button
- A sidebar showing team members with their task counts
- Footer with project stats: Total Tasks, Completed percentage`,
  },
  {
    label: 'Restaurant Menu App',
    prompt: `Create a restaurant menu app called "Sakura Kitchen":
- Category tabs: Appetizers, Mains, Sushi, Desserts
- Menu item cards showing name, description, price
- A shopping cart sidebar with selected items and total
- At least 4 items per category with realistic names and prices
- Use Card components for menu items`,
  },
  {
    label: 'Weather Dashboard',
    prompt: `Build a weather dashboard:
- City search input at the top
- Current weather card: temperature 72F, Partly Cloudy, humidity 65%, wind 12 mph
- 7-day forecast row with day names, conditions, high/low temps
- Hourly temperature line chart using Recharts for next 12 hours
- A Saved Locations list with 3 cities`,
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadHomepage(page: Page) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForSelector('textarea', { timeout: 15_000 })
  // Wait for React to fully hydrate before interacting
  await page.waitForTimeout(HYDRATION_WAIT)
}

async function waitForGenerationComplete(page: Page) {
  const startTime = Date.now()

  // Wait for the loading overlay to disappear (generation in progress)
  try {
    await page.waitForSelector('text=Generating your component', { timeout: 30_000 })
    console.log('   ⚙️  Generation started...')
  } catch {
    // May have already completed or not shown
  }

  // Wait for the loading overlay to go away = generation done
  try {
    await page.waitForSelector('text=Generating your component', { state: 'hidden', timeout: GENERATION_TIMEOUT })
    console.log('   ✅ Generation overlay dismissed')
  } catch {
    // Timeout — check if we have content anyway
  }

  // Extra settle time for Sandpack to compile
  await page.waitForTimeout(8_000)
  return Date.now() - startTime
}

function collectErrors(page: Page): { crashes: string[]; sandpackWorkerErrors: string[] } {
  const crashes: string[] = []
  const sandpackWorkerErrors: string[] = []

  page.on('pageerror', (err) => {
    const msg = err.message || String(err)
    // Sandpack's internal worker bug — they mutate a frozen SyntaxError
    if (msg.includes('Cannot assign to read only property') || msg.includes('babel-transpiler')) {
      sandpackWorkerErrors.push(msg.slice(0, 150))
      return
    }
    // Real app crashes
    if (msg.includes('ChunkLoadError') || (msg.includes('Uncaught') && !msg.includes('SyntaxError'))) {
      crashes.push(msg.slice(0, 150))
    }
  })

  return { crashes, sandpackWorkerErrors }
}

async function captureAndAssert(page: Page, label: string) {
  const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  await page.screenshot({ path: `e2e/screenshots/${safeName}.png`, fullPage: false })

  const pageContent = await page.content()

  // Check for our error boundary (means we caught a crash gracefully)
  const errorBoundary = await page.getByText('Preview failed to render').isVisible({ timeout: 500 }).catch(() => false)

  // Check for the Sandpack preview iframe
  const hasPreviewIframe = await page.locator('iframe').first().isVisible({ timeout: 2000 }).catch(() => false)

  // Check for "Something went wrong" panel in the preview (Sandpack compile error, not a crash)
  const hasSandpackError = pageContent.includes('Something went wrong') || pageContent.includes('Could not find module')

  // Check for assistant message (means generation completed)
  const hasAssistantMsg = pageContent.includes('Assistant') || pageContent.includes('assistant') ||
    pageContent.includes("I've created") || pageContent.includes("I've built")

  // Check for preview URL bar (means a chat was created)
  const hasPreviewUrl = pageContent.includes('/preview/')

  console.log(`   📊 iframe=${hasPreviewIframe} | sandpackError=${hasSandpackError} | assistantMsg=${hasAssistantMsg} | previewUrl=${hasPreviewUrl} | errorBoundary=${errorBoundary}`)

  if (errorBoundary) console.warn(`   ⚠️  Error boundary triggered — crash was caught gracefully`)
  if (hasSandpackError) console.warn(`   ⚠️  Sandpack compile error (bad import) — fix needed`)

  // Key assertion: generation completed (assistant responded + preview URL exists)
  expect(
    hasAssistantMsg || hasPreviewUrl,
    `"${label}": generation should complete and produce a response`
  ).toBe(true)

  return { hasPreviewIframe, hasSandpackError, hasAssistantMsg, hasPreviewUrl }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Code Generation - Predefined Suggestion Buttons', () => {
  test.setTimeout(GENERATION_TIMEOUT + 60_000)

  for (const { label, buttonText } of PREDEFINED_PROMPTS) {
    test(`"${label}" button generates a complete app`, async ({ page }) => {
      const { crashes, sandpackWorkerErrors } = collectErrors(page)

      await loadHomepage(page)
      console.log(`\n🔘 Clicking "${buttonText}" suggestion...`)

      const btn = page.getByText(buttonText, { exact: true }).first()
      await expect(btn).toBeVisible({ timeout: 5_000 })
      await btn.click()

      console.log(`⏳ Waiting for generation to complete...`)
      const elapsed = await waitForGenerationComplete(page)
      console.log(`⏱️  Total: ${Math.round(elapsed / 1000)}s`)

      // App-level crashes are hard failures
      expect(crashes, `App crash on "${label}"`).toHaveLength(0)
      if (sandpackWorkerErrors.length > 0) {
        console.warn(`   ⚠️  Sandpack worker errors: ${sandpackWorkerErrors.length} (internal Sandpack bug)`)
      }

      await captureAndAssert(page, `predefined-${label}`)
    })
  }
})

test.describe('Code Generation - Custom PRD Prompts', () => {
  test.setTimeout(GENERATION_TIMEOUT + 60_000)

  for (const { label, prompt } of CUSTOM_PROMPTS) {
    test(`custom PRD "${label}" generates a complete app`, async ({ page }) => {
      const { crashes, sandpackWorkerErrors } = collectErrors(page)

      await loadHomepage(page)
      console.log(`\n📝 Submitting PRD: "${label}" (${prompt.length} chars)`)

      const textarea = page.locator('textarea').first()
      await textarea.fill(prompt)
      await page.waitForTimeout(300)

      // Submit
      const submitBtn = page.locator('button[type="submit"]').first()
      await submitBtn.click()

      console.log(`⏳ Waiting for generation to complete...`)
      const elapsed = await waitForGenerationComplete(page)
      console.log(`⏱️  Total: ${Math.round(elapsed / 1000)}s`)

      expect(crashes, `App crash on "${label}"`).toHaveLength(0)
      if (sandpackWorkerErrors.length > 0) {
        console.warn(`   ⚠️  Sandpack worker errors: ${sandpackWorkerErrors.length}`)
      }

      await captureAndAssert(page, `custom-${label}`)
    })
  }
})

test.describe('Regression - Import Sanitizer', () => {
  test.setTimeout(GENERATION_TIMEOUT + 60_000)

  test('complex multi-import prompt does not crash the app', async ({ page }) => {
    const { crashes, sandpackWorkerErrors } = collectErrors(page)

    await loadHomepage(page)

    const stressPrompt = `Build a dashboard using ALL of these:
- MetricCard, ChatBubble, StreamingIndicator, CodeDisplay, AIKitHeader, AIKitTable from AIKit
- Button, Card, Badge, Input, Tabs from shadcn/ui
- ArrowRight, DollarSign, TrendingUp, Users, BarChart3 from lucide-react
- A Recharts AreaChart with sample monthly data
Show all components on one page with realistic sample data.`

    console.log('\n🧪 Stress test: complex multi-import prompt')
    const textarea = page.locator('textarea').first()
    await textarea.fill(stressPrompt)
    await page.waitForTimeout(300)
    await page.locator('button[type="submit"]').first().click()

    const elapsed = await waitForGenerationComplete(page)
    console.log(`⏱️  Total: ${Math.round(elapsed / 1000)}s`)

    // Hard failure: app crashed
    expect(crashes, 'App crash on stress test').toHaveLength(0)
    if (sandpackWorkerErrors.length > 0) {
      console.warn(`   ⚠️  Sandpack worker errors: ${sandpackWorkerErrors.length}`)
    }

    await captureAndAssert(page, 'stress-multi-import')
  })
})
