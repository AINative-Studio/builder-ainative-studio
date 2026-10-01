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
 * #881 — the Secrets section's "unavailable" message used to be one generic
 * string regardless of WHY secrets aren't available, collapsing two real,
 * different states into one: a company that never had a dedicated deploy
 * service (the common case) vs. one whose service existed and was later
 * deleted (confirmed live: triage's railwayServiceId pointed at a real
 * Railway service removed during cost remediation on 2026-09-26, leaving a
 * stale registry field). "You'll get this once deployed" is misleading for
 * the second case. The API route already returned a `reason` field
 * (no_service | service_not_found | disabled | no_environment) — this was
 * purely a client-side gap: the UI discarded it.
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

function mockSecretsFetch(response: unknown) {
  return vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.startsWith('/api/build/secrets')) {
      return { ok: true, json: async () => response }
    }
    if (u.startsWith('/api/build/logo')) {
      return { ok: true, status: 200, json: async () => ({ url: null }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('WebsitePanel — Secrets unavailable messaging (#881)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows the generic message for reason:no_service (never had a dedicated service — the common case)', async () => {
    global.fetch = mockSecretsFetch({ ok: true, secrets: [], available: false, reason: 'no_service' })
    render(<WebsitePanel companyId="freshco" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const el = host.querySelector('[data-testid="secrets-unavailable"]')
    expect(el?.textContent).toContain('Secrets become available once your app has its own deploy service.')
  })

  it('shows a distinct, accurate message for reason:service_not_found (service existed, was deleted)', async () => {
    global.fetch = mockSecretsFetch({ ok: true, secrets: [], available: false, reason: 'service_not_found' })
    render(<WebsitePanel companyId="triage" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const el = host.querySelector('[data-testid="secrets-unavailable"]')
    expect(el?.textContent).toContain('no longer available')
    expect(el?.textContent).not.toContain('become available once your app has its own deploy service')
  })

  it('falls back to the generic message when no reason is given at all', async () => {
    global.fetch = mockSecretsFetch({ ok: true, secrets: [], available: false })
    render(<WebsitePanel companyId="freshco" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const el = host.querySelector('[data-testid="secrets-unavailable"]')
    expect(el?.textContent).toContain('Secrets become available once your app has its own deploy service.')
  })
})
