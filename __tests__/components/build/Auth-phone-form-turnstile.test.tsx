// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const h = vi.hoisted(() => ({ dispatch: vi.fn(), signIn: vi.fn() }))

vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { appSub: null, pendingBuild: null, track: 'app' },
    dispatch: h.dispatch,
  }),
}))
vi.mock('next-auth/react', () => ({ signIn: h.signIn }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/build/attribution', () => ({ getRefCode: () => null }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: vi.fn() }))
// Capture onVerify so the test can simulate a real Turnstile pass/token,
// same technique the component uses in production — this mock renders a
// real button the test can click to fire the captured callback.
vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: ({ onVerify }: { onVerify: (t: string) => void }) =>
    React.createElement('button', {
      className: 'mock-turnstile-verify',
      onClick: () => onVerify('real-turnstile-token'),
    }, 'mock verify'),
}))

import { Auth } from '@/components/build/screens/Auth'

describe('Auth — phone form Turnstile gating (review finding #2)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.dispatch.mockReset()
    h.signIn.mockReset().mockResolvedValue({ error: null })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders a Turnstile widget inside the phone-first signup form', () => {
    render(<Auth mode="signup" />)
    const phoneForm = screen.getByTestId('auth-phone-form')
    expect(phoneForm.querySelector('.mock-turnstile-verify')).not.toBeNull()
  })

  it('includes the real Turnstile token in the register-phone request body once verified', async () => {
    let capturedBody: any = null
    fetchMock.mockImplementation((url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : null
      if (url.includes('/api/build/register-phone') && body?.action === 'send-otp') {
        return Promise.resolve({ json: async () => ({ ok: true }) })
      }
      if (url.includes('/api/build/login-phone')) {
        return Promise.resolve({ json: async () => ({ ok: false, errorCode: 'NO_SUCH_PHONE_ACCOUNT' }) })
      }
      if (url.includes('/api/build/register-phone')) {
        capturedBody = body
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600 }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    render(<Auth mode="signup" />)
    const phoneForm = screen.getByTestId('auth-phone-form')
    fireEvent.click(phoneForm.querySelector('.mock-turnstile-verify') as HTMLElement)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await vi.waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody.turnstileToken).toBe('real-turnstile-token')
  })
})
