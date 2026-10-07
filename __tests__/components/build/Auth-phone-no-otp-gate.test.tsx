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
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => null }))

import { Auth } from '@/components/build/screens/Auth'

describe('Auth — email/password signup with an unverified phone (#734 follow-up, OTP stripped)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.dispatch.mockReset()
    h.signIn.mockReset().mockResolvedValue({ error: null })
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/build/register')) {
        return Promise.resolve({ json: async () => ({ ok: true, email: 'a@b.com', verificationRequired: false, metaEventId: 'x' }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('submits successfully with a phone typed but never verified — no OTP gate blocks it', async () => {
    render(<Auth mode="signup" />)
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'longenough1' } })
    fireEvent.change(screen.getByTestId('auth-phone'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('auth-submit'))
    await vi.waitFor(() => expect(h.signIn).toHaveBeenCalledWith('credentials', expect.objectContaining({ email: 'a@b.com', password: 'longenough1' })))
  })

  it('sends the typed phone to /api/build/register even though it was never verified', async () => {
    render(<Auth mode="signup" />)
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'longenough1' } })
    fireEvent.change(screen.getByTestId('auth-phone'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('auth-submit'))
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/register'))
      expect(call).toBeDefined()
    })
    const registerCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/register'))!
    const body = JSON.parse(registerCall[1].body)
    expect(body.phone).toBe('+15125551234')
  })

  it('does not render any OTP send/verify controls on the signup form', () => {
    render(<Auth mode="signup" />)
    expect(screen.queryByTestId('auth-send-otp')).toBeNull()
    expect(screen.queryByTestId('auth-otp-code')).toBeNull()
    expect(screen.queryByTestId('auth-verify-otp')).toBeNull()
  })

  it('still submits with no phone at all (phone remains fully optional)', async () => {
    render(<Auth mode="signup" />)
    fireEvent.change(screen.getByTestId('auth-email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByTestId('auth-submit'))
    await vi.waitFor(() => expect(h.signIn).toHaveBeenCalled())
  })
})
