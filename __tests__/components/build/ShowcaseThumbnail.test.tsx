// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1068 — the showcase Featured strip's live app thumbnail always iframed
 * /api/preview/{chatId} directly, scaled to 40% — same flattening exposure
 * fixed for the full /build/{slug} page in #1066, just lower-stakes (a
 * broken thumbnail, not a broken page). Same shouldUseSandpack() routing,
 * with Sandpack's refresh button hidden since this is a non-interactive
 * card background.
 */

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => {
    const Stub = (props: any) => {
      ;(globalThis as any).__sandpackStubTriggerTimeout = props.onTimeout
      return React.createElement('div', {
        'data-testid': 'sandpack-stub',
        'data-file-count': Object.keys(props.files || {}).length,
        'data-show-refresh': String(props.showRefreshButton),
        'data-timeout-ms': props.timeoutMs,
      })
    }
    return Stub
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { ShowcaseThumbnail } from '@/components/build/ShowcaseThumbnail'

let host: HTMLElement
let root: Root

beforeEach(() => {
  fetchMock.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  act(() => { root?.unmount() })
  host.remove()
})

async function renderThumbnail(props: { chatId: string; title: string }) {
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(ShowcaseThumbnail, props))
  })
  await act(async () => { await Promise.resolve() })
}

describe('ShowcaseThumbnail — Sandpack routing (#1068)', () => {
  it('renders the iframe (not Sandpack) when the durable files route 404s (single-file app)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ files: null }) })
    await renderThumbnail({ chatId: 'test-chat-id', title: 'Acme' })
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.src).toContain('/api/preview/test-chat-id')
  })

  it('renders SandpackPreview with the refresh button hidden when the files map is genuinely multi-file', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: {
          '/src/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){return null}",
          '/src/components/Sidebar.tsx': 'export default function Sidebar(){return null}',
        },
      }),
    })
    await renderThumbnail({ chatId: 'finio-chat', title: 'Finio' })
    const stub = host.querySelector('[data-testid="sandpack-stub"]')
    expect(stub).toBeTruthy()
    expect(stub?.getAttribute('data-file-count')).toBe('2')
    expect(stub?.getAttribute('data-show-refresh')).toBe('false')
    expect(host.querySelector('iframe')).toBeFalsy()
  })

  it('falls back to the iframe (never throws) when the durable files fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await renderThumbnail({ chatId: 'test-chat-id', title: 'Acme' })
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
  })

  it('uses a shorter 8s watchdog than the full page (cosmetic, not worth the same wait) and falls back on timeout', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: {
          '/src/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){return null}",
          '/src/components/Sidebar.tsx': 'export default function Sidebar(){return null}',
        },
      }),
    })
    await renderThumbnail({ chatId: 'finio-chat', title: 'Finio' })

    const stub = host.querySelector('[data-testid="sandpack-stub"]')
    expect(stub?.getAttribute('data-timeout-ms')).toBe('8000')

    await act(async () => {
      ;(globalThis as any).__sandpackStubTriggerTimeout()
    })

    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.src).toContain('/api/preview/finio-chat')
  })
})
