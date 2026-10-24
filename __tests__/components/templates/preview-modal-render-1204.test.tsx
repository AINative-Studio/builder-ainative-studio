// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { PreviewModal } from '@/components/templates/preview-modal'
import type { Template } from '@/lib/types/template'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — PreviewModal (components/templates/preview
 * -modal.tsx, 230 lines, reached live via app/templates/page.tsx) had zero
 * test coverage.
 *
 * react-syntax-highlighter is mocked — third-party code-display library,
 * jsdom has no real syntax highlighter (same precedent as
 * template-review-modal-render-1204.test.tsx).
 */

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: string }) => React.createElement('pre', { 'data-testid': 'code-pre' }, children),
}))
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ vscDarkPlus: {} }))
vi.mock('next/image', () => ({
  default: (props: any) => React.createElement('img', { 'data-testid': 'stub-next-image', src: props.src, alt: props.alt }),
}))

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1',
    name: 'Landing Page',
    category: 'landing',
    description: 'A real landing page template',
    code: 'export function Page() { return <div>Hi</div> }',
    preview_image_url: null,
    tags: ['landing', 'marketing'],
    metadata: { placeholders: [], components_used: ['Button', 'Card'], complexity: 'simple' },
    is_active: true,
    usage_count: 42,
    created_at: new Date('2026-01-10T00:00:00Z'),
    updated_at: new Date('2026-01-10T00:00:00Z'),
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

/** Radix TabsTrigger switches via onMouseDown, not onClick — confirmed by
 *  reading @radix-ui/react-tabs/dist/index.mjs directly earlier this pass
 *  (template-review-modal-render-1204.test.tsx). Reused here verbatim. */
