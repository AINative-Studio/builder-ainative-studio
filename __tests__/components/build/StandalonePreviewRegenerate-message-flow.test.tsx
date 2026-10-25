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
 * #1204 (Coverage Phase 4) — follow-up to StandalonePreviewRegenerate.mount.
 * test.tsx, which covers the reconciliation fetch + the 'home' routing fix.
 * The real remaining gap: the onPreviewMessage effect's 'retry'/'reload'
 * branches, the full 'regenerate' flow for BOTH planRegenerate outcomes
 * (redirect for the App track, the real company-app/company-product POST
 * for the Company track — success and failure), the message-origin reject
 * path, and the working/error/idle rendered status UI. planRegenerate/
 * isAcceptedPreviewMessageOrigin's own branch logic is independently tested
 * in standalone-preview-regenerate.test.ts — this covers the component
 * wiring that actually consumes their output.
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

function postPreviewMessage(data: unknown, origin = 'null') {
  return act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }))
    await Promise.resolve()
  })
}

describe('StandalonePreviewRegenerate — postMessage flow (#1204)', () => {
  const originalFetch = global.fetch
  let originalLocation: Location

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    originalLocation = window.location
    delete (window as any).location
    ;(window as any).location = { ...originalLocation, href: originalLocation.href, reload: vi.fn() }
  })

  afterEach(() => {
    global.fetch = originalFetch
    ;(window as any).location = originalLocation
    unmount()
  })

  it('ignores a message from a disallowed origin (neither "null" nor the real page origin)', async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'regenerate' }, 'https://evil.example')
    // Only the mount-time reconciliation call happened — no regenerate redirect/call.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe(originalLocation.href)
  })

  it('ignores a differently-typed payload even from an accepted origin', async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await postPreviewMessage({ type: 'some-other-event', action: 'regenerate' })
    expect(window.location.href).toBe(originalLocation.href)
  })

  it("'retry' reloads the page", async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'retry' })
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it("'reload' reloads the page", async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'reload' })
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('regenerate on the App track redirects to the real Live dashboard (no headless retry path exists)', async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'regenerate' })
    expect(window.location.href).toBe('/build?screen=live&company=flashpoint')
  })

  it('regenerate on the Company track POSTs the real company-app endpoint with force:true', async () => {
    // A never-resolving regenerate fetch lets the 'working' state settle and
    // stay put for this assertion — the done/reload transition (status
    // flips to 'done', which renders null) is covered by the test below.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // mount reconciliation
      .mockImplementationOnce(() => new Promise(() => {})) // regenerate call never resolves
    global.fetch = fetchMock
    render(<StandalonePreviewRegenerate slug="agentive" idea="an idea" track="company" name="Agentive" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'regenerate' })

    expect(fetchMock).toHaveBeenCalledWith('/api/build/company-app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: 'an idea', slug: 'agentive', name: 'Agentive', force: true }),
    })
    expect(document.body.textContent).toContain('Rebuilding agentive…')
  })

  it('a real recovered/processing regenerate response schedules a reload (done state) rather than leaving the founder stuck', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'processing' }) })
    global.fetch = fetchMock
    render(<StandalonePreviewRegenerate slug="agentive" idea="an idea" track="company" name="Agentive" />)
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ainative-preview-nav', action: 'regenerate' }, origin: 'null' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })

    expect(window.location.reload).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('regenerate on the Company track for a -product slug calls company-product, not company-app', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ chatId: 'chat-123' }) })
    global.fetch = fetchMock
    render(<StandalonePreviewRegenerate slug="agentive-product" idea="an idea" track="company" name="Agentive" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'regenerate' })

    expect(fetchMock).toHaveBeenCalledWith('/api/build/company-product', expect.objectContaining({ method: 'POST' }))
  })

  it('a real non-ok / unrecognized regenerate response shows the honest error state, never a fake success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    global.fetch = fetchMock
    render(<StandalonePreviewRegenerate slug="agentive" idea="an idea" track="company" name="Agentive" />)
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'regenerate' })

    expect(document.body.textContent).toContain("Couldn't start a rebuild")
  })

  it('a real network failure on the regenerate POST shows the error state (caught, never crashes)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('network down'))
    global.fetch = fetchMock
    expect(() => {
      render(<StandalonePreviewRegenerate slug="agentive" idea="an idea" track="company" name="Agentive" />)
    }).not.toThrow()
    await postPreviewMessage({ type: 'ainative-preview-nav', action: 'regenerate' })

    expect(document.body.textContent).toContain("Couldn't start a rebuild")
  })

  it('renders nothing (idle) before any regenerate attempt', async () => {
    render(<StandalonePreviewRegenerate slug="flashpoint" idea="an idea" track="app" name="Flashpoint" />)
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toBe('')
  })
})
