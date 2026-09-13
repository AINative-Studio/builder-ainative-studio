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
 * Real bug found live (2026-09-13, core#7395): Builder's own ZeroDB registry
 * project started returning 403 on every read, platform-wide. Before this
 * fix, GET /api/build/my-companies caught that failure and returned
 * { companies: [] } — indistinguishable from a founder who genuinely has no
 * companies yet. A real founder (arif@8genc.com) reported their projects had
 * "disappeared," when the real cause was a database outage, not lost data.
 *
 * /api/build/my-companies now returns { companies: [], ok: false } (503) on
 * a real registry failure, and MyCompanies.tsx must show an honest "couldn't
 * load" state for that — never the same empty-state UI a genuinely new
 * founder sees.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn(async () => {}) }))
vi.mock('@/components/build/MenuChip', () => ({ MenuChip: () => null }))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { activePlan: '' }, dispatch: vi.fn() }),
}))

import { MyCompanies } from '@/components/build/screens/MyCompanies'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('MyCompanies — real registry outage never looks like "no companies" (core#7395)', () => {
  afterEach(() => {
    act(() => { root?.unmount() })
    host?.remove()
    vi.clearAllMocks()
  })

  it('shows the load-error state (not the empty-state) when the API reports ok:false', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/my-companies')) {
        return { ok: false, status: 503, json: async () => ({ companies: [], ok: false, error: 'registry_unavailable' }) } as any
      }
      if (u.includes('/api/build/subscription/status')) return { ok: true, json: async () => ({ plan: null }) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any

    render(React.createElement(MyCompanies))
    await flush()

    expect(host.querySelector('[data-testid="companies-load-error"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="companies-empty"]')).toBeNull()
  })

  it('shows the load-error state when the fetch itself throws (network failure)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/my-companies')) throw new Error('network down')
      if (u.includes('/api/build/subscription/status')) return { ok: true, json: async () => ({ plan: null }) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any

    render(React.createElement(MyCompanies))
    await flush()

    expect(host.querySelector('[data-testid="companies-load-error"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="companies-empty"]')).toBeNull()
  })

  it('still shows the genuine empty state when the API honestly reports zero companies (ok:true)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/my-companies')) return { ok: true, json: async () => ({ companies: [], ok: true }) } as any
      if (u.includes('/api/build/subscription/status')) return { ok: true, json: async () => ({ plan: null }) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any

    render(React.createElement(MyCompanies))
    await flush()

    expect(host.querySelector('[data-testid="companies-empty"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="companies-load-error"]')).toBeNull()
  })

  it('a real company list still renders normally (unaffected by the new ok-check)', async () => {
    const company = { slug: 'ember-box', name: 'Ember Box', tagline: '', track: 'company', plan: null, deployUrl: 'https://builder.ainative.studio/build/ember-box' }
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/my-companies')) return { ok: true, json: async () => ({ companies: [company], ok: true }) } as any
      if (u.includes('/api/build/subscription/status')) return { ok: true, json: async () => ({ plan: null }) } as any
      return { ok: true, json: async () => ({}) } as any
    }) as any

    render(React.createElement(MyCompanies))
    await flush()

    expect(host.querySelector('[data-testid="company-ember-box"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="companies-load-error"]')).toBeNull()
  })
})
