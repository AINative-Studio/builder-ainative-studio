/**
 * Batch 50 — Mass generation to populate showcase with 50+ working examples
 * Each test generates an app, verifies it renders, auto-populates showcase via addToShowcase
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function gen(page: Page, prompt: string, label: string) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.waitForTimeout(1500)
  const textarea = page.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(prompt)
  await page.waitForTimeout(200)
  await page.locator('button[type="submit"]').first().click()
  try {
    await page.waitForSelector('text=Building your app', { timeout: 10_000 }).catch(() => {})
    await page.waitForSelector('text=Building your app', { state: 'hidden', timeout: 120_000 })
  } catch {}
  await page.waitForTimeout(3_000)
  const has = (await page.locator('iframe').count()) > 0 || (await page.content()).includes('/preview/')
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  await page.screenshot({ path: `e2e/screenshots/b50-${safe}.png` })
  console.log(`[${label}] ok=${has}`)
  return has
}

// All prompts — 50 diverse app types
const PROMPTS = [
  // Landing Pages (10)
  ['Fitness SaaS Landing', 'Build a fitness tracking SaaS landing page with hero, 4 feature cards with Lucide icons, 3 AIKitPriceCard pricing tiers, testimonials with AIKitRating, and dark CTA section'],
  ['AI Startup NeuralFlow', 'Build an AI startup landing page for "NeuralFlow" with dark gradient hero, 3 MetricCards (Models: 12,847 / Latency: 23ms / Uptime: 99.97%), feature grid, AIKitPriceCard pricing'],
  ['Design Agency Pixel Co', 'Build a design agency portfolio for "Pixel & Co" with dark hero, 6 project cards, team section with AIKitAvatar, client logos, contact form'],
  ['Crypto Exchange Landing', 'Build a crypto exchange landing page with live price ticker cards (BTC, ETH, SOL), hero with gradient, feature comparison table, security badges with SafetyBadge, signup CTA'],
  ['EdTech Platform', 'Build an online learning platform landing page with course category cards, instructor profiles with AIKitAvatar and AIKitRating, pricing with AIKitPriceCard, student testimonials'],
  ['Real Estate Listings', 'Build a real estate landing page with property search bar, 6 property cards with price/beds/baths, neighborhood map placeholder, agent contact form, mortgage calculator'],
  ['Health & Wellness', 'Build a wellness app landing page with calming green theme, feature cards for meditation/nutrition/fitness, pricing tiers, testimonial carousel, newsletter signup'],
  ['Developer Tools', 'Build a developer tools landing page for "CodeShip" with terminal-style hero, code snippets in CodeDisplay, integration badges, usage MetricCards, open source stats'],
  ['Food Delivery App', 'Build a food delivery app landing page with restaurant categories, popular dishes grid, how-it-works steps with AIKitStepper, delivery tracking preview, download CTA'],
  ['Music Streaming', 'Build a music streaming service landing page with playlist showcase, artist cards with AIKitAvatar, feature comparison table, pricing with AIKitPriceCard, equalizer animation CSS'],

  // Dashboards (10)
  ['E-commerce Analytics', 'Build an e-commerce analytics dashboard with AIKitSidebar, 4 MetricCards (Revenue $127K, Orders 3,241, Conversion 4.2%, AOV $39.20) with sparklineData, Recharts AreaChart for revenue, AIKitTable of top products'],
  ['DevOps Monitor', 'Build a DevOps monitoring dashboard with sidebar nav, MetricCards for CPU/Memory/Requests/Errors, Recharts LineChart for latency, alerts table with status badges'],
  ['HR People Dashboard', 'Build an HR dashboard with AIKitSidebar, MetricCards for Employees 248, Open Roles 12, Avg Tenure 3.2y, Satisfaction 4.6/5, AIKitTable of recent hires, Recharts PieChart of departments'],
  ['Social Media Analytics', 'Build a social media analytics dashboard with MetricCards for Followers 45.2K, Engagement 5.8%, Impressions 1.2M, Recharts BarChart of daily posts, AIKitTable of top performing content'],
  ['Finance Portfolio', 'Build a finance portfolio dashboard with total value MetricCard, asset allocation PieChart, performance LineChart, holdings AIKitTable with gain/loss badges, recent transactions'],
  ['Marketing Campaign', 'Build a marketing campaign dashboard with MetricCards for Spend $24K, Leads 1,847, CPA $12.98, ROI 340%, funnel BarChart, campaign AIKitTable with status badges'],
  ['IoT Sensor Dashboard', 'Build an IoT sensor monitoring dashboard with real-time MetricCards for Temperature 23.4C, Humidity 65%, Air Quality Good, Battery 87%, Recharts LineChart of sensor readings over 24h'],
  ['Customer Support', 'Build a customer support dashboard with MetricCards for Open Tickets 127, Avg Response 2.4h, CSAT 4.7/5, Resolution 94%, ticket queue AIKitTable, Recharts BarChart of tickets by category'],
  ['Sales Pipeline', 'Build a sales pipeline dashboard with MetricCards for Pipeline Value $2.1M, Win Rate 34%, Avg Deal $47K, deals in stages BarChart, top deals AIKitTable with probability badges'],
  ['Content Management', 'Build a CMS dashboard with AIKitSidebar, content stats MetricCards (Published 847, Drafts 23, Scheduled 8), recent articles AIKitTable, content calendar view, author activity timeline'],

  // Apps (15)
  ['Kanban Board TaskFlow', 'Build a Kanban board "TaskFlow" with 3 columns (To Do, In Progress, Done), 3-4 task cards each with title, AIKitAvatar assignee, priority Badge, due date, AIKitHeader with search'],
  ['AI Chat Interface', 'Build an AI chat app with conversation sidebar (5 chats), main area with ChatBubble messages (4 alternating), StreamingIndicator, message input with send button'],
  ['Restaurant Menu Sakura', 'Build a restaurant menu "Sakura Kitchen" with category tabs (Appetizers/Mains/Sushi/Desserts), menu cards with name/description/price, cart sidebar with totals, AIKitRating on items'],
  ['Weather Dashboard', 'Build a weather dashboard with city search, current conditions card (72F, Partly Cloudy, Humidity 65%), 7-day forecast row, Recharts LineChart of hourly temperatures, saved locations list'],
  ['Expense Tracker', 'Build an expense tracker with category dropdown, amount input, add button, Recharts BarChart of spending by category, transaction history AIKitTable with date/description/amount/category'],
  ['Recipe Book', 'Build a recipe book app with search bar, category filter tabs, recipe cards with image placeholder/title/time/difficulty Badge, recipe detail view with ingredients list and steps'],
  ['Music Player', 'Build a music player with album art placeholder, song title/artist, play/pause/skip controls, progress bar, volume slider, playlist queue with 8 songs, shuffle/repeat toggles'],
  ['Note Taking App', 'Build a note-taking app with sidebar folder navigation, note list with title/preview/date, rich text editor area, tag badges, search functionality, sort by date/title'],
  ['Fitness Tracker', 'Build a fitness tracker with daily stats MetricCards (Steps 8,432, Calories 1,847, Distance 5.2km, Active 47min), Recharts BarChart of weekly activity, workout log AIKitTable'],
  ['Invoice Generator', 'Build an invoice generator with company info inputs, line items table with add/remove rows, subtotal/tax/total calculations, client details section, download/send buttons'],
  ['Calendar Scheduler', 'Build a calendar app with month view grid, event cards with color-coded categories, sidebar with upcoming events list, add event form with date/time/title inputs'],
  ['File Manager', 'Build a file manager with breadcrumb navigation, grid/list view toggle, file cards with icon/name/size/date, folder navigation, upload button, storage usage progress bar'],
  ['Settings Page', 'Build a settings page with sidebar sections (Profile, Security, Notifications, Appearance, Billing), profile form with avatar upload, notification toggles, theme selector, danger zone'],
  ['Booking System', 'Build a booking system with service selection cards, date picker, time slot grid, booking summary card, customer info form, confirmation step with AIKitStepper progress'],
  ['Survey Builder', 'Build a survey builder with question type selector (Multiple Choice, Text, Rating, Scale), drag-and-drop question list, preview panel, share settings, response counter MetricCard'],

  // Specialized (15)
  ['Agent Ops Center', 'Build an agent operations center with SwarmView (6 agents), MetricCards for Tasks 1,247/Success 98.7%/Latency 1.2s, TokenUsageBar, AgentTimeline with execution traces, GuardrailPanel'],
  ['Product Listing Shop', 'Build an e-commerce product listing with AIKitHeader, search/filters, 6 AIKitProductCard with realistic names/prices/ratings, AIKitPagination, AIKitBreadcrumb navigation'],
  ['Blog Platform DevPulse', 'Build a tech blog "DevPulse" with featured article hero card, 6 article cards with category Badges, author AIKitAvatar, dates, category tabs, newsletter signup'],
  ['Video Gallery', 'Build a video gallery with VideoPlayer hero, thumbnail grid with 8 videos, category filter tabs, view count badges, like/share buttons, comments section'],
  ['Inventory Management', 'Build an inventory management system with AIKitSidebar, MetricCards for Items 3,421/Low Stock 23/Incoming 12, stock levels AIKitTable, reorder alerts with AIKitBanner'],
  ['Event Management', 'Build an event management platform with upcoming events cards, calendar view, attendee list with AIKitAvatar, ticket types with AIKitPriceCard, registration form'],
  ['Code Review Tool', 'Build a code review interface with file tree sidebar, diff viewer with CodeDisplay, comment threads, approval status badges, reviewer avatars, merge button'],
  ['Analytics Reports', 'Build a reports dashboard with date range picker, Recharts multi-line chart, data summary cards, export buttons, comparison toggle, AIKitTable with sortable columns'],
  ['Team Directory', 'Build a team directory with search bar, department filter tabs, team member cards with AIKitAvatar/name/role/email/status Badge, org chart view toggle'],
  ['Subscription Manager', 'Build a subscription management page with current plan card, usage MetricCards, plan comparison with AIKitPriceCard, billing history AIKitTable, payment method section'],
  ['Feedback Dashboard', 'Build a feedback dashboard with overall score MetricCard, AIKitRating distribution BarChart, recent feedback AIKitTable with sentiment badges, response rate trend LineChart'],
  ['API Documentation', 'Build an API docs page with sidebar endpoint navigation, endpoint detail with method Badge, request/response CodeDisplay, parameter table, try-it-out section'],
  ['Onboarding Flow', 'Build a user onboarding wizard with AIKitStepper (4 steps: Profile, Preferences, Team, Complete), form fields per step, progress indicator, skip/back/next buttons'],
  ['Notification Center', 'Build a notification center with tabs (All/Unread/Mentions), notification items with icon/title/description/time, mark all read button, notification preferences toggles'],
  ['Leaderboard', 'Build a competitive leaderboard with top 3 podium display, ranked AIKitTable with avatar/name/score/streak, time period tabs (Daily/Weekly/All Time), user stats MetricCards'],
]

// Split into test groups of 5 for parallel execution
for (let batch = 0; batch < PROMPTS.length; batch += 5) {
  const batchNum = Math.floor(batch / 5) + 1
  const batchPrompts = PROMPTS.slice(batch, batch + 5)

  test.describe(`Batch ${batchNum}`, () => {
    test.setTimeout(180_000)

    for (const [label, prompt] of batchPrompts) {
      test(`${label}`, async ({ page }) => {
        const ok = await gen(page, prompt, label)
        expect(ok).toBe(true)
      })
    }
  })
}
