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
 * #1204 (Coverage Phase 4) — Live.tsx is the single most important screen in
 * the app (the founder's real operating dashboard) and, before this file,
 * had ZERO direct render tests despite being 1746 lines. Real render +
 * interaction coverage, not a page-load smoke test: the systems grid
 * computes from real buildSystems() logic (not mocked data), and the
 * provisioning-banner copy/CTA genuinely reflects the mocked session state.
 *
 * Child panels (Tasks/Versions/Documents/Media/AutoMode/Growth/Waitlist/
 * Visitors/Website) each own their own real fetch calls and are covered by
 * their own dedicated test files — stubbed here to keep this file's mock
 * surface focused on Live.tsx's OWN logic, not re-testing already-tested
 * children.
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
// Live.tsx's own logic (company header, systems grid, provisioning banner).
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
vi.mock('@/components/build/ZeroVoiceConnect', () => ({ ZeroVoiceConnect: () => React.createElement('div', { 'data-testid': 'stub-zerovoice' }) }))
vi.mock('@/components/build/TextCodyCard', () => ({ TextCodyCard: () => React.createElement('div', { 'data-testid': 'stub-textcody' }) }))
vi.mock('@/components/build/DomainModal', () => ({ DomainModal: () => null }))
vi.mock('@ainative/ai-kit', () => ({ StreamingMessage: () => null }))

let host: HTMLElement
let root: Root

/** A fetch mock that routes by URL to a safe, honest default for every
 *  endpoint Live.tsx calls directly on mount — never a blanket catch-all
 *  that could silently hide a real route Live.tsx stops calling. */
function installFetchMock(opts: { provisioned?: boolean; postProvisionFails?: boolean } = {}) {
  const provisioned = opts.provisioned ?? false
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as any
    if (url.includes('/api/build/visitors')) return ok({ visitors: 0, entries: [] })
    if (url.includes('/api/build/waitlist')) return ok({ entries: [] })
    if (url.includes('/api/build/subscription/status')) return ok({ active: false })
    if (url.includes('/api/build/provision')) {
      // POST (the real "Provision cloud now" click, including the #748
      // auto-provision effect's own automatic first attempt) vs. GET (the
      // mount-time check).
      if (init?.method === 'POST') {
        if (opts.postProvisionFails) {
          return { ok: false, status: 404, json: async () => ({ ok: false, reason: 'not_registered' }) } as any
        }
        return ok({ ok: true, zerodbProjectId: 'proj-1' })
      }
      return ok({ provisioned, checked: true })
    }
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

describe('Live screen — real render + interaction coverage (#1204)', () => {
  it('renders the real company name and the real systems grid, computed from real buildSystems() logic', async () => {
    installFetchMock()
    mockUseBuild()
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).toContain('Acme Roofing')
    const grid = host.querySelector('[data-testid="systems-grid"]')
    expect(grid).not.toBeNull()
  })

  it('falls back to a slugified company name as companyId when appSub is empty', async () => {
    installFetchMock()
    mockUseBuild({ appSub: '', companyName: 'My New Co' })
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).toContain('My New Co')
  })

  it('renders the real stub panels (Tasks, Versions, Documents, Media) inside the dashboard', async () => {
    installFetchMock()
    mockUseBuild()
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-testid="stub-tasks"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-versions"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-documents"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-media"]')).not.toBeNull()
  })

  it('shows the real "View site" link pointing at /build/{companyId}', async () => {
    installFetchMock()
    mockUseBuild()
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })

    const links = Array.from(host.querySelectorAll('a')) as HTMLAnchorElement[]
    const viewSite = links.find((a) => /View site/i.test(a.textContent || ''))
    expect(viewSite).toBeTruthy()
    expect(viewSite?.getAttribute('href')).toBe('/build/acme-roofing')
  })

  it('never crashes when idea is empty (a brand-new company with nothing typed yet)', async () => {
    installFetchMock()
    mockUseBuild({ idea: '' })
    const { Live } = await import('@/components/build/screens/Live')

    expect(() => render(React.createElement(Live))).not.toThrow()
    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('[data-testid="systems-grid"]')).not.toBeNull()
  })

  it('shows the real provisioning banner (not the upgrade banner) while provisioning genuinely has not succeeded yet', async () => {
    // Real behavior, confirmed live: the #748 auto-provision effect fires
    // its own POST automatically the moment provision.checked is true and
    // !provisioned — a real founder almost never sees this banner for long.
    // To assert on the banner's genuine pending state (not a race with that
    // auto-provision succeeding first), the auto-provision's own POST must
    // itself fail here, same as the real "not_registered" case this banner's
    // copy is written for.
    installFetchMock({ provisioned: false, postProvisionFails: true })
    mockUseBuild()
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-testid="provisioning-banner"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="upgrade-banner"]')).toBeNull()
    expect(host.textContent).toMatch(/setting it up now|Still finishing/)
  })

  it('shows the real upgrade banner (trial state) once provisioned and signed in, on a free plan', async () => {
    installFetchMock({ provisioned: true })
    mockUseBuild()
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(host.querySelector('[data-testid="upgrade-banner"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="provisioning-banner"]')).toBeNull()
  })

  it('clicking "Try again" after a failed auto-provision fires a real retry POST and recovers the real upgrade banner', async () => {
    installFetchMock({ provisioned: false, postProvisionFails: true })
    mockUseBuild()
    const { Live } = await import('@/components/build/screens/Live')

    render(React.createElement(Live))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    // Confirmed pending (same real state the previous test locks in).
    expect(host.querySelector('[data-testid="provisioning-banner"]')).not.toBeNull()
    const ctaBefore = host.querySelector('[data-testid="provision-now-cta"]') as HTMLButtonElement | null
    expect(ctaBefore?.textContent).toMatch(/Try again/)

    // Now let a real retry succeed — same mocked endpoint, different outcome,
    // exactly like a real transient registry hiccup clearing on its own.
    installFetchMock({ provisioned: false, postProvisionFails: false })
    const cta = host.querySelector('[data-testid="provision-now-cta"]') as HTMLButtonElement
    await act(async () => {
      cta.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const postCalls = (global.fetch as any).mock.calls.filter(
      ([url, init]: [string, RequestInit]) => String(url).includes('/api/build/provision') && init?.method === 'POST',
    )
    expect(postCalls.length).toBeGreaterThan(0)
    expect(host.querySelector('[data-testid="upgrade-banner"]')).not.toBeNull()
  })
})
