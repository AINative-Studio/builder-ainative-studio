// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { PublicFooter } from '@/components/shared/public-footer'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — PublicFooter (components/shared/public-footer.tsx,
 * 25 lines, reached live via 13+ real public pages) had zero test coverage.
 */

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
})

describe('PublicFooter — real link set coverage (#1204)', () => {
  it('renders every real link with its real href and label', () => {
    render(React.createElement(PublicFooter))

    const links = Array.from(host.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), text: a.textContent }))
    expect(links).toEqual([
      { href: '/showcase', text: 'Showcase' },
      { href: '/capabilities', text: 'What can I build?' },
      { href: '/about', text: 'About' },
      { href: '/terms', text: 'Terms' },
      { href: 'https://ainative.studio/acceptable-use', text: 'Acceptable use' },
      { href: '/privacy', text: 'Privacy' },
      { href: 'mailto:support@ainative.studio', text: 'support@ainative.studio' },
    ])
  })

  it('points Terms/Privacy at Builder\'s own real local pages (#794), not ainative.studio', () => {
    render(React.createElement(PublicFooter))

    const termsLink = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'Terms') as HTMLAnchorElement
    const privacyLink = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'Privacy') as HTMLAnchorElement
    expect(termsLink.getAttribute('href')).toBe('/terms')
    expect(privacyLink.getAttribute('href')).toBe('/privacy')
  })

  it('shows the real support contact line', () => {
    render(React.createElement(PublicFooter))

    expect(host.textContent).toContain('Support:')
    expect(host.textContent).toContain('support@ainative.studio')
  })
})
