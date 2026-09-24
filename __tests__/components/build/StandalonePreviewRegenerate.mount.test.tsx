// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { StandalonePreviewRegenerate } from '@/components/build/StandalonePreviewRegenerate'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #866 (2026-09-24): component-level coverage for the two real gaps fixed on
 * the standalone /build/{slug} page — the pure-function decisions are covered
 * in standalone-preview-regenerate.test.ts, this covers the actual wiring:
 * the reconciliation fetch firing on mount, and the fixed 'home' message
 * routing through window.location instead of the old dead-end '/'.
 */

let host: HTMLElement
let root: Root

function render(el: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

describe('StandalonePreviewRegenerate', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  })

  afterEach(() => {
    global.fetch = originalFetch
    unmount()
  })

  it('calls subscription/status with this slug on mount, so plan reconciliation runs without needing the full dashboard', async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await act(async () => { await Promise.resolve() })
    expect(global.fetch).toHaveBeenCalledWith('/api/build/subscription/status?slug=flashpoint')
  })

  it('strips a -product suffix before calling subscription/status', async () => {
    render(<StandalonePreviewRegenerate slug="agentive-product" idea="an idea" track="company" name="Agentive" />)
    await act(async () => { await Promise.resolve() })
    expect(global.fetch).toHaveBeenCalledWith('/api/build/subscription/status?slug=agentive')
  })

  it('does not call subscription/status when there is no slug', async () => {
    render(<StandalonePreviewRegenerate slug="" idea={undefined} track={undefined} name={undefined} />)
    await act(async () => { await Promise.resolve() })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a network/auth failure on the reconciliation call is swallowed silently (best-effort, never surfaces)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('401'))
    expect(() => {
      render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    }).not.toThrow()
    await act(async () => { await Promise.resolve() })
  })

  it("routes 'home' to this company's own Live dashboard, not the bare homepage", async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    const originalHref = window.location.href
    delete (window as any).location
    ;(window as any).location = { href: originalHref }
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'ainative-preview-nav', action: 'home' },
        origin: 'null',
      }))
    })
    expect(window.location.href).toBe('/build?screen=live&company=flashpoint')
  })
})
