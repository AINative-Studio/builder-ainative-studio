// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CollapsibleSection } from '@/components/build/CollapsibleSection'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #803 — the real disclosure/accordion for the Live dashboard's middle
 * column. Defaults open (nothing should look newly hidden on first load);
 * a founder's collapse/expand choice persists per project + section.
 */

let host: HTMLElement
let root: Root

function render(props: { slug: string; sectionId: string; title: React.ReactNode }) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(
      React.createElement(
        CollapsibleSection,
        { ...props, children: React.createElement('p', { 'data-testid': 'body-content' }, 'section body') },
      ),
    )
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  window.localStorage.clear()
})

describe('CollapsibleSection (#803)', () => {
  it('defaults to open — body content is visible on first render', () => {
    render({ slug: 'acme', sectionId: 'tasks', title: 'Tonight' })
    expect(host.querySelector('[data-testid="body-content"]')).not.toBeNull()
    const toggle = host.querySelector('[data-testid="live-section-toggle-tasks"]')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses on click — body content is removed, aria-expanded flips false', () => {
    render({ slug: 'acme', sectionId: 'tasks', title: 'Tonight' })
    const toggle = host.querySelector('[data-testid="live-section-toggle-tasks"]') as HTMLButtonElement
    act(() => { toggle.click() })
    expect(host.querySelector('[data-testid="body-content"]')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands again on a second click', () => {
    render({ slug: 'acme', sectionId: 'tasks', title: 'Tonight' })
    const toggle = host.querySelector('[data-testid="live-section-toggle-tasks"]') as HTMLButtonElement
    act(() => { toggle.click() })
    act(() => { toggle.click() })
    expect(host.querySelector('[data-testid="body-content"]')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('persists a collapsed choice across remounts for the same project + section', () => {
    render({ slug: 'acme', sectionId: 'growth', title: 'Growth' })
    const toggle = host.querySelector('[data-testid="live-section-toggle-growth"]') as HTMLButtonElement
    act(() => { toggle.click() })
    act(() => { root.unmount() })
    host.remove()

    render({ slug: 'acme', sectionId: 'growth', title: 'Growth' })
    expect(host.querySelector('[data-testid="body-content"]')).toBeNull()
  })

  it('keeps collapse state independent per section id', () => {
    render({ slug: 'acme', sectionId: 'tasks', title: 'Tonight' })
    const toggle = host.querySelector('[data-testid="live-section-toggle-tasks"]') as HTMLButtonElement
    act(() => { toggle.click() })
    act(() => { root.unmount() })
    host.remove()

    render({ slug: 'acme', sectionId: 'growth', title: 'Growth' })
    expect(host.querySelector('[data-testid="body-content"]')).not.toBeNull()
  })
})
