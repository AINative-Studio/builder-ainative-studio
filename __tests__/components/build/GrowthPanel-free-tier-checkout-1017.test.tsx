// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1017 — a free-tier founder can fund a campaign from the Growth panel.
 *
 * Product direction confirmed 2026-10-10: ad campaigns are NOT gated on plan
 * tier. Founders purchase prepaid ad credits to fund a campaign, and a
 * free-tier founder validating demand for their idea is exactly who that is
 * for. The server endpoint's `isPaidTier` gate was removed; this panel's
 * client-side `if (!unlocked) { onUpgrade(); return }` had to go with it,
 * otherwise the founder never even got as far as the request.
 *
 * Properties under test:
 *  - an un-upgraded (`unlocked: false`) founder clicking FUND actually POSTs to
 *    /api/build/growth/ad-budget-checkout — never short-circuited to upgrade;
 *  - the real Stripe URL the endpoint returns is followed;
 *  - the idle copy no longer claims "Paid plan required";
 *  - if the SERVER does refuse on entitlement (`reason: 'tier'`), the upgrade
 *    path still fires — the honest-refusal branch is intact.
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

/** The status GET the panel issues on mount: available, no campaign yet. */
function idleStatus() {
  return { ok: true, json: async () => ({ available: true }) } as any
}

let assignedUrl: string | null = null

beforeEach(() => {
  assignedUrl = null
  // window.location.href is not assignable in jsdom — replace it with a plain
  // writable object so the panel's real redirect is observable.
  delete (window as any).location
  ;(window as any).location = {
    set href(v: string) { assignedUrl = v },
    get href() { return assignedUrl ?? '' },
  }
})

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GrowthPanel — free-tier credits checkout (#1017)', () => {
  it('a free-tier founder (unlocked: false) reaches real checkout instead of the upgrade screen', async () => {
    const onUpgrade = vi.fn()
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).includes('/growth/status')) return idleStatus()
      // The real funding call.
      expect(String(url)).toBe('/api/build/growth/ad-budget-checkout')
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body)
      expect(body.slug).toBe('acme')
      expect(body.amountCents).toBe(1000)
      return { ok: true, json: async () => ({ ok: true, url: 'https://checkout.stripe.com/session/free' }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked={false} onUpgrade={onUpgrade} />)
    await act(async () => { await Promise.resolve() })

    const btn = q('growth-fund') as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    // The checkout POST really happened (status GET + checkout POST).
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // And the founder was sent to the REAL Stripe URL, not to upgrade.
    expect(assignedUrl).toBe('https://checkout.stripe.com/session/free')
    expect(onUpgrade).not.toHaveBeenCalled()
  })

  it('no longer tells a free-tier founder a paid plan is required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => idleStatus()))
    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked={false} onUpgrade={vi.fn()} />)
    await act(async () => { await Promise.resolve() })

    const cost = q('growth-cost')
    expect(cost).toBeTruthy()
    expect(cost!.textContent || '').not.toMatch(/paid plan required/i)
    expect(cost!.textContent || '').toMatch(/any plan/i)
    // The old upgrade-affordance arrow is gone from the button label too.
    expect((q('growth-fund')!.textContent || '')).not.toContain('↗')
  })

  it('still surfaces the upgrade path if the SERVER refuses on entitlement', async () => {
    const onUpgrade = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/growth/status')) return idleStatus()
      return { ok: true, json: async () => ({ ok: false, reason: 'tier' }) } as any
    }))

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked={false} onUpgrade={onUpgrade} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { (q('growth-fund') as HTMLButtonElement).click() })
    await act(async () => { await Promise.resolve() })

    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(assignedUrl).toBeNull()
  })
})
