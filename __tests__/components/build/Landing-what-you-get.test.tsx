// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }))

import { Landing } from '@/components/build/screens/Landing'

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

describe('Landing — what you get + physical business framing (#BLD-11)', () => {
  it('names a concrete software-track deliverable (an app)', () => {
    render(React.createElement(Landing))
    expect(host.textContent).toMatch(/app/i)
  })

  it('explicitly names a physical/local business example', () => {
    render(React.createElement(Landing))
    expect(host.textContent).toMatch(/bakery|gym|landscaping|local business/i)
  })

  // #2172 — AX agent-readiness scan: the real anonymous-build + claim-later
  // capability (already documented in public/auth.md) must also appear in
  // plain, crawlable language on the homepage itself, not just that one
  // static file.
  it('states the real anonymous-build / claim-later capability (#2172)', () => {
    render(React.createElement(Landing))
    expect(host.textContent).toMatch(/no account required/i)
    expect(host.textContent).toMatch(/claim/i)
  })

  // #2205/user feedback — the natural, human-facing sentence stays "claim
  // your project" (not checker-speak like "claim this deployment"), per
  // explicit user correction. A separate, small, genuinely-true technical
  // aside carries one of the real AX checker's exact literal phrases
  // (_CLAIMABLE_RESOURCE_MARKERS) so the check still passes without making
  // the primary marketing copy read like a scanner's keyword list.
  it('keeps the natural human-facing phrasing as the primary sentence', () => {
    render(React.createElement(Landing))
    expect(host.textContent).toContain('claim your project')
  })

  it('also includes an exact-match claimable-resource phrase the real AX checker recognizes, as a secondary aside', () => {
    render(React.createElement(Landing))
    expect(host.textContent?.toLowerCase()).toContain('claim this deployment')
  })
})
