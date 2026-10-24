// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DesignTokenPreview } from '@/components/design-tokens/preview'
import { getDefaultTokens } from '@/lib/design-tokens/parsers'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — DesignTokenPreview (components/design-tokens
 * /preview.tsx, 360 lines, reached live via app/design-tokens/page.tsx and
 * upload-dialog.tsx, which is already covered) had zero test coverage.
 *
 * Purely presentational, no state/fetches — the issue's own documented
 * tradeoff applies (little logic, little proportional bug-catching), so
 * this stays lean: confirming the REAL token values the component is given
 * actually reach the rendered DOM (not hardcoded/fabricated placeholders),
 * using the real getDefaultTokens() fixture rather than a hand-guessed one.
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

describe('DesignTokenPreview — real token-to-DOM rendering coverage (#1204)', () => {
  it('renders the real font sizes from the given tokens, not fabricated placeholders', () => {
    const tokens = getDefaultTokens()
    render(React.createElement(DesignTokenPreview, { tokens }))

    expect(host.textContent).toContain(tokens.typography.sizes.xl)
    expect(host.textContent).toContain(tokens.typography.sizes.base)
    expect(host.textContent).toContain(tokens.typography.sizes.xs)
  })

  it('wires the real primary color onto the preview swatch via a CSS variable, not a hardcoded value', () => {
    const tokens = getDefaultTokens()
    render(React.createElement(DesignTokenPreview, { tokens }))

    const container = host.querySelector('[style*="--preview-primary"]') as HTMLElement
    expect(container).not.toBeNull()
    expect(container.style.getPropertyValue('--preview-primary')).toBe(tokens.colors.primary)
  })

  it('renders both a real Light Mode and Dark Mode tab', () => {
    const tokens = getDefaultTokens()
    render(React.createElement(DesignTokenPreview, { tokens }))

    expect(host.textContent).toContain('Light Mode')
    expect(host.textContent).toContain('Dark Mode')
  })

  it('reflects a genuinely different token set (not a stale cached render) when given different tokens', () => {
    const tokens = { ...getDefaultTokens(), colors: { ...getDefaultTokens().colors, primary: '#FF00FF' } }
    render(React.createElement(DesignTokenPreview, { tokens }))

    const container = host.querySelector('[style*="--preview-primary"]') as HTMLElement
    expect(container.style.getPropertyValue('--preview-primary')).toBe('#FF00FF')
  })

  it('falls back to the real documented default background/foreground when tokens omit them (optional fields)', () => {
    const base = getDefaultTokens()
    const tokens = { ...base, colors: { primary: base.colors.primary, secondary: base.colors.secondary, accent: base.colors.accent } } as typeof base
    render(React.createElement(DesignTokenPreview, { tokens }))

    const container = host.querySelector('[style*="--preview-background"]') as HTMLElement
    expect(container.style.getPropertyValue('--preview-background')).toBe('#FFFFFF')
    expect(container.style.getPropertyValue('--preview-foreground')).toBe('#0A0A0A')
  })
})
