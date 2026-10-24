// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ComponentMapper, parseA2UISpec, validateA2UIComponent, type A2UIComponent } from '@/components/a2ui/ComponentMapper'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ComponentMapper (components/a2ui/ComponentMapper.tsx,
 * 339 lines) had zero test coverage despite being the real dynamic-rendering core
 * reached live via A2UIPreview.tsx <- components/chat/preview-panel.tsx. A pure,
 * self-contained renderer (no fetch/store), so tested deeply rather than stubbed.
 */

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
  vi.restoreAllMocks()
})

describe('ComponentMapper — real dynamic A2UI rendering coverage (#1204)', () => {
  it('renders a real registered component type (button) with its real props and real children', () => {
    // component.children (not props.children) wins: ComponentMapper's JSX passes
    // children={renderChildren()} explicitly, after spreading component.props, so
    // an explicit children JSX prop always overrides any props.children value.
    const component: A2UIComponent = { type: 'button', id: 'btn-1', props: { variant: 'destructive' }, children: 'Click me' }
    render(React.createElement(ComponentMapper, { component }))

    const btn = host.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toBe('Click me')
  })

  it('shows the real "Unknown component type" fallback (not a crash) for an unregistered type', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const component: A2UIComponent = { type: 'totally-made-up-widget', id: 'x-1' }
    render(React.createElement(ComponentMapper, { component }))

    expect(host.textContent).toContain('Unknown component type: totally-made-up-widget')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('totally-made-up-widget'))
  })

  it('renders real string children directly', () => {
    const component: A2UIComponent = { type: 'text', id: 't-1', children: 'Hello from the agent' }
    render(React.createElement(ComponentMapper, { component }))

    expect(host.textContent).toBe('Hello from the agent')
  })

  it('recursively renders real array children into actual nested DOM nodes', () => {
    const component: A2UIComponent = {
      type: 'card',
      id: 'card-1',
      props: { title: 'Settings' },
      children: [
        { type: 'text', id: 'child-1', children: 'First line' },
        { type: 'text', id: 'child-2', children: 'Second line' },
      ],
    }
    render(React.createElement(ComponentMapper, { component }))

    expect(host.textContent).toContain('Settings')
    expect(host.textContent).toContain('First line')
    expect(host.textContent).toContain('Second line')
    expect(host.querySelectorAll('p').length).toBe(2)
  })

  it('wires a real event handler that calls onAction with the real component id/event/data context', () => {
    const onAction = vi.fn()
    const component: A2UIComponent = {
      type: 'button',
      id: 'submit-btn',
      props: { children: 'Submit', data: { formId: 'f1' } },
      events: { onClick: 'submitForm' },
    }
    render(React.createElement(ComponentMapper, { component, onAction }))

    const btn = host.querySelector('button') as HTMLButtonElement
    act(() => { btn.click() })

    expect(onAction).toHaveBeenCalledWith('submitForm', expect.objectContaining({
      componentId: 'submit-btn',
      event: 'onClick',
    }))
  })

  it('never crashes when a component has neither string nor array children', () => {
    const component: A2UIComponent = { type: 'separator', id: 'sep-1' }
    expect(() => render(React.createElement(ComponentMapper, { component }))).not.toThrow()
  })
})

describe('parseA2UISpec — real JSON parsing utility (#1204)', () => {
  it('parses genuinely valid A2UI JSON into the real component object', () => {
    const result = parseA2UISpec('{"type":"button","id":"b1"}')
    expect(result).toEqual({ type: 'button', id: 'b1' })
  })

  it('returns real null (never throws) for malformed JSON', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseA2UISpec('{not valid')).toBeNull()
  })
})

describe('validateA2UIComponent — real structural validation utility (#1204)', () => {
  it('accepts a genuinely valid component shape', () => {
    expect(validateA2UIComponent({ type: 'button', id: 'b1' })).toBe(true)
  })

  it('rejects null/non-object input', () => {
    expect(validateA2UIComponent(null)).toBe(false)
    expect(validateA2UIComponent('a string')).toBe(false)
  })

  it('rejects a component missing a real string type', () => {
    expect(validateA2UIComponent({ id: 'b1' })).toBe(false)
    expect(validateA2UIComponent({ type: 42, id: 'b1' })).toBe(false)
  })

  it('rejects a component missing a real string id', () => {
    expect(validateA2UIComponent({ type: 'button' })).toBe(false)
  })
})
