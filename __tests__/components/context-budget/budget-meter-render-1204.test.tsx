// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BudgetMeter } from '@/components/context-budget/budget-meter'
import type { ContextBudget } from '@/lib/types/context-budget'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — BudgetMeter (components/context-budget/budget
 * -meter.tsx, 123 lines, reached live via BudgetDashboard <-
 * app/context-budget-demo/page.tsx) had zero test coverage. Pure
 * presentational component, no fetch, no Radix.
 */

function makeBudget(overrides: Partial<ContextBudget> = {}): ContextBudget {
  return {
    total: 100000, used: 40000, remaining: 60000, allocations: [],
    usagePercentage: 40, isWarning: false, isCritical: false,
    sessionId: 's1', userId: 'u1', updatedAt: new Date('2026-01-01'),
    ...overrides,
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

describe('BudgetMeter — real status/formatting/gating coverage (#1204)', () => {
  it('shows the real "Healthy" status when genuinely neither warning nor critical', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget() }))
    expect(host.textContent).toContain('Healthy')
    expect(host.querySelector('.bg-red-50')).toBeNull()
    expect(host.querySelector('.bg-yellow-50')).toBeNull()
  })

  it('shows the real "Warning" status + the real warning banner when genuinely isWarning and not critical', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ isWarning: true, isCritical: false }) }))
    expect(host.textContent).toContain('Warning')
    expect(host.textContent).toContain('Budget Warning')
    expect(host.textContent).toContain("You're approaching your token budget limit")
  })

  it('shows the real "Critical" status + the real critical banner when genuinely isCritical', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ isCritical: true }) }))
    expect(host.textContent).toContain('Critical')
    expect(host.textContent).toContain('Budget Critical')
    expect(host.textContent).toContain('critically low')
  })

  it('shows ONLY the real critical banner (never the warning one too) when a budget is genuinely both critical AND warning', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ isCritical: true, isWarning: true }) }))
    expect(host.textContent).toContain('Budget Critical')
    expect(host.textContent).not.toContain('Budget Warning')
  })

  it('renders the real usage percentage text and the real visual progress-bar fill width', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ usagePercentage: 73 }) }))
    expect(host.textContent).toContain('73%')
    const indicator = host.querySelector('[role="progressbar"] > div') as HTMLElement
    expect(indicator.style.transform).toBe('translateX(-27%)')
  })

  it('exposes the real percentage to assistive technology via aria-valuenow (#1395 fix)', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ usagePercentage: 73 }) }))
    const bar = host.querySelector('[role="progressbar"]') as HTMLElement
    expect(bar.getAttribute('aria-valuenow')).toBe('73')
    expect(bar.getAttribute('data-state')).toBe('loading')
  })

  it('shows the real formatted used/total/remaining token counts when showDetails is genuinely true (the default)', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ used: 42000, total: 100000, remaining: 58000 }) }))
    expect(host.textContent).toContain('42,000 / 100,000 tokens')
    expect(host.textContent).toContain('58,000 remaining')
  })

  it('never shows the token-count details when showDetails is genuinely false', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ used: 42000 }), showDetails: false }))
    expect(host.textContent).not.toContain('42,000')
    expect(host.textContent).not.toContain('remaining')
  })

  it('never shows any warning/critical banner for a genuinely healthy budget', () => {
    render(React.createElement(BudgetMeter, { budget: makeBudget({ isWarning: false, isCritical: false }) }))
    expect(host.textContent).not.toContain('Budget Critical')
    expect(host.textContent).not.toContain('Budget Warning')
  })
})
