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
 * #734 — Auth.tsx signup phone input + OTP verification gating. Mirrors the
 * house style of Auth-my-companies-outage.test.tsx: a real React render,
 * real DOM events, fetch mocked per-URL.
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
  signInMock.mockReset().mockResolvedValue({ error: null })
})

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('Auth signup — phone input + OTP verification (#734)', () => {
  it('renders the phone input only in signup mode', async () => {
    render(React.createElement(Auth, { mode: 'signup' }))
    expect(host.querySelector('[data-testid="auth-phone"]')).toBeTruthy()

    act(() => { root.unmount() })
    host.remove()
    render(React.createElement(Auth, { mode: 'login' }))
    expect(host.querySelector('[data-testid="auth-phone"]')).toBeNull()
  })

  it('sends an OTP and shows the code input on success', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const u = String(url)
      if (u.includes('/api/build/register')) {
        const body = JSON.parse(opts.body)
        if (body.action === 'send-otp') {
          expect(body.phone).toBe('+15550001111')
          return { ok: true, json: async () => ({ ok: true, expiresAt: '2026-09-13T00:10:00.000Z' }) }
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => { setValue(phoneInput, '5550001111') })

    const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
    expect(sendBtn).toBeTruthy()
    await act(async () => { sendBtn.click(); await tick() })

    expect(host.querySelector('[data-testid="auth-otp-code"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="auth-otp-note"]')?.textContent).toContain('Code sent')
  })

  it('verifies the code and shows the phone-verified confirmation', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const u = String(url)
      if (u.includes('/api/build/register')) {
        const body = JSON.parse(opts.body)
        if (body.action === 'send-otp') return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
        if (body.action === 'verify-otp') {
          expect(body.phone).toBe('+15550001111')
          expect(body.code).toBe('123456')
          return { ok: true, json: async () => ({ ok: true }) }
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => { setValue(phoneInput, '5550001111') })
    const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
    await act(async () => { sendBtn.click(); await tick() })

    const codeInput = host.querySelector('[data-testid="auth-otp-code"]') as HTMLInputElement
    await act(async () => { setValue(codeInput, '123456') })
    const verifyBtn = host.querySelector('[data-testid="auth-verify-otp"]') as HTMLButtonElement
    await act(async () => { verifyBtn.click(); await tick() })

    expect(host.querySelector('[data-testid="auth-phone-verified"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="auth-otp-code"]')).toBeNull()
  })

  it('shows an error and does not verify on a wrong code', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const body = JSON.parse(opts.body)
      if (body.action === 'send-otp') return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
      if (body.action === 'verify-otp') return { ok: true, json: async () => ({ ok: false, reason: 'mismatch' }) }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => { setValue(phoneInput, '5550001111') })
    const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
    await act(async () => { sendBtn.click(); await tick() })

    const codeInput = host.querySelector('[data-testid="auth-otp-code"]') as HTMLInputElement
    await act(async () => { setValue(codeInput, '000000') })
    const verifyBtn = host.querySelector('[data-testid="auth-verify-otp"]') as HTMLButtonElement
    await act(async () => { verifyBtn.click(); await tick() })

    expect(host.querySelector('[data-testid="auth-phone-verified"]')).toBeNull()
    expect(host.querySelector('.m-auth-error')?.textContent).toContain('Incorrect code')
  })

  it('blocks final signup submission when a phone was entered but never verified', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/register')) return { ok: true, json: async () => ({ ok: true }) }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
    const passwordInput = host.querySelector('[data-testid="auth-password"]') as HTMLInputElement
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => {
      setValue(emailInput, 'a@b.com')
      setValue(passwordInput, 'longenough1')
      setValue(phoneInput, '5550001111')
    })

    const submit = host.querySelector('[data-testid="auth-submit"]') as HTMLButtonElement
    await act(async () => { submit.click(); await tick() })

    expect(host.querySelector('.m-auth-error')?.textContent).toContain('Verify your phone')
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('allows submission with no phone entered at all (phone is optional)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/register')) return { ok: true, json: async () => ({ ok: true }) }
      if (u.includes('/api/build/my-companies')) return { ok: true, json: async () => ({ ok: true, companies: [] }) }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
    const passwordInput = host.querySelector('[data-testid="auth-password"]') as HTMLInputElement
    await act(async () => {
      setValue(emailInput, 'a@b.com')
      setValue(passwordInput, 'longenough1')
    })

    const submit = host.querySelector('[data-testid="auth-submit"]') as HTMLButtonElement
    await act(async () => { submit.click(); await tick() })

    expect(signInMock).toHaveBeenCalledTimes(1)
  })

  it('proceeds to submission when send-otp reports not_configured (honest infra gap fallback)', async () => {
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const u = String(url)
      if (u.includes('/api/build/register')) {
        const body = JSON.parse(opts.body)
        if (body.action === 'send-otp') return { ok: true, json: async () => ({ ok: false, reason: 'not_configured' }) }
        return { ok: true, json: async () => ({ ok: true }) }
      }
      if (u.includes('/api/build/my-companies')) return { ok: true, json: async () => ({ ok: true, companies: [] }) }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
    const passwordInput = host.querySelector('[data-testid="auth-password"]') as HTMLInputElement
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => {
      setValue(emailInput, 'a@b.com')
      setValue(passwordInput, 'longenough1')
      setValue(phoneInput, '5550001111')
    })

    const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
    await act(async () => { sendBtn.click(); await tick() })
    expect(host.querySelector('[data-testid="auth-phone-verified"]')).toBeTruthy()

    const submit = host.querySelector('[data-testid="auth-submit"]') as HTMLButtonElement
    await act(async () => { submit.click(); await tick() })

    expect(signInMock).toHaveBeenCalledTimes(1)
  })
})
