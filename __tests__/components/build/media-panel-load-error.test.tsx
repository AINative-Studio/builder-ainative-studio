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
 * MediaPanel — honest load-failure state, same bug shape as the
 * WaitlistPanel/VisitorsPanel/GrowthPanel/TasksPanel fixes.
 *
 * Real bug: a non-ok response (or a thrown fetch) from /api/build/media was
 * swallowed identically to a genuinely fresh workspace — showing "not
 * configured" / "No media yet" / "Not scheduled" even though real routines
 * and assets exist. A founder re-starting a routine that looks idle but is
 * actually already running risks a real duplicate image/video generation
 * cost (same shape of risk as the GrowthPanel double-charge fix).
 */

import { MediaPanel } from '@/components/build/MediaPanel'

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

describe('MediaPanel — load failure vs. genuine fresh workspace', () => {
  it('shows the honest error state on a non-ok response, never the "not configured" note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) as any))

    render(<MediaPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('media-error')).toBeTruthy()
    expect(q('media-disabled-note')).toBeFalsy()
    expect(q('media-kind-image')).toBeFalsy()
  })

  it('shows the honest error state when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    render(<MediaPanel companyId="agentive" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('media-error')).toBeTruthy()
    expect(q('media-kind-image')).toBeFalsy()
  })

  it('still shows the genuine fresh-workspace state on a real ok:true, empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ routines: [], assets: [], configured: false, nextRuns: {} }),
    }) as any))

    render(<MediaPanel companyId="fresh" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('media-error')).toBeFalsy()
    expect(q('media-disabled-note')).toBeTruthy()
    expect(q('media-kind-image')).toBeTruthy()
  })

  it('clears a prior error once a retry (company change) succeeds', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('companyId=broken')) {
        return { ok: false, status: 503, json: async () => ({}) } as any
      }
      return { ok: true, json: async () => ({ routines: [], assets: [], configured: true, nextRuns: {} }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<MediaPanel companyId="broken" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(q('media-error')).toBeTruthy()

    await act(async () => { root.render(<MediaPanel companyId="fine" />) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('media-error')).toBeFalsy()
    expect(q('media-kind-image')).toBeTruthy()
  })
})
