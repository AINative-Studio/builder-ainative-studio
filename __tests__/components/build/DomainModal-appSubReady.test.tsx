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
 * Regression test for #817: a real customer got "company not found" trying
 * to connect a domain to their real, existing company from the Live
 * dashboard. Root cause traced to Live.tsx's `companyId` — computed as
 * `state.appSub || company.toLowerCase().replace(/\s+/g, '-')` — which can
 * still resolve via that FALLBACK on a fresh deep-link mount
 * (/build?screen=live&company=X), before the reducer's own real `appSub` is
 * settled. DomainModal's connect-domain lookups previously fired off
 * `slug`/`brand` alone with no way to know whether the slug they were given
 * was a confirmed real one or just companyId's best-effort fallback.
 *
 * The fix: Live.tsx now also passes `appSubReady={!!state.appSub}` — a
 * signal DomainModal can trust independently of whether `slug` happens to be
 * a non-empty string. These tests mount DomainModal directly (not through
 * Live, to keep this deterministic and fast) and assert:
 *   - with appSubReady={false}, opening the modal and even landing on the
 *     BYO tab fires NO connect-domain request, no matter what `slug` says;
 *   - once appSubReady flips to true (mirroring the real appSub settling),
 *     the normal idempotent re-open lookup fires with the real slug;
 *   - a Connect click while appSubReady={false} never calls the API either
 *     (defense-in-depth on the write path, not just the read effects).
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))

import { DomainModal } from '@/components/build/DomainModal'

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

/** connect-domain calls only — filters out the unrelated buy-flow /domains fetch. */
function connectDomainCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/build/connect-domain'))
}

describe('DomainModal appSubReady gate (#817)', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('/api/build/domains')) {
        return Promise.resolve({ ok: true, json: async () => ({ suggestions: [] }) } as Response)
      }
      if (String(url).includes('/api/build/connect-domain')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ connected: false }),
        } as Response)
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    }) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('fires no connect-domain request when appSubReady is false, even on the BYO tab', async () => {
    render(
      <DomainModal
        brand="Agentive"
        slug="agentive"
        appSubReady={false}
        open={true}
        onClose={() => {}}
      />,
    )
    // Let any pending microtasks/effects flush.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // Switch to the BYO tab (where the re-open lookup + poll effect live).
    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => {
      byoTab.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const calls = connectDomainCalls(global.fetch as any)
    expect(calls).toHaveLength(0)
  })

  it('a Connect click while appSubReady is false does not call the API', async () => {
    render(
      <DomainModal
        brand="Agentive"
        slug="agentive"
        appSubReady={false}
        open={true}
        onClose={() => {}}
      />,
    )
    await act(async () => { await Promise.resolve() })

    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => { byoTab.click() })

    const input = host.querySelector('[data-testid="byo-domain-input"]') as HTMLInputElement
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    await act(async () => {
      nativeInputValueSetter.call(input, 'mydomain.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const connectBtn = host.querySelector('[data-testid="byo-connect-cta"]') as HTMLButtonElement
    await act(async () => {
      connectBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(connectDomainCalls(global.fetch as any)).toHaveLength(0)
    // Honest status message instead of silent no-op.
    const msg = host.querySelector('[data-testid="byo-message"]')
    expect(msg?.textContent).toContain('Still loading')
  })

  it('fires the idempotent re-open lookup with the real slug once appSubReady becomes true', async () => {
    let currentRoot: Root
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentRoot = createRoot(container)

    // Start not-ready — mirrors the deep-link window before appSub settles.
    act(() => {
      currentRoot.render(
        <DomainModal brand="Agentive" slug="agentive" appSubReady={false} open={true} onClose={() => {}} />,
      )
    })
    await act(async () => { await Promise.resolve() })
    expect(connectDomainCalls(global.fetch as any)).toHaveLength(0)

    // appSub settles — real slug is now confirmed.
    await act(async () => {
      currentRoot.render(
        <DomainModal brand="Agentive" slug="agentive" appSubReady={true} open={true} onClose={() => {}} />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const calls = connectDomainCalls(global.fetch as any)
    expect(calls.length).toBeGreaterThan(0)
    expect(String(calls[0][0])).toBe('/api/build/connect-domain?slug=agentive')

    act(() => currentRoot.unmount())
    container.remove()
  })

  it('defaults to ready (appSubReady omitted) so older/other callers keep working unchanged', async () => {
    render(
      <DomainModal brand="Agentive" slug="agentive" open={true} onClose={() => {}} />,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const byoTab = host.querySelector('[data-testid="domain-tab-byo"]') as HTMLButtonElement
    await act(async () => {
      byoTab.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const calls = connectDomainCalls(global.fetch as any)
    expect(calls.length).toBeGreaterThan(0)
  })
})
