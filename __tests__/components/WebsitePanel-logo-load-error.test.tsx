// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { WebsitePanel } from '@/components/build/WebsitePanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * Real bug fix, same shape as the Secrets section's own fix just above it
 * in this file: a failed `GET /api/build/logo` (non-ok response, or the
 * fetch itself throwing) used to collapse into the SAME `logoUrl: null`
 * shape as "no logo set," so a founder who already uploaded a logo saw
 * "Upload a logo" (not "Replace logo") with no current-logo thumbnail and
 * no indication the load had failed. These tests assert an honest
 * load-error notice renders instead, and that the real logo still shows on
 * a genuine successful load.
 */

let host: HTMLElement
let root: Root

function render(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

function mockFetch(logoResponse: { ok: boolean; status?: number; throws?: boolean; url?: string | null }) {
  return vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.startsWith('/api/build/logo')) {
      if (logoResponse.throws) throw new Error('network down')
      return { ok: logoResponse.ok, status: logoResponse.status ?? (logoResponse.ok ? 200 : 503), json: async () => ({ url: logoResponse.url ?? null }) }
    }
    if (u.startsWith('/api/build/secrets')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, secrets: [], available: true }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('WebsitePanel — Logo honest load-error state', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows the honest load-error notice on a non-ok response, never a silent "no logo" state', async () => {
    global.fetch = mockFetch({ ok: false, status: 503 })
    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="logo-load-error"]')).toBeTruthy()
  })

  it('shows the honest load-error notice when the fetch itself throws', async () => {
    global.fetch = mockFetch({ ok: false, throws: true })
    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="logo-load-error"]')).toBeTruthy()
  })

  it('shows the real current logo and no error notice on a genuine successful load', async () => {
    global.fetch = mockFetch({ ok: true, url: 'https://example.com/logo.png' })
    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="logo-current"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="logo-load-error"]')).toBeFalsy()
  })

  it('shows no error notice on a genuine ok:true, no-logo-set response', async () => {
    global.fetch = mockFetch({ ok: true, url: null })
    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="logo-load-error"]')).toBeFalsy()
    expect(host.querySelector('[data-testid="logo-current"]')).toBeFalsy()
  })
})
