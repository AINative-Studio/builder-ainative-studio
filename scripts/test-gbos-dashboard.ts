#!/usr/bin/env tsx

/**
 * Test Ghost Brand Operating System (GBOS) Dashboard Generation
 * More complex than Bay View - 20+ pages with state management
 */

const GBOS_PRD = `You are Bolt. Build a FRONTEND-ONLY Ghost Brand Operating System (GBOS) Admin Dashboard in Next.js (App Router) + TypeScript. Do NOT build a backend. All data must be mocked in the frontend (use in-memory mock data + small fake async fetch helpers). The goal is to fully stub every screen, component, and state so the UI is navigable and matches the described product.

====================================================
TECH + CONSTRAINTS
====================================================
- Framework: Next.js (latest) with App Router
- Language: TypeScript
- Styling: TailwindCSS
- State: Zustand (global UI state) + local component state
- Data fetching: simple mock async functions (simulate latency); optional TanStack Query is allowed but not required
- Charts: Recharts (preferred) or Chart.js (acceptable)
- Forms: React Hook Form + Zod validation (where forms exist)
- UI: Build clean reusable components; Headless UI-style patterns (dropdown, modal, drawer)
- Must support: Loading, Empty, Error, Success UI states on every page
- Responsive: Desktop-first; tablet collapsible sidebar; mobile drawer sidebar
- Accessibility: ARIA labels for dropdowns, tabs, modals, drawers

====================================================
APP CONCEPT
====================================================
Multi-brand operator dashboard for ghost kitchens / restaurants / retailers. One facility runs multiple "brands" across delivery platforms and in-house dining. Operators can switch brand context, toggle order mode (Delivery vs In-House), manage products, orders, customers, payments, deliveries, inventory, analytics, and settings (including Integrations for delivery networks).

====================================================
GLOBAL LAYOUT (MUST BUILD)
====================================================
Layout:
- Left Sidebar (fixed on desktop)
- Top Header
- Main Content area

Sidebar content (exact hierarchy):
- Brand Switcher dropdown at top (shows current brand name + logo/avatar + chevron)
- MAIN MENU:
  - Get Started (shows progress chip like "0% DONE")
  - Dashboard
  - Products (collapsible group; include chevron)
    - All Products (/products)
    - Categories (/products/categories)
    - Add Product (/products/new)
  - Orders (collapsible group; include chevron)
    - Orders (/orders)
    - Customers (/orders/customers)
  - Payments (/payments)
  - Deliveries (/deliveries)
  - Inventory (/inventory)
  - Analytics (/analytics)
  - Store Settings (/settings)
- PROFILE:
  - My Profile (/profile)
  - Logout (clears local storage + resets global state, routes to /login)

Top Header (global):
- Left: Page Title (based on route)
- Right:
  - ORDER MODE TOGGLE (CRITICAL): segmented control with two options:
    - Delivery
    - In-House Dining
    Persist in Zustand + localStorage. Switching changes Orders list behavior + Dashboard metrics.
  - Quick Actions dropdown button (always visible)
  - (Optional placeholder) Notifications icon

====================================================
CRITICAL FEATURE: BRAND SWITCHER
====================================================
Brand switcher dropdown:
- Lists brands user has access to (mock data)
- Each item shows logo/avatar, brand name, status (active/paused)
- Includes "+ Create Brand" action (opens modal stub with simple form; adds to mock state)
On select brand:
- Updates currentBrand in global store
- Persists to localStorage
- Triggers refetch/refresh of brand-scoped mock data (simulate via reloading local state + showing skeleton briefly)

Brand model:
- id, name, logoUrl (or initials), status: "active"|"paused", facilityId

====================================================
ROUTES (ALL MUST EXIST AND BE NAVIGABLE)
====================================================
Create Next.js App Router pages for:
- /login (stub login page with button "Sign in" -> sets mock authUser and routes to /dashboard)
- /get-started
- /dashboard
- /products
- /products/categories
- /products/new
- /products/[productId] (view stub)
- /products/[productId]/edit
- /orders
- /orders/customers
- /payments
- /deliveries
- /inventory
- /analytics
- /settings (tabbed)
- /settings/integrations (or integrations as a tab within /settings)
- /profile

====================================================
DASHBOARD PAGE (MUST MATCH SPEC)
====================================================
/dashboard layout:
- Main column:
  1) "Total Store Visits" chart card
     - Line chart with soft area fill
     - Date range dropdown default: "This year"
  2) "Top Products" table
     - Columns: ITEMS, VIEWS, PRICE, OPTIONS, ACTIONS, AVAILABILITY
     - Row actions icons: View, Edit, Delete
     - Availability toggle
     - "See all products" button linking to /products
- Right rail panel (fixed card stack):
  - Balance block: "GHS 0.00" (mock)
  - Link: "WHAT IS CATALOG CREDITS ↗" (no-op)
  - Referral Code block:
    - label "Referral Code"
    - code like "TOBY-C04" with copy icon
    - "0 Friends Invited" pill
  - Latest Orders block:
    - title "Latest Orders"
    - empty state: icon + "No Orders to show"
All dashboard data must be scoped to currentBrand + orderMode (Delivery vs In-House).

====================================================
ORDERS PAGE (MUST MATCH SPEC)
====================================================
/orders:
- Top section: "Total Orders" chart card with date filter dropdown default "This year"
- Below: Orders list module:
  - Title "Orders"
  - Tabs: Pending, Processing, Fulfilled, Cancelled
  - Search input top-right placeholder "Search Orders" with search icon
  - Order Card component (as shown):
    - product thumbnail
    - product title
    - price (e.g., GHS 500.00)
    - customer avatar initial on right
    - checkbox line "Mark as confirmed"
    - kebab menu (three dots) with actions: View Details, Cancel Order (stubs)
  - Results count line: "Showing 1 - 1 of 1 orders"
- Order Details Drawer:
  - Opens when clicking card or "View Details"
  - Contains customer info, items, subtotal, tax, delivery fee (if delivery mode), timeline, status update controls (stubs)
Orders must be filtered by:
- currentBrand
- orderMode (Delivery vs In-House)
- selected status tab
- search query

====================================================
CUSTOMERS PAGE
====================================================
/orders/customers:
- Table columns: Name, Email, Phone, Orders, Total Spend
- Search + empty/loading/error states

====================================================
PRODUCTS PAGES
====================================================
/products:
- Product table with search, filter by category, sort, bulk select, availability toggles
/products/categories:
- Categories list + add category modal stub
/products/new:
- Add Product form using React Hook Form + Zod validation
/products/[productId]/edit:
- Edit Product form (prefilled from mock data)
/products/[productId]:
- Product detail stub with key info + actions

Product fields:
- name, description, category, price, comparePrice, variants, addOns, images (stub), availability, prepTime, taxSettings, inventoryTracking

====================================================
PAYMENTS PAGE
====================================================
/payments:
- Overview cards: Total revenue, Payout balance, Upcoming payout
- Transactions table: Date, Order ID, Amount, Fee, Net, Status
- Support empty/loading/error states

====================================================
DELIVERIES PAGE
====================================================
/deliveries:
- Sections: Active Deliveries, Delivery History, Delivery Settings (tabs)
- Delivery card: Order ID, Rider, ETA, Status, static map preview placeholder
- Delivery mode should show richer delivery info; In-House mode should downplay delivery

====================================================
INVENTORY PAGE (REQUIRED FOR GHOST BRANDS)
====================================================
/inventory:
- Inventory items table: Item, SKU, On hand, Low stock threshold, Status
- Stock alerts section (empty state ok)
- Inventory must be shareable across brands but visible in current brand context (show note: "shared facility inventory")

====================================================
ANALYTICS PAGE (REQUIRED)
====================================================
/analytics:
- Cards and charts for:
  - Sales by brand
  - Sales by platform (Uber/DoorDash/etc.)
  - Product performance
  - Delivery times (delivery mode only)
  - Platform commissions (stub)
- Include dropdowns to filter by date range and platform

====================================================
SETTINGS PAGE (MUST INCLUDE INTEGRATIONS)
====================================================
/settings:
Tabbed settings UI with tabs:
- Brand Info
- Operating Hours
- Location
- Taxes
- Notifications
- Integrations (CRITICAL)

Brand Info fields:
- logo, brandName, description, slug, status(open/closed), brand scheduling stub

Operating Hours:
- day selector, open/close times

Location:
- address, coordinates, map preview placeholder

Taxes:
- taxRate, inclusive/exclusive

Notifications:
- email alerts, sms alerts toggles

Integrations tab (/settings/integrations or tab content):
Show integration cards for ALL networks:
- Uber Eats
- DoorDash
- GrubHub
- Postmates
- Walmart
- PieFi Net (student drivers)

Each integration card must include:
- Status: Connected / Not Connected
- Buttons:
  - Connect (opens modal)
  - Manage (opens manage modal)
  - Disconnect (confirm modal)
- Fields in connect/manage modal (stubs):
  - API Key
  - Store ID / Merchant ID
  - Brand Mapping (select which GBOS brand maps to platform store)
  - Menu Sync toggles
  - Order Import toggles
  - Dispatch routing rule (platform vs PieFi vs in-house)

====================================================
GET STARTED PAGE
====================================================
/get-started:
- Checklist:
  - Create brand
  - Add first product
  - Connect delivery platform
  - Set operating hours
  - Publish menu
- Progress bar updates based on completed steps (local state ok)

====================================================
PROFILE + LOGOUT
====================================================
/profile:
- Name, Email, Phone
- Change password stub
- 2FA toggle stub

Logout:
- Clears mock auth token + brand context in localStorage + Zustand reset
- Redirects to /login

====================================================
QUICK ACTIONS DROPDOWN (GLOBAL)
====================================================
Quick Actions menu items (wire up navigation or stubs):
- Add Product -> /products/new
- Create Brand -> opens create brand modal
- View Orders -> /orders
- Pause Brand -> toggles current brand status (active/paused)

====================================================
DATA + MOCKING
====================================================
- Implement a simple mock API layer:
  - fakeFetch(delayMs, data, shouldError?) utility
  - mock endpoints as functions that accept brandId + orderMode
- Use consistent mock data models:
  - Brand
  - Product
  - Order (include orderType: "delivery"|"in_house", platform: Uber/DoorDash/etc or "in_house")
  - Customer
  - Delivery
  - Transaction
  - InventoryItem
  - IntegrationConnection

====================================================
POLISH REQUIREMENTS
====================================================
- Skeleton loaders for charts, tables, cards
- Empty states with simple icon + copy
- Error boundary per page + retry button
- Toast notifications for actions like copy referral code, save settings, delete product
- Keep UI clean, minimal, modern, close to the provided screenshots:
  - light background
  - subtle borders
  - soft shadow cards
  - clear spacing
  - table with action icons
  - toggles for availability

====================================================
OUTPUT
====================================================
Generate the full Next.js project structure with all pages and components implemented and working.
Everything must be clickable and navigable.
All routes must render and use the shared layout.
No backend. All mocked. No unimplemented routes.`

