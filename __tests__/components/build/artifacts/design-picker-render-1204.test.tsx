// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DESIGN_SYSTEMS } from '@/lib/design-systems/catalog'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — DesignPicker (components/build/artifacts/
 * DesignPicker.tsx, 93 lines, reached live via components/build/
 * ArtifactRouter.tsx <- components/build/screens/Workspace.tsx) had zero
 * test coverage. lib/design-systems/catalog.ts's DESIGN_SYSTEMS/
 * getDesignSystem are already independently tested — used here REAL, not
 * mocked.
 */

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goView: vi.fn(),
  state: {} as Record<string, any>,
}))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state, dispatch: h.dispatch, goView: h.goView }) }))

function baseState(overrides: Record<string, any> = {}) {
  return { designStepDone: false, companyName: '', track: 'app', designSystemId: null, ...overrides }
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
  h.dispatch.mockClear()
  h.goView.mockClear()
  h.state = {}
})

describe('DesignPicker — real pre/post-choice + per-track routing coverage (#1204)', () => {
  it('shows the real picker UI with every real design system card when design is genuinely not yet done', async () => {
    h.state = baseState()
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    expect(host.querySelector('[data-testid="design-picker-cards"]')).not.toBeNull()
    DESIGN_SYSTEMS.forEach((sys) => {
      expect(host.querySelector(`[data-testid="design-system-${sys.id}"]`)?.textContent).toContain(sys.name)
    })
  })

  it('a real click on a design-system card dispatches the real PICK_DESIGN_SYSTEM action with that real id', async () => {
    h.state = baseState()
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    const firstSystem = DESIGN_SYSTEMS[0]
    const card = host.querySelector(`[data-testid="design-system-${firstSystem.id}"]`) as HTMLButtonElement
    await act(async () => { card.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'PICK_DESIGN_SYSTEM', designSystemId: firstSystem.id })
  })

  it('a real Skip click dispatches the real SKIP_DESIGN_SYSTEM action', async () => {
    h.state = baseState()
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    const skipBtn = host.querySelector('[data-testid="design-picker-skip"]') as HTMLButtonElement
    await act(async () => { skipBtn.click() })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'SKIP_DESIGN_SYSTEM' })
  })

  it('shows the real "Got it — I\'ll pick a look" fallback confirmation once done with genuinely no chosen system', async () => {
    h.state = baseState({ designStepDone: true, designSystemId: null })
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    expect(host.textContent).toContain("I'll pick a look that fits your idea")
    expect(host.querySelector('[data-testid="design-picker-cards"]')).toBeNull()
  })

  it('shows the real chosen design system\'s name + direction once done with a genuinely real designSystemId', async () => {
    const chosen = DESIGN_SYSTEMS[0]
    h.state = baseState({ designStepDone: true, designSystemId: chosen.id, companyName: 'Acme Co' })
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    expect(host.textContent).toContain('Acme Co')
    expect(host.textContent).toContain(chosen.name)
    expect(host.textContent).toContain(chosen.direction.toLowerCase())
  })

  it('falls back to "your app" when done but companyName is genuinely empty', async () => {
    h.state = baseState({ designStepDone: true, designSystemId: null, companyName: '' })
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    expect(host.textContent).toContain('Got it')
  })

  it('a real "Keep building" click on the App track navigates to the real "brief" view', async () => {
    h.state = baseState({ designStepDone: true, track: 'app' })
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    const keepBuildingBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Keep building')) as HTMLButtonElement
    await act(async () => { keepBuildingBtn.click() })

    expect(h.goView).toHaveBeenCalledWith('brief')
  })

  it('a real "Keep building" click on the Company track navigates to the real "thesis" view (the real #Meridian per-track fix)', async () => {
    h.state = baseState({ designStepDone: true, track: 'company' })
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    const keepBuildingBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Keep building')) as HTMLButtonElement
    await act(async () => { keepBuildingBtn.click() })

    expect(h.goView).toHaveBeenCalledWith('thesis')
  })

  it('shows the real company name (or "your app" fallback) in the picker headline before a choice is made', async () => {
    h.state = baseState({ companyName: 'Widget Co' })
    const { DesignPicker } = await import('@/components/build/artifacts/DesignPicker')
    render(React.createElement(DesignPicker))

    expect(host.textContent).toContain('Pick a look for Widget Co.')
  })
})
