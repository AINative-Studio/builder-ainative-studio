// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SWRConfig } from 'swr'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * components/chats/chats-client.tsx (#1190) — the home-page chat history
 * list rendered a bare spinner while /api/chats (via SWR) was in flight,
 * with no shape resembling the real chat-card grid underneath.
 */

vi.mock('@/components/shared/app-header', () => ({ AppHeader: () => null }))

import { ChatsClient } from '@/components/chats/chats-client'

let host: HTMLElement
let root: Root

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

function renderWithSwr() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const fetcher = (url: string) => fetch(url).then((r) => r.json())
  return act(async () => {
    root.render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map(), fetcher, dedupingInterval: 0 } },
        React.createElement(ChatsClient),
      ),
    )
  })
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }
}

describe('ChatsClient — skeleton loading state (#1190)', () => {
  it('shows a card-grid skeleton while /api/chats is in flight', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any

    await renderWithSwr()

    const skeleton = host.querySelector('[data-testid="chats-loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(host.textContent).not.toContain('Loading chats...')
  })

  it('replaces the skeleton with the real chat list once chats load', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        object: 'list',
        data: [
          {
            id: 'c1',
            object: 'chat',
            name: 'My first build',
            messages: [{ role: 'user', content: 'build me a landing page' }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    })) as any

    await renderWithSwr()
    await flush()

    expect(host.querySelector('[data-testid="chats-loading"]')).toBeNull()
    expect(host.textContent).toContain('My first build')
  })
})
