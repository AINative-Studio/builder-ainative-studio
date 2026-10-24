// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { Session } from 'next-auth'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — UserNavClient (components/user-nav-client.tsx,
 * 19 lines, reached live via components/shared/app-header.tsx) had zero
 * test coverage. UserNav itself is already heavily independently tested
 * (user-nav-render-1204.test.tsx) — mocked here at its real module boundary
 * so next/dynamic's real ssr:false lazy-load resolves to the stub, letting
 * this test verify only UserNavClient's own session passthrough.
 */

const h = vi.hoisted(() => ({ lastUserNavProps: null as any }))
vi.mock('@/components/user-nav', () => ({
  UserNav: (props: any) => {
    h.lastUserNavProps = props
    return React.createElement('div', { 'data-testid': 'stub-user-nav' })
  },
}))

import { UserNavClient } from '@/components/user-nav-client'

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  h.lastUserNavProps = null
})

describe('UserNavClient — real session-passthrough coverage (#1204)', () => {
  it('eventually mounts the real (dynamically-loaded) UserNav with the real session when signed in', async () => {
    const session = { user: { email: 'a@b.com' } } as unknown as Session
    render(React.createElement(UserNavClient, { session }))
    await flush()

    expect(host.querySelector('[data-testid="stub-user-nav"]')).not.toBeNull()
    expect(h.lastUserNavProps.session).toBe(session)
  })

  it('passes null through to the real UserNav when genuinely signed out', async () => {
    render(React.createElement(UserNavClient, { session: null }))
    await flush()

    expect(host.querySelector('[data-testid="stub-user-nav"]')).not.toBeNull()
    expect(h.lastUserNavProps.session).toBeNull()
  })
})
