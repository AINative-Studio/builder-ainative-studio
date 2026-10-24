// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { ContextBudget, ContextItem, OptimizationSuggestion } from '@/lib/types/context-budget'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — BudgetDashboard (components/context-budget/
 * budget-dashboard.tsx, 318 lines, reached live via
 * app/context-budget-demo/page.tsx) had zero test coverage. Its 4 child
 * components (BudgetMeter, BudgetBreakdown, OptimizationSuggestions,
 * ContextItemsList) are each themselves untested — mocked here at their
 * real exported boundary since this file verifies only BudgetDashboard's
 * own data-fetching/action orchestration, not their internal rendering.
 */

const toastMock = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))
vi.mock('@/components/context-budget/budget-meter', () => ({
  BudgetMeter: ({ budget }: { budget: ContextBudget }) => React.createElement('div', { 'data-testid': 'stub-meter' }, `used:${budget.used}`),
}))
vi.mock('@/components/context-budget/budget-breakdown', () => ({
  BudgetBreakdown: ({ budget }: { budget: ContextBudget }) => React.createElement('div', { 'data-testid': 'stub-breakdown' }, `allocations:${budget.allocations.length}`),
}))
vi.mock('@/components/context-budget/optimization-suggestions', () => ({
  OptimizationSuggestions: ({ suggestions, onApplySuggestion }: { suggestions: OptimizationSuggestion[]; onApplySuggestion: (s: OptimizationSuggestion) => void }) =>
    React.createElement('div', { 'data-testid': 'stub-suggestions' },
      suggestions.map((s, i) =>
        React.createElement('button', { key: i, onClick: () => onApplySuggestion(s) }, `apply:${s.type}`)
      )
    ),
}))
vi.mock('@/components/context-budget/context-items-list', () => ({
  ContextItemsList: ({ items, onUnloadItem }: { items: ContextItem[]; onUnloadItem: (id: string) => void }) =>
    React.createElement('div', { 'data-testid': 'stub-items' },
      items.map((item) => React.createElement('button', { key: item.id, onClick: () => onUnloadItem(item.id) }, `unload:${item.id}`))
    ),
}))

