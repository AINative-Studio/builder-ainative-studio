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
 * #1204 (Coverage Phase 4) — DomainModal (components/build/DomainModal.tsx,
 * 603 lines, reached live via components/build/screens/Live.tsx) had zero
 * unit-level render coverage — only e2e/domain-modal-byo.spec.ts and
 * e2e/domain-modal-scroll.spec.ts (real-browser Playwright specs) touch it,
 * which never run as part of the component-level #1204 sweep.
 *
 * useSession is mocked at its real next-auth/react boundary (established
 * pattern from user-nav-render-1204.test.tsx). fetch is mocked per-test to
 * drive the real /api/build/domains and /api/build/connect-domain response
 * shapes this component itself reads (configured/suggestions/ok/domain/
 * status/dnsRecords/needs_provision/reason) — those endpoints are not
 * re-tested here, only the component's real reaction to their shapes.
 */

const h = vi.hoisted(() => ({ useSession: vi.fn() }))
vi.mock('next-auth/react', () => h)

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({ ok, json: async () => data } as Response)
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('DomainModal — real search/buy/BYO coverage (#1204)', () => {
  it('renders nothing when genuinely closed', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn() as any
    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: false, onClose: vi.fn() }))

    expect(host.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches real suggestions on open and renders them once loaded', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('/api/build/domains')) {
        return jsonResponse({ configured: true, suggestions: [{ domain: 'ember.com', available: true, price: 12 }] })
      }
      return jsonResponse({ connected: false })
    }) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose: vi.fn() }))

    expect(host.textContent).toContain('Checking available domains')
    await flush()

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/build/domains?brand=ember'))
    expect(host.textContent).toContain('ember.com')
    expect(host.textContent).toContain('$12/yr')
  })

  it('shows the real "not configured" message when Namecheap is genuinely unconfigured', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('/api/build/domains')) return jsonResponse({ configured: false, suggestions: [] })
      return jsonResponse({ connected: false })
    }) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose: vi.fn() }))
    await flush()

    expect(host.textContent).toContain("isn't enabled yet")
  })

  it('picking a suggestion enables the real Buy CTA with the picked domain in its label', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('/api/build/domains')) {
        return jsonResponse({ configured: true, suggestions: [{ domain: 'ember.com', available: true }] })
      }
      return jsonResponse({ connected: false })
    }) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose: vi.fn() }))
    await flush()

    const buyBtn = host.querySelector('[data-testid="domain-buy-cta"]') as HTMLButtonElement
    expect(buyBtn.disabled).toBe(true)
    expect(buyBtn.textContent).toBe('Pick a domain')

    const option = Array.from(host.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes('ember.com')) as HTMLElement
    await act(async () => { option.click() })

    expect(buyBtn.disabled).toBe(false)
    expect(buyBtn.textContent).toBe('Sign in to buy ember.com →')
  })

  it('a signed-out Buy click persists the real resume stash and calls the real onRequireAuth callback', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('/api/build/domains')) {
        return jsonResponse({ configured: true, suggestions: [{ domain: 'ember.com', available: true }] })
      }
      return jsonResponse({ connected: false })
    }) as any
    const onRequireAuth = vi.fn()

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', slug: 'ember-co', open: true, onClose: vi.fn(), onRequireAuth }))
    await flush()

    const option = host.querySelector('[role="option"]') as HTMLElement
    await act(async () => { option.click() })
    const buyBtn = host.querySelector('[data-testid="domain-buy-cta"]') as HTMLButtonElement
    await act(async () => { buyBtn.click() })

    expect(onRequireAuth).toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('ainative:domain-purchase-resume')!)).toEqual({ domain: 'ember.com', slug: 'ember-co' })
  })

  it('a signed-in Buy click starts the real checkout POST and redirects to the real returned Stripe url', async () => {
    h.useSession.mockReturnValue({ status: 'authenticated' })
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/build/domains') && (!init || init.method !== 'POST')) {
        return jsonResponse({ configured: true, suggestions: [{ domain: 'ember.com', available: true }] })
      }
      if (String(url) === '/api/build/domains' && init?.method === 'POST') {
        return jsonResponse({ url: 'https://checkout.stripe.com/session123' })
      }
      return jsonResponse({ connected: false })
    })
    global.fetch = fetchMock as any

    const originalLocation = window.location
    // @ts-expect-error — real jsdom location is non-configurable for assignment; replace wholesale for this test.
    delete window.location
    window.location = { ...originalLocation, href: '' } as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose: vi.fn() }))
    await flush()

    const option = host.querySelector('[role="option"]') as HTMLElement
    await act(async () => { option.click() })
    const buyBtn = host.querySelector('[data-testid="domain-buy-cta"]') as HTMLButtonElement
    await act(async () => { buyBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledWith('/api/build/domains', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ domain: 'ember.com', slug: 'ember' }),
    }))
    expect(window.location.href).toBe('https://checkout.stripe.com/session123')

    window.location = originalLocation as any
  })

  it('"Show more domains" fetches the next real batch and de-dups against existing suggestions', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/build/domains') && u.includes('offset=')) {
        return jsonResponse({ configured: true, suggestions: [{ domain: 'ember.com', available: true }, { domain: 'ember.io', available: true }] })
      }
      if (u.includes('/api/build/domains')) {
        return jsonResponse({ configured: true, suggestions: [{ domain: 'ember.com', available: true }] })
      }
      return jsonResponse({ connected: false })
    }) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose: vi.fn() }))
    await flush()

    const moreBtn = host.querySelector('[data-testid="show-more-domains"]') as HTMLButtonElement
    await act(async () => { moreBtn.click(); await Promise.resolve(); await Promise.resolve() })

    const names = Array.from(host.querySelectorAll('.m-domain-name')).map((el) => el.textContent)
    expect(names).toEqual(['ember.com', 'ember.io'])
  })

  it('switching to the "Connect a domain you own" tab shows the real BYO panel, buy flow is hidden', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn(() => jsonResponse({ configured: true, suggestions: [] })) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose: vi.fn() }))
    await flush()

    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => { byoTab.click() })

    expect(host.querySelector('[data-testid="domain-byo-panel"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="domain-buy-cta"]')).toBeNull()
  })

  it('a real BYO connect submission for a signed-in founder shows the real pending status + DNS records', async () => {
    h.useSession.mockReturnValue({ status: 'authenticated' })
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/build/connect-domain') && init?.method === 'POST') {
        return jsonResponse({ ok: true, domain: 'myco.com', status: 'pending', dnsRecords: [{ type: 'CNAME', name: '@', value: 'host.ainative.studio' }] })
      }
      if (u.includes('/api/build/connect-domain')) return jsonResponse({ connected: false })
      return jsonResponse({ configured: true, suggestions: [] })
    })
    global.fetch = fetchMock as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', slug: 'ember-co', open: true, onClose: vi.fn() }))
    await flush()

    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => { byoTab.click() })

    const input = host.querySelector('[data-testid="byo-domain-input"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'myco.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const connectBtn = host.querySelector('[data-testid="byo-connect-cta"]') as HTMLButtonElement
    await act(async () => { connectBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(fetchMock).toHaveBeenCalledWith('/api/build/connect-domain', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ slug: 'ember-co', domain: 'myco.com' }),
    }))
    const statusEl = host.querySelector('[data-testid="byo-status"]')
    expect(statusEl?.getAttribute('data-status')).toBe('pending')
    expect(host.textContent).toContain('Waiting for DNS records for myco.com')
    expect(host.querySelector('[data-testid="byo-dns-records"]')).not.toBeNull()
    expect(host.textContent).toContain('host.ainative.studio')
  })

  it('a real BYO connect for a signed-out founder stashes the resume key and routes to auth, never calls connect-domain POST', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/build/connect-domain')) return jsonResponse({ connected: false })
      return jsonResponse({ configured: true, suggestions: [] })
    })
    global.fetch = fetchMock as any
    const onRequireAuth = vi.fn()

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', slug: 'ember-co', open: true, onClose: vi.fn(), onRequireAuth }))
    await flush()

    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => { byoTab.click() })

    const input = host.querySelector('[data-testid="byo-domain-input"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'myco.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const connectBtn = host.querySelector('[data-testid="byo-connect-cta"]') as HTMLButtonElement
    expect(connectBtn.textContent).toBe('Sign in to connect')
    await act(async () => { connectBtn.click(); await Promise.resolve() })

    expect(onRequireAuth).toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('ainative:domain-connect-resume')!)).toEqual({ domain: 'myco.com', slug: 'ember-co' })
    expect(fetchMock).not.toHaveBeenCalledWith('/api/build/connect-domain', expect.objectContaining({ method: 'POST' }))
  })

  it('shows the real "needs_provision" guidance when connect-domain reports it, never DNS records', async () => {
    h.useSession.mockReturnValue({ status: 'authenticated' })
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/build/connect-domain') && init?.method === 'POST') {
        return jsonResponse({ needs_provision: true, detail: 'Provision this company first, then come back.' })
      }
      if (u.includes('/api/build/connect-domain')) return jsonResponse({ connected: false })
      return jsonResponse({ configured: true, suggestions: [] })
    }) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', slug: 'ember-co', open: true, onClose: vi.fn() }))
    await flush()

    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => { byoTab.click() })
    const input = host.querySelector('[data-testid="byo-domain-input"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'myco.com'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const connectBtn = host.querySelector('[data-testid="byo-connect-cta"]') as HTMLButtonElement
    await act(async () => { connectBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="byo-needs-provision"]')).not.toBeNull()
    expect(host.textContent).toContain('needs its own dedicated host')
    expect(host.querySelector('[data-testid="byo-dns-records"]')).toBeNull()
  })

  it('idempotent re-open: hydrates the BYO tab + existing status from a real already-connected domain', async () => {
    h.useSession.mockReturnValue({ status: 'authenticated' })
    global.fetch = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/build/connect-domain')) {
        return jsonResponse({ connected: true, domain: 'already.com', status: 'live', dnsRecords: [] })
      }
      return jsonResponse({ configured: true, suggestions: [] })
    }) as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', slug: 'ember-co', open: true, onClose: vi.fn(), appSubReady: true }))
    await flush()

    expect(host.querySelector('[data-testid="domain-byo-panel"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="byo-status"]')?.getAttribute('data-status')).toBe('live')
    expect(host.textContent).toContain('already.com is live with HTTPS')
  })

  it('never fires the slug-scoped BYO lookup while appSubReady is genuinely false (#817 guard)', async () => {
    h.useSession.mockReturnValue({ status: 'authenticated' })
    const fetchMock = vi.fn((url: string) => {
      const u = String(url)
      if (u.includes('/api/build/connect-domain')) return jsonResponse({ connected: false })
      return jsonResponse({ configured: true, suggestions: [] })
    })
    global.fetch = fetchMock as any

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', slug: 'ember-co', open: true, onClose: vi.fn(), appSubReady: false }))
    await flush()

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/build/connect-domain'))
  })

  it('clicking Close calls the real onClose handler', async () => {
    h.useSession.mockReturnValue({ status: 'unauthenticated' })
    global.fetch = vi.fn(() => jsonResponse({ configured: true, suggestions: [] })) as any
    const onClose = vi.fn()

    const { DomainModal } = await import('@/components/build/DomainModal')
    render(React.createElement(DomainModal, { brand: 'ember', open: true, onClose }))
    await flush()

    const closeBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Close') as HTMLButtonElement
    await act(async () => { closeBtn.click() })

    expect(onClose).toHaveBeenCalled()
  })
})
