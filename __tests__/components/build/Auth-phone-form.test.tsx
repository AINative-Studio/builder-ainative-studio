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