async function testGBOSGeneration(): Promise<void> {
  console.log('🧪 Testing GBOS Dashboard Generation (32k token limit)...\n')
  console.log('📝 PRD Length:', GBOS_PRD.length, 'characters\n')
  console.log('📊 Complexity: 20+ pages, Zustand state, Forms, Charts, Integrations\n')

  try {
    const startTime = Date.now()

    const response = await fetch('http://localhost:3000/api/chat-ws', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: GBOS_PRD,
        chatId: `gbos-${Date.now()}`,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    console.log('✅ Request accepted, streaming response...\n')

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let previewId = ''
    let eventCount = 0
    let lastEventType = ''

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log('\n✅ Stream completed successfully!')
          break
        }

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              eventCount++

              if (parsed.type !== lastEventType) {
                if (lastEventType === 'chunk') {
                  console.log() // New line after dots
                }
                console.log(`📦 Event: ${parsed.type}`)
                lastEventType = parsed.type
              }

              if (parsed.type === 'content' || parsed.type === 'chunk') {
                fullContent += parsed.content
                process.stdout.write('.')
              } else if (parsed.type === 'init') {
                previewId = parsed.chatId
                console.log(`🆔 Preview ID: ${previewId}`)
              } else if (parsed.type === 'build_step') {
                console.log(`   📋 ${parsed.step}`)
              } else if (parsed.type === 'complete') {
                console.log(`\n✅ Generation complete!`)
                const duration = ((Date.now() - startTime) / 1000).toFixed(1)
                console.log(`⏱️  Duration: ${duration}s`)
                console.log(`📊 Content length: ${fullContent.length} characters`)
                console.log(`📦 Total events: ${eventCount}`)
              } else if (parsed.type === 'error' || parsed.type === 'validation_error') {
                console.error(`❌ Error: ${parsed.error}`)
                throw new Error(parsed.error)
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
        }
      }
    }

    if (fullContent.length === 0) {
      console.log('\n⚠️  No conversational content (this is normal - code sent separately)')
    }

    console.log(`\n📝 Conversational message length: ${fullContent.length} characters`)

    if (previewId) {
      console.log(`\n🔍 Testing preview endpoint...`)
      const previewResponse = await fetch(
        `http://localhost:3000/api/preview/${previewId}`
      )

      if (previewResponse.ok) {
        const previewHtml = await previewResponse.text()
        console.log(`✅ Preview HTML received: ${previewHtml.length} chars`)

        if (previewHtml.includes('Code Validation Error') || previewHtml.includes('Preview Expired')) {
          console.error(`❌ Preview shows error page`)
          console.error(previewHtml.substring(0, 500))
          throw new Error('Preview validation failed')
        } else {
          console.log(`✅ Preview HTML looks valid`)
          console.log(`\n${'='.repeat(80)}`)
          console.log(`🎉 FINAL PREVIEW URL`)
          console.log(`${'='.repeat(80)}`)
          console.log(`\n🌐 http://localhost:3000/preview/${previewId}\n`)
          console.log(`${'='.repeat(80)}`)
        }
      } else {
        throw new Error(`Preview fetch failed: ${previewResponse.status}`)
      }
    }

    console.log('\n✅ TEST PASSED - GBOS generation completed successfully!')
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error)
    process.exit(1)
  }
}

testGBOSGeneration()