async function clickTab(label: string) {
  const tab = Array.from(document.body.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.trim() === label) as HTMLElement
  await act(async () => {
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

function baseProps(overrides: Record<string, any> = {}) {
  return { template: makeTemplate(), isOpen: true, onClose: vi.fn(), onUseTemplate: vi.fn(), onCustomize: vi.fn(), ...overrides }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('PreviewModal — real template detail/tabs/action coverage (#1204)', () => {
  it('renders genuinely nothing when there is no real template', () => {
    render(React.createElement(PreviewModal, baseProps({ template: null })))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the real template name, category, complexity, and description', () => {
    render(React.createElement(PreviewModal, baseProps()))
    expect(document.body.textContent).toContain('Landing Page')
    expect(document.body.textContent).toContain('landing')
    expect(document.body.textContent).toContain('simple')
    expect(document.body.textContent).toContain('A real landing page template')
  })

  it('shows the real "No preview available" placeholder with the category icon when preview_image_url is genuinely null', () => {
    render(React.createElement(PreviewModal, baseProps({ template: makeTemplate({ preview_image_url: null, category: 'ecommerce' }) })))
    expect(document.body.textContent).toContain('No preview available')
    expect(document.body.querySelector('[data-testid="stub-next-image"]')).toBeNull()
  })

  it('renders the real preview image when a preview_image_url is genuinely present', () => {
    render(React.createElement(PreviewModal, baseProps({ template: makeTemplate({ preview_image_url: 'https://cdn.example.com/x.png' }) })))
    const img = document.body.querySelector('[data-testid="stub-next-image"]') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/x.png')
  })

  it('never shows navigation chevrons when neither onNext nor onPrevious are given', () => {
    render(React.createElement(PreviewModal, baseProps()))
    expect(document.body.querySelector('button svg.lucide-chevron-left')).toBeNull()
    expect(document.body.querySelector('button svg.lucide-chevron-right')).toBeNull()
  })

  it('shows and wires only the real onPrevious button when onNext is genuinely absent', async () => {
    const onPrevious = vi.fn()
    render(React.createElement(PreviewModal, baseProps({ onPrevious })))

    const prevBtn = document.body.querySelector('button svg.lucide-chevron-left')?.closest('button') as HTMLButtonElement
    expect(prevBtn).not.toBeNull()
    expect(document.body.querySelector('button svg.lucide-chevron-right')).toBeNull()

    await act(async () => { prevBtn.click() })
    expect(onPrevious).toHaveBeenCalled()
  })

  it('shows and wires the real onNext button', async () => {
    const onNext = vi.fn()
    render(React.createElement(PreviewModal, baseProps({ onNext })))

    const nextBtn = document.body.querySelector('button svg.lucide-chevron-right')?.closest('button') as HTMLButtonElement
    await act(async () => { nextBtn.click() })
    expect(onNext).toHaveBeenCalled()
  })

  it('the real Details tab renders real tags, components used, placeholders-empty note, and formatted usage/date', async () => {
    const template = makeTemplate({
      tags: ['saas', 'b2b'],
      metadata: { placeholders: [], components_used: ['Table'], complexity: 'medium' },
      usage_count: 2500,
      // Midday UTC avoids the real date rolling back a day when
      // toLocaleDateString renders in the test runner's local timezone —
      // a genuine finding, not a test bug: formatDate's own implementation
      // has no explicit timeZone option.
      created_at: new Date('2026-03-05T12:00:00Z'),
    })
    render(React.createElement(PreviewModal, baseProps({ template })))
    await clickTab('Details')

    expect(document.body.textContent).toContain('saas')
    expect(document.body.textContent).toContain('Table')
    expect(document.body.textContent).toContain('No placeholders')
    expect(document.body.textContent).toContain('2.5K uses')
    expect(document.body.textContent).toContain('Created Mar 5, 2026')
  })

  it('renders real placeholder tokens in the Details tab when genuinely present (never the empty note)', async () => {
    const template = makeTemplate({ metadata: { placeholders: ['{{company_name}}', '{{logo_url}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(PreviewModal, baseProps({ template })))
    await clickTab('Details')

    expect(document.body.textContent).toContain('{{company_name}}')
    expect(document.body.textContent).toContain('{{logo_url}}')
    expect(document.body.textContent).not.toContain('No placeholders')
  })

  it('shows the real raw usage count under 1000 without a K suffix', async () => {
    render(React.createElement(PreviewModal, baseProps({ template: makeTemplate({ usage_count: 42 }) })))
    await clickTab('Details')
    expect(document.body.textContent).toContain('42 uses')
  })

  it('the real Code tab renders the real template code via the (mocked) syntax highlighter', async () => {
    render(React.createElement(PreviewModal, baseProps({ template: makeTemplate({ code: 'const x = 1' }) })))
    await clickTab('Code')
    expect(document.body.querySelector('[data-testid="code-pre"]')?.textContent).toBe('const x = 1')
  })

  it('a real Close click calls the real onClose callback', async () => {
    const onClose = vi.fn()
    render(React.createElement(PreviewModal, baseProps({ onClose })))

    const closeBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Close') as HTMLButtonElement
    await act(async () => { closeBtn.click() })
    expect(onClose).toHaveBeenCalled()
  })

  it('a real Customize click calls onCustomize with the real template', async () => {
    const onCustomize = vi.fn()
    const template = makeTemplate()
    render(React.createElement(PreviewModal, baseProps({ template, onCustomize })))

    const customizeBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Customize')) as HTMLButtonElement
    await act(async () => { customizeBtn.click() })
    expect(onCustomize).toHaveBeenCalledWith(template)
  })

  it('a real "Use This Template" click calls onUseTemplate with the real template', async () => {
    const onUseTemplate = vi.fn()
    const template = makeTemplate()
    render(React.createElement(PreviewModal, baseProps({ template, onUseTemplate })))

    const useBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Use This Template')) as HTMLButtonElement
    await act(async () => { useBtn.click() })
    expect(onUseTemplate).toHaveBeenCalledWith(template)
  })
})
