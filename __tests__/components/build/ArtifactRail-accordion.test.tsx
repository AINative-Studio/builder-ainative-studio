// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #652 — the Artifacts rail defaults to a nested accordion (collapsed
 * categories), but forces every category expanded while Cody is actively
 * driving the build (state.auto). A founder's own explicit collapse mid-run
 * is never overridden again for the rest of that run, and the resulting
 * layout persists per-project (localStorage) across visits.
 */

let mockState: any
const dispatchMock = vi.fn()
const goViewMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: mockState, dispatch: dispatchMock, goView: goViewMock }),
}))

import { ArtifactRail } from '@/components/build/ArtifactRail'

let host: HTMLElement
let root: Root

function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(React.createElement(ArtifactRail)) })
}

function baseState(overrides: Partial<any> = {}) {
  return {
    railOpen: true,
    appSub: 'ember-box',
    track: 'app',
    view: 'design',
    auto: true,
    done: { design: 'done', brief: 'done', dataModel: 'done' },
    ...overrides,
  }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

describe('ArtifactRail accordion (#652)', () => {
  it('while Cody is actively driving (auto=true), every category renders expanded', () => {
    mockState = baseState({ auto: true })
    render()
    // 'Product' category holds design/brief (both done) — its items should render.
    expect(host.querySelector('[data-testid="rail-cat-toggle-Product"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelectorAll('.m-rail-item').length).toBeGreaterThan(0)
  })

  it('once idle (auto=false) with no saved preference, categories default to expanded too (nothing collapsed yet)', () => {
    mockState = baseState({ auto: false })
    render()
    expect(host.querySelector('[data-testid="rail-cat-toggle-Product"]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('once idle, a previously-collapsed category (persisted from an earlier visit) renders collapsed', () => {
    window.localStorage.setItem('ainative-builder-artifact-rail-ember-box', JSON.stringify(['Product']))
    mockState = baseState({ auto: false })
    render()
    expect(host.querySelector('[data-testid="rail-cat-toggle-Product"]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('clicking a category toggle collapses it and persists the choice for this project', () => {
    mockState = baseState({ auto: false })
    render()
    const toggle = host.querySelector('[data-testid="rail-cat-toggle-Product"]') as HTMLButtonElement
    act(() => { toggle.click() })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(JSON.parse(window.localStorage.getItem('ainative-builder-artifact-rail-ember-box') || '[]')).toContain('Product')
  })

  it('collapsing a category mid-run (auto=true) marks an explicit override, so a later re-render never force-reopens it', () => {
    mockState = baseState({ auto: true })
    render()
    const toggle = host.querySelector('[data-testid="rail-cat-toggle-Product"]') as HTMLButtonElement
    act(() => { toggle.click() })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(window.sessionStorage.getItem('ainative-builder-artifact-rail-override-ember-box')).toBe('1')

    // Re-render as if new artifacts arrived (still auto=true, same project) —
    // the collapsed category must NOT be forced back open.
    act(() => { root.unmount() })
    render()
    const toggleAfter = host.querySelector('[data-testid="rail-cat-toggle-Product"]') as HTMLButtonElement
    expect(toggleAfter.getAttribute('aria-expanded')).toBe('false')
  })

  it('a category never touched by the founder still force-expands mid-run even after another category was overridden', () => {
    mockState = baseState({ auto: true })
    render()
    const productToggle = host.querySelector('[data-testid="rail-cat-toggle-Product"]') as HTMLButtonElement
    act(() => { productToggle.click() }) // collapses Product, marks override
    const deliveryToggle = host.querySelector('[data-testid="rail-cat-toggle-Delivery"]')
    // Delivery was never touched — falls through to the (empty) collapsed list, stays expanded.
    expect(deliveryToggle?.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders nothing when the rail is closed', () => {
    mockState = baseState({ railOpen: false })
    render()
    expect(host.innerHTML).toBe('')
  })
})
