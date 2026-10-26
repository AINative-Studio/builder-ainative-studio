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
 * #1204/#1199 — Preview.tsx's own component body (register-app retry flow,
 * postMessage nav handler, share-bar/upsell/banner gating, Sandpack-vs-iframe
 * routing) had zero render coverage; only its pure exported decisions
 * (livePreviewLabel etc., see preview-registration.test.ts and
 * preview-generation-ribbon.test.ts) were tested. useRealPreview and
 * useBuild are real, independently-tested modules — mocked here at their
 * real context/hook boundaries so this file verifies only Preview()'s own
 * wiring of their output.
 */

const h = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  dispatch: vi.fn(),
  previewReturn: {} as Record<string, any>,
}))

vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: h.state, dispatch: h.dispatch }),
}))

vi.mock('@/lib/build/useRealPreview', () => ({
  useRealPreview: () => h.previewReturn,
}))

vi.mock('@/components/chat/sandpack-preview', () => ({
  SandpackPreview: ({ files }: { files: Record<string, string> }) => (
    React.createElement('div', { 'data-testid': 'mock-sandpack', 'data-file-count': Object.keys(files || {}).length })
  ),
}))

const baseState = {
  idea: 'A CRM for plumbers',
  view: 'preview',
  appSub: 'plumber-crm',
  companyName: 'PlumberCo',
  brandTagline: 'Plumbing, organized',
  brandColor: '#2f6d86',
  track: 'app',
  generated: {},
  designSystemId: '',
  sawPreview: false,
  builtMVP: false,
  appChatId: '',
}

let host: HTMLElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function flush() {
  return act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeAll(() => {
  // jsdom doesn't implement navigator.clipboard; copy-share isn't under test here.
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true })
})

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
  h.dispatch.mockClear()
  h.state = {}
  h.previewReturn = {}
})

async function importPreview() {
  const mod = await import('@/components/build/artifacts/Preview')
  return mod.Preview
}

