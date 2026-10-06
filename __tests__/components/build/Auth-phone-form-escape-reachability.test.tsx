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

describe('Auth — escape hatch stays reachable under CSS hiding (review finding #1)', () => {
  beforeEach(() => { h.dispatch.mockReset(); h.signIn.mockReset() })

  it('the "Use phone instead" button is NOT a descendant of .m-auth-phone-form, so .m-auth-force-email cannot hide it', () => {
    render(<Auth mode="signup" />)
    fireEvent.click(screen.getByTestId('auth-use-email-instead'))
    const backButton = screen.getByTestId('auth-use-phone-instead')
    const phoneForm = document.querySelector('.m-auth-phone-form')
    expect(phoneForm?.contains(backButton)).toBe(false)
  })

  it('the "Use email instead" button is also NOT a descendant of .m-auth-phone-form', () => {
    render(<Auth mode="signup" />)
    const forwardButton = screen.getByTestId('auth-use-email-instead')
    const phoneForm = document.querySelector('.m-auth-phone-form')
    expect(phoneForm?.contains(forwardButton)).toBe(false)
  })
})
