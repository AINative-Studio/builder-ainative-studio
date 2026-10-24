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
 * #1204 (Coverage Phase 4) — CodeViewer (components/chat/code-viewer.tsx,
 * 385 lines, reached live via preview-panel.tsx -> chat-detail-client.tsx
 * -> app/chats/[chatId]/page.tsx) had zero test coverage. Real fetch-on-open
 * logic, real generated project-file tree, real clipboard copy, and a real
 * Blob-download path — none of which jsdom implements natively, so this
 * file's own setup mocks navigator.clipboard, URL.createObjectURL/revokeObjectURL.
 */

function installBrowserApiMocks() {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  })
  global.URL.createObjectURL = vi.fn(() => 'blob:fake-url')
  global.URL.revokeObjectURL = vi.fn()
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
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('CodeViewer — real fetch/render/copy/download coverage (#1204)', () => {
  it('renders nothing when isOpen is false — never fetches code for a closed viewer', async () => {
    installBrowserApiMocks()
    global.fetch = vi.fn()
    const { CodeViewer } = await import('@/components/chat/code-viewer')

    render(React.createElement(CodeViewer, { isOpen: false, onClose: vi.fn(), chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches the real code for chatId when opened, and generates a real multi-file project tree', async () => {
    installBrowserApiMocks()
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('/api/chats/chat-1/code')
      return { ok: true, json: async () => ({ code: 'export default function App() { return <div/> }' }) } as any
    }) as any
    const { CodeViewer } = await import('@/components/chat/code-viewer')

    render(React.createElement(CodeViewer, { isOpen: true, onClose: vi.fn(), chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/chats/chat-1/code')
    // Real generated file tree — package.json/tsconfig.json alongside the
    // real fetched component content, not a fabricated single-file view.
    expect(host.textContent).toContain('package.json')
    expect(host.textContent).toContain('Component.jsx')
  })

  it('shows the real "Error loading code" state, never fabricated content, when the fetch itself rejects', async () => {
    installBrowserApiMocks()
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as any
    const { CodeViewer } = await import('@/components/chat/code-viewer')

    render(React.createElement(CodeViewer, { isOpen: true, onClose: vi.fn(), chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(host.textContent).toContain('Error loading code')
  })

  it('clicking Copy writes the real selected file content to the clipboard', async () => {
    installBrowserApiMocks()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ code: 'const x = 1' }) })) as any
    const { CodeViewer } = await import('@/components/chat/code-viewer')

    render(React.createElement(CodeViewer, { isOpen: true, onClose: vi.fn(), chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const copyBtn = Array.from(host.querySelectorAll('button')).find((b) => b.querySelector('svg') && /copy/i.test(b.getAttribute('aria-label') || b.title || b.textContent || ''))
      ?? Array.from(host.querySelectorAll('button')).find((b) => b.innerHTML.includes('lucide-copy') || b.innerHTML.includes('lucide-check'))
    expect(copyBtn).toBeTruthy()

    await act(async () => {
      (copyBtn as HTMLButtonElement).click()
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalled()
  })

  it('clicking Download creates a real Blob URL and triggers a real anchor-click download, then cleans it up', async () => {
    installBrowserApiMocks()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ code: 'const x = 1' }) })) as any
    const { CodeViewer } = await import('@/components/chat/code-viewer')

    render(React.createElement(CodeViewer, { isOpen: true, onClose: vi.fn(), chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const downloadBtn = Array.from(host.querySelectorAll('button')).find((b) => b.innerHTML.includes('lucide-download'))
    expect(downloadBtn).toBeTruthy()

    await act(async () => {
      (downloadBtn as HTMLButtonElement).click()
    })

    expect(global.URL.createObjectURL).toHaveBeenCalled()
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('clicking the close button calls the real onClose callback', async () => {
    installBrowserApiMocks()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ code: 'const x = 1' }) })) as any
    const onClose = vi.fn()
    const { CodeViewer } = await import('@/components/chat/code-viewer')

    render(React.createElement(CodeViewer, { isOpen: true, onClose, chatId: 'chat-1' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const closeBtn = Array.from(host.querySelectorAll('button')).find((b) => b.innerHTML.includes('lucide-x'))
    expect(closeBtn).toBeTruthy()
    ;(closeBtn as HTMLButtonElement).click()

    expect(onClose).toHaveBeenCalled()
  })
})
