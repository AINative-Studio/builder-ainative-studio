// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ArtifactRouter (components/build/ArtifactRouter.tsx,
 * 49 lines, reached live via components/build/WorkspaceShell.tsx /
 * components/build/screens/Workspace.tsx) had zero direct test coverage —
 * it's only ever exercised indirectly through the individual artifact
 * components' own tests (Wedge/DesignPicker/Conflict/RescopeIntent), none of
 * which verify the router's OWN title/status/Body-resolution logic.
 *
 * ArtifactFrame is already heavily independently tested (3 dedicated test
 * files) — mocked here at its real boundary so this file isolates only
 * ArtifactRouter's own resolution logic: which Body component gets picked
 * for a given view, and what title/status ArtifactFrame receives.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any>, lastFrameProps: null as any }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))
vi.mock('@/components/build/ArtifactFrame', () => ({
  ArtifactFrame: (props: any) => {
    h.lastFrameProps = props
    return React.createElement('div', { 'data-testid': 'stub-artifact-frame' }, props.children)
  },
}))
vi.mock('@/components/build/artifacts/Swarm', () => ({ Swarm: () => React.createElement('div', { 'data-testid': 'body-swarm' }) }))
vi.mock('@/components/build/artifacts/Preview', () => ({ Preview: () => React.createElement('div', { 'data-testid': 'body-preview' }) }))
vi.mock('@/components/build/artifacts/Wedge', () => ({ Wedge: () => React.createElement('div', { 'data-testid': 'body-wedge' }) }))
vi.mock('@/components/build/artifacts/DesignPicker', () => ({ DesignPicker: () => React.createElement('div', { 'data-testid': 'body-design' }) }))
vi.mock('@/components/build/artifacts/Pipeline', () => ({ Pipeline: () => React.createElement('div', { 'data-testid': 'body-pipeline' }) }))
vi.mock('@/components/build/artifacts/Conflict', () => ({ Conflict: () => React.createElement('div', { 'data-testid': 'body-conflict' }) }))
vi.mock('@/components/build/artifacts/Graph', () => ({ Graph: () => React.createElement('div', { 'data-testid': 'body-graph' }) }))
vi.mock('@/components/build/artifacts/RescopeIntent', () => ({ RescopeIntent: () => React.createElement('div', { 'data-testid': 'body-rescope-intent' }) }))
vi.mock('@/components/build/artifacts/app-artifacts', () => ({
  APP_ARTIFACT_BODIES: { prd: () => React.createElement('div', { 'data-testid': 'body-prd' }) },
}))
vi.mock('@/components/build/artifacts/company-artifacts', () => ({
  COMPANY_ARTIFACT_BODIES: { thesis: () => React.createElement('div', { 'data-testid': 'body-thesis' }) },
}))

import { ArtifactRouter } from '@/components/build/ArtifactRouter'

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
  h.state = {}
  h.lastFrameProps = null
})

describe('ArtifactRouter — real view-to-Body/title/status resolution coverage (#1204)', () => {
  it('resolves a real SPECIAL_BODIES entry (wedge) over any app/company body with the same key', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'wedge' }))

    expect(host.querySelector('[data-testid="body-wedge"]')).not.toBeNull()
  })

  it('resolves a real APP_ARTIFACT_BODIES entry when the view has no SPECIAL_BODIES match', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'prd' }))

    expect(host.querySelector('[data-testid="body-prd"]')).not.toBeNull()
  })

  it('resolves a real COMPANY_ARTIFACT_BODIES entry when neither SPECIAL_BODIES nor app bodies match', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'thesis' }))

    expect(host.querySelector('[data-testid="body-thesis"]')).not.toBeNull()
  })

  it('passes undefined children to ArtifactFrame for a genuinely unmapped view, never crashing', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'totally-unmapped-view' }))

    expect(h.lastFrameProps.children).toBeUndefined()
  })

  it('resolves the real title from ARTIFACT_TITLES, falling back to the raw view string when absent', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'prd' }))
    expect(h.lastFrameProps.title).toBe(ARTIFACT_TITLES['prd'])

    act(() => { root.unmount() })
    host.remove()
    render(React.createElement(ArtifactRouter, { view: 'some-unknown-view-xyz' }))
    expect(h.lastFrameProps.title).toBe('some-unknown-view-xyz')
  })

  it('passes the real per-view done status from state.done when genuinely present', () => {
    h.state = { done: { wedge: 'complete' }, building: true }
    render(React.createElement(ArtifactRouter, { view: 'wedge' }))

    expect(h.lastFrameProps.status).toBe('complete')
  })

  it('falls back to "building" when state.building is genuinely true and no done status exists', () => {
    h.state = { done: {}, building: true }
    render(React.createElement(ArtifactRouter, { view: 'wedge' }))

    expect(h.lastFrameProps.status).toBe('building')
  })

  it('falls back to "queued" when genuinely not building and no done status exists', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'wedge' }))

    expect(h.lastFrameProps.status).toBe('queued')
  })

  it('passes the real view prop straight through to ArtifactFrame', () => {
    h.state = { done: {}, building: false }
    render(React.createElement(ArtifactRouter, { view: 'conflict' }))

    expect(h.lastFrameProps.view).toBe('conflict')
  })
})
