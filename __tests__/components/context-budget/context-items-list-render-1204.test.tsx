// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ContextItemsList } from '@/components/context-budget/context-items-list'
import type { ContextItem } from '@/lib/types/context-budget'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom gap — Radix Select's own internals call this when an item is
  // highlighted/opened (established polyfill, same as
  // deploy-dialog-render-1204.test.tsx earlier this pass).
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — ContextItemsList (components/context-budget/
 * context-items-list.tsx, 212 lines, reached live via BudgetDashboard <-
 * app/context-budget-demo/page.tsx) had zero test coverage.
 */

function makeItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return { id: 'item-1', type: 'file', name: 'notes.md', tokenCost: 500, priority: 'medium', status: 'loaded', ...overrides }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

/** Open a real Radix Select then click a real option by its visible text —
 *  confirmed working in deploy-dialog-render-1204.test.tsx earlier this pass. */
async function selectOption(triggerIndex: number, optionText: string) {
  const triggers = Array.from(host.querySelectorAll('[role="combobox"]')) as HTMLElement[]
  await act(async () => { triggers[triggerIndex].click() })
  const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((o) => o.textContent === optionText) as HTMLElement
  await act(async () => { option.click() })
}

/** Excludes the two real Select trigger buttons (role="combobox" is also a
 *  real <button>) — only real per-item Unload buttons, confirmed by the
 *  real component's own markup (Button with a Trash2 icon). */
function unloadButtons(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('button')).filter((b) => b.getAttribute('role') !== 'combobox') as HTMLButtonElement[]
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ''
})

describe('ContextItemsList — real filter/sort/unload coverage (#1204)', () => {
  it('shows the real "No context items loaded" empty state', () => {
    render(React.createElement(ContextItemsList, { items: [] }))
    expect(host.textContent).toContain('No context items loaded')
  })

  it('shows the real item count and real total token sum in the header', () => {
    const items = [makeItem({ id: 'a', tokenCost: 300 }), makeItem({ id: 'b', tokenCost: 700 })]
    render(React.createElement(ContextItemsList, { items }))
    expect(host.textContent).toContain('2 items')
    expect(host.textContent).toContain('1,000 tokens')
  })

  it('defaults to the real sort-by-cost order (highest token cost first)', () => {
    const items = [makeItem({ id: 'low', name: 'Low', tokenCost: 100 }), makeItem({ id: 'high', name: 'High', tokenCost: 900 })]
    render(React.createElement(ContextItemsList, { items }))

    const names = Array.from(host.querySelectorAll('span.font-medium.truncate')).map((el) => el.textContent)
    expect(names[0]).toBe('High')
    expect(names[1]).toBe('Low')
  })

  it('a real sort-by-name selection re-sorts items alphabetically', async () => {
    const items = [makeItem({ id: 'z', name: 'Zebra', tokenCost: 900 }), makeItem({ id: 'a', name: 'Apple', tokenCost: 100 })]
    render(React.createElement(ContextItemsList, { items }))

    await selectOption(1, 'By Name')

    const names = Array.from(host.querySelectorAll('span.font-medium.truncate')).map((el) => el.textContent)
    expect(names[0]).toBe('Apple')
    expect(names[1]).toBe('Zebra')
  })

  it('a real sort-by-priority selection orders critical before low, regardless of token cost', async () => {
    const items = [
      makeItem({ id: 'low', name: 'LowPri', priority: 'low', tokenCost: 900 }),
      makeItem({ id: 'crit', name: 'Critical', priority: 'critical', tokenCost: 10 }),
    ]
    render(React.createElement(ContextItemsList, { items }))

    await selectOption(1, 'By Priority')

    const names = Array.from(host.querySelectorAll('span.font-medium.truncate')).map((el) => el.textContent)
    expect(names[0]).toBe('Critical')
    expect(names[1]).toBe('LowPri')
  })

  it('a real sort-by-access selection orders the highest real accessCount first', async () => {
    const items = [
      makeItem({ id: 'rare', name: 'Rare', accessCount: 1, tokenCost: 500 }),
      makeItem({ id: 'often', name: 'Often', accessCount: 20, tokenCost: 500 }),
    ]
    render(React.createElement(ContextItemsList, { items }))

    await selectOption(1, 'By Access')

    const names = Array.from(host.querySelectorAll('span.font-medium.truncate')).map((el) => el.textContent)
    expect(names[0]).toBe('Often')
    expect(names[1]).toBe('Rare')
  })

  it('a real type-filter selection shows only matching items', async () => {
    const items = [makeItem({ id: 'f1', name: 'File One', type: 'file' }), makeItem({ id: 's1', name: 'Skill One', type: 'skill' })]
    render(React.createElement(ContextItemsList, { items }))

    await selectOption(0, 'Skills')

    expect(host.textContent).toContain('Skill One')
    expect(host.textContent).not.toContain('File One')
  })

  it('never shows an Unload button for a real critical-priority item, even with onUnloadItem given', () => {
    const items = [makeItem({ id: 'crit', priority: 'critical' })]
    render(React.createElement(ContextItemsList, { items, onUnloadItem: vi.fn() }))

    expect(unloadButtons().length).toBe(0)
  })

  it('shows an Unload button for a real non-critical item when onUnloadItem is given', () => {
    const items = [makeItem({ id: 'med', priority: 'medium' })]
    render(React.createElement(ContextItemsList, { items, onUnloadItem: vi.fn() }))

    expect(unloadButtons().length).toBe(1)
  })

  it('never shows an Unload button when there is genuinely no onUnloadItem handler, even for a non-critical item', () => {
    const items = [makeItem({ id: 'med', priority: 'medium' })]
    render(React.createElement(ContextItemsList, { items }))

    expect(unloadButtons().length).toBe(0)
  })

  it('a real Unload click calls onUnloadItem with the real item id, and only disables THAT item\'s button while pending', async () => {
    let resolveUnload: () => void = () => {}
    const onUnloadItem = vi.fn(() => new Promise<void>((resolve) => { resolveUnload = resolve }))
    const items = [makeItem({ id: 'a', name: 'A', priority: 'medium', tokenCost: 900 }), makeItem({ id: 'b', name: 'B', priority: 'medium', tokenCost: 100 })]
    render(React.createElement(ContextItemsList, { items, onUnloadItem }))

    const buttons = unloadButtons()
    await act(async () => { buttons[0].click() })

    expect(onUnloadItem).toHaveBeenCalledWith('a')
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].disabled).toBe(false)

    await act(async () => { resolveUnload(); await Promise.resolve(); await Promise.resolve() })
    expect(buttons[0].disabled).toBe(false)
  })

  it('renders the real accessed-count and real "Never" last-accessed fallback for an item with no lastAccessedAt', () => {
    const items = [makeItem({ accessCount: 7, lastAccessedAt: undefined })]
    render(React.createElement(ContextItemsList, { items }))

    expect(host.textContent).toContain('Accessed 7 times')
    expect(host.textContent).toContain('Last: Never')
  })

  it('renders a real distinct icon per item type (file vs skill)', () => {
    const items = [makeItem({ id: 'f1', type: 'file' }), makeItem({ id: 's1', type: 'skill' })]
    render(React.createElement(ContextItemsList, { items }))

    const iconClasses = Array.from(host.querySelectorAll('svg')).map((s) => s.getAttribute('class'))
    expect(iconClasses.some((c) => c?.includes('lucide-file-code'))).toBe(true)
    expect(iconClasses.some((c) => c?.includes('lucide-sparkles'))).toBe(true)
  })
})
