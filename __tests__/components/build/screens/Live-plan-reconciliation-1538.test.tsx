// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo = vi.fn()
})

/**
 * #1538 — real bug, confirmed live (silo-product, toby+builderqa...@opencapstack.com,
 * a genuine completed Stripe Pro checkout): the founder still saw "Free"/
 * "Upgrade" minutes later, hard refresh included. Root cause investigation
 * confirmed with real registry data that `plan` was never stamped via EITHER
 * fulfillment path (client-redirect subscription/verify, or the webhook at
 * /api/webhooks/stripe) — core does not relay subscription events to
 * Builder's webhook at all today (separate, core-side gap, being scoped
 * there).
 *
 * Independent of that: Live.tsx's reconciliation effect used to gate on
 * `!activePlan` alone — but activePlan is part of PersistedBuildState,
 * restored from localStorage on every mount, including a hard refresh. A
 * stale/empty-but-truthy activePlan left over from any earlier point
 * permanently blocked reconciliation from ever re-checking core for that
 * company, for the rest of the session — so even once core DOES correctly
 * reflect a real payment, a founder who already has a (stale) activePlan
 * value never gets it re-verified. Fixed: track "have we asked core about
 * THIS company yet" with a ref KEYED BY companyId (not a bare boolean —
 * Live never remounts on a company switch, so a bare "ran once" ref would
 * wrongly skip reconciliation for a second company switched to in the same
 * session).
 */

const dispatchMock = vi.fn()
const baseState = {
  companyName: 'Acme Roofing',
  appSub: 'acme-roofing',
  idea: 'A B2B sales CRM for roofing contractors.',
  track: 'company' as const,
  appChatId: 'chat-123',
  productChatId: 'chat-456',
  activePlan: '',
  enrolled: false,
  brandTagline: '',
  brandColor: '',
}

let currentState = { ...baseState }
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: currentState, dispatch: dispatchMock }),
}))

vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'founder@example.com' } }, status: 'authenticated' }),
}))

vi.mock('@/components/build/TasksPanel', () => ({ TasksPanel: () => React.createElement('div') }))
vi.mock('@/components/build/VersionsPanel', () => ({ VersionsPanel: () => React.createElement('div') }))
vi.mock('@/components/build/OnboardingVideo', () => ({ OnboardingVideo: () => React.createElement('div') }))
vi.mock('@/components/build/DocumentsPanel', () => ({ DocumentsPanel: () => React.createElement('div') }))
vi.mock('@/components/build/MediaPanel', () => ({ MediaPanel: () => React.createElement('div') }))
vi.mock('@/components/build/AutoModePanel', () => ({ AutoModePanel: () => React.createElement('div') }))
vi.mock('@/components/build/GrowthPanel', () => ({ GrowthPanel: () => React.createElement('div') }))
vi.mock('@/components/build/WaitlistPanel', () => ({ WaitlistPanel: () => React.createElement('div') }))
vi.mock('@/components/build/VisitorsPanel', () => ({ VisitorsPanel: () => React.createElement('div') }))
vi.mock('@/components/build/WebsitePanel', () => ({ WebsitePanel: () => React.createElement('div') }))
vi.mock('@/components/build/FeedbackPulse', () => ({ FeedbackPulse: () => null }))
vi.mock('@/components/build/ZeroVoiceConnect', () => ({ ZeroVoiceConnect: () => React.createElement('div') }))
vi.mock('@/components/build/TextCodyCard', () => ({ TextCodyCard: () => React.createElement('div') }))
vi.mock('@/components/build/DomainModal', () => ({ DomainModal: () => null }))
vi.mock('@ainative/ai-kit', () => ({ StreamingMessage: () => null }))

let host: HTMLElement
let root: Root

function installFetchMock(subStatusPlan: string | null = null) {
  const calls: string[] = []
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as any
    if (url.includes('/api/build/subscription/status')) {
      calls.push(url)
      return ok(subStatusPlan ? { plan: subStatusPlan } : { plan: null })
    }
    if (url.includes('/api/build/visitors')) return ok({ visitors: 0, entries: [] })
    if (url.includes('/api/build/waitlist')) return ok({ entries: [] })
    if (url.includes('/api/build/provision')) return ok({ provisioned: false, checked: true })
    if (url.includes('/api/build/resolve-app')) return ok({ chatId: 'chat-123', idea: baseState.idea, verified: true })
    if (url.includes('/api/build/systems')) return ok({ systems: [] })
    if (url.includes('/api/build/nightshift')) return ok({})
    if (url.includes('/api/build/register-app')) return ok({ ok: true })
    if (url.includes('/api/build/ask')) return ok({ answer: '' })
    return ok({})
  }) as any
  return calls
}

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function rerender(node: React.ReactElement) {
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  dispatchMock.mockClear()
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
  currentState = { ...baseState }
})

describe('Live screen — plan reconciliation survives a stale persisted activePlan (#1538)', () => {
  it('checks core even when activePlan is already truthy on first mount (a stale persisted value, not a freshly-verified one)', async () => {
    const calls = installFetchMock('pro')
    // Simulates exactly the real bug: activePlan restored non-empty from
    // localStorage BEFORE any real reconciliation ever ran this session.
    currentState = { ...baseState, activePlan: 'hobbyist' }
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(calls.length).toBe(1)
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ACTIVE_PLAN', plan: 'pro' })
  })

  it('only checks once for the SAME company on a re-render (no re-check storm)', async () => {
    const calls = installFetchMock('pro')
    currentState = { ...baseState, activePlan: '' }
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })
    expect(calls.length).toBe(1)

    // A re-render of the SAME company (e.g. an unrelated state change
    // elsewhere in the reducer) must not trigger a second check.
    currentState = { ...baseState, activePlan: 'pro' }
    rerender(React.createElement(Live))
    await act(async () => { await Promise.resolve() })
    expect(calls.length).toBe(1)
  })

  it('re-checks when the founder switches to a DIFFERENT company in the same mounted Live instance', async () => {
    const calls = installFetchMock('business')
    currentState = { ...baseState, appSub: 'first-co', activePlan: '' }
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })
    expect(calls.length).toBe(1)
    expect(calls[0]).toContain('slug=first-co')

    // Live.tsx never remounts on a company switch (no key={companyId} at its
    // call site) -- a naive "ran once per mount" ref would wrongly skip this.
    currentState = { ...baseState, appSub: 'second-co', activePlan: '' }
    rerender(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(calls.length).toBe(2)
    expect(calls[1]).toContain('slug=second-co')
  })

  it('never checks core when signed out', async () => {
    const calls = installFetchMock('pro')
    currentState = { ...baseState, activePlan: '' }
    vi.doMock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }))
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(calls.length).toBe(0)
  })

  it('a null/no-plan response from core never dispatches SET_ACTIVE_PLAN (no fabricated upgrade)', async () => {
    installFetchMock(null)
    currentState = { ...baseState, activePlan: '' }
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_ACTIVE_PLAN' }))
  })
})
