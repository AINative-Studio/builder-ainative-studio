// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom doesn't implement scrollTo — Live.tsx's chat-log auto-scroll
  // effect calls it unconditionally on every mount/update.
  Element.prototype.scrollTo = vi.fn()
})

/**
 * #1467 (BLD-05) — "See it live" dispatches COMPANY_DONE (or, on the App
 * track, MVP_DONE) and lands the founder on Live with screen:'live', a hard
 * screen change away from the journey workspace (screen:'ws'). A path back
 * DOES exist (openGraph, Pricing's seePreviewFirst, Account's "Back to app"
 * — see state.ts's #1033 comment), but none of those is a dedicated,
 * persistent "Continue to next step" control — they're general-purpose nav
 * buried in unrelated UI. This file asserts the real control: distinct from
 * those three, labeled with the real next journey step (computed the same
 * way JourneyBar does — trackViews + state.done, via nextJourneyStep in
 * lib/build/state.ts), and that activating it returns to screen:'ws' at
 * that exact next view.
 */

const dispatchMock = vi.fn()
const baseState = {
  companyName: 'Acme Roofing',
  appSub: 'acme-roofing',
  idea: 'A B2B sales CRM for roofing contractors — track leads, move deals through a pipeline.',
  track: 'company' as const,
  appChatId: 'chat-123',
  productChatId: 'chat-456',
  activePlan: '',
  enrolled: false,
  brandTagline: '',
  brandColor: '',
  done: {} as Record<string, string>,
  builtCompany: true,
  builtMVP: false,
}

function mockUseBuild(stateOverrides: Partial<typeof baseState> = {}) {
  vi.doMock('@/contexts/build-context', () => ({
    useBuild: () => ({
      state: { ...baseState, ...stateOverrides },
      dispatch: dispatchMock,
    }),
  }))
}

vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))

let sessionStatus: 'authenticated' | 'unauthenticated' = 'authenticated'
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: sessionStatus === 'authenticated' ? { user: { email: 'founder@example.com' } } : null, status: sessionStatus }),
}))

// Heavy child panels each own real fetch calls and have their own dedicated
// test files — stub them so this file's mock surface stays focused on
// Live.tsx's own "Continue to next step" logic (mirrors Live-render-1204.test.tsx).
vi.mock('@/components/build/TasksPanel', () => ({ TasksPanel: () => React.createElement('div', { 'data-testid': 'stub-tasks' }) }))
vi.mock('@/components/build/VersionsPanel', () => ({ VersionsPanel: () => React.createElement('div', { 'data-testid': 'stub-versions' }) }))
vi.mock('@/components/build/OnboardingVideo', () => ({ OnboardingVideo: () => React.createElement('div', { 'data-testid': 'stub-onboarding-video' }) }))
vi.mock('@/components/build/DocumentsPanel', () => ({ DocumentsPanel: () => React.createElement('div', { 'data-testid': 'stub-documents' }) }))
vi.mock('@/components/build/MediaPanel', () => ({ MediaPanel: () => React.createElement('div', { 'data-testid': 'stub-media' }) }))
vi.mock('@/components/build/AutoModePanel', () => ({ AutoModePanel: () => React.createElement('div', { 'data-testid': 'stub-automode' }) }))
vi.mock('@/components/build/GrowthPanel', () => ({ GrowthPanel: () => React.createElement('div', { 'data-testid': 'stub-growth' }) }))
vi.mock('@/components/build/WaitlistPanel', () => ({ WaitlistPanel: () => React.createElement('div', { 'data-testid': 'stub-waitlist' }) }))
vi.mock('@/components/build/VisitorsPanel', () => ({ VisitorsPanel: () => React.createElement('div', { 'data-testid': 'stub-visitors' }) }))
vi.mock('@/components/build/WebsitePanel', () => ({ WebsitePanel: () => React.createElement('div', { 'data-testid': 'stub-website' }) }))
vi.mock('@/components/build/FeedbackPulse', () => ({ FeedbackPulse: () => null }))
vi.mock('@/components/build/ZeroInvoiceConnect', () => ({ ZeroInvoiceConnect: () => React.createElement('div', { 'data-testid': 'stub-zeroinvoice' }) }))
vi.mock('@/components/build/ZeroVoiceConnect', () => ({ ZeroVoiceConnect: () => React.createElement('div', { 'data-testid': 'stub-zerovoice' }) }))
vi.mock('@/components/build/TextCodyCard', () => ({ TextCodyCard: () => React.createElement('div', { 'data-testid': 'stub-textcody' }) }))
vi.mock('@/components/build/DomainModal', () => ({ DomainModal: () => null }))
vi.mock('@ainative/ai-kit', () => ({ StreamingMessage: () => null }))

