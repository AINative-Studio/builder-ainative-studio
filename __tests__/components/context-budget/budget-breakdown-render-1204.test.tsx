// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { ContextBudget, BudgetAllocation } from '@/lib/types/context-budget'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — BudgetBreakdown (components/context-budget/
 * budget-breakdown.tsx, 176 lines, reached live via BudgetDashboard <-
 * app/context-budget-demo/page.tsx) had zero test coverage.
 *
 * recharts (PieChart/Pie/Cell/ResponsiveContainer/Legend/Tooltip) is mocked
 * at its real exported boundary — it's a third-party charting library whose
 * own SVG rendering relies on real DOM layout measurements jsdom doesn't
 * provide (ResponsiveContainer needs a real measured width/height), and its
 * own correctness isn't this component's logic to verify. This file checks
 * only BudgetBreakdown's own data: the chartData memo's zero-token
 * filtering, and the fully real (unmocked) Detailed Breakdown table below
 * the chart, which is plain DOM with no library involvement.
 */

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => React.createElement('div', { 'data-testid': 'stub-chart-container' }, children),
  PieChart: ({ children }: any) => React.createElement('div', { 'data-testid': 'stub-pie-chart' }, children),
  Pie: ({ data }: any) => React.createElement('div', { 'data-testid': 'stub-pie', 'data-count': data.length }),
  Cell: () => null,
  Legend: () => null,
  Tooltip: () => null,
}))

function makeAllocation(overrides: Partial<BudgetAllocation> = {}): BudgetAllocation {
  return { category: 'files', tokens: 1000, percentage: 25, itemCount: 3, ...overrides }
}

function makeBudget(allocations: BudgetAllocation[]): ContextBudget {
  return {
    total: 100000, used: 40000, remaining: 60000, allocations,
    usagePercentage: 40, isWarning: false, isCritical: false,
    sessionId: 's1', userId: 'u1', updatedAt: new Date('2026-01-01'),
  }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('BudgetBreakdown — real data-filtering/table coverage (#1204)', () => {
  it('shows the real "No context items loaded" empty state when every real allocation has zero tokens', async () => {
    const { BudgetBreakdown } = await import('@/components/context-budget/budget-breakdown')
    const budget = makeBudget([makeAllocation({ category: 'baseline', tokens: 0 })])
    render(React.createElement(BudgetBreakdown, { budget }))

    expect(host.textContent).toContain('No context items loaded')
    expect(host.querySelector('[data-testid="stub-chart-container"]')).toBeNull()
  })

  it('shows the real empty state when there are genuinely no allocations at all', async () => {
    const { BudgetBreakdown } = await import('@/components/context-budget/budget-breakdown')
    render(React.createElement(BudgetBreakdown, { budget: makeBudget([]) }))

    expect(host.textContent).toContain('No context items loaded')
  })

  it('passes only the real non-zero-token allocations into the chart data (real memo filtering)', async () => {
    const { BudgetBreakdown } = await import('@/components/context-budget/budget-breakdown')
    const budget = makeBudget([
      makeAllocation({ category: 'files', tokens: 1000 }),
      makeAllocation({ category: 'baseline', tokens: 0 }),
      makeAllocation({ category: 'skills', tokens: 500 }),
    ])
    render(React.createElement(BudgetBreakdown, { budget }))

    expect(host.querySelector('[data-testid="stub-pie"]')?.getAttribute('data-count')).toBe('2')
  })

  it('renders the real Detailed Breakdown table with real category label, item count, formatted tokens, and percentage', async () => {
    const { BudgetBreakdown } = await import('@/components/context-budget/budget-breakdown')
    const budget = makeBudget([makeAllocation({ category: 'tools', tokens: 12345, percentage: 30, itemCount: 7 })])
    render(React.createElement(BudgetBreakdown, { budget }))

    expect(host.textContent).toContain('Tools')
    expect(host.textContent).toContain('7 items')
    expect(host.textContent).toContain('12,345')
    expect(host.textContent).toContain('30%')
  })

  it('the real Detailed Breakdown table sorts by token count descending, independent of allocation array order', async () => {
    const { BudgetBreakdown } = await import('@/components/context-budget/budget-breakdown')
    const budget = makeBudget([
      makeAllocation({ category: 'other', tokens: 100 }),
      makeAllocation({ category: 'files', tokens: 9000 }),
      makeAllocation({ category: 'skills', tokens: 500 }),
    ])
    render(React.createElement(BudgetBreakdown, { budget }))

    const rows = Array.from(host.querySelectorAll('.border-t .space-y-2 > div')).map((r) => r.textContent)
    expect(rows[0]).toContain('Files')
    expect(rows[1]).toContain('Skills')
    expect(rows[2]).toContain('Other')
  })

  it('the real Detailed Breakdown table never includes a real zero-token category row', async () => {
    const { BudgetBreakdown } = await import('@/components/context-budget/budget-breakdown')
    const budget = makeBudget([
      makeAllocation({ category: 'files', tokens: 1000 }),
      makeAllocation({ category: 'history', tokens: 0 }),
    ])
    render(React.createElement(BudgetBreakdown, { budget }))

    expect(host.textContent).toContain('Files')
    expect(host.textContent).not.toContain('History')
  })
})
