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
 * #1204 (Coverage Phase 4) — ChatSelector (components/shared/chat-selector.tsx,
 * 606 lines, zero prior test coverage) renders in the shared app header on
 * real pages (/insights, /settings/*, /admin/*, /chats, /chats/[chatId]).
 *
 * Real bug this component's own comment documents (confirmed live): fetching
 * /api/chats unconditionally 401s for anonymous visitors, polluting the
 * console on public marketing pages where this header renders — fixed by
 * gating the fetch on a real signed-in session. This is the exact behavior
 * these tests lock in, plus the current-chat-id derivation from pathname.
 */

let sessionData: { user: { email: string } } | null = null
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: sessionData }) }))

let pathname = '/'
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => pathname,
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
  sessionData = null
  pathname = '/'
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ChatSelector — real render + fetch-gating coverage (#1204)', () => {
  it('never calls /api/chats for an anonymous (signed-out) visitor — the real #401-pollution fix', async () => {
    sessionData = null
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as any
    const { ChatSelector } = await import('@/components/shared/chat-selector')

    render(React.createElement(ChatSelector))
    await act(async () => { await Promise.resolve() })

    expect(global.fetch).not.toHaveBeenCalled()
    // Real behavior, confirmed live: `if (chats.length === 0 && !isLoading)
    // return null` — the whole selector renders nothing at all when there
    // are no chats (anonymous visitors always have none), not an empty
    // state with text. host.textContent === '' IS the correct assertion.
    expect(host.textContent).toBe('')
  })

  it('fetches /api/chats and renders a real selectable trigger once a real session with chats exists', async () => {
    sessionData = { user: { email: 'founder@example.com' } }
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/chats')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'chat-1', name: 'Acme CRM', createdAt: '2026-10-01T00:00:00Z' },
              { id: 'chat-2', name: 'Beta App', createdAt: '2026-10-02T00:00:00Z' },
            ],
          }),
        } as any
      }
      return { ok: true, json: async () => ({}) } as any
    }) as any
    const { ChatSelector } = await import('@/components/shared/chat-selector')

    render(React.createElement(ChatSelector))
    await act(async () => { await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/chats')
    // Real Radix behavior: SelectValue's custom children (the "N chats
    // available"/display-name content) only render once the Select HAS a
    // selected value — with no chat selected (pathname '/'), Radix shows
    // its bare `placeholder` prop text instead. Confirmed by reading
    // components/ui/select.tsx's SelectValue wrapper directly.
    expect(host.textContent).toContain('Select chat')
    expect(host.querySelector('[data-slot="select-trigger"]')).not.toBeNull()
  })

  it('renders the current chat\'s real display name when pathname is /chats/{chatId} and that chat is in the fetched list', async () => {
    sessionData = { user: { email: 'founder@example.com' } }
    pathname = '/chats/chat-1'
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ id: 'chat-1', name: 'Acme CRM', createdAt: '2026-10-01T00:00:00Z' }],
      }),
    })) as any
    const { ChatSelector } = await import('@/components/shared/chat-selector')

    render(React.createElement(ChatSelector))
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).toContain('Acme CRM')
  })

  it('falls back to a truncated-id display name for a chat with no real name set', async () => {
    sessionData = { user: { email: 'founder@example.com' } }
    pathname = '/chats/chat-no-name-123456789'
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ id: 'chat-no-name-123456789', createdAt: '2026-10-01T00:00:00Z' }],
      }),
    })) as any
    const { ChatSelector } = await import('@/components/shared/chat-selector')

    render(React.createElement(ChatSelector))
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).toContain('Chat chat-no-')
  })

  it('renders nothing at all for a real signed-in founder with zero chats — never a fabricated empty-state UI', async () => {
    sessionData = { user: { email: 'founder@example.com' } }
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as any
    const { ChatSelector } = await import('@/components/shared/chat-selector')

    render(React.createElement(ChatSelector))
    await act(async () => { await Promise.resolve() })

    // Same real `chats.length === 0 && !isLoading` -> null behavior as the
    // anonymous case — the component has no "No chats yet" message at all;
    // it simply doesn't render, confirmed by reading the real source.
    expect(host.textContent).toBe('')
  })

  it('never crashes when the real fetch rejects outright (network failure), and renders nothing (same as zero chats)', async () => {
    sessionData = { user: { email: 'founder@example.com' } }
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    const { ChatSelector } = await import('@/components/shared/chat-selector')

    expect(() => render(React.createElement(ChatSelector))).not.toThrow()
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toBe('')
  })
})
