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
 * #1204 (Coverage Phase 4) — MetaPixel (components/analytics/meta-pixel.tsx,
 * 95 lines, reached live via app/layout.tsx — mounted globally) had zero
 * test coverage. PIXEL_ID is read from process.env at MODULE LOAD time (not
 * per-render), so toggling NEXT_PUBLIC_META_PIXEL_ID between tests requires
 * vi.resetModules() + a fresh dynamic import each time, not just vi.stubEnv
 * before an already-loaded module.
 */

vi.mock('next/script', () => ({
  default: (props: any) => React.createElement('script', { 'data-testid': 'stub-meta-pixel-script', 'data-html': props.dangerouslySetInnerHTML?.__html }),
}))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

async function freshImport() {
  vi.resetModules()
  return import('@/components/analytics/meta-pixel')
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.unstubAllEnvs()
  delete (window as any).fbq
})

describe('MetaPixel — real silent-no-op/tracking coverage (#1204)', () => {
  it('renders genuinely nothing when NEXT_PUBLIC_META_PIXEL_ID is unset (the real silent no-op)', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '')
    const { default: MetaPixel } = await freshImport()
    render(React.createElement(MetaPixel))
    expect(host.innerHTML).toBe('')
  })

  it('renders the real pixel-init script with the real pixel id when genuinely configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '123456789')
    const { default: MetaPixel } = await freshImport()
    render(React.createElement(MetaPixel))

    const script = host.querySelector('[data-testid="stub-meta-pixel-script"]')
    expect(script?.getAttribute('data-html')).toContain("fbq('init', '123456789')")
    expect(script?.getAttribute('data-html')).toContain("fbq('track', 'PageView')")

    // jsdom renders <noscript> as a real but genuinely EMPTY element — per
    // the HTML spec, noscript content is raw text (not parsed into real
    // child DOM nodes) whenever scripting is enabled, which jsdom always
    // simulates. Confirmed via a direct debug render. So the real fallback
    // <img>'s src can't be asserted via a DOM query here; only that the
    // noscript element itself is genuinely present.
    expect(host.querySelector('noscript')).not.toBeNull()
  })

  it('trackMeta is a genuine silent no-op (never touches window.fbq) when the pixel is unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '')
    const { trackMeta } = await freshImport()
    const fbqSpy = vi.fn()
    window.fbq = fbqSpy

    trackMeta('Lead')

    expect(fbqSpy).not.toHaveBeenCalled()
  })

  it('trackMeta calls the real window.fbq("track", event, params) when genuinely configured and fbq has loaded', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '123456789')
    const { trackMeta } = await freshImport()
    const fbqSpy = vi.fn()
    window.fbq = fbqSpy

    trackMeta('CompleteRegistration', { value: 10 })

    expect(fbqSpy).toHaveBeenCalledWith('track', 'CompleteRegistration', { value: 10 }, undefined)
  })

  it('trackMeta passes the real eventID option through when a real eventId is given (for CAPI dedup)', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '123456789')
    const { trackMeta } = await freshImport()
    const fbqSpy = vi.fn()
    window.fbq = fbqSpy

    trackMeta('Purchase', { value: 49 }, 'evt-real-123')

    expect(fbqSpy).toHaveBeenCalledWith('track', 'Purchase', { value: 49 }, { eventID: 'evt-real-123' })
  })

  it('trackMeta never crashes and silently no-ops when the pixel is configured but real window.fbq has genuinely not loaded yet', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '123456789')
    const { trackMeta } = await freshImport()
    delete (window as any).fbq

    expect(() => trackMeta('Lead')).not.toThrow()
  })

  it('newMetaEventId generates a real, genuinely unique id each call with the real default "evt-" prefix', async () => {
    const { newMetaEventId } = await freshImport()
    const id1 = newMetaEventId()
    const id2 = newMetaEventId()

    expect(id1).toMatch(/^evt-\d+-[a-z0-9]+$/)
    expect(id1).not.toBe(id2)
  })

  it('newMetaEventId uses a real genuinely custom prefix when given', async () => {
    const { newMetaEventId } = await freshImport()
    expect(newMetaEventId('checkout')).toMatch(/^checkout-\d+-[a-z0-9]+$/)
  })
})
