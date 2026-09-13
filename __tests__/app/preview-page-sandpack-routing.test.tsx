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
 * #729 — the standalone shared preview page (app/preview/[id]/page.tsx)
 * always iframed /api/preview/{id}, which unconditionally flattens a
 * multi-file app into a single Babel module regardless of file count.
 * Confirmed live: a genuinely valid multi-file TSX app (real ZeroPipeline/
 * ZeroInvoice primitive wiring, real TypeScript interfaces) 500'd with
 * "Unexpected token" on this page, even though the SAME files map renders
 * correctly via Sandpack inside the live Builder chat UI.
 *
 * Fix: fetch the durable files map (/api/generation/{id}/files — the same
 * route the in-session Sandpack rehydration path already uses) and route
 * through shouldUseSandpack() exactly like components/build/artifacts/
 * Preview.tsx already does. Single-file apps are unaffected — no durable
 * files map exists for them, so this always falls through to the iframe.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-chat-id' }),
}))

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => {
    // Synchronously resolve to a stub SandpackPreview for the test — the
    // real dynamic()/ssr:false behavior is exercised elsewhere; here we only
    // need to confirm PreviewPage renders IT (vs. the iframe) when it should.
    const Stub = (props: any) => React.createElement('div', { 'data-testid': 'sandpack-stub', 'data-file-count': Object.keys(props.files || {}).length })
    return Stub
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import PreviewPage from '@/app/preview/[id]/page'

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

async function renderPage() {
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(PreviewPage))
  })
  // Flush the fetch effect's microtask/state update.
  await act(async () => { await Promise.resolve() })
}

describe('PreviewPage — Sandpack routing (#729)', () => {
  it('renders the iframe (not Sandpack) when the durable files route 404s (single-file app)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ files: null }) })
    await renderPage()
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.src).toContain('/api/preview/test-chat-id')
  })

  it('renders the iframe when the files map has only one real source file (not genuinely multi-file)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: { '/App.tsx': 'export default function App(){return null}' } }),
    })
    await renderPage()
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
  })

  it('renders SandpackPreview (not the iframe) when the durable files map is genuinely multi-file', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: {
          '/src/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){return null}",
          '/src/components/Sidebar.tsx': 'export default function Sidebar(){return null}',
        },
      }),
    })
    await renderPage()
    const stub = host.querySelector('[data-testid="sandpack-stub"]')
    expect(stub).toBeTruthy()
    expect(stub?.getAttribute('data-file-count')).toBe('2')
    expect(host.querySelector('iframe')).toBeFalsy()
  })

  it('falls back to the iframe (never throws) when the durable files fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await renderPage()
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
  })
})
