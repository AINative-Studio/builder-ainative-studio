// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const signInMock = vi.fn(async (): Promise<{ error: string | null }> => ({ error: null }))
vi.mock('next-auth/react', () => ({ signIn: (_provider: string, _opts: any) => signInMock() }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn(async () => {}) }))
vi.mock('@/lib/build/attribution', () => ({ getRefCode: () => null }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: {}, dispatch: dispatchMock }) }))

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

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('Auth signup — email-OTP fallback option (#BLD-02b)', () => {
  it('offers "Email me a code instead" in the fallback once it appears, and sending it calls send-otp-email', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const body = JSON.parse(opts.body)
      if (body.action === 'send-otp') return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
      if (body.action === 'send-otp-email') {
        expect(body.email).toBe('a@b.com')
        return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => {
      setValue(emailInput, 'a@b.com')
      setValue(phoneInput, '5550001111')
    })
    const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
    await act(async () => { sendBtn.click(); await tick() })
    await act(async () => { vi.advanceTimersByTime(45_000) })

    const emailFallbackBtn = host.querySelector('[data-testid="auth-otp-email-fallback"]') as HTMLButtonElement
    expect(emailFallbackBtn).toBeTruthy()
    await act(async () => { emailFallbackBtn.click(); await tick() })

    expect(host.querySelector('[data-testid="auth-otp-note"]')?.textContent).toContain('email')
    vi.useRealTimers()
  })
})
