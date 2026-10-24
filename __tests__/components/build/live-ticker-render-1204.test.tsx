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
 * #1204 (Coverage Phase 4) — LiveTicker (components/build/LiveTicker.tsx,
 * 54 lines, reached live via components/build/screens/Fork.tsx) had zero
 * test coverage. useLiveProof is already independently tested
 * (__tests__/lib/build/useLiveProof.test.ts) — mocked here at its real
 * exported boundary rather than re-tested.
 */

const h = vi.hoisted(() => ({ proof: {} as LiveProof }))
vi.mock('@/lib/build/useLiveProof', () => ({ useLiveProof: () => h.proof }))

function makeProof(overrides: Partial<LiveProof> = {}): LiveProof {
  return { agentsActive: 12, tasksToday: 340, apiRequestsToday: null, companiesBuilt: null, ...overrides }
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
  vi.useRealTimers()
})

describe('LiveTicker — real line-building/rotation coverage (#1204)', () => {
  it('renders nothing when agentsActive is genuinely null — never fabricates', async () => {
    h.proof = makeProof({ agentsActive: null })
    const { LiveTicker } = await import('@/components/build/LiveTicker')
    render(React.createElement(LiveTicker))

    expect(host.innerHTML).toBe('')
  })

  it('shows the real LIVE strip with the real first line once agentsActive is genuinely present', async () => {
    h.proof = makeProof({ agentsActive: 12, tasksToday: 340 })
    const { LiveTicker } = await import('@/components/build/LiveTicker')
    render(React.createElement(LiveTicker))

    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(host.textContent).toContain('LIVE')
    expect(host.textContent).toContain('12 agents working across the platform right now')
  })

  it('inserts the real tasksToday line as the second line only when tasksToday is genuinely non-null', async () => {
    h.proof = makeProof({ agentsActive: 5, tasksToday: 99 })
    const { LiveTicker } = await import('@/components/build/LiveTicker')
    vi.useFakeTimers()
    render(React.createElement(LiveTicker))

    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    expect(host.querySelector('.m-ticker-line')?.textContent).toBe('99 agent tasks completed in the last 24h')
  })

  it('never shows a tasksToday line when tasksToday is genuinely null — the line list shrinks by one', async () => {
    h.proof = makeProof({ agentsActive: 5, tasksToday: null })
    const { LiveTicker } = await import('@/components/build/LiveTicker')
    vi.useFakeTimers()
    render(React.createElement(LiveTicker))

    const seen = new Set<string>()
    for (let i = 0; i < 4; i++) {
      seen.add(host.querySelector('.m-ticker-line')!.textContent!)
      await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    }

    expect(Array.from(seen).some((l) => l.includes('agent tasks completed'))).toBe(false)
  })

  it('rotates through the real lines every 2600ms and wraps back to the first', async () => {
    h.proof = makeProof({ agentsActive: 7, tasksToday: 50 })
    const { LiveTicker } = await import('@/components/build/LiveTicker')
    vi.useFakeTimers()
    render(React.createElement(LiveTicker))

    const first = host.querySelector('.m-ticker-line')!.textContent
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    const second = host.querySelector('.m-ticker-line')!.textContent
    expect(second).not.toBe(first)

    // 5 real lines total with tasksToday present (4 base + 1 spliced in) —
    // already one tick in, so 4 more ticks wraps back to the first.
    await act(async () => { await vi.advanceTimersByTimeAsync(2600 * 4) })
    expect(host.querySelector('.m-ticker-line')!.textContent).toBe(first)
  })

  it('renders the real "watch the loop" link pointed at the real intelligence URL', async () => {
    h.proof = makeProof()
    const { LiveTicker } = await import('@/components/build/LiveTicker')
    render(React.createElement(LiveTicker))

    const link = host.querySelector('a') as HTMLAnchorElement
    expect(link.href).toBe('https://ainative.studio/intelligence')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noreferrer')
  })
})
