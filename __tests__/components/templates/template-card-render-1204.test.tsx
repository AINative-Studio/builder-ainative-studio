// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TemplateCard } from '@/components/templates/template-card'
import type { Template } from '@/lib/types/template'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — TemplateCard (components/templates/template
 * -card.tsx, 128 lines, reached live via app/templates/page.tsx) had zero
 * test coverage.
 */

vi.mock('next/image', () => ({
  default: (props: any) => React.createElement('img', { 'data-testid': 'stub-next-image', src: props.src, alt: props.alt }),
}))

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1', name: 'Dashboard Template', category: 'dashboard', description: 'A real dashboard template',
    code: 'x', preview_image_url: null, tags: ['analytics', 'charts'],
    metadata: { placeholders: [], components_used: [], complexity: 'simple' },
    is_active: true, usage_count: 42, created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
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

function baseProps(overrides: Record<string, any> = {}) {
  return { template: makeTemplate(), onPreview: vi.fn(), onUseTemplate: vi.fn(), ...overrides }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('TemplateCard — real click-propagation/formatting coverage (#1204)', () => {
  it('a real click anywhere on the card calls onPreview with the real template', async () => {
    const onPreview = vi.fn()
    const template = makeTemplate()
    render(React.createElement(TemplateCard, baseProps({ template, onPreview })))

    const card = host.querySelector('[data-slot="card"]') as HTMLElement
    await act(async () => { card.click() })

    expect(onPreview).toHaveBeenCalledWith(template)
  })

  it('a real click on the Preview button calls onPreview exactly once (stops propagation, never double-fires via the card click too)', async () => {
    const onPreview = vi.fn()
    render(React.createElement(TemplateCard, baseProps({ onPreview })))

    const previewBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Preview')) as HTMLButtonElement
    await act(async () => { previewBtn.click() })

    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('a real click on "Use Template" calls onUseTemplate with the real template, and never calls onPreview at all', async () => {
    const onPreview = vi.fn()
    const onUseTemplate = vi.fn()
    const template = makeTemplate()
    render(React.createElement(TemplateCard, baseProps({ template, onPreview, onUseTemplate })))

    const useBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Use Template')) as HTMLButtonElement
    await act(async () => { useBtn.click() })

    expect(onUseTemplate).toHaveBeenCalledWith(template)
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('shows the real "No preview available" category icon fallback when preview_image_url is genuinely null', () => {
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ preview_image_url: null, category: 'ecommerce' }) })))
    expect(host.querySelector('[data-testid="stub-next-image"]')).toBeNull()
    expect(host.textContent).toContain('🛒')
  })

  it('renders the real preview image when preview_image_url is genuinely present', () => {
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ preview_image_url: 'https://cdn.example.com/x.png' }) })))
    expect((host.querySelector('[data-testid="stub-next-image"]') as HTMLImageElement).getAttribute('src')).toBe('https://cdn.example.com/x.png')
  })

  it('truncates a real description longer than 100 chars, leaves a real short one untouched', () => {
    const long = 'x'.repeat(150)
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ description: long }) })))
    expect(host.textContent).toContain('x'.repeat(100) + '...')
    expect(host.textContent).not.toContain('x'.repeat(101))
  })

  it('shows the real K-suffix usage count over 1000, the real raw count otherwise', () => {
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ usage_count: 2500 }) })))
    expect(host.textContent).toContain('2.5K uses')

    act(() => { root.unmount() })
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ usage_count: 42 }) })))
    expect(host.textContent).toContain('42 uses')
  })

  it('shows at most the real first 3 tags, with a real "+N more" badge for any remainder', () => {
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ tags: ['a', 'b', 'c', 'd', 'e'] }) })))
    expect(host.textContent).toContain('a')
    expect(host.textContent).toContain('b')
    expect(host.textContent).toContain('c')
    expect(host.textContent).not.toContain('>d<')
    expect(host.textContent).toContain('+2 more')
  })

  it('never shows a "+N more" badge when there are genuinely 3 or fewer tags', () => {
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ tags: ['a', 'b'] }) })))
    expect(host.textContent).not.toContain('more')
  })

  it('renders the real template name and category badge', () => {
    render(React.createElement(TemplateCard, baseProps({ template: makeTemplate({ name: 'Acme Dashboard', category: 'admin' }) })))
    expect(host.textContent).toContain('Acme Dashboard')
    expect(host.textContent).toContain('admin')
  })
})
