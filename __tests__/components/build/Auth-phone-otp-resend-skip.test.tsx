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
 * #950 — Auth.tsx signup phone OTP: resend/skip fallback for a code that
 * never arrives. Real bug: sendOtp reports {ok:true} as soon as Twilio
 * ACCEPTS the send (HTTP 201 queued) — actual carrier delivery is async and
 * untracked, so a real SMS can silently fail delivery (confirmed live,
 * 2026-10-06: Twilio error 30034, A2P campaign still pending review) while
 * the client already shows "Code sent — enter it below." with no further
 * signal. Before this fix, the founder was then stuck on the code-entry
 * screen forever with no resend, no timeout, no way out.
 *
 * Mirrors Auth-phone-otp.test.tsx's house style: real React render, real DOM
 * events, fetch mocked per-URL, fake timers for the countdown.
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
  vi.useRealTimers()
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

async function sendOtpAndReachCodeEntry() {
  render(React.createElement(Auth, { mode: 'signup' }))
  const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
  await act(async () => { setValue(phoneInput, '5550001111') })
  const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
  await act(async () => { sendBtn.click(); await tick() })
}

describe('Auth signup — OTP resend/skip fallback (#950)', () => {
  it('does not show the "didn\'t get it?" fallback immediately after a code is sent', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) })) as any
    await sendOtpAndReachCodeEntry()

    expect(host.querySelector('[data-testid="auth-otp-fallback"]')).toBeNull()
  })

  it('shows "didn\'t get it?" with Resend and Skip once the countdown expires', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) })) as any
    await sendOtpAndReachCodeEntry()

    await act(async () => { vi.advanceTimersByTime(45_000) })

    expect(host.querySelector('[data-testid="auth-otp-fallback"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="auth-otp-resend"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="auth-otp-skip"]')).toBeTruthy()
  })

  it('Resend re-sends the code and resets the countdown (fallback hides again)', async () => {
    vi.useFakeTimers()
    let sendCount = 0
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const u = String(url)
      if (u.includes('/api/build/register')) {
        const body = JSON.parse(opts.body)
        if (body.action === 'send-otp') {
          sendCount++
          return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as any
    await sendOtpAndReachCodeEntry()
    expect(sendCount).toBe(1)

    await act(async () => { vi.advanceTimersByTime(45_000) })
    const resendBtn = host.querySelector('[data-testid="auth-otp-resend"]') as HTMLButtonElement
    await act(async () => { resendBtn.click(); await tick() })

    expect(sendCount).toBe(2)
    expect(host.querySelector('[data-testid="auth-otp-fallback"]')).toBeNull()
  })

  it('Skip marks the phone verified (unverified-continue) and clears the code-entry state, same as the not_configured fallback', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) })) as any
    await sendOtpAndReachCodeEntry()

    await act(async () => { vi.advanceTimersByTime(45_000) })
    const skipBtn = host.querySelector('[data-testid="auth-otp-skip"]') as HTMLButtonElement
    await act(async () => { skipBtn.click() })

    expect(host.querySelector('[data-testid="auth-phone-verified"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="auth-otp-code"]')).toBeNull()
    expect(host.querySelector('[data-testid="auth-otp-fallback"]')).toBeNull()
  })

  it('the fallback copy never names Twilio/carrier/A2P — stays generic per product decision', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) })) as any
    await sendOtpAndReachCodeEntry()

    await act(async () => { vi.advanceTimersByTime(45_000) })

    const text = host.querySelector('[data-testid="auth-otp-fallback"]')?.textContent || ''
    expect(text.toLowerCase()).not.toMatch(/twilio|carrier|a2p|10dlc/)
    expect(text).toMatch(/didn.t get it/i)
  })

  it('verifying successfully before the countdown expires clears any pending fallback timer (no stray fallback after verification)', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const body = JSON.parse(opts.body)
      if (body.action === 'send-otp') return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
      if (body.action === 'verify-otp') return { ok: true, json: async () => ({ ok: true }) }
      return { ok: true, json: async () => ({}) }
    }) as any
    await sendOtpAndReachCodeEntry()

    const codeInput = host.querySelector('[data-testid="auth-otp-code"]') as HTMLInputElement
    await act(async () => { setValue(codeInput, '123456') })
    const verifyBtn = host.querySelector('[data-testid="auth-verify-otp"]') as HTMLButtonElement
    await act(async () => { verifyBtn.click(); await tick() })

    await act(async () => { vi.advanceTimersByTime(45_000) })

    expect(host.querySelector('[data-testid="auth-otp-fallback"]')).toBeNull()
    expect(host.querySelector('[data-testid="auth-phone-verified"]')).toBeTruthy()
  })
})
