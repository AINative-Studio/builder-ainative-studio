// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * TurnstileWidget's aria-live status region (2026-10-05 accessibility
 * audit): Cloudflare's own Turnstile iframe has no aria-live ancestor, so a
 * screen-reader user is never told when the "Success!" state lands. This
 * widget now drives its own announcement off the same onVerify callback the
 * form already uses, independent of the iframe's internals.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

const originalEnv = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

beforeEach(() => {
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key'
  ;(window as any).turnstile = undefined
})

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalEnv
  document.getElementById('cf-turnstile-script')?.remove()
})

import { TurnstileWidget } from '@/components/turnstile-widget'

describe('TurnstileWidget — aria-live status region', () => {
  it('renders an empty, polite status region before verification', () => {
    render(React.createElement(TurnstileWidget, { onVerify: vi.fn() }))
    const status = host.querySelector('[data-testid="turnstile-sr-status"]')
    expect(status).toBeTruthy()
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.textContent).toBe('')
  })

  it('announces completion once the real Turnstile callback fires', async () => {
    const onVerify = vi.fn()
    // Simulate window.turnstile being available by the time the script "loads".
    ;(window as any).turnstile = {
      render: (_el: string, opts: { callback: (t: string) => void }) => {
        // Defer to mimic the real async render-then-verify flow.
        setTimeout(() => opts.callback('real-token'), 0)
        return 'widget-id-1'
      },
      remove: vi.fn(),
    }
    render(React.createElement(TurnstileWidget, { onVerify }))

    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

    expect(onVerify).toHaveBeenCalledWith('real-token')
    const status = host.querySelector('[data-testid="turnstile-sr-status"]')
    expect(status?.textContent).toBe('Verification complete.')
  })

  it('clears the announcement and calls onExpire when the widget expires', async () => {
    const onExpire = vi.fn()
    let expireCb: (() => void) | undefined
    ;(window as any).turnstile = {
      render: (_el: string, opts: { callback: (t: string) => void; 'expired-callback'?: () => void }) => {
        setTimeout(() => opts.callback('real-token'), 0)
        expireCb = opts['expired-callback']
        return 'widget-id-2'
      },
      remove: vi.fn(),
    }
    render(React.createElement(TurnstileWidget, { onVerify: vi.fn(), onExpire }))
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

    expect(host.querySelector('[data-testid="turnstile-sr-status"]')?.textContent).toBe('Verification complete.')

    act(() => { expireCb?.() })
    expect(onExpire).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="turnstile-sr-status"]')?.textContent).toBe('')
  })

  it('renders nothing when the site key is not configured', () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    render(React.createElement(TurnstileWidget, { onVerify: vi.fn() }))
    expect(host.innerHTML).toBe('')
  })
})
