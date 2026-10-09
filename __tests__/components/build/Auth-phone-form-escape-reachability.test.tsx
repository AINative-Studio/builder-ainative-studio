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

// Real live bug found 2026-10-09 (QA pass, pre-summit): confirmed on production
// (https://builder.ainative.studio, desktop AND mobile viewports, via Playwright)
// that the phone-first form is COMPLETELY UNREACHABLE through the UI. The
// above JSDOM tests never caught this because Testing Library queries work
// on elements regardless of `display:none` — JSDOM doesn't apply real CSS
// layout, so a hidden .m-auth-phone-form's inputs are still "found" and
// "clickable" in tests even though a real browser hides them.
//
// Root cause: showPhoneForm is typed 'auto' | 'email' | 'phone', and
// .m-auth-force-phone (the ONLY class that makes CSS show .m-auth-phone-form
// instead of .m-auth-fields-email — see app/modernist.css ~line 1301) is only
// applied when showPhoneForm === 'phone'. But "Use phone instead"
// (auth-use-phone-instead) calls setShowPhoneForm('auto') — never 'phone'.
// No code path anywhere in this file ever sets the literal state 'phone'.
// Since 'auto' renders with no force-* class, the base (email) CSS always
// wins — on every viewport, since the #944-follow-up mobile media query
// (app/modernist.css ~line 1762) also removed the old mobile-defaults-to-
// phone behavior. Net effect: a founder can never see the phone-first form,
// regardless of device or how many times they click the toggle.
describe('Auth — "Use phone instead" must actually reach the phone form (regression, 2026-10-09)', () => {
  beforeEach(() => { h.dispatch.mockReset(); h.signIn.mockReset() })

  it('sets showPhoneForm to the literal "phone" state (so .m-auth-force-phone is applied) after the full email -> phone round trip', () => {
    render(<Auth mode="signup" />)
    // Round-trip through 'email' first, mirroring how a real founder who
    // defaults to the email view and taps the toggle twice would behave.
    fireEvent.click(screen.getByTestId('auth-use-email-instead'))
    fireEvent.click(screen.getByTestId('auth-use-phone-instead'))
    const root = document.querySelector('.modernist.m-auth')
    expect(root?.classList.contains('m-auth-force-phone')).toBe(true)
    expect(root?.classList.contains('m-auth-force-email')).toBe(false)
  })
})