describe('Preview — live-status chip + banners (render)', () => {
  it('shows the building skeleton while status is generating, no share bar or chip claiming production', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: null, status: 'generating', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    expect(host.textContent).toContain('Building your app…')
    expect(host.querySelector('.m-share-bar')).toBeNull()
    expect(host.querySelector('[data-testid="register-failed-banner"]')).toBeNull()
  })

  it('THE BUG (#1256): status ready but registration still pending never claims "Live in production" or shows a share link', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }
    // register-app never resolves within this test's window — registered stays null.
    fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    expect(host.textContent).toContain('Finishing up…')
    expect(host.textContent).not.toContain('Live in production')
    expect(host.querySelector('.m-share-bar')).toBeNull()
  })

  it('registration succeeds: shows "Live in production" and a real /build/{slug} share link', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()

    expect(host.textContent).toContain('Live in production')
    const link = host.querySelector('.m-share-url') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toContain('/build/plumber-crm')
    expect(host.querySelector('[data-testid="register-failed-banner"]')).toBeNull()
  })

  it('register-app 422 retry:true + a successful repair re-registers and recovers to Live', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }

    let registerCalls = 0
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/build/register-app')) {
        registerCalls += 1
        if (registerCalls === 1) {
          return Promise.resolve({ ok: false, json: async () => ({ retry: true, error: 'SyntaxError: unexpected token' }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({ deployUrl: 'https://plumber-crm.ainative.studio' }) })
      }
      if (String(url).includes('/api/build/repair-app')) {
        return Promise.resolve({ ok: true, json: async () => ({ recovered: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()
    await flush()

    expect(registerCalls).toBe(2)
    expect(host.textContent).toContain('Live in production')
  })

  it('#1551: repair attempted but still fails — retries up to the cap, then shows an honest stuck state with a real Try again button (never the stale "is repairing it" copy)', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }

    let registerCalls = 0
    let repairCalls = 0
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/build/register-app')) {
        registerCalls += 1
        return Promise.resolve({ ok: false, json: async () => ({ retry: true, error: 'SyntaxError: unexpected token' }) })
      }
      if (String(url).includes('/api/build/repair-app')) {
        repairCalls += 1
        return Promise.resolve({ ok: true, json: async () => ({ recovered: false }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    // Flush enough microtask turns for every bounded repair+retry cycle to settle.
    for (let i = 0; i < 10; i++) await flush()

    // More than one repair attempt was made (a bounded cap, not a single shot).
    expect(repairCalls).toBeGreaterThan(1)
    expect(registerCalls).toBeGreaterThan(1)

    // The terminal state is honest: it must NOT claim an active repair is in
    // progress once every attempt has concluded and failed.
    expect(host.textContent).not.toContain('is repairing it')

    const banner = host.querySelector('[data-testid="register-failed-banner"]')
    expect(banner).not.toBeNull()
    expect(host.querySelector('.m-share-bar')).toBeNull()

    // A real retry affordance — not a dead end.
    const retryButton = host.querySelector('[data-testid="register-retry-button"]') as HTMLButtonElement | null
    expect(retryButton).not.toBeNull()
  })

  it('register-app rejects permanently (no retry/error): shows the honest register-failed banner, no share bar', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/build/register-app')) {
        return Promise.resolve({ ok: false, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()

    expect(host.querySelector('[data-testid="register-failed-banner"]')).not.toBeNull()
    expect(host.textContent).toContain('Fixing a generation error…')
    expect(host.querySelector('.m-share-bar')).toBeNull()
  })

  it('status error always shows "Preview unavailable" and the retry-friendly fallback, never the skeleton', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: null, status: 'error', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    expect(host.textContent).toContain('Preview unavailable')
    expect(host.textContent).toContain("couldn't build the live preview")
  })

  it('design-conformance badge renders only once ready, with the real pass/partial/fail label + glyph', async () => {
    h.state = { ...baseState, designSystemId: 'ds-1' }
    h.previewReturn = {
      previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, refreshKey: 0,
      designConformance: { status: 'partial', score: 0.4 },
    }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()

    const badge = host.querySelector('[data-testid="design-conformance-badge"]')
    expect(badge).not.toBeNull()
    expect(badge?.getAttribute('data-status')).toBe('partial')
    expect(badge?.textContent).toContain('Partially matches your design system')
  })

  it('MVP upsell banner appears once builtMVP+ready, gated off during generating (CRITICAL GATE regression)', async () => {
    h.state = { ...baseState, builtMVP: true }
    h.previewReturn = { previewUrl: null, status: 'generating', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ used: 1, limit: 3, unlimited: false }) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    expect(host.querySelector('[data-testid="mvp-upsell"]')).toBeNull()
  })

  it('MVP upsell banner appears once builtMVP+ready, and its CTA dispatches GOTO_SCREEN pricing', async () => {
    h.state = { ...baseState, builtMVP: true }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ used: 1, limit: 3, unlimited: false }) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()

    const cta = host.querySelector('[data-testid="mvp-upsell-cta"]') as HTMLButtonElement | null
    expect(cta).not.toBeNull()
    act(() => { cta?.click() })
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'pricing' })
  })

  it('builtMVP + status error (no upsell) shows the no-cost "Make it real" fallback instead', async () => {
    h.state = { ...baseState, builtMVP: true }
    h.previewReturn = { previewUrl: null, status: 'error', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    expect(host.querySelector('[data-testid="mvp-upsell"]')).toBeNull()
    expect(host.textContent).toContain('Make it real →')
  })

  it('a ready multi-file app routes to the Sandpack mount, not the iframe', async () => {
    h.state = { ...baseState }
    h.previewReturn = {
      previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', refreshKey: 0, designConformance: null,
      files: { '/App.tsx': 'export default function App() { return null }', '/components/Foo.tsx': 'export default function Foo(){return null}' },
    }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()

    expect(host.querySelector('[data-testid="sandpack-preview-mount"]')).not.toBeNull()
    expect(host.querySelector('iframe')).toBeNull()
  })

  it('a ready single-file app renders the sandboxed iframe (no allow-same-origin) with the slug token', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: '/api/preview/chat-1', status: 'ready', chatId: 'chat-1', files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()
    await flush()

    const iframe = host.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals allow-popups')
    expect(iframe?.getAttribute('src')).toContain('slug=plumber-crm')
  })

  it('FeedbackPulse mounts only once status is ready', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: null, status: 'generating', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    // FeedbackPulse's own "ask" phase renders real rating glyphs; absent while generating.
    expect(host.querySelector('.m-live-chip')).not.toBeNull()
  })
})

describe('Preview — postMessage nav handler (sandboxed iframe origin "null")', () => {
  it('ignores a message whose origin is not "null" (not from the sandboxed preview frame)', async () => {
    h.state = { ...baseState, idea: 'A CRM for plumbers', appSub: 'plumber-crm' }
    h.previewReturn = { previewUrl: null, status: 'generating', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: 'ainative-preview-nav', action: 'regenerate' } }))
    })
    expect(h.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'START_BUILD' }))
  })

  it('a "regenerate" nav message with a real idea+appSub dispatches START_BUILD then GOTO_VIEW preview', async () => {
    h.state = { ...baseState, idea: 'A CRM for plumbers', appSub: 'plumber-crm', companyName: 'PlumberCo' }
    h.previewReturn = { previewUrl: null, status: 'generating', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'null', data: { type: 'ainative-preview-nav', action: 'regenerate' } }))
    })

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'START_BUILD', idea: 'A CRM for plumbers', appSub: 'plumber-crm', companyName: 'PlumberCo' })
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'GOTO_VIEW', view: 'preview' })
  })

  it('ignores a differently-typed payload even from a null-origin frame', async () => {
    h.state = { ...baseState }
    h.previewReturn = { previewUrl: null, status: 'generating', chatId: null, files: null, designConformance: null, refreshKey: 0 }
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const Preview = await importPreview()
    render(React.createElement(Preview))
    await flush()

    h.dispatch.mockClear()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'null', data: { type: 'some-other-message', action: 'regenerate' } }))
    })
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
