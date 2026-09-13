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
 * Real bug found live (2026-09-13, core#7395): a real /api/build/my-companies
 * registry-read failure (a live, platform-wide ZeroDB outage) used to be
 * treated identically to "this account genuinely has no companies yet" —
 * afterAuth() routed a returning founder with real, existing companies
 * straight into the "Don't build from scratch" new-user funnel (go('fork'))
 * during the outage, instead of landing on My Companies (which itself now
 * shows an honest "couldn't load right now" state — see
 * MyCompanies-load-error.test.tsx). A real founder (arif@8genc.com) reported
 * their projects had "disappeared."
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
})

async function submitLogin() {
  const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
  const passwordInput = host.querySelector('[data-testid="auth-password"]') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(emailInput, 'arif@8genc.com')
    emailInput.dispatchEvent(new Event('input', { bubbles: true }))
    setter.call(passwordInput, 'realpassword123')
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = host.querySelector('[data-testid="auth-submit"]') as HTMLButtonElement
  await act(async () => {
    submit.click()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  })
}

describe('Auth afterAuth() — real registry outage never routes to the new-user funnel (core#7395)', () => {
  it('lands on companies (not fork) when my-companies reports a real failure (ok:false, 503)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/register')) return { ok: true, json: async () => ({ ok: true }) }
      if (u.includes('/api/build/my-companies')) {
        return { ok: false, status: 503, json: async () => ({ companies: [], ok: false, error: 'registry_unavailable' }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'login' }))
    await submitLogin()

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
    expect(dispatchMock).not.toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'fork' })
  })

  it('lands on companies (not fork) when the my-companies fetch itself throws', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/register')) return { ok: true, json: async () => ({ ok: true }) }
      if (u.includes('/api/build/my-companies')) throw new Error('network down')
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'login' }))
    await submitLogin()

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
    expect(dispatchMock).not.toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'fork' })
  })

  it('still lands on companies when the founder genuinely has real companies (ok:true, non-empty)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/register')) return { ok: true, json: async () => ({ ok: true }) }
      if (u.includes('/api/build/my-companies')) {
        return { ok: true, json: async () => ({ companies: [{ slug: 'ember-box' }], ok: true }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'login' }))
    await submitLogin()

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'companies' })
  })

  it('still lands on fork for a genuinely new founder (ok:true, zero companies) — unaffected by the fix', async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/build/register')) return { ok: true, json: async () => ({ ok: true }) }
      if (u.includes('/api/build/my-companies')) {
        return { ok: true, json: async () => ({ companies: [], ok: true }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'login' }))
    await submitLogin()

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'fork' })
  })
})
