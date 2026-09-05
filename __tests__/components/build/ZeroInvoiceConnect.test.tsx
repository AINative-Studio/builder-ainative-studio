// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ZeroInvoiceConnect } from '@/components/build/ZeroInvoiceConnect'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #506 (child of #418) — real "Connect ZeroInvoice" action on the Live
 * dashboard. The backend (`POST /api/build/zeroinvoice`) has existed and
 * been live since #418; the only real gap was that nothing in the UI called
 * it. These tests cover the new component in isolation.
 *
 * Properties under test:
 *  - anonymous click routes to sign-in instead of calling the API;
 *  - signed-in click POSTs { slug } and opens the returned authUrl in a new tab;
 *  - a mid-click session lapse (reason:'signin') also routes to sign-in;
 *  - a real authorize failure shows an honest notice, never a false success;
 *  - copy never claims "Connected" — only an honest "clicked" acknowledgment,
 *    persisted across reload via the `clickedAt` prop.
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

describe('ZeroInvoiceConnect', () => {
  const originalFetch = global.fetch
  let openSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    global.fetch = vi.fn()
    openSpy = vi.fn()
    ;(window as any).open = openSpy
  })

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows honest "Not connected" copy by default — never "Connected"', () => {
    render(
      <ZeroInvoiceConnect companyId="acme" signedIn={false} clickedAt={null} onRequireAuth={() => {}} />,
    )
    const status = host.querySelector('[data-testid="zeroinvoice-connect-status"]')
    expect(status?.textContent).toContain('Not connected')
    expect(host.textContent).not.toContain('Connected ✓')
  })

  it('an anonymous click routes to sign-in instead of calling the API', async () => {
    const onRequireAuth = vi.fn()
    render(
      <ZeroInvoiceConnect companyId="acme" signedIn={false} clickedAt={null} onRequireAuth={onRequireAuth} />,
    )
    const btn = host.querySelector('[data-testid="zeroinvoice-connect-btn"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    expect(onRequireAuth).toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a signed-in click POSTs { slug } and opens the real authUrl in a new tab', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, authUrl: 'https://zeroinvoice.ainative.studio/oauth/authorize?x=1' }),
    })
    render(
      <ZeroInvoiceConnect companyId="acme" signedIn={true} clickedAt={null} onRequireAuth={() => {}} />,
    )
    const btn = host.querySelector('[data-testid="zeroinvoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/build/zeroinvoice',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slug: 'acme' }),
      }),
    )
    expect(openSpy).toHaveBeenCalledWith(
      'https://zeroinvoice.ainative.studio/oauth/authorize?x=1',
      '_blank',
      'noopener,noreferrer',
    )
    // Honest "clicked" acknowledgment, never "Connected".
    const status = host.querySelector('[data-testid="zeroinvoice-connect-status"]')
    expect(status?.textContent).toContain('Connect requested')
    expect(host.textContent).not.toContain('Connected ✓')
  })

  it('a session lapse mid-click (reason: signin) routes to sign-in, does not open a tab', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'signin' }) })
    const onRequireAuth = vi.fn()
    render(
      <ZeroInvoiceConnect companyId="acme" signedIn={true} clickedAt={null} onRequireAuth={onRequireAuth} />,
    )
    const btn = host.querySelector('[data-testid="zeroinvoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onRequireAuth).toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('a real authorize failure shows an honest notice, never a false success', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, reason: 'authorize_response_missing_auth_url' }),
    })
    render(
      <ZeroInvoiceConnect companyId="acme" signedIn={true} clickedAt={null} onRequireAuth={() => {}} />,
    )
    const btn = host.querySelector('[data-testid="zeroinvoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(openSpy).not.toHaveBeenCalled()
    const notice = host.querySelector('[data-testid="zeroinvoice-connect-notice"]')
    expect(notice?.textContent).toContain('authorize_response_missing_auth_url')
    const status = host.querySelector('[data-testid="zeroinvoice-connect-status"]')
    expect(status?.textContent).toContain('Not connected')
  })

  it('a persisted clickedAt (from reload) renders the honest "requested" state up front', () => {
    render(
      <ZeroInvoiceConnect
        companyId="acme"
        signedIn={true}
        clickedAt="2026-09-01T00:00:00Z"
        onRequireAuth={() => {}}
      />,
    )
    const status = host.querySelector('[data-testid="zeroinvoice-connect-status"]')
    expect(status?.textContent).toContain('Connect requested')
    const btn = host.querySelector('[data-testid="zeroinvoice-connect-btn"]') as HTMLButtonElement
    expect(btn.textContent).toContain('Reconnect ZeroInvoice')
  })

  it('a network error shows an honest notice', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    render(
      <ZeroInvoiceConnect companyId="acme" signedIn={true} clickedAt={null} onRequireAuth={() => {}} />,
    )
    const btn = host.querySelector('[data-testid="zeroinvoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const notice = host.querySelector('[data-testid="zeroinvoice-connect-notice"]')
    expect(notice?.textContent).toContain('Network error')
  })
})
