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
 * Real bug fix, same shape as the WaitlistPanel/VisitorsPanel/GrowthPanel/
 * TasksPanel/VersionsPanel/AutoModePanel fixes: a failed `GET
 * /api/build/secrets` (non-ok response, or the fetch itself throwing) used
 * to collapse into the SAME shape as a confirmed `available: false`
 * response, showing "Secrets become available once your app has its own
 * deploy service" on a transient hiccup for a company that genuinely has a
 * deploy service AND secrets configured. These tests assert the honest
 * load-error state renders instead, and never the misleading "unavailable"
 * message, on a 503 or a thrown fetch.
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

function mockFetch(secretsResponse: { ok: boolean; status?: number; throws?: boolean }) {
  return vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.startsWith('/api/build/secrets')) {
      if (secretsResponse.throws) throw new Error('network down')
      return { ok: secretsResponse.ok, status: secretsResponse.status ?? (secretsResponse.ok ? 200 : 503), json: async () => ({}) }
    }
    if (u.startsWith('/api/build/logo')) {
      return { ok: true, status: 200, json: async () => ({ url: null }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('WebsitePanel — Secrets honest load-error state', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows the honest load-error state on a non-ok response, never the "unavailable" message', async () => {
    global.fetch = mockFetch({ ok: false, status: 503 })
    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="secrets-load-error"]')?.textContent).toContain("Couldn't load secrets")
    expect(host.querySelector('[data-testid="secrets-unavailable"]')).toBeFalsy()
    expect(host.querySelector('[data-testid="secrets-empty"]')).toBeFalsy()
  })

  it('shows the honest load-error state when the fetch itself throws', async () => {
    global.fetch = mockFetch({ ok: false, throws: true })
    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="secrets-load-error"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="secrets-unavailable"]')).toBeFalsy()
  })

  it('still shows the real empty state on a genuine ok:true, available:true, zero-secrets response', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.startsWith('/api/build/secrets')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, secrets: [], available: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ url: null }) }
    }) as unknown as typeof fetch

    render(<WebsitePanel companyId="acme" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="secrets-empty"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="secrets-load-error"]')).toBeFalsy()
  })
})
