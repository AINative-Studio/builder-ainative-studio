// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TemplateFiltersComponent } from '@/components/templates/template-filters'
import type { TemplateFilters } from '@/lib/types/template'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * #1204 (Coverage Phase 4) — TemplateFiltersComponent (components/templates/
 * template-filters.tsx, 192 lines, reached live via app/templates/page.tsx)
 * had zero test coverage.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function selectOption(selectId: string, optionText: string) {
  const trigger = host.querySelector(`#${selectId}`) as HTMLElement
  await act(async () => { trigger.click() })
  const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((o) => o.textContent === optionText) as HTMLElement
  await act(async () => { option.click() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('TemplateFiltersComponent — real search/filter/tag/clear coverage (#1204)', () => {
  it('debounces real search input: calls onFiltersChange with the real value + page:1 only after 300ms', async () => {
    vi.useFakeTimers()
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 1 }, onFiltersChange }))

    const input = host.querySelector('#search') as HTMLInputElement
    await act(async () => { setInputValue(input, 'dashboard') })

    expect(onFiltersChange).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(300) })

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'dashboard', page: 1 }))
  })

  it('a real Category selection calls onFiltersChange with the real category and page reset to 1', async () => {
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 3 }, onFiltersChange }))

    await selectOption('category', 'E-commerce')

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'ecommerce', page: 1 }))
  })

  it('selecting the real "All Templates" category clears category to undefined (never the literal string "all")', async () => {
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { category: 'blog', sort: 'most-used', page: 1 }, onFiltersChange }))

    await selectOption('category', 'All Templates')

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ category: undefined }))
  })

  it('a real Complexity selection calls onFiltersChange with the real complexity level', async () => {
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 1 }, onFiltersChange }))

    await selectOption('complexity', 'Advanced')

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ complexity: 'advanced', page: 1 }))
  })

  it('a real Sort selection calls onFiltersChange with the real sort value', async () => {
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 1 }, onFiltersChange }))

    await selectOption('sort', 'Newest')

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ sort: 'newest', page: 1 }))
  })

  it('a real tag click toggles it into the real filters.tags array', async () => {
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 1 }, onFiltersChange }))

    const chartsTag = Array.from(host.querySelectorAll('[class*="cursor-pointer"]')).find((el) => el.textContent?.startsWith('Charts')) as HTMLElement
    await act(async () => { chartsTag.click() })

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['Charts'] }))
  })

  it('clicking an already-selected real tag removes it, and clears tags to undefined when it was the last one', async () => {
    const onFiltersChange = vi.fn()
    render(React.createElement(TemplateFiltersComponent, { filters: { tags: ['Charts'], sort: 'most-used', page: 1 }, onFiltersChange }))

    const chartsTag = Array.from(host.querySelectorAll('[class*="cursor-pointer"]')).find((el) => el.textContent?.startsWith('Charts')) as HTMLElement
    await act(async () => { chartsTag.click() })

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ tags: undefined }))
  })

  it('never shows Clear Filters when there are genuinely no active filters', () => {
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 1 }, onFiltersChange: vi.fn() }))
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Clear Filters'))).toBe(false)
  })

  it('shows Clear Filters once a real filter is active, and clicking it resets to the real default filters', async () => {
    const onFiltersChange = vi.fn()
    const filters: TemplateFilters = { category: 'blog', complexity: 'advanced', tags: ['Forms'], search: 'x', sort: 'a-z', page: 4 }
    render(React.createElement(TemplateFiltersComponent, { filters, onFiltersChange }))

    const clearBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Clear Filters')) as HTMLButtonElement
    expect(clearBtn).toBeTruthy()
    await act(async () => { clearBtn.click() })

    expect(onFiltersChange).toHaveBeenCalledWith({ sort: 'most-used', page: 1 })
  })

  it('renders the real active-filters summary badges for category, complexity, search, and tags', () => {
    const filters: TemplateFilters = { category: 'dashboard', complexity: 'simple', tags: ['Analytics', 'CRUD'], search: 'crm', sort: 'most-used', page: 1 }
    render(React.createElement(TemplateFiltersComponent, { filters, onFiltersChange: vi.fn() }))

    expect(host.textContent).toContain('Category: Dashboard')
    expect(host.textContent).toContain('Complexity: Simple')
    expect(host.textContent).toContain('Search: crm')
    expect(host.textContent).toContain('Tag: Analytics')
    expect(host.textContent).toContain('Tag: CRUD')
  })

  it('never renders the active-filters summary section with no active filters', () => {
    render(React.createElement(TemplateFiltersComponent, { filters: { sort: 'most-used', page: 1 }, onFiltersChange: vi.fn() }))
    expect(host.textContent).not.toContain('Active filters:')
  })
})
