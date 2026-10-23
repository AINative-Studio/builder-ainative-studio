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
 * VisitorsPanel — honest load-failure state (#1316-class fix).
 *
 * Mirrors WaitlistPanel-load-error.test.tsx verbatim. A non-ok response from
 * /api/build/visitors (now returned as a 503 when the registry lookup
 * itself couldn't be verified — see app/api/build/visitors/route.ts) used to
 * be swallowed identically to a genuinely empty visitor list, so the panel
 * showed "No visits yet" even though the real answer was "couldn't check."
 */

import { VisitorsPanel } from '@/components/build/VisitorsPanel'

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

describe('VisitorsPanel — load failure vs. genuine empty state', () => {
  it('shows the honest error state on a non-ok response, never "No visits yet"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, reason: 'lookup_failed' }) }) as any))

    render(<VisitorsPanel companyId="beacon" />)
    await act(async () => { await Promise.resolve() })

    expect(q('visitors-error')).toBeTruthy()
    expect(q('visitors-empty')).toBeFalsy()
    expect(q('visitors-count')?.textContent).toContain('0 visit')
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<VisitorsPanel companyId="beacon" />)
    await act(async () => { await Promise.resolve() })

    expect(q('visitors-error')).toBeTruthy()
    expect(q('visitors-empty')).toBeFalsy()
  })

  it('still shows the genuine empty state on a real ok:true, entries:[] response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ visitors: 0, entries: [] }) }) as any))

    render(<VisitorsPanel companyId="fresh" />)
    await act(async () => { await Promise.resolve() })

    expect(q('visitors-empty')).toBeTruthy()
    expect(q('visitors-error')).toBeFalsy()
  })

  it('renders the real list on success, with no error state', async () => {
    const entries = [{ path: '/api/preview/chat-beacon', visitedAt: '2026-10-19T00:00:00.000Z' }]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ visitors: 1, entries }) }) as any))

    render(<VisitorsPanel companyId="beacon" />)
    await act(async () => { await Promise.resolve() })

    expect(q('visitors-error')).toBeFalsy()
    expect(q('visitors-list')).toBeTruthy()
    expect(q('visitors-count')?.textContent).toContain('1 visit')
  })
})
