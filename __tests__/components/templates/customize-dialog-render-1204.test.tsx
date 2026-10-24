// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CustomizeDialog } from '@/components/templates/customize-dialog'
import type { Template } from '@/lib/types/template'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — CustomizeDialog (components/templates/customize
 * -dialog.tsx, 138 lines, reached live via app/templates/page.tsx) had zero
 * test coverage.
 */

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1', name: 'Dashboard Template', category: 'dashboard', description: 'A real dashboard',
    code: 'export function Page() { return null }', preview_image_url: null,
    tags: [], metadata: { placeholders: [], components_used: [], complexity: 'simple' },
    is_active: true, usage_count: 0, created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function baseProps(overrides: Record<string, any> = {}) {
  return { template: makeTemplate(), isOpen: true, onClose: vi.fn(), onGenerate: vi.fn(), ...overrides }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

describe('CustomizeDialog — real placeholder-labeling/default/generate coverage (#1204)', () => {
  it('renders genuinely nothing when there is no real template', () => {
    render(React.createElement(CustomizeDialog, baseProps({ template: null })))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows the real "no customizable placeholders" note when a template genuinely has none', () => {
    render(React.createElement(CustomizeDialog, baseProps()))
    expect(document.body.textContent).toContain('This template has no customizable placeholders')
  })

  it('converts a real camelCase placeholder into the real Title Case label, alongside the raw placeholder', () => {
    const template = makeTemplate({ metadata: { placeholders: ['{{dashboardTitle}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(CustomizeDialog, baseProps({ template })))

    expect(document.body.textContent).toContain('Dashboard Title')
    expect(document.body.textContent).toContain('{{dashboardTitle}}')
  })

  it('converts a real snake_case placeholder into the real Title Case label', () => {
    const template = makeTemplate({ metadata: { placeholders: ['{{primary_color}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(CustomizeDialog, baseProps({ template })))

    expect(document.body.textContent).toContain('Primary Color')
  })

  it('shows the real keyword-based default placeholder text for title/description/metric/value/color placeholders', () => {
    const template = makeTemplate({
      metadata: { placeholders: ['{{pageTitle}}', '{{pageDescription}}', '{{keyMetric}}', '{{totalValue}}', '{{brandColor}}'], components_used: [], complexity: 'simple' },
    })
    render(React.createElement(CustomizeDialog, baseProps({ template })))

    const inputs = Array.from(document.body.querySelectorAll('input'))
    expect(inputs[0].placeholder).toBe('My Dashboard')
    expect(inputs[1].placeholder).toBe('A beautiful dashboard')
    expect(inputs[2].placeholder).toBe('Revenue')
    expect(inputs[3].placeholder).toBe('1,234')
    expect(inputs[4].placeholder).toBe('#3b82f6')
  })

  it('falls back to the real raw placeholder string as the default when no real keyword matches', () => {
    const template = makeTemplate({ metadata: { placeholders: ['{{unmatchedThing}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(CustomizeDialog, baseProps({ template })))

    expect((document.body.querySelector('input') as HTMLInputElement).placeholder).toBe('{{unmatchedThing}}')
  })

  it('typing into a real placeholder field updates the real live preview section', async () => {
    const template = makeTemplate({ metadata: { placeholders: ['{{pageTitle}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(CustomizeDialog, baseProps({ template })))

    expect(document.body.textContent).not.toContain('→')
    const input = document.body.querySelector('input') as HTMLInputElement
    await act(async () => { setInputValue(input, 'My Real Title') })

    expect(document.body.textContent).toContain('{{pageTitle}}')
    expect(document.body.textContent).toContain('My Real Title')
    expect(document.body.textContent).toContain('→')
  })

  it('never shows a preview row for a real field that is still genuinely empty', async () => {
    const template = makeTemplate({ metadata: { placeholders: ['{{pageTitle}}', '{{pageDescription}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(CustomizeDialog, baseProps({ template })))

    const inputs = Array.from(document.body.querySelectorAll('input'))
    await act(async () => { setInputValue(inputs[0] as HTMLInputElement, 'Filled') })

    const previewRows = document.body.querySelectorAll('.font-mono.text-primary')
    expect(previewRows.length).toBe(1)
  })

  it('never shows a Preview section at all when the template genuinely has no placeholders', () => {
    render(React.createElement(CustomizeDialog, baseProps()))
    expect(document.body.textContent).not.toContain('Preview')
  })

  it('a real Cancel click calls the real onClose callback', async () => {
    const onClose = vi.fn()
    render(React.createElement(CustomizeDialog, baseProps({ onClose })))

    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement
    await act(async () => { cancelBtn.click() })
    expect(onClose).toHaveBeenCalled()
  })

  it('a real Generate click calls onGenerate with the real template and the real typed customizations, then calls onClose', async () => {
    const onGenerate = vi.fn()
    const onClose = vi.fn()
    const template = makeTemplate({ metadata: { placeholders: ['{{pageTitle}}'], components_used: [], complexity: 'simple' } })
    render(React.createElement(CustomizeDialog, baseProps({ template, onGenerate, onClose })))

    const input = document.body.querySelector('input') as HTMLInputElement
    await act(async () => { setInputValue(input, 'Real Title Value') })

    const generateBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Generate with Customizations')) as HTMLButtonElement
    await act(async () => { generateBtn.click() })

    expect(onGenerate).toHaveBeenCalledWith(template, { '{{pageTitle}}': 'Real Title Value' })
    expect(onClose).toHaveBeenCalled()
  })

  it('a real Generate click with no real placeholders still calls onGenerate with an empty customizations object', async () => {
    const onGenerate = vi.fn()
    const template = makeTemplate()
    render(React.createElement(CustomizeDialog, baseProps({ template, onGenerate })))

    const generateBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Generate with Customizations')) as HTMLButtonElement
    await act(async () => { generateBtn.click() })

    expect(onGenerate).toHaveBeenCalledWith(template, {})
  })
})
