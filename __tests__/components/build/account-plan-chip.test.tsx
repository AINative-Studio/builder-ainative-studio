// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { planChipLabel } from '@/components/build/screens/Account'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * Real bug (live, Enterprise account, screenshot-reported 2026-09-05):
 * Account's "Current plan" chip showed "Free" for a real Enterprise founder.
 * Root cause: `activePlan`'s default ('') is indistinguishable from a
 * confirmed-unpaid plan, and the screen rendered `PLAN_LABEL[activePlan]`
 * unconditionally with no loading state — so on mount, before the async
 * `/api/build/subscription/status` fetch resolved, it showed "Free"
 * immediately. If that fetch ever silently failed, it stayed "Free" forever.
 * This mirrors the exact "confirmed vs unverified" bug class already fixed
 * server-side for Auto Mode (see lib/ainative/active-plan.ts's `verified`).
 */
describe('planChipLabel (pure)', () => {
  it('THE BUG: never returns "Free" while the plan check is still loading', () => {
    expect(planChipLabel('', true)).not.toBe('Free')
    expect(planChipLabel('', true)).toBe('Checking your plan…')
  })

  it('returns the real plan label once loading settles', () => {
    expect(planChipLabel('enterprise', false)).toBe('Enterprise')
    expect(planChipLabel('business', false)).toBe('Business')
    expect(planChipLabel('pro', false)).toBe('Pro')
    expect(planChipLabel('cody_vcto', false)).toBe('Cody · Virtual CTO')
  })

  it('only shows "Free" for a genuinely confirmed unpaid plan (loading settled, plan empty)', () => {
    expect(planChipLabel('', false)).toBe('Free')
  })
})

// ---- Full component regression: the mount-time render never shows "Free" ----
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'founder@enterprise.co', type: 'real' } } }),
  signOut: vi.fn(),
}))
vi.mock('@/components/build/SettingsForm', () => ({ SettingsForm: () => null }))
vi.mock('@/components/build/DangerZone', () => ({ DangerZone: () => null }))

const dispatchMock = vi.fn()
let mockState: any = { activePlan: '' }
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: mockState, dispatch: dispatchMock }),
}))

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
  vi.clearAllMocks()
  mockState = { activePlan: '' }
  vi.unstubAllGlobals()
})

describe('Account screen — plan chip mount-time render (regression)', () => {
  it('THE BUG, end to end: a signed-in founder never sees "Free" while the plan fetch is in flight', async () => {
    // The subscription/status fetch is deliberately left unresolved (a pending
    // promise) to capture the exact mount-time window the bug lived in.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { Account } = await import('@/components/build/screens/Account')
    render(<Account />)
    const chip = host.querySelector('[data-testid="account-plan-chip"]')
    expect(chip?.textContent).not.toBe('Free')
    expect(chip?.textContent).toBe('Checking your plan…')
  })

  it('once the real Enterprise plan resolves, the chip updates to "Enterprise"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: 'enterprise' }) }))
    const { Account } = await import('@/components/build/screens/Account')
    render(<Account />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ACTIVE_PLAN', plan: 'enterprise' })
  })

  it('a genuinely already-hydrated Enterprise plan renders immediately, no loading flash', async () => {
    mockState = { activePlan: 'enterprise' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const { Account } = await import('@/components/build/screens/Account')
    render(<Account />)
    const chip = host.querySelector('[data-testid="account-plan-chip"]')
    expect(chip?.textContent).toBe('Enterprise')
  })

  it('if the plan fetch fails, the chip settles to the honest confirmed-unpaid "Free" — never stuck loading forever', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { Account } = await import('@/components/build/screens/Account')
    render(<Account />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    const chip = host.querySelector('[data-testid="account-plan-chip"]')
    expect(chip?.textContent).toBe('Free')
  })
})
