/**
 * Batch Showcase Generation — Creates diverse apps and populates the showcase
 *
 * Each test generates a different type of app, waits for completion,
 * and verifies the preview renders. Successful generations auto-populate
 * the showcase via addToShowcase() in chat-ws.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function generateAndVerify(page: Page, prompt: string, label: string) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.waitForTimeout(2000)

  // Submit prompt
  const textarea = page.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(prompt)
  await page.waitForTimeout(300)
  await page.locator('button[type="submit"]').first().click()

  // Wait for generation to complete
  try {
    await page.waitForSelector('text=Building your app', { timeout: 15_000 }).catch(() => {})
    await page.waitForSelector('text=Building your app', { state: 'hidden', timeout: 120_000 })
  } catch {}
  await page.waitForTimeout(5_000)

  // Verify preview exists
  const hasPreview = (await page.locator('iframe').count()) > 0
  const pageContent = await page.content()
  const hasPreviewUrl = pageContent.includes('/preview/')

  const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  await page.screenshot({ path: `e2e/screenshots/showcase-${safeName}.png` })

  console.log(`[${label}] preview=${hasPreview} previewUrl=${hasPreviewUrl}`)
  return hasPreview || hasPreviewUrl
}

// ── Batch 1: Landing Pages ──────────────────────────────────────────────────

test.describe('Showcase: Landing Pages', () => {
  test.setTimeout(180_000)

  test('Fitness Tracking SaaS', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build a fitness tracking SaaS landing page with hero section, 4 feature cards with icons, pricing tiers using AIKitPriceCard (Free, Pro $19/mo, Team $49/mo), testimonials from 3 users with AIKitRating, and a dark CTA section',
      'fitness-saas')
    expect(ok).toBe(true)
  })

  test('AI Startup Landing', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build an AI startup landing page for "NeuralFlow" — a platform that helps developers deploy ML models. Hero with gradient background, 3 MetricCards showing "Models Deployed: 12,847", "Avg Latency: 23ms", "Uptime: 99.97%", feature grid with Lucide icons, and pricing with AIKitPriceCard',
      'ai-startup')
    expect(ok).toBe(true)
  })

  test('Design Agency Portfolio', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build a design agency portfolio page for "Pixel & Co" with a dark hero section, project showcase grid with 6 cards showing project names and categories, team section with AIKitAvatar for 4 team members, client logos section, and contact form',
      'design-agency')
    expect(ok).toBe(true)
  })
})

// ── Batch 2: Dashboards ─────────────────────────────────────────────────────

test.describe('Showcase: Dashboards', () => {
  test.setTimeout(180_000)

  test('E-commerce Analytics Dashboard', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build an e-commerce analytics dashboard with AIKitSidebar navigation, 4 MetricCards (Revenue $127K, Orders 3,241, Conversion 4.2%, AOV $39.20) with sparklineData, a Recharts AreaChart showing monthly revenue, an AIKitTable of top products with columns: Product, Units, Revenue, Growth, and AIKitPagination',
      'ecommerce-dashboard')
    expect(ok).toBe(true)
  })

  test('DevOps Monitoring Dashboard', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build a DevOps monitoring dashboard with AIKitHeader, sidebar with nav items (Overview, Services, Deployments, Alerts, Logs), MetricCards for CPU 67%, Memory 4.2GB/8GB, Requests 2.4K/s, Error Rate 0.12%, a Recharts LineChart showing request latency over 24 hours, and an alerts table',
      'devops-dashboard')
    expect(ok).toBe(true)
  })

  test('HR People Dashboard', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build an HR people management dashboard with AIKitSidebar, MetricCards for Total Employees 248, Open Positions 12, Avg Tenure 3.2 years, Satisfaction 4.6/5 using AIKitRating. Include an AIKitTable of recent hires with Name, Role, Department, Start Date. Add a Recharts PieChart showing department distribution',
      'hr-dashboard')
    expect(ok).toBe(true)
  })
})

// ── Batch 3: Apps ────────────────────────────────────────────────────────────

test.describe('Showcase: Apps', () => {
  test.setTimeout(180_000)

  test('Project Management Kanban', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build a Kanban project management board called "TaskFlow" with 3 columns: To Do, In Progress, Done. Each column has 3-4 task cards with title, assignee with AIKitAvatar, priority Badge (Critical red, High orange, Medium blue), and due date. Include an AIKitHeader with search and "New Task" button',
      'kanban-board')
    expect(ok).toBe(true)
  })

  test('Chat Application', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build an AI chat application with a sidebar showing conversation list (5 conversations with names and timestamps), main chat area with ChatBubble messages (4 messages alternating user/assistant), StreamingIndicator for typing state, and a message input with send button',
      'chat-app')
    expect(ok).toBe(true)
  })

  test('Restaurant Menu', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build a restaurant menu app called "Sakura Kitchen" with category tabs (Appetizers, Mains, Sushi, Desserts), menu item cards with name, description, price in USD, and AIKitRating. Include a shopping cart sidebar with selected items, quantities, and total. At least 3 items per category',
      'restaurant-menu')
    expect(ok).toBe(true)
  })
})

// ── Batch 4: Specialized ────────────────────────────────────────────────────

test.describe('Showcase: Specialized', () => {
  test.setTimeout(180_000)

  test('AI Agent Operations Center', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build an AI agent operations center with SwarmView showing 6 agents (DataProcessor, ContentAnalyzer, CodeReviewer, SecurityScanner, DeploymentBot, TestRunner) with varying statuses. Include MetricCards for Total Tasks 1,247, Success Rate 98.7%, Avg Latency 1.2s, Token Budget usage with TokenUsageBar. Add AgentTimeline showing recent execution traces and GuardrailPanel with safety rules',
      'agent-ops')
    expect(ok).toBe(true)
  })

  test('E-commerce Product Listing', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build an e-commerce product listing page with AIKitHeader, search and filter bar, 6 AIKitProductCard items with realistic product names, prices (USD 29-199), original prices showing discounts, AIKitRating scores (4.2-4.9), and color swatches. Include AIKitPagination at the bottom and AIKitBreadcrumb navigation',
      'product-listing')
    expect(ok).toBe(true)
  })

  test('Blog/Content Platform', async ({ page }) => {
    const ok = await generateAndVerify(page,
      'Build a tech blog platform called "DevPulse" with a featured article hero (large card with title, excerpt, author with AIKitAvatar, read time), grid of 6 article cards with titles, categories as Badges, author names, and publication dates. Include category filter tabs and a newsletter signup section',
      'blog-platform')
    expect(ok).toBe(true)
  })
})
