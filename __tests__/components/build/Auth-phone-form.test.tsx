// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
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

describe('Auth — phone-first form shell (#944)', () => {
  beforeEach(() => { h.dispatch.mockReset(); h.signIn.mockReset() })

  it('renders the phone-first form block alongside the email form', () => {
    render(<Auth mode="signup" />)
    expect(screen.getByTestId('auth-phone-form')).not.toBeNull()
  })

  it('shows a phone input and a Send code button initially', () => {
    render(<Auth mode="signup" />)
    const phoneForm = screen.getByTestId('auth-phone-form')
    expect(phoneForm.querySelector('input[type="tel"]')).not.toBeNull()
    expect(screen.getByTestId('phone-send-code')).not.toBeNull()
  })

  it('has an escape-hatch control to switch to the email form, and back', () => {
    render(<Auth mode="signup" />)
    const toEmail = screen.getByTestId('auth-use-email-instead')
    expect(toEmail).not.toBeNull()
    fireEvent.click(toEmail)
    expect(screen.getByTestId('auth-use-phone-instead')).not.toBeNull()
  })
})

describe('Auth — phone-first form submission (#944)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.dispatch.mockReset()
    h.signIn.mockReset().mockResolvedValue({ error: null })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends a code, then registers+signs in on a NEW phone number', async () => {
    fetchMock.mockImplementation((url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : null
      if (url.includes('/api/build/register-phone') && body?.action === 'send-otp') {
        return Promise.resolve({ json: async () => ({ ok: true }) })
      }
      if (url.includes('/api/build/login-phone')) {
        return Promise.resolve({ json: async () => ({ ok: false, errorCode: 'NO_SUCH_PHONE_ACCOUNT' }) })
      }
      if (url.includes('/api/build/register-phone')) {
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600 }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    render(<Auth mode="signup" />)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await vi.waitFor(() => expect(h.signIn).toHaveBeenCalledWith(
      'phone-login',
      expect.objectContaining({ redirect: false, accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600 }),
    ))
  })

  it('falls back from login to register when core reports NO_SUCH_PHONE_ACCOUNT', async () => {
    let registerCalled = false
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/build/login-phone')) {
        return Promise.resolve({ json: async () => ({ ok: false, errorCode: 'NO_SUCH_PHONE_ACCOUNT' }) })
      }
      if (url.includes('/api/build/register-phone')) {
        registerCalled = true
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok2', refreshToken: 'ref2', expiresIn: 3600 }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    render(<Auth mode="login" />)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await vi.waitFor(() => expect(registerCalled).toBe(true))
  })

  it('shows a real error message, never hangs busy, when signIn fails after tokens are issued', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/build/login-phone')) {
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok3', refreshToken: 'ref3', expiresIn: 3600 }) })
      }
      if (url.includes('/api/build/register-phone')) {
        return Promise.resolve({ json: async () => ({ ok: true }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    h.signIn.mockResolvedValue({ error: 'CredentialsSignin' })
    render(<Auth mode="login" />)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await screen.findByText(/could not sign you in/i)
    expect((screen.getByTestId('phone-submit-code') as HTMLButtonElement).disabled).toBe(false)
  })
})
