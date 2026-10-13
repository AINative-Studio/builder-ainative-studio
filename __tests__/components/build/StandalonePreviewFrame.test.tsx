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
 * #1066 — the public /build/{slug} page always iframed /api/preview/{chatId},
 * which unconditionally flattens a multi-file generation into a single Babel
 * module. That flattened blob can contain real syntax errors a clean
 * multi-file source does not (confirmed live, finio-product: a stray `}`
 * only exists in the flattened code). Same fix as #729
 * (app/preview/[id]/page.tsx): fetch the durable files map and route through
 * shouldUseSandpack() exactly like that page and components/build/artifacts/
 * Preview.tsx already do.
 */

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => {
    const Stub = (props: any) => {
      // Real resilience test (see sandpack-preview.tsx's doc comment on the
      // unfixed CodeSandbox/unpkg hang): expose a way for a test to trigger
      // the SAME onTimeout callback SandpackResilientTimeout would call for
      // real, via a global hook keyed by chatId-independent test control.
      ;(globalThis as any).__sandpackStubTriggerTimeout = props.onTimeout
      return React.createElement('div', { 'data-testid': 'sandpack-stub', 'data-file-count': Object.keys(props.files || {}).length, 'data-timeout-ms': props.timeoutMs })
    }
    return Stub
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { StandalonePreviewFrame } from '@/components/build/StandalonePreviewFrame'

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

async function renderFrame(props: { chatId: string; slug: string; title: string }) {
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(StandalonePreviewFrame, props))
  })
  await act(async () => { await Promise.resolve() })
}

describe('StandalonePreviewFrame — Sandpack routing (#1066)', () => {
  it('renders the iframe (not Sandpack) when the durable files route 404s (single-file app)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ files: null }) })
    await renderFrame({ chatId: 'test-chat-id', slug: 'acme', title: 'Acme' })
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.src).toContain('/api/preview/test-chat-id')
    expect(iframe.src).toContain('slug=acme')
  })

  it('renders the iframe when the files map has only one real source file (not genuinely multi-file)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: { '/App.tsx': 'export default function App(){return null}' } }),
    })
    await renderFrame({ chatId: 'test-chat-id', slug: 'acme', title: 'Acme' })
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
  })

  it('renders SandpackPreview (not the iframe) when the durable files map is genuinely multi-file — the real #1066 fix', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: {
          '/src/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){return null}",
          '/src/components/Sidebar.tsx': 'export default function Sidebar(){return null}',
        },
      }),
    })
    await renderFrame({ chatId: 'finio-chat', slug: 'finio-product', title: 'Finio' })
    const stub = host.querySelector('[data-testid="sandpack-stub"]')
    expect(stub).toBeTruthy()
    expect(stub?.getAttribute('data-file-count')).toBe('2')
    expect(host.querySelector('iframe')).toBeFalsy()
  })

  it('falls back to the iframe (never throws) when the durable files fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await renderFrame({ chatId: 'test-chat-id', slug: 'acme', title: 'Acme' })
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
  })

  it('uses the title prop on the iframe', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ files: null }) })
    await renderFrame({ chatId: 'test-chat-id', slug: 'acme', title: 'My Real Company' })
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.title).toBe('My Real Company')
  })

  it('passes a real timeoutMs to SandpackPreview and falls back to the iframe when onTimeout fires — the real preview-system resilience fix', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: {
          '/src/App.tsx': "import Sidebar from './components/Sidebar'\nexport default function App(){return null}",
          '/src/components/Sidebar.tsx': 'export default function Sidebar(){return null}',
        },
      }),
    })
    await renderFrame({ chatId: 'finio-chat', slug: 'finio-product', title: 'Finio' })

    const stub = host.querySelector('[data-testid="sandpack-stub"]')
    expect(stub).toBeTruthy()
    expect(stub?.getAttribute('data-timeout-ms')).toBe('15000')
    expect(host.querySelector('iframe')).toBeFalsy()

    // Simulate Sandpack hanging past the watchdog (the real, confirmed-live
    // failure mode — unpkg never resolving a pinned dependency version).
    await act(async () => {
      ;(globalThis as any).__sandpackStubTriggerTimeout()
    })

    expect(host.querySelector('[data-testid="sandpack-stub"]')).toBeFalsy()
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).toBeTruthy()
    expect(iframe.src).toContain('/api/preview/finio-chat')
  })
})
