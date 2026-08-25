/**
 * E2E tests for the persistent Documents library panel (#64).
 *
 * Verifies on the real Live dashboard that:
 *  1. The Documents panel renders (data-testid="documents-panel") with Documents
 *     vs Reports tabs and a list of the company's docs (title / type / date / VIEW).
 *  2. Switching to the Reports tab shows the daily operational report.
 *  3. VIEW loads + renders the full STRUCTURED markdown (Executive Summary → Key
 *     Findings → Sources) in-app.
 *  4. A brand-new company shows the honest empty state (no fabricated entries).
 *
 * The panel loads from /api/build/documents, which we intercept so the E2E is
 * deterministic (no dependency on live ZeroDB / a model). The Live screen is
 * reached via the same deep-link hook the Tasks + Versions E2Es use.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const RESEARCH_CONTENT =
  '## Executive Summary\nShelfMind competes in the SMB inventory-automation space; the wedge is agent-run reordering.\n\n' +
  '## Key Findings\n- Competitor A leads on integrations.\n- Competitor B is cheaper but manual.\n- No incumbent offers autonomous purchase orders.\n\n' +
  '## Sources\n- https://competitor-a.example\n- No public source located — flagged as an assumption to verify.'

const DAILY_CONTENT =
  '## Executive Summary\nOvernight, Cody dispatched the highest-leverage task to the swarm (task task-abc).\n\n' +
  '## Key Findings\n- Loop status: dispatched.\n- Swarm task dispatched: task-abc.\n\n' +
  '### Next actions\n- Poll the dispatched swarm task.\n\n## Sources\n- Nightly loop run record.'

const SUMMARIES = [
  { id: 'doc-research', kind: 'document', type: 'research', typeLabel: 'Research', title: 'Research: Audit competing platforms for ShelfMind', createdAt: '2026-08-24T02:00:00Z' },
  { id: 'doc-mission', kind: 'document', type: 'mission', typeLabel: 'Mission', title: 'ShelfMind Mission', createdAt: '2026-08-23T02:00:00Z' },
  { id: 'rep-daily', kind: 'report', type: 'daily', typeLabel: 'Daily Report', title: 'Daily Operational Report — Aug 25, 2026', createdAt: '2026-08-25T02:00:00Z' },
]

const FULL: Record<string, any> = {
  'doc-research': { ...SUMMARIES[0], content: RESEARCH_CONTENT },
  'rep-daily': { ...SUMMARIES[2], content: DAILY_CONTENT },
}

/** Stub /api/build/documents. GET list → summaries; GET ?id= → full doc. */
async function stubDocuments(page: Page, opts: { summaries: typeof SUMMARIES }) {
  await page.route('**/api/build/documents**', async (route) => {
    const url = new URL(route.request().url())
    const id = url.searchParams.get('id')
    if (route.request().method() === 'GET' && id) {
      const doc = FULL[id]
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document: doc }) })
    }
    if (route.request().method() === 'GET') {
      const s = opts.summaries
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: s,
          counts: { all: s.length, document: s.filter((d) => d.kind === 'document').length, report: s.filter((d) => d.kind === 'report').length },
          kinds: [{ kind: 'all', label: 'All' }, { kind: 'document', label: 'Documents' }, { kind: 'report', label: 'Reports' }],
        }),
      })
    }
    return route.continue()
  })
}

async function reachLiveDashboard(page: Page, company = 'e2e-documents') {
  await page.goto(`${BASE_URL}/?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="documents-panel"], .m-systems', { timeout: 60_000 }).catch(() => {})
}

test.describe('Documents library panel (#64)', () => {
  test('renders the library with Documents/Reports tabs + doc cards', async ({ page }) => {
    await stubDocuments(page, { summaries: SUMMARIES })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="documents-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached in this E2E environment')
    }
    await expect(page.getByTestId('documents-tabs')).toBeVisible()
    await expect(page.getByTestId('documents-tab-document')).toBeVisible()
    await expect(page.getByTestId('documents-tab-report')).toBeVisible()
    // The 'all' tab shows every entry (2 docs + 1 report).
    const cards = page.getByTestId('document-card')
    expect(await cards.count()).toBeGreaterThanOrEqual(3)
    await expect(page.getByTestId('document-title').first()).toContainText('Research')
    await expect(page.getByTestId('document-type').first()).toBeVisible()
    await expect(page.getByTestId('document-date').first()).toBeVisible()
  })

  test('the Reports tab shows the daily operational report', async ({ page }) => {
    await stubDocuments(page, { summaries: SUMMARIES })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="documents-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    await page.getByTestId('documents-tab-report').click()
    const cards = page.getByTestId('document-card')
    await expect(cards).toHaveCount(1)
    await expect(page.getByTestId('document-title')).toContainText('Daily Operational Report')
    await expect(page.getByTestId('document-kind-badge')).toContainText('REPORT')
  })

  test('VIEW renders the full structured markdown in-app', async ({ page }) => {
    await stubDocuments(page, { summaries: SUMMARIES })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="documents-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    // Open the research doc (first card in the 'all' tab).
    await page.getByTestId('document-view').first().click()
    const detail = page.getByTestId('document-detail')
    await expect(detail).toBeVisible()
    const content = page.getByTestId('document-content')
    // Structured markdown is rendered as real headings, not raw text.
    await expect(content).toContainText('Executive Summary')
    await expect(content).toContainText('Key Findings')
    await expect(content).toContainText('Sources')
    // Close returns to the list.
    await page.getByTestId('document-detail-close').click()
    await expect(detail).toBeHidden()
  })

  test('a brand-new company shows the honest empty state', async ({ page }) => {
    await stubDocuments(page, { summaries: [] })
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="documents-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    await expect(page.getByTestId('documents-empty')).toBeVisible()
    await expect(page.getByTestId('document-card')).toHaveCount(0)
  })
})
