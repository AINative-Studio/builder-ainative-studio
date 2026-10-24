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
 * GrowthPanel — status-load failure must not be indistinguishable from "no
 * campaign yet."
 *
 * Real bug: `load()` used to do `fetch(...).then((r) => (r.ok ? r.json() :
 * null))`. On a non-ok response (the route's own #832-class `lookup_failed`
 * 503, or a `company_not_found` 404 during a transient hiccup), `d` resolved
 * to `null`, and `d?.available !== false` evaluated to `true` — the same
 * default as a genuinely successful, empty response. Every funding field
 * stayed `undefined`, so the panel rendered the IDLE "FUND TEST CAMPAIGN"
 * prompt exactly as if the founder had never created a campaign, even when
 * they already had a funded, running one. Clicking that button starts a
 * real second Stripe checkout (`ad-budget-checkout` has no guard against
 * double-funding an existing campaign) — a transient read failure could
 * cost a founder a real, unwanted charge.
 *
 * Fix mirrors WaitlistPanel/VisitorsPanel's `loadError` pattern: a non-ok or
 * failed fetch sets `loadError`, which renders an honest "couldn't load"
 * message instead of fabricating an idle/fundable state, and never shows
 * the fund button while in that state.
 */

import { GrowthPanel } from '@/components/build/GrowthPanel'

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

describe('GrowthPanel — status load error', () => {
  it('renders an error state, not the fund prompt, on a 503 lookup_failed response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, reason: 'lookup_failed' }) }) as any)
    vi.stubGlobal('fetch', fetchMock)

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked onUpgrade={vi.fn()} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('growth-error')).toBeTruthy()
    expect(q('growth-idle')).toBeFalsy()
    expect(q('growth-fund')).toBeFalsy()
    expect(q('growth-disabled-note')).toBeFalsy()
  })

  it('renders an error state, not the fund prompt, when the fetch itself rejects', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network error') })
    vi.stubGlobal('fetch', fetchMock)

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked onUpgrade={vi.fn()} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('growth-error')).toBeTruthy()
    expect(q('growth-fund')).toBeFalsy()
  })

  it('still renders the real funded state correctly on a genuinely successful response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        available: true,
        campaignId: 'camp_1',
        fundedCents: 1000,
        realBudgetCents: 800,
        clicks: 12,
        cpcCents: 50,
      }),
    }) as any)
    vi.stubGlobal('fetch', fetchMock)

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked onUpgrade={vi.fn()} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('growth-error')).toBeFalsy()
    expect(q('growth-campaign-active')).toBeTruthy()
  })

  it('recovers from a prior load error once a subsequent load succeeds', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      if (call === 1) return { ok: false, status: 503, json: async () => ({ ok: false }) } as any
      return { ok: true, status: 200, json: async () => ({ available: true }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked onUpgrade={vi.fn()} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(q('growth-error')).toBeTruthy()

    act(() => { root.render(<GrowthPanel companyId="acme2" companyName="Acme2" unlocked onUpgrade={vi.fn()} />) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(q('growth-error')).toBeFalsy()
    expect(q('growth-idle')).toBeTruthy()
  })
})
