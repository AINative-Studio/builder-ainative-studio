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
 * #1204 (Coverage Phase 4) — EcosystemRunwayNote
 * (components/build/EcosystemRunwayNote.tsx, 21 lines, reached live via
 * components/build/screens/Workspace.tsx) had zero test coverage.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))

import { EcosystemRunwayNote } from '@/components/build/EcosystemRunwayNote'

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
})

describe('EcosystemRunwayNote — real server-copy passthrough coverage (#1204)', () => {
  it('renders nothing when state.runwayNote is genuinely absent', () => {
    h.state = { runwayNote: undefined }
    render(React.createElement(EcosystemRunwayNote))

    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when state.runwayNote is a genuinely empty string', () => {
    h.state = { runwayNote: '' }
    render(React.createElement(EcosystemRunwayNote))

    expect(host.innerHTML).toBe('')
  })

  it('renders the real server-provided copy verbatim once genuinely present', () => {
    h.state = { runwayNote: "You've earned 3 extra days of runway by composing ZeroMemory + ZeroVoice." }
    render(React.createElement(EcosystemRunwayNote))

    const el = host.querySelector('[data-testid="ecosystem-runway-note"]')
    expect(el?.textContent).toContain("You've earned 3 extra days of runway by composing ZeroMemory + ZeroVoice.")
  })
})
