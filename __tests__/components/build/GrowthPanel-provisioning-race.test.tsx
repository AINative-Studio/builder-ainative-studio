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
 * GrowthPanel — `provisioned` gate.
 *
 * Real bug found via a live founder report (company "pathly", 2026-10-11):
 * a brand-new company's registry row is written by a DETACHED background
 * generation step that can take real minutes (Live.tsx's `provisionCompany`
 * doc comment, #748). Until it lands, /api/build/growth/status and
 * /api/build/growth/ad-budget-checkout both correctly 404 with
 * `company_not_found` — that server behavior is right, there is genuinely
 * nothing to look up yet. But GrowthPanel polled status and allowed funding
 * unconditionally regardless of provisioning state, so a founder who saw the
 * Live dashboard early (before their company finished setting up) got a
 * console full of 404s and a FUND TEST CAMPAIGN button that silently failed
 * when clicked.
 *
 * Properties under test:
 *  - provisioned=false: no status GET fires on mount (nothing to look up yet)
 *  - provisioned=false: the fund button is disabled and never POSTs
 *  - provisioned=false → true: the panel starts loading status once it flips
 *  - provisioned=true (or omitted): unchanged — today's existing behavior
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

function rerender(node: React.ReactElement) {
  act(() => { root.render(node) })
}

function q(testid: string): HTMLElement | null {
  return host.querySelector(`[data-testid="${testid}"]`)
}

function idleStatus() {
  return { ok: true, json: async () => ({ available: true }) } as any
}

function makeStatusFetchMock() {
  return vi.fn(async (_url: string, _init?: any) => idleStatus())
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GrowthPanel — provisioned gate', () => {
  it('fires no status fetch on mount while provisioned is false', async () => {
    const fetchMock = makeStatusFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <GrowthPanel companyId="pathly" companyName="Pathly" unlocked onUpgrade={vi.fn()} provisioned={false} />,
    )
    await act(async () => { await Promise.resolve() })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables the fund button and never POSTs while provisioned is false', async () => {
    const fetchMock = makeStatusFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <GrowthPanel companyId="pathly" companyName="Pathly" unlocked onUpgrade={vi.fn()} provisioned={false} />,
    )
    await act(async () => { await Promise.resolve() })

    const btn = q('growth-fund') as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)

    await act(async () => { btn.click() })
    await act(async () => { await Promise.resolve() })

    // Clicking a disabled button is a no-op in a real browser, but this also
    // guards the handler itself in case disabled is ever dropped elsewhere.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts loading status once provisioned flips from false to true', async () => {
    const fetchMock = makeStatusFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <GrowthPanel companyId="pathly" companyName="Pathly" unlocked onUpgrade={vi.fn()} provisioned={false} />,
    )
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()

    rerender(
      <GrowthPanel companyId="pathly" companyName="Pathly" unlocked onUpgrade={vi.fn()} provisioned />,
    )
    await act(async () => { await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/build/growth/status')

    const btn = q('growth-fund') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('omitting provisioned defaults to true — unchanged existing behavior', async () => {
    const fetchMock = makeStatusFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    render(<GrowthPanel companyId="acme" companyName="Acme" unlocked onUpgrade={vi.fn()} />)
    await act(async () => { await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const btn = q('growth-fund') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })
})
