// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { OptimizationSuggestions } from '@/components/context-budget/optimization-suggestions'
import type { ContextItem, OptimizationSuggestion } from '@/lib/types/context-budget'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — OptimizationSuggestions (components/context
 * -budget/optimization-suggestions.tsx, 236 lines, reached live via
 * BudgetDashboard <- app/context-budget-demo/page.tsx) had zero test
 * coverage. Pure presentational + local-state component, no fetch.
 */

function makeItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return { id: 'item-1', type: 'file', name: 'notes.md', tokenCost: 500, priority: 'medium', status: 'loaded', ...overrides }
}

function makeSuggestion(overrides: Partial<OptimizationSuggestion> = {}): OptimizationSuggestion {
  return {
    type: 'unload', priority: 'medium', description: 'Unload stale file',
    affectedItems: [makeItem()], estimatedSavings: 500, confidence: 0.8, autoApplicable: false,
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

describe('OptimizationSuggestions — real empty/apply/expand coverage (#1204)', () => {
  it('shows the real "well optimized" empty state when there are genuinely no suggestions', () => {
    render(React.createElement(OptimizationSuggestions, { suggestions: [] }))
    expect(host.textContent).toContain('No optimization suggestions at this time')
    expect(host.textContent).toContain('well optimized')
  })

  it('shows the real total savings and real suggestion count header', () => {
    const suggestions = [makeSuggestion({ estimatedSavings: 300 }), makeSuggestion({ estimatedSavings: 700 })]
    render(React.createElement(OptimizationSuggestions, { suggestions }))
    expect(host.textContent).toContain('Save up to 1,000 tokens')
    expect(host.textContent).toContain('2 suggestions')
  })

  it('renders real per-suggestion metadata: description, priority badge, savings, affected count, confidence', () => {
    const suggestion = makeSuggestion({
      description: 'Compress old chat history',
      priority: 'high',
      estimatedSavings: 1234,
      affectedItems: [makeItem(), makeItem({ id: 'item-2' })],
      confidence: 0.753,
    })
    render(React.createElement(OptimizationSuggestions, { suggestions: [suggestion] }))

    expect(host.textContent).toContain('Compress old chat history')
    expect(host.textContent).toContain('high')
    expect(host.textContent).toContain('1,234')
    expect(host.textContent).toContain('2 items affected')
    expect(host.textContent).toContain('75% confidence')
  })

  it('shows a real "Auto-applicable" badge only when the real suggestion is genuinely auto-applicable', () => {
    render(React.createElement(OptimizationSuggestions, { suggestions: [makeSuggestion({ autoApplicable: true })] }))
    expect(host.textContent).toContain('Auto-applicable')
  })

  it('never shows the Auto-applicable badge when the suggestion is not', () => {
    render(React.createElement(OptimizationSuggestions, { suggestions: [makeSuggestion({ autoApplicable: false })] }))
    expect(host.textContent).not.toContain('Auto-applicable')
  })

  it('never renders an Apply button when there is genuinely no onApplySuggestion handler', () => {
    render(React.createElement(OptimizationSuggestions, { suggestions: [makeSuggestion()] }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent === 'Apply')).toBe(false)
  })

  it('a real Apply click shows the real "Applying..." disabled state, calls onApplySuggestion with the real suggestion, then resets', async () => {
    let resolveApply: () => void = () => {}
    const onApplySuggestion = vi.fn(() => new Promise<void>((resolve) => { resolveApply = resolve }))
    const suggestion = makeSuggestion({ description: 'Unload X' })
    render(React.createElement(OptimizationSuggestions, { suggestions: [suggestion], onApplySuggestion }))

    const applyBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Apply') as HTMLButtonElement
    await act(async () => { applyBtn.click() })

    expect(host.textContent).toContain('Applying...')
    expect(applyBtn.disabled).toBe(true)
    expect(onApplySuggestion).toHaveBeenCalledWith(suggestion)

    await act(async () => { resolveApply(); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).not.toContain('Applying...')
  })

  it('applying one of several suggestions only disables that one row\'s Apply button, not the others', async () => {
    let resolveApply: () => void = () => {}
    const onApplySuggestion = vi.fn(() => new Promise<void>((resolve) => { resolveApply = resolve }))
    const suggestions = [makeSuggestion({ description: 'First' }), makeSuggestion({ description: 'Second' })]
    render(React.createElement(OptimizationSuggestions, { suggestions, onApplySuggestion }))

    const applyButtons = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Apply' || b.textContent === 'Applying...') as HTMLButtonElement[]
    await act(async () => { applyButtons[0].click() })

    const afterClick = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Apply' || b.textContent === 'Applying...') as HTMLButtonElement[]
    expect(afterClick[0].textContent).toBe('Applying...')
    expect(afterClick[1].textContent).toBe('Apply')
    expect(afterClick[1].disabled).toBe(false)

    resolveApply()
    await act(async () => { await Promise.resolve() })
  })

  it('details are genuinely collapsed by default and a real expand-toggle click reveals the real reasoning + affected items', async () => {
    const suggestion = makeSuggestion({
      reasoning: 'This file has not been accessed in 30 days.',
      affectedItems: [makeItem({ id: 'stale-1', name: 'old-notes.md', type: 'file', tokenCost: 2000 })],
    })
    render(React.createElement(OptimizationSuggestions, { suggestions: [suggestion] }))

    expect(host.textContent).not.toContain('This file has not been accessed')

    const toggleBtn = Array.from(host.querySelectorAll('button')).find((b) => b.querySelector('svg')) as HTMLButtonElement
    await act(async () => { toggleBtn.click() })

    expect(host.textContent).toContain('This file has not been accessed in 30 days.')
    expect(host.textContent).toContain('old-notes.md')
    expect(host.textContent).toContain('2,000 tokens')

    await act(async () => { toggleBtn.click() })
    expect(host.textContent).not.toContain('This file has not been accessed')
  })

  it('never shows a Reasoning section when the real suggestion has none, even when expanded', async () => {
    const suggestion = makeSuggestion({ reasoning: undefined })
    render(React.createElement(OptimizationSuggestions, { suggestions: [suggestion] }))

    const toggleBtn = Array.from(host.querySelectorAll('button')).find((b) => b.querySelector('svg')) as HTMLButtonElement
    await act(async () => { toggleBtn.click() })

    expect(host.textContent).not.toContain('Reasoning')
  })

  it('renders a real, distinct icon per suggestion type (unload vs compress)', () => {
    const suggestions = [makeSuggestion({ type: 'unload' }), makeSuggestion({ type: 'compress' })]
    render(React.createElement(OptimizationSuggestions, { suggestions }))

    const icons = Array.from(host.querySelectorAll('.rounded-lg.border svg')).map((s) => s.getAttribute('class'))
    expect(icons.some((c) => c?.includes('lucide-trash'))).toBe(true)
    expect(icons.some((c) => c?.includes('lucide-file-archive'))).toBe(true)
  })
})
