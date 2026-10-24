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
 * #1204 (Coverage Phase 4) — GoogleAnalytics (components/analytics/
 * google-analytics.tsx, 62 lines, reached live via app/layout.tsx — global
 * on every page) had zero test coverage.
 *
 * GA_ID is a module-level constant read from process.env at import time —
 * the same gotcha hit with MetaPixel earlier this session. vi.resetModules()
 * + a fresh dynamic import() is required to actually toggle it via
 * vi.stubEnv across tests. next/script is mocked at its real boundary.
 */

vi.mock('next/script', () => ({
  default: (props: any) => React.createElement('script', {
    'data-testid': props.id ? `script-${props.id}` : 'script-src',
    src: props.src,
    dangerouslySetInnerHTML: props.dangerouslySetInnerHTML,
  }),
}))

async function freshImport() {
  vi.resetModules()
  return import('@/components/analytics/google-analytics')
}

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
  vi.unstubAllEnvs()
  delete (window as any).gtag
})

describe('GoogleAnalytics — real GA_ID/script/trackEvent/trackPageView coverage (#1204)', () => {
  it('uses the real NEXT_PUBLIC_GA_ID env var in the real gtag script src when genuinely set', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_ID', 'G-CUSTOM123')
    const mod = await freshImport()
    render(React.createElement(mod.default))

    const srcScript = host.querySelector('[data-testid="script-src"]') as HTMLScriptElement
    expect(srcScript.getAttribute('src')).toBe('https://www.googletagmanager.com/gtag/js?id=G-CUSTOM123')
  })

  it('falls back to the real hardcoded default GA ID when the env var is genuinely unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_ID', '')
    const mod = await freshImport()
    render(React.createElement(mod.default))

    const srcScript = host.querySelector('[data-testid="script-src"]') as HTMLScriptElement
    expect(srcScript.getAttribute('src')).toBe('https://www.googletagmanager.com/gtag/js?id=G-L8T0TB6M2C')
  })

  it('embeds the real GA_ID inside the inline gtag config script', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_ID', 'G-INLINE456')
    const mod = await freshImport()
    render(React.createElement(mod.default))

    const inlineScript = host.querySelector('[data-testid="script-google-analytics"]') as HTMLScriptElement
    expect(inlineScript.innerHTML).toContain("gtag('config', 'G-INLINE456'")
  })

  it('trackEvent calls the real window.gtag with the real event shape when gtag is genuinely loaded', async () => {
    const mod = await freshImport()
    const gtagMock = vi.fn()
    ;(window as any).gtag = gtagMock

    mod.trackEvent('click', 'cta', 'hero-button', 1)

    expect(gtagMock).toHaveBeenCalledWith('event', 'click', { event_category: 'cta', event_label: 'hero-button', value: 1 })
  })

  it('trackEvent never throws and never calls gtag when window.gtag is genuinely absent', async () => {
    const mod = await freshImport()
    delete (window as any).gtag

    expect(() => mod.trackEvent('click', 'cta')).not.toThrow()
  })

  it('trackPageView calls the real window.gtag config with the real GA_ID/path/title when loaded', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_ID', 'G-PAGE789')
    const mod = await freshImport()
    const gtagMock = vi.fn()
    ;(window as any).gtag = gtagMock

    mod.trackPageView('/pricing', 'Pricing — Builder')

    expect(gtagMock).toHaveBeenCalledWith('config', 'G-PAGE789', { page_path: '/pricing', page_title: 'Pricing — Builder' })
  })

  it('trackPageView falls back to the real document.title when no title is genuinely given', async () => {
    vi.stubEnv('NEXT_PUBLIC_GA_ID', 'G-PAGE789')
    const mod = await freshImport()
    const gtagMock = vi.fn()
    ;(window as any).gtag = gtagMock
    document.title = 'Real Document Title'

    mod.trackPageView('/about')

    expect(gtagMock).toHaveBeenCalledWith('config', 'G-PAGE789', { page_path: '/about', page_title: 'Real Document Title' })
  })
})