function makeBudget(overrides: Partial<ContextBudget> = {}): ContextBudget {
  return {
    total: 100000,
    used: 40000,
    remaining: 60000,
    allocations: [{ category: 'baseline', tokens: 10000, percentage: 10, itemCount: 1 }],
    usagePercentage: 40,
    isWarning: false,
    isCritical: false,
    sessionId: 'session-1',
    userId: 'user-1',
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function makeItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return { id: 'item-1', type: 'file', name: 'notes.md', tokenCost: 500, priority: 'medium', status: 'loaded', ...overrides }
}

function makeSuggestion(overrides: Partial<OptimizationSuggestion> = {}): OptimizationSuggestion {
  return {
    type: 'unload', priority: 'medium', description: 'Unload stale file',
    affectedItems: [makeItem()], estimatedSavings: 500, confidence: 0.8, autoApplicable: true,
    ...overrides,
  }
}

function jsonOk(data: any) {
  return { ok: true, json: async () => data }
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
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('BudgetDashboard — real fetch/action orchestration coverage (#1204)', () => {
  it('shows the real loading state, then the real dashboard grid once the budget fetch resolves', async () => {
    global.fetch = vi.fn(async () => jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [] })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 'session-1', userId: 'user-1', autoRefresh: false }))

    expect(host.textContent).toContain('Loading budget data')

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('Context Budget Manager')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/context/budget?sessionId=session-1&userId=user-1&includeSuggestions=true'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('shows the real "Failed to load" + Retry state when the fetch genuinely fails, and a real destructive toast', async () => {
    global.fetch = vi.fn(async () => ({ ok: false })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('Failed to load budget data')
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))

    const retryBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Retry') as HTMLButtonElement
    expect(retryBtn).toBeTruthy()
  })

  it('renders the real budget/items data into the real child components once loaded', async () => {
    const budget = makeBudget({ used: 77777 })
    const items = [makeItem({ id: 'item-a' })]
    global.fetch = vi.fn(async () => jsonOk({ success: true, budget, items, suggestions: [] })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="stub-meter"]')?.textContent).toBe('used:77777')
    expect(host.querySelector('[data-testid="stub-items"]')?.textContent).toContain('unload:item-a')
  })

  it('a real Refresh click re-fetches the budget without showing the full-page loading state again', async () => {
    global.fetch = vi.fn(async () => jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [] })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const callsBefore = (global.fetch as any).mock.calls.length
    const refreshBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh') && !b.textContent.includes('Suggestions')) as HTMLButtonElement
    await act(async () => { refreshBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect((global.fetch as any).mock.calls.length).toBe(callsBefore + 1)
    expect(host.textContent).toContain('Context Budget Manager')
  })

  it('a real Refresh Suggestions click fires the real POST /api/context/optimize with moderate aggressiveness', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/context/optimize') return jsonOk({ success: true, suggestions: [makeSuggestion()] })
      return jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [] })
    }) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const suggestBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh Suggestions')) as HTMLButtonElement
    await act(async () => { suggestBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/context/optimize', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', userId: 'u1', aggressiveness: 'moderate' }),
    }))
    expect(host.querySelector('[data-testid="stub-suggestions"]')?.textContent).toContain('apply:unload')
  })

  it('a real unload-item click fires the real POST /api/context/unload with the real itemId, then removes it from the rendered list and shows a real toast with tokensSaved', async () => {
    const items = [makeItem({ id: 'item-a' }), makeItem({ id: 'item-b' })]
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/context/unload') return jsonOk({ success: true, budget: makeBudget({ used: 10000 }), tokensSaved: 500, unloadedItems: ['item-a'] })
      if (url === '/api/context/optimize') return jsonOk({ success: true, suggestions: [] })
      return jsonOk({ success: true, budget: makeBudget(), items, suggestions: [] })
    }) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const unloadBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'unload:item-a') as HTMLButtonElement
    await act(async () => { unloadBtn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/context/unload', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', userId: 'u1', itemIds: ['item-a'], reason: 'manual_unload' }),
    }))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Item Unloaded', description: 'Freed 500 tokens' }))
    expect(host.querySelector('[data-testid="stub-items"]')?.textContent).not.toContain('unload:item-a')
    expect(host.querySelector('[data-testid="stub-items"]')?.textContent).toContain('unload:item-b')
  })

  it('applying a real "unload"-type suggestion fires the real unload POST with reason optimization, then refreshes the budget', async () => {
    const suggestion = makeSuggestion({ type: 'unload', affectedItems: [makeItem({ id: 'stale-1' })] })
    let budgetFetchCount = 0
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/context/unload') return jsonOk({ success: true, tokensSaved: 900, unloadedItems: ['stale-1'] })
      if (url.toString().startsWith('/api/context/budget')) { budgetFetchCount++; return jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [suggestion] }) }
      return jsonOk({ success: true, suggestions: [] })
    }) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const applyBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'apply:unload') as HTMLButtonElement
    const fetchesBefore = budgetFetchCount
    await act(async () => { applyBtn.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/context/unload', expect.objectContaining({
      body: JSON.stringify({ sessionId: 's1', userId: 'u1', itemIds: ['stale-1'], reason: 'optimization' }),
    }))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Optimization Applied' }))
    expect(budgetFetchCount).toBeGreaterThan(fetchesBefore)
  })

  it('applying a real non-"unload" suggestion type (e.g. compress) shows the real "Coming Soon" toast, never a fetch to /api/context/unload', async () => {
    const suggestion = makeSuggestion({ type: 'compress' })
    global.fetch = vi.fn(async () => jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [suggestion] })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const applyBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'apply:compress') as HTMLButtonElement
    await act(async () => { applyBtn.click(); await Promise.resolve() })

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Coming Soon', description: expect.stringContaining('compress') }))
    expect(global.fetch).not.toHaveBeenCalledWith('/api/context/unload', expect.anything())
  })

  it('auto-refreshes the real budget on the real configured interval when autoRefresh is true', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async () => jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [] })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: true, refreshInterval: 5000 }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const callsBefore = (global.fetch as any).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); await Promise.resolve() })

    expect((global.fetch as any).mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('never auto-refreshes when autoRefresh is false, even after real time advances', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async () => jsonOk({ success: true, budget: makeBudget(), items: [], suggestions: [] })) as any
    const { BudgetDashboard } = await import('@/components/context-budget/budget-dashboard')
    render(React.createElement(BudgetDashboard, { sessionId: 's1', userId: 'u1', autoRefresh: false }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const callsBefore = (global.fetch as any).mock.calls.length
    await act(async () => { vi.advanceTimersByTime(60000) })

    expect((global.fetch as any).mock.calls.length).toBe(callsBefore)
  })
})
