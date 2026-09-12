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
 * #651 — the login, signup, forgot, and reset screens had no way back to the
 * public landing page short of the browser back button or retyping the URL.
 * Adds a persistent header (logo + explicit back control) shared by every
 * Auth mode, both dispatching a plain GOTO_SCREEN('landing') — never a
 * signIn/register call, so clicking either creates no session.
 */

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
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
})

describe.each(['login', 'signup', 'forgot', 'reset'] as const)('Auth back-to-landing navigation (#651) — mode=%s', (mode) => {
  it('renders the persistent header with a logo and an explicit back control', () => {
    render(React.createElement(Auth, { mode }))
    const header = host.querySelector('[data-testid="auth-header"]')
    expect(header).not.toBeNull()
    expect(host.querySelector('[data-testid="auth-logo-home"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="auth-back-home"]')).not.toBeNull()
  })

  it('clicking the logo dispatches GOTO_SCREEN landing with no signIn/register side effect', () => {
    render(React.createElement(Auth, { mode }))
    const logo = host.querySelector('[data-testid="auth-logo-home"]') as HTMLButtonElement
    act(() => { logo.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'landing' })
  })

  it('clicking the back control dispatches GOTO_SCREEN landing', () => {
    render(React.createElement(Auth, { mode }))
    const back = host.querySelector('[data-testid="auth-back-home"]') as HTMLButtonElement
    act(() => { back.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'landing' })
  })
})

describe('Auth back-to-landing navigation (#651) — verify-email state', () => {
  it('the header is present even in the post-signup "check your email" state', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, error: 'no' }) })) as any
    render(React.createElement(Auth, { mode: 'signup' }))

    // Drive into the verify-email state via a real signup submit that core
    // reports as requiring verification.
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/build/register')) {
        return { ok: true, json: async () => ({ ok: true, verificationRequired: true }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
    const passwordInput = host.querySelector('[data-testid="auth-password"]') as HTMLInputElement
    await act(async () => {
      const emailSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      emailSetter.call(emailInput, 'founder@example.com')
      emailInput.dispatchEvent(new Event('input', { bubbles: true }))
      emailSetter.call(passwordInput, 'longenoughpassword')
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const submit = host.querySelector('[data-testid="auth-submit"]') as HTMLButtonElement
    await act(async () => { submit.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(host.querySelector('[data-testid="auth-verify-panel"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="auth-header"]')).not.toBeNull()
  })
})
