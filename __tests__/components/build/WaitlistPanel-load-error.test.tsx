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
 * WaitlistPanel — honest load-failure state (#1316-class fix).
 *
 * Real bug: a non-ok response from /api/build/waitlist (now returned as a
 * 503 when the registry lookup itself couldn't be verified — see
 * app/api/build/waitlist/route.ts) used to be swallowed identically to a
 * genuinely empty waitlist, so the panel showed "No signups yet" even though
 * the real answer was "couldn't check." The panel must now tell these apart.
 */

import { WaitlistPanel } from '@/components/build/WaitlistPanel'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function q(testid: string): HTMLElement | null {
  return host.querySelector(`[data-testid="${testid}"]`)
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WaitlistPanel — load failure vs. genuine empty state', () => {
  it('shows the honest error state on a non-ok response, never "No signups yet"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, reason: 'lookup_failed' }) }) as any))

    render(<WaitlistPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve() })

    expect(q('waitlist-error')).toBeTruthy()
    expect(q('waitlist-empty')).toBeFalsy()
    expect(q('waitlist-count')?.textContent).toContain('0 signup')
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<WaitlistPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve() })

    expect(q('waitlist-error')).toBeTruthy()
    expect(q('waitlist-empty')).toBeFalsy()
  })

  it('still shows the genuine empty state on a real ok:true, entries:[] response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries: [] }) }) as any))

    render(<WaitlistPanel companyId="fresh" />)
    await act(async () => { await Promise.resolve() })

    expect(q('waitlist-empty')).toBeTruthy()
    expect(q('waitlist-error')).toBeFalsy()
  })

  it('renders the real list on success, with no error state', async () => {
    const entries = [{ email: 'a@x.com', joinedAt: '2026-09-20T00:00:00.000Z' }]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries }) }) as any))

    render(<WaitlistPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve() })

    expect(q('waitlist-error')).toBeFalsy()
    expect(q('waitlist-list')).toBeTruthy()
    expect(q('waitlist-count')?.textContent).toContain('1 signup')
  })
})
