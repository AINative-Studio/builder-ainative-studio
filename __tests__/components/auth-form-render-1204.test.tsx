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
 * #1204 (Coverage Phase 4) — AuthForm (components/auth-form.tsx, 100 lines,
 * reached live via app/(auth)/login/page.tsx and app/(auth)/register/page.tsx)
 * had zero test coverage. signInAction/signUpAction are real Next.js Server
 * Actions ('use server' in app/(auth)/actions.ts) — out of scope for a
 * client-component test, mocked at their real exported boundary.
 * TurnstileWidget already has its own dedicated coverage
 * (turnstile-widget-aria-live.test.tsx) — mocked here too.
 */

const h = vi.hoisted(() => ({ signInAction: vi.fn(), signUpAction: vi.fn() }))
vi.mock('@/app/(auth)/actions', () => h)
vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: ({ onVerify }: { onVerify: (t: string) => void }) =>
    React.createElement('button', { type: 'button', 'data-testid': 'stub-turnstile-verify', onClick: () => onVerify('real-token-123') }, 'Verify'),
}))

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
  vi.unstubAllEnvs()
})

describe('AuthForm — real signin/signup mode + Turnstile-gating coverage (#1204)', () => {
  it('renders the real "Sign In" button and the real "Signing in..." pending copy, never the signup copy', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signin' }))

    const submitBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn.textContent).toBe('Sign In')
    expect(host.textContent).toContain("Don't have an account?")
  })

  it('renders the real "Create Account" button and the real signup-specific copy', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signup' }))

    const submitBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn.textContent).toBe('Create Account')
    expect(host.textContent).toContain('Already have an account?')
  })

  it('sets the real 12-char password minLength for signup, but only 1 for signin', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signup' }))
    expect((host.querySelector('#password') as HTMLInputElement).minLength).toBe(12)

    act(() => { root.unmount() })
    render(React.createElement(AuthForm, { type: 'signin' }))
    expect((host.querySelector('#password') as HTMLInputElement).minLength).toBe(1)
  })

  it('never renders the real Turnstile widget for signin, only for signup', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signin' }))
    expect(host.querySelector('[data-testid="stub-turnstile-verify"]')).toBeNull()

    act(() => { root.unmount() })
    render(React.createElement(AuthForm, { type: 'signup' }))
    expect(host.querySelector('[data-testid="stub-turnstile-verify"]')).not.toBeNull()
  })

  it('disables the real signup submit button until Turnstile genuinely verifies, when the real site key env var is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'real-site-key')
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signup' }))

    const submitBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    const verifyBtn = host.querySelector('[data-testid="stub-turnstile-verify"]') as HTMLButtonElement
    await act(async () => { verifyBtn.click() })

    expect(submitBtn.disabled).toBe(false)
  })

  it('a real verified Turnstile token is written into the real hidden turnstileToken field', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signup' }))

    const verifyBtn = host.querySelector('[data-testid="stub-turnstile-verify"]') as HTMLButtonElement
    await act(async () => { verifyBtn.click() })

    const hiddenField = host.querySelector('input[name="turnstileToken"]') as HTMLInputElement
    expect(hiddenField.value).toBe('real-token-123')
  })

  it('never gates the real signup submit button on Turnstile when the real site key env var is genuinely unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signup' }))

    const submitBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitBtn.disabled).toBe(false)
  })

  it('renders the real required email/password inputs for both modes', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signin' }))

    expect((host.querySelector('#email') as HTMLInputElement).required).toBe(true)
    expect((host.querySelector('#password') as HTMLInputElement).required).toBe(true)
    expect((host.querySelector('#email') as HTMLInputElement).type).toBe('email')
    expect((host.querySelector('#password') as HTMLInputElement).type).toBe('password')
  })

  it('renders the real "Sign up"/"Sign in" cross-links to the real /register and /login routes', async () => {
    const { AuthForm } = await import('@/components/auth-form')
    render(React.createElement(AuthForm, { type: 'signin' }))
    expect((host.querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/register')

    act(() => { root.unmount() })
    render(React.createElement(AuthForm, { type: 'signup' }))
    expect((host.querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/login')
  })
})
