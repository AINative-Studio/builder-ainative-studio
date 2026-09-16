// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ZeroVoiceConnect } from '@/components/build/ZeroVoiceConnect'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * ZeroVoiceConnect (2026-09-16) — real "Get a phone number" action on the
 * Live dashboard. The backend (`POST /api/build/zerovoice`) was correctly
 * built and tier-gated for any paid plan, but nothing in the UI ever called
 * it — this is the missing entry point. Simpler than ZeroInvoiceConnect:
 * this route is synchronous (no OAuth handoff), so there's no separate
 * "confirm" step — a successful call returns the real number directly.
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

describe('ZeroVoiceConnect', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows "No phone number yet" by default', () => {
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164={null} onRequireAuth={() => {}} />)
    const status = host.querySelector('[data-testid="zerovoice-connect-status"]')
    expect(status?.textContent).toContain('No phone number yet')
  })

  it('renders the real number and no button when already provisioned', () => {
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164="+15551234567" onRequireAuth={() => {}} />)
    const status = host.querySelector('[data-testid="zerovoice-connect-status"]')
    expect(status?.textContent).toContain('+15551234567')
    expect(host.querySelector('[data-testid="zerovoice-connect-btn"]')).toBeNull()
  })

  it('the button is disabled for an unpaid founder', () => {
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={false} e164={null} onRequireAuth={() => {}} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('an anonymous click routes to sign-in instead of calling the API', async () => {
    const onRequireAuth = vi.fn()
    render(<ZeroVoiceConnect companyId="acme" signedIn={false} isPaidPlan={true} e164={null} onRequireAuth={onRequireAuth} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    expect(onRequireAuth).toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a paid, signed-in click POSTs { slug } and shows the real returned number', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, numberId: 'num-1', e164: '+15559998888' }),
    })
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164={null} onRequireAuth={() => {}} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/build/zerovoice',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ slug: 'acme' }) }),
    )
    const status = host.querySelector('[data-testid="zerovoice-connect-status"]')
    expect(status?.textContent).toContain('+15559998888')
    expect(host.querySelector('[data-testid="zerovoice-connect-btn"]')).toBeNull()
  })

  it('a session lapse mid-click (reason: signin) routes to sign-in', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'signin' }) })
    const onRequireAuth = vi.fn()
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164={null} onRequireAuth={onRequireAuth} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onRequireAuth).toHaveBeenCalled()
  })

  it('an unpaid-tier rejection shows an honest upgrade notice, never a false success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'tier', tier: 'hobbyist', unverified: false }) })
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164={null} onRequireAuth={() => {}} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const notice = host.querySelector('[data-testid="zerovoice-connect-notice"]')
    expect(notice?.textContent).toContain('Upgrade')
    expect(host.querySelector('[data-testid="zerovoice-connect-status"]')?.textContent).toContain('No phone number yet')
  })

  it('a real provisioning failure shows an honest notice, never a false success', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: false, reason: 'no_available_numbers' }) })
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164={null} onRequireAuth={() => {}} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const notice = host.querySelector('[data-testid="zerovoice-connect-notice"]')
    expect(notice?.textContent).toContain('no_available_numbers')
  })

  it('a network error shows an honest notice', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network down'))
    render(<ZeroVoiceConnect companyId="acme" signedIn={true} isPaidPlan={true} e164={null} onRequireAuth={() => {}} />)
    const btn = host.querySelector('[data-testid="zerovoice-connect-btn"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const notice = host.querySelector('[data-testid="zerovoice-connect-notice"]')
    expect(notice?.textContent).toContain('Network error')
  })
})
