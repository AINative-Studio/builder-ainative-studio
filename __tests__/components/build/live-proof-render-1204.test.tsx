// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { LiveProof } from '@/lib/build/useLiveProof'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — LiveProof (components/build/LiveProof.tsx,
 * 44 lines) had zero component-level test coverage — only the underlying
 * useLiveProof hook is tested. Reached live via the front-door page (where
 * #222's own doc comment says it surfaces the /intelligence loop). Mocked
 * at useLiveProof's real exported boundary (same pattern as
 * live-ticker-render-1204.test.tsx).
 */

const h = vi.hoisted(() => ({ proof: {} as LiveProof }))
vi.mock('@/lib/build/useLiveProof', () => ({ useLiveProof: () => h.proof }))

function makeProof(overrides: Partial<LiveProof> = {}): LiveProof {
  return { agentsActive: null, tasksToday: null, apiRequestsToday: null, companiesBuilt: null, ...overrides }
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
  h.proof = {} as LiveProof
})

describe('LiveProof — real number-formatting/stat-filtering coverage (#1204)', () => {
  it('renders nothing when every real stat is genuinely null', async () => {
    h.proof = makeProof()
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    expect(host.innerHTML).toBe('')
  })

  it('renders only the real stats that are genuinely non-null, omitting the rest', async () => {
    h.proof = makeProof({ agentsActive: 7 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    const stats = Array.from(host.querySelectorAll('.m-proof-stat'))
    expect(stats).toHaveLength(1)
    expect(stats[0].textContent).toContain('agents working now')
  })

  it('shows the real live-dot only on the agentsActive stat, never on tasksToday/companiesBuilt', async () => {
    h.proof = makeProof({ agentsActive: 5, tasksToday: 10, companiesBuilt: 3 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    const stats = Array.from(host.querySelectorAll('.m-proof-stat'))
    const agentsStat = stats.find((s) => s.textContent?.includes('agents working now'))
    const tasksStat = stats.find((s) => s.textContent?.includes('agent tasks today'))
    expect(agentsStat?.querySelector('.m-live-dot')).not.toBeNull()
    expect(tasksStat?.querySelector('.m-live-dot')).toBeNull()
  })

  it('renders a real raw number under 1000 with no suffix', async () => {
    h.proof = makeProof({ tasksToday: 340 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    expect(host.querySelector('.m-proof-num')?.textContent).toBe('340')
  })

  it('formats a real number >= 1000 and < 10000 with one decimal + "k"', async () => {
    h.proof = makeProof({ companiesBuilt: 2345 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    expect(host.querySelector('.m-proof-num')?.textContent).toBe('2.3k')
  })

  it('formats a real number >= 10000 with NO decimal, just "k"', async () => {
    h.proof = makeProof({ companiesBuilt: 15234 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    expect(host.querySelector('.m-proof-num')?.textContent).toBe('15k')
  })

  it('formats the real boundary value 1000 as "1.0k", and 10000 exactly as "10k"', async () => {
    h.proof = makeProof({ tasksToday: 1000 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))
    expect(host.querySelector('.m-proof-num')?.textContent).toBe('1.0k')

    act(() => { root.unmount() })
    host.remove()
    h.proof = makeProof({ tasksToday: 10000 })
    const { LiveProof: LP2 } = await import('@/components/build/LiveProof')
    render(React.createElement(LP2))
    expect(host.querySelector('.m-proof-num')?.textContent).toBe('10k')
  })

  it('renders the real attribution tagline when at least one stat is present', async () => {
    h.proof = makeProof({ agentsActive: 1 })
    const { LiveProof } = await import('@/components/build/LiveProof')
    render(React.createElement(LiveProof))

    expect(host.textContent).toContain('built in real time, 24/7, by its own agents')
  })
})
