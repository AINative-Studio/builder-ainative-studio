// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
}))

import { PublicNav } from '@/components/shared/public-nav'

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

/**
 * #1189 — app/evidence/page.tsx (real gallery/timeline of test-run/build/
 * coverage/deployment proof) was reachable only by typing the URL directly;
 * no page anywhere linked to it. Added to PublicNav's sitewide default links
 * — used across 15 public pages (about, pricing, help, guides, etc.) — the
 * same trust/credibility register as About and Pricing.
 */
describe('PublicNav — default links include Evidence (#1189)', () => {
  it('renders a link to /evidence by default', () => {
    render(React.createElement(PublicNav))
    const link = Array.from(host.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/evidence')
    expect(link).toBeTruthy()
    expect(link?.textContent).toBe('Evidence')
  })

  it('still renders the pre-existing default links (Guides/About/Help/Pricing) unchanged', () => {
    render(React.createElement(PublicNav))
    const hrefs = Array.from(host.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/guides')
    expect(hrefs).toContain('/about')
    expect(hrefs).toContain('/help')
    expect(hrefs).toContain('/pricing')
  })

  it('a caller passing a custom links prop is unaffected (Evidence is only in the DEFAULT set)', () => {
    render(React.createElement(PublicNav, { links: [{ href: '/custom', label: 'Custom' }] }))
    const hrefs = Array.from(host.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/custom')
    expect(hrefs).not.toContain('/evidence')
  })
})
