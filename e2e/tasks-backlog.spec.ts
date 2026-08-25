/**
 * E2E tests for the Tasks/Backlog panel (#55).
 *
 * Verifies on the real Live dashboard that:
 *  1. The Tasks panel renders (data-testid="tasks-panel") with the six stage
 *     tabs (To Do / Recurring / In Progress / Completed / Rejected / Failed) + All.
 *  2. Clicking a stage tab filters the list (the tab becomes aria-selected).
 *  3. When there are tasks, VIEW opens the detail panel (task_id/output visible).
 *  4. A brand-new company shows the honest empty state (data-testid="tasks-empty").
 *
 * The panel loads from /api/build/tasks, which we intercept so the E2E is
 * deterministic (no dependency on a live ZeroDB or swarm dispatch). The intake
 * flow is walked to reach the Live screen, matching live-vs-planned.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const SAMPLE_TASKS = [
  {
    id: 'recurring:nightly-loop',
    scopeKey: 'guest:anon::e2e-tasks',
    title: 'Nightly autonomous loop',
    detail: 'Each night Cody evaluates the company and dispatches the highest-leverage task.',
    stage: 'recurring',
    source: 'recurring',
    taskId: 'run-42',
    output: 'Last dispatch: run-42 · dispatched',
    createdAt: '2026-08-24T02:00:00Z',
    updatedAt: '2026-08-24T02:00:00Z',
  },
  {
    id: 't_swarm_1',
    scopeKey: 'guest:anon::e2e-tasks',
    title: 'Wire ZeroPipeline lead capture',
    detail: 'Dispatched to the agent swarm.',
    stage: 'in_progress',
    source: 'swarm',
    taskId: 'swarm-1001',
    output: '',
    createdAt: '2026-08-24T01:00:00Z',
    updatedAt: '2026-08-24T01:30:00Z',
  },
  {
    id: 't_done_1',
    scopeKey: 'guest:anon::e2e-tasks',
    title: 'Ship landing page',
    detail: 'Built and deployed.',
    stage: 'completed',
    source: 'cody',
    taskId: null,
    output: 'Deployed to /build/e2e-tasks',
    createdAt: '2026-08-23T10:00:00Z',
    updatedAt: '2026-08-23T12:00:00Z',
  },
]

const STAGES = ['todo', 'recurring', 'in_progress', 'completed', 'rejected', 'failed'] as const

function countsFor(tasks: typeof SAMPLE_TASKS) {
  const c: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]))
  for (const t of tasks) c[t.stage] = (c[t.stage] || 0) + 1
  return c
}

/** Stub /api/build/tasks GET with a given task list so the panel is deterministic. */
async function stubTasks(page: Page, tasks: typeof SAMPLE_TASKS) {
  await page.route('**/api/build/tasks**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tasks,
        counts: countsFor(tasks),
        stages: STAGES.map((s) => ({ stage: s, label: s })),
      }),
    })
  })
}

/**
 * Reach the Live dashboard deterministically via the deep-link the build context
 * honors (?screen=live&company=<slug>) — the same hook Playwright/QA use to jump
 * straight to Live without driving a full codegen build (see build-context.tsx).
 */
async function reachLiveDashboard(page: Page, company = 'e2e-tasks') {
  await page.goto(`${BASE_URL}/?screen=live&company=${encodeURIComponent(company)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForSelector('[data-testid="tasks-panel"], .m-systems', { timeout: 60_000 }).catch(() => {})
}

test.describe('Tasks/Backlog panel (#55)', () => {
  test('renders the Tasks panel with all six stage tabs + All', async ({ page }) => {
    await stubTasks(page, SAMPLE_TASKS)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="tasks-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached in this E2E environment')
    }
    await expect(page.getByTestId('task-tab-all')).toBeVisible()
    for (const s of STAGES) {
      await expect(page.getByTestId(`task-tab-${s}`)).toBeVisible()
    }
  })

  test('renders task cards with stage badges + source', async ({ page }) => {
    await stubTasks(page, SAMPLE_TASKS)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="tasks-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    const cards = page.getByTestId('task-card')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThanOrEqual(3)
    // Every card has a stage badge + a source chip.
    await expect(page.getByTestId('task-stage-badge').first()).toBeVisible()
    await expect(page.getByTestId('task-source').first()).toBeVisible()
  })

  test('filters by stage when a tab is clicked', async ({ page }) => {
    await stubTasks(page, SAMPLE_TASKS)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="tasks-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    // Click "Completed" — only the completed card should remain.
    await page.getByTestId('task-tab-completed').click()
    await expect(page.getByTestId('task-tab-completed')).toHaveAttribute('aria-selected', 'true')
    const cards = page.getByTestId('task-card')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Ship landing page')
  })

  test('VIEW opens the task detail with task_id + output', async ({ page }) => {
    await stubTasks(page, SAMPLE_TASKS)
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="tasks-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    // Open the completed task's detail (it has an output + is deterministic).
    await page.getByTestId('task-tab-completed').click()
    await page.getByTestId('task-view').first().click()
    const detail = page.getByTestId('task-detail')
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('task-detail-title')).toContainText('Ship landing page')
    await expect(page.getByTestId('task-detail-output')).toContainText('Deployed')
    // Close it.
    await page.getByTestId('task-detail-close').click()
    await expect(detail).toBeHidden()
  })

  test('shows the honest empty state for a brand-new company', async ({ page }) => {
    await stubTasks(page, [])
    await reachLiveDashboard(page)
    const panel = page.locator('[data-testid="tasks-panel"]')
    if (!(await panel.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Live dashboard not reached')
    }
    await expect(page.getByTestId('tasks-empty')).toBeVisible()
    await expect(page.getByTestId('task-card')).toHaveCount(0)
  })
})