let host: HTMLElement
let root: Root

function installFetchMock() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as any
    if (url.includes('/api/build/visitors')) return ok({ visitors: 0, entries: [] })
    if (url.includes('/api/build/waitlist')) return ok({ entries: [] })
    if (url.includes('/api/build/subscription/status')) return ok({ active: false })
    if (url.includes('/api/build/provision')) return ok({ provisioned: true, checked: true })
    if (url.includes('/api/build/resolve-app')) return ok({ chatId: 'chat-123', idea: baseState.idea, verified: true })
    if (url.includes('/api/build/systems')) return ok({ systems: [] })
    if (url.includes('/api/build/nightshift')) return ok({})
    if (url.includes('/api/build/register-app')) return ok({ ok: true })
    if (url.includes('/api/build/ask')) return ok({ answer: '' })
    return ok({})
  }) as any
}

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  sessionStatus = 'authenticated'
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('Live screen — persistent "Continue to next step" return path (#1467)', () => {
  it('renders a dedicated continue-journey control, distinct from the existing openGraph/rescope buttons', async () => {
    installFetchMock()
    // Company track, nothing marked done yet — the real shape right after
    // COMPANY_DONE fires on a build that hasn't walked the artifacts (the
    // control must still render something sane: the first view).
    mockUseBuild({ done: {} })
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    const cta = host.querySelector('[data-testid="continue-journey-cta"]') as HTMLButtonElement | null
    expect(cta).not.toBeNull()

    // Not the same control as the existing graph/rescope buttons.
    const graphBtn = Array.from(host.querySelectorAll('button')).find((b) => /Open the artifact graph/i.test(b.textContent || ''))
    const rescopeBtn = Array.from(host.querySelectorAll('button')).find((b) => /Re-scope the wedge/i.test(b.textContent || ''))
    expect(cta).not.toBe(graphBtn)
    expect(cta).not.toBe(rescopeBtn)
  })

  it('labels the control with the real next journey step, not a generic string', async () => {
    installFetchMock()
    // 'design' is done; 'thesis' is the next undone company-track view.
    mockUseBuild({ done: { design: 'done' } })
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    const cta = host.querySelector('[data-testid="continue-journey-cta"]') as HTMLButtonElement
    expect(cta.textContent).toMatch(/Continue/i)
    expect(cta.textContent).toMatch(/business thesis/i) // ARTIFACT_TITLES.thesis
  })

  it('clicking it dispatches GOTO_VIEW at the correct next view, then GOTO_SCREEN to ws', async () => {
    installFetchMock()
    mockUseBuild({ done: { design: 'done' } })
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    const cta = host.querySelector('[data-testid="continue-journey-cta"]') as HTMLButtonElement
    act(() => { cta.click() })

    const calls = dispatchMock.mock.calls.map((c) => c[0])
    expect(calls).toContainEqual({ type: 'GOTO_VIEW', view: 'thesis' })
    expect(calls).toContainEqual({ type: 'GOTO_SCREEN', screen: 'ws' })
  })

  it('shows a "Back to your plan" fallback (not a dangling "Continue to undefined") once every track view is already done', async () => {
    installFetchMock()
    const allDone = { design: 'done', thesis: 'done', wedge: 'done', businessModel: 'done', positioning: 'done', landing: 'done', plan30: 'done' }
    mockUseBuild({ done: allDone })
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    const cta = host.querySelector('[data-testid="continue-journey-cta"]') as HTMLButtonElement
    expect(cta).not.toBeNull()
    expect(cta.textContent).toMatch(/back to your plan/i)
    expect(cta.textContent).not.toMatch(/Continue to/i)
  })

  it('a completed-journey click still returns screen:ws, at the first view of the track (nothing to pick as "next")', async () => {
    installFetchMock()
    const allDone = { design: 'done', thesis: 'done', wedge: 'done', businessModel: 'done', positioning: 'done', landing: 'done', plan30: 'done' }
    mockUseBuild({ done: allDone })
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    const cta = host.querySelector('[data-testid="continue-journey-cta"]') as HTMLButtonElement
    act(() => { cta.click() })

    const calls = dispatchMock.mock.calls.map((c) => c[0])
    expect(calls).toContainEqual({ type: 'GOTO_SCREEN', screen: 'ws' })
  })
})
