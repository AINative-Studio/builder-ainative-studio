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
 * #7698 — Auth.tsx forgot/reset modes must actually call the real reset flow.
 * Before this, both modes hit a stub:
 *   if (mode === 'forgot' || mode === 'reset') { setError('Password reset is
 *     coming soon — contact support.'); return }
 * so a founder who clicked "Forgot password?" got a dead end (live: 2026-09-18).
 *
 * House style matches Auth-phone-otp.test.tsx: real React render, real DOM
 * events, fetch mocked per-call.
 */

const signInMock = vi.fn(async (): Promise<{ error: string | null }> => ({ error: null }))
vi.mock('next-auth/react', () => ({ signIn: (_provider: string, _opts: any) => signInMock() }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn(async () => {}) }))
vi.mock('@/lib/build/attribution', () => ({ getRefCode: () => null }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: {}, dispatch: dispatchMock }),
}))

import { Auth } from '@/components/build/screens/Auth'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/build')
})

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

function mockFetch(response: unknown, status = 200) {
  const f = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(response), { status }),
  )
  vi.stubGlobal('fetch', f)
  return f
}

function click(el: Element | null) {
  act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('Auth forgot mode — real reset request (#7698)', () => {
  it('no longer shows the "coming soon" stub message', async () => {
    const f = mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'forgot' }))
    setValue(host.querySelector('[data-testid="auth-email"]') as HTMLInputElement, 'founder@example.com')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(host.textContent).not.toMatch(/coming soon/i)
    expect(f).toHaveBeenCalled()
  })

  it('posts the email to /api/auth/forgot-password', async () => {
    const f = mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'forgot' }))
    setValue(host.querySelector('[data-testid="auth-email"]') as HTMLInputElement, 'founder@example.com')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/auth/forgot-password')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'founder@example.com' })
  })

  it('shows a neutral "check your email" confirmation that does not confirm the account exists', async () => {
    mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'forgot' }))
    setValue(host.querySelector('[data-testid="auth-email"]') as HTMLInputElement, 'founder@example.com')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(host.querySelector('[data-testid="auth-reset-sent-panel"]')).toBeTruthy()
    // Must stay conditional — this screen must not become an enumeration oracle.
    expect(host.textContent).toMatch(/if an account exists/i)
  })

  it('rejects an invalid email locally without calling the API', async () => {
    const f = mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'forgot' }))
    setValue(host.querySelector('[data-testid="auth-email"]') as HTMLInputElement, 'nope')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(f).not.toHaveBeenCalled()
    expect(host.querySelector('.m-auth-error')?.textContent).toMatch(/valid email/i)
  })

  it('surfaces a server error instead of a false confirmation', async () => {
    mockFetch({ ok: false, error: 'Too many reset requests — try again in a little while.' }, 429)
    render(React.createElement(Auth, { mode: 'forgot' }))
    setValue(host.querySelector('[data-testid="auth-email"]') as HTMLInputElement, 'founder@example.com')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(host.querySelector('[data-testid="auth-reset-sent-panel"]')).toBeNull()
    expect(host.querySelector('.m-auth-error')?.textContent).toMatch(/too many/i)
  })
})

describe('Auth reset mode — token exchange (#7698)', () => {
  it('sends the token from the URL plus the new password', async () => {
    window.history.replaceState({}, '', '/build?screen=reset&token=tok-from-email')
    const f = mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'reset' }))
    setValue(host.querySelector('[data-testid="auth-password"]') as HTMLInputElement, 'a-new-passphrase')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/auth/forgot-password')
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'reset', token: 'tok-from-email', password: 'a-new-passphrase',
    })
  })

  it('confirms success and offers log in', async () => {
    window.history.replaceState({}, '', '/build?screen=reset&token=tok-from-email')
    mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'reset' }))
    setValue(host.querySelector('[data-testid="auth-password"]') as HTMLInputElement, 'a-new-passphrase')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(host.querySelector('[data-testid="auth-reset-done-panel"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="auth-reset-done-login"]')).toBeTruthy()
  })

  it('refuses to submit without a token rather than calling the API blindly', async () => {
    window.history.replaceState({}, '', '/build?screen=reset')
    const f = mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'reset' }))
    setValue(host.querySelector('[data-testid="auth-password"]') as HTMLInputElement, 'a-new-passphrase')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(f).not.toHaveBeenCalled()
    expect(host.querySelector('.m-auth-error')?.textContent).toMatch(/missing its token/i)
  })

  it('enforces the minimum password length locally', async () => {
    window.history.replaceState({}, '', '/build?screen=reset&token=tok-from-email')
    const f = mockFetch({ ok: true })
    render(React.createElement(Auth, { mode: 'reset' }))
    setValue(host.querySelector('[data-testid="auth-password"]') as HTMLInputElement, 'short')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(f).not.toHaveBeenCalled()
    expect(host.querySelector('.m-auth-error')?.textContent).toMatch(/at least 8/i)
  })

  it('surfaces an expired-link error instead of claiming success', async () => {
    window.history.replaceState({}, '', '/build?screen=reset&token=stale')
    mockFetch({ ok: false, error: 'Invalid or expired reset token' }, 400)
    render(React.createElement(Auth, { mode: 'reset' }))
    setValue(host.querySelector('[data-testid="auth-password"]') as HTMLInputElement, 'a-new-passphrase')
    click(host.querySelector('[data-testid="auth-submit"]'))
    await tick()

    expect(host.querySelector('[data-testid="auth-reset-done-panel"]')).toBeNull()
    expect(host.querySelector('.m-auth-error')?.textContent).toMatch(/expired/i)
  })
})
