// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { WebsitePanel } from '@/components/build/WebsitePanel'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #492 — real jsdom render tests for the "Logo & brand" section of WebsitePanel.
 * Covers: honest empty state (no logo yet), rendering an existing saved logo,
 * and a successful upload updating the shown logo without a page reload.
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

/** Route each fetch call to the right canned response by URL/method. */
function routedFetch(opts: {
  logoGet?: unknown
  logoPost?: unknown
  logoPostStatus?: number
}) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith('/api/build/secrets')) {
      return { ok: true, json: async () => ({ secrets: [], available: false }) }
    }
    if (u.startsWith('/api/build/logo')) {
      if (init?.method === 'POST') {
        return {
          ok: (opts.logoPostStatus ?? 200) < 400,
          status: opts.logoPostStatus ?? 200,
          json: async () => opts.logoPost ?? { url: '/api/build/logo?id=new', saved: true },
        }
      }
      return { ok: true, status: 200, json: async () => opts.logoGet ?? { url: null } }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('WebsitePanel — Logo & brand (#492)', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('shows an honest empty state when no logo has been uploaded yet', async () => {
    global.fetch = routedFetch({ logoGet: { url: null } })
    render(<WebsitePanel companyId="beacon" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(host.querySelector('[data-testid="logo-current"]')).toBeFalsy()
    const btn = host.querySelector('[data-testid="logo-upload-btn"]') as HTMLButtonElement
    expect(btn.textContent).toContain('Upload a logo')
  })

  it('renders the current logo when one is already saved', async () => {
    global.fetch = routedFetch({ logoGet: { url: '/api/build/logo?id=11111111-1111-1111-1111-111111111111' } })
    render(<WebsitePanel companyId="beacon" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const img = host.querySelector('[data-testid="logo-current"] img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.src).toContain('/api/build/logo?id=11111111-1111-1111-1111-111111111111')
    const btn = host.querySelector('[data-testid="logo-upload-btn"]') as HTMLButtonElement
    expect(btn.textContent).toContain('Replace logo')
  })

  it('uploading a valid logo shows the new logo and a saved notice', async () => {
    global.fetch = routedFetch({
      logoGet: { url: null },
      logoPost: { url: '/api/build/logo?id=22222222-2222-2222-2222-222222222222', saved: true },
    })
    render(<WebsitePanel companyId="beacon" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const input = host.querySelector('[data-testid="logo-upload-input"]') as HTMLInputElement
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const img = host.querySelector('[data-testid="logo-current"] img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.src).toContain('/api/build/logo?id=22222222-2222-2222-2222-222222222222')
    expect(host.querySelector('[data-testid="logo-notice"]')?.textContent).toContain('saved')
  })

  it('rejects an oversized file client-side without ever calling the upload route', async () => {
    global.fetch = routedFetch({ logoGet: { url: null } })
    render(<WebsitePanel companyId="beacon" canManage={true} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const input = host.querySelector('[data-testid="logo-upload-input"]') as HTMLInputElement
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [big] })
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>
    const callsBefore = fetchSpy.mock.calls.length
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(host.querySelector('[data-testid="logo-notice"]')?.textContent).toMatch(/2MB/)
    // No new fetch call was made for the rejected upload.
    expect(fetchSpy.mock.calls.length).toBe(callsBefore)
  })

  it('a locked (non-owner/unpaid) founder is routed to upgrade instead of the file picker', async () => {
    global.fetch = routedFetch({ logoGet: { url: null } })
    const onRequireUpgrade = vi.fn()
    render(<WebsitePanel companyId="beacon" canManage={false} onRequireUpgrade={onRequireUpgrade} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const btn = host.querySelector('[data-testid="logo-upload-btn"]') as HTMLButtonElement
    await act(async () => { btn.click() })
    expect(onRequireUpgrade).toHaveBeenCalledTimes(1)
  })
})
