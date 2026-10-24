// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { REFERRAL_CREDIT_AWARD } from '@/lib/build/referral'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ReferEarn (components/build/screens/ReferEarn.tsx,
 * 161 lines, reached live via the 'refer' screen case in BuildApp.tsx) had
 * zero test coverage. isGuestSession (lib/build/account-session.ts) is
 * already independently tested and used here REAL (not mocked) — only its
 * input, useSession's real session object, is controlled per test.
 */

let sessionData: any = null
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: sessionData }) }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: dispatchMock }) }))

function jsonResponse(data: any, ok = true) {
  return { ok, json: async () => data }
}

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return host.querySelector(`[data-testid="${id}"]`) as T | null
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  dispatchMock.mockClear()
  sessionData = null
  vi.restoreAllMocks()
})

describe('ReferEarn — real guest-gating/fetch/copy coverage (#1204)', () => {
  it('shows the real "Create a free account" prompt for a genuinely guest session (no real fetch)', async () => {
    sessionData = { user: { type: 'guest', email: 'guest@example.com' } }
    global.fetch = vi.fn() as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve() })

    expect(byTestId('refer-guest-prompt')).not.toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a real guest Sign up click dispatches the real GOTO_SCREEN signup action', async () => {
    sessionData = { user: { type: 'guest', email: 'guest@example.com' } }
    global.fetch = vi.fn() as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('refer-guest-signup')!.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'signup' })
  })

  it('fetches the real referral summary for a genuinely authenticated session and renders it', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => jsonResponse({ code: 'ACME25', link: 'https://builder.ainative.studio/r/ACME25', stats: { friendsReferred: 3, creditsEarned: 75, creditsPending: 25 } })) as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/build/referral')
    expect(byTestId<HTMLInputElement>('refer-link')!.value).toBe('https://builder.ainative.studio/r/ACME25')
    expect(byTestId('refer-code')?.textContent).toBe('ACME25')
    expect(byTestId('refer-friends')?.textContent).toBe('3')
    expect(byTestId('refer-earned')?.textContent).toBe('$75')
    expect(byTestId('refer-pending')?.textContent).toBe('25')
  })

  it('shows the real "Loading…" link value before the real fetch resolves', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(() => new Promise(() => {})) as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))

    expect(byTestId<HTMLInputElement>('refer-link')!.value).toBe('Loading…')
    expect(byTestId<HTMLButtonElement>('refer-copy')!.disabled).toBe(true)
  })

  it('shows the real "Unavailable" fallback and the real "—" code placeholder when the fetch genuinely fails', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId<HTMLInputElement>('refer-link')!.value).toBe('Unavailable')
    expect(byTestId('refer-code')?.textContent).toBe('—')
    expect(byTestId<HTMLButtonElement>('refer-copy')!.disabled).toBe(true)
  })

  it('never crashes on a genuinely rejected fetch, resolves the real loading state', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(byTestId<HTMLInputElement>('refer-link')!.value).toBe('Unavailable')
  })

  it('a real Copy click writes the real link via navigator.clipboard and shows the real "Copied ✓" label for 2s', async () => {
    vi.useFakeTimers()
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => jsonResponse({ code: 'X', link: 'https://real-link.example/r/X', stats: {} })) as any
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('refer-copy')!.click(); await Promise.resolve() })

    expect(writeText).toHaveBeenCalledWith('https://real-link.example/r/X')
    expect(byTestId('refer-copy')?.textContent).toBe('Copied ✓')

    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(byTestId('refer-copy')?.textContent).toBe('Copy')
    vi.useRealTimers()
  })

  it('never crashes and still shows "Copied ✓" via the real execCommand fallback when the clipboard API genuinely rejects', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => jsonResponse({ code: 'X', link: 'https://real-link.example/r/X', stats: {} })) as any
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard blocked'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    document.execCommand = vi.fn().mockReturnValue(true) as any

    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { byTestId<HTMLButtonElement>('refer-copy')!.click(); await Promise.resolve(); await Promise.resolve() })

    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(byTestId('refer-copy')?.textContent).toBe('Copied ✓')
  })

  it('a real Back click dispatches the real GOTO_SCREEN account action', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => jsonResponse({ code: '', link: '', stats: {} })) as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const backBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Back to account')) as HTMLButtonElement
    await act(async () => { backBtn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'account' })
  })

  it('renders the real per-referral credit award amount from REFERRAL_CREDIT_AWARD', async () => {
    sessionData = { user: { email: 'founder@acme.com' } }
    global.fetch = vi.fn(async () => jsonResponse({ code: '', link: '', stats: {} })) as any
    const { ReferEarn } = await import('@/components/build/screens/ReferEarn')
    render(React.createElement(ReferEarn))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain(`$${REFERRAL_CREDIT_AWARD} per referral`)
  })
})
