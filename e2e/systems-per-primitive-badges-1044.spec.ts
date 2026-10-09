import { test, expect } from '@playwright/test'

/**
 * #1044 — real browser verification that the Live dashboard's "Business systems"
 * grid renders a GENUINELY DISTINCT Live/Planned badge per primitive.
 *
 * Before the fix, ZeroInvoice / ZeroCommerce / OpenCapStack all read one shared
 * "does this company have a ZeroDB project" boolean, so a company with only
 * ZeroInvoice really provisioned rendered three identical "✓ LIVE" badges
 * (confirmed live against production company "silo" on 2026-10-09).
 *
 * This drives the REAL Live.tsx grid + real SystemStatusBadge in a real browser.
 * Only next-auth's session endpoint and the systems API payload are stubbed —
 * the rendering path under test is the actual production component tree. The
 * payload used is exactly the shape the fixed route now returns for a realistic
 * partially-provisioned company.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

/** Realistic partial-provisioning state: only ZeroInvoice is genuinely live. */
const PARTIAL_SYSTEMS = {
  companyId: 'qa1044',
  idea: 'coffee storefront with invoicing and a cap table',
  provisioned: true,
  pipelineProvisioned: false,
  primitiveProvisioning: {
    zerodb: true,
    pipeline: false,
    zeroinvoice: true,
    commerce: false,
    capstack: false,
    serviceos: false,
    zerovoice: false,
    livestreaming: false,
    socialgraph: false,
  },
  zeroState: true,
  systems: [
    {
      key: 'zeroinvoice', name: 'ZeroInvoice', primitive: 'ZeroInvoice',
      docUrl: 'https://docs.ainative.studio/docs/business-ops/zeroinvoice',
      stat: 'Ready · $0 collected', count: 0, provisioned: true,
      vsProvider: 'QuickBooks', savedMonthly: 30,
    },
    {
      key: 'zerocommerce', name: 'ZeroCommerce', primitive: 'ZeroCommerce',
      docUrl: 'https://docs.ainative.studio/docs/business-ops/zerocommerce',
      stat: 'Ready · shop live', count: 0, provisioned: false,
      vsProvider: 'Shopify', savedMonthly: 29,
    },
    {
      key: 'opencapstack', name: 'OpenCapStack', primitive: 'OpenCapStack',
      docUrl: 'https://docs.ainative.studio/docs/business-ops/opencapstack',
      stat: 'Ready · cap table empty', count: 0, provisioned: false,
      vsProvider: 'Carta', savedMonthly: 40,
    },
    {
      key: 'zeropipeline', name: 'ZeroPipeline', primitive: 'ZeroPipeline',
      docUrl: 'https://docs.ainative.studio/docs/business-ops/zeropipeline',
      stat: 'Ready · Scout sourcing', count: 0, provisioned: false,
      vsProvider: 'Salesforce', savedMonthly: 25,
    },
  ],
}

async function stubSession(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'qa-1044', email: 'qa1044@example.com', name: 'QA 1044', type: 'regular' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    }),
  )
}

test.describe('#1044 Business systems badges are distinct per primitive', () => {
  test('renders ZeroInvoice Live while ZeroCommerce / OpenCapStack stay Planned', async ({ page }) => {
    await stubSession(page)
    await page.route('**/api/build/systems**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PARTIAL_SYSTEMS),
      }),
    )

    await page.goto(`${BASE}/build?screen=live&company=qa1044`, { waitUntil: 'domcontentloaded' })

    const grid = page.getByTestId('systems-grid')
    await expect(grid).toBeVisible({ timeout: 60_000 })

    // Read the real rendered badge next to each real primitive card.
    const statusFor = async (primitive: string) => {
      const card = grid.locator('.m-system', { hasText: primitive }).first()
      await expect(card).toBeVisible()
      return card.getByTestId('system-status-badge').first().getAttribute('data-status')
    }

    const invoice = await statusFor('ZeroInvoice')
    const commerce = await statusFor('ZeroCommerce')
    const capstack = await statusFor('OpenCapStack')

    // The whole point of #1044: these must NOT all be the same value.
    expect(new Set([invoice, commerce, capstack]).size).toBeGreaterThan(1)
    expect(invoice).toBe('live')
    expect(commerce).not.toBe('live')
    expect(capstack).not.toBe('live')

    await grid.scrollIntoViewIfNeeded()
    await grid.screenshot({ path: 'e2e/test-results/1044-partial-provisioning-badges.png' })
  })
})
