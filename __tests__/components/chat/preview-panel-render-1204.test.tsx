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
 * #1204 (Coverage Phase 4) — PreviewPanel (components/chat/preview-panel.tsx,
 * 285 lines, reached live via components/chats/chat-detail-client.tsx <-
 * app/chats/[chatId]/page.tsx) had zero test coverage despite being the real
 * state-selection core deciding which of 5 different preview modes
 * (code-viewer, Sandpack, cached-iframe, A2UI, waiting) to show.
 *
 * All children with their own dedicated test coverage elsewhere (DeployDialog,
 * CodeViewer, SandpackPreview, A2UIPreviewWithFallback) are mocked at their
 * real exported boundary — this file verifies only PreviewPanel's own mode
 * -selection and control-wiring logic. web-preview.tsx primitives are left
 * real (thin, presentational, no fetch/state of their own worth mocking).
 */

vi.mock('@/components/export-button', () => ({ ExportButton: () => React.createElement('button', { 'data-testid': 'stub-export' }, 'Export') }))
vi.mock('@/components/deploy-dialog', () => ({ DeployDialog: ({ open }: { open: boolean }) => open ? React.createElement('div', { 'data-testid': 'stub-deploy-dialog' }, 'Deploy dialog open') : null }))
vi.mock('@/components/chat/code-viewer', () => ({ CodeViewer: ({ isOpen }: { isOpen: boolean }) => isOpen ? React.createElement('div', { 'data-testid': 'stub-code-viewer' }, 'Code viewer open') : null }))
vi.mock('@/components/a2ui', () => ({ A2UIPreviewWithFallback: ({ chatId }: { chatId: string }) => React.createElement('div', { 'data-testid': 'stub-a2ui' }, `a2ui:${chatId}`) }))
vi.mock('@/components/chat/sandpack-preview', () => ({ SandpackPreview: ({ files }: { files: Record<string, string> }) => React.createElement('div', { 'data-testid': 'stub-sandpack' }, `sandpack:${Object.keys(files).length}`) }))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

/** WebPreviewNavigationButton's `tooltip` text only renders inside a Radix
 *  TooltipContent that isn't mounted until hover/focus — buttons carry no
 *  title/aria-label of their own. Confirmed via a debug render that each
 *  nav button's lucide icon has a stable, distinguishing class instead. */
function navButton(iconClass: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button')).find(
    (b) => b.querySelector(`svg.${iconClass}`)
  ) as HTMLButtonElement
}

function baseProps(overrides: Record<string, any> = {}) {
  return {
    currentChat: { id: 'chat-1', demo: '/preview/abc' },
    isFullscreen: false,
    setIsFullscreen: vi.fn(),
    refreshKey: 0,
    setRefreshKey: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('PreviewPanel — real preview-mode selection + control wiring coverage (#1204)', () => {
  it('shows the real "Your app will appear here" waiting state with no chat and no demo', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: null })))

    expect(host.textContent).toContain('Your app will appear here')
  })

  it('shows the real "Building your app" generating state with no demo yet, including the latest real build step', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: { id: 'chat-1' }, isGenerating: true, buildSteps: ['Scaffolding files', 'Installing deps'] })))

    expect(host.textContent).toContain('Building your app')
    expect(host.textContent).toContain('Installing deps')
  })

  it('prefers the real Sandpack mode over the cached iframe when sandpackFiles are genuinely present', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ sandpackFiles: { 'App.tsx': 'x', 'index.tsx': 'y' } })))

    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('[data-testid="stub-sandpack"]')?.textContent).toBe('sandpack:2')
  })

  it('falls back to the real cached-iframe mode when there is a demo URL but no sandpackFiles', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: { id: 'chat-1', demo: '/preview/xyz' } })))

    const iframe = host.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('src')).toBe('/api/preview/xyz')
  })

  it('rewrites a real already-/api/-prefixed demo URL unchanged (never double-prefixes)', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: { id: 'chat-1', demo: '/api/preview/xyz' } })))

    const iframe = host.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe('/api/preview/xyz')
  })

  it('a real Code button click shows the real CodeViewer, replacing the preview entirely', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps()))

    const codeBtn = navButton('lucide-code')
    expect(codeBtn).toBeTruthy()
    await act(async () => { codeBtn.click() })

    expect(host.querySelector('[data-testid="stub-code-viewer"]')).not.toBeNull()
    expect(host.querySelector('iframe')).toBeNull()
  })

  it('a real Deploy button click opens the real DeployDialog with the real generationId', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: { id: 'chat-99', demo: '/preview/x' } })))

    expect(host.querySelector('[data-testid="stub-deploy-dialog"]')).toBeNull()

    const deployBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Deploy')) as HTMLButtonElement
    await act(async () => { deployBtn.click() })

    expect(host.querySelector('[data-testid="stub-deploy-dialog"]')).not.toBeNull()
  })

  it('never renders Export/Deploy controls when there is genuinely no currentChat id', async () => {
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: null })))

    expect(host.querySelector('[data-testid="stub-export"]')).toBeNull()
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Deploy'))).toBe(false)
  })

  it('a real Refresh click bumps the real refreshKey via the functional updater', async () => {
    const setRefreshKey = vi.fn()
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ setRefreshKey })))

    const refreshBtn = navButton('lucide-refresh-cw')
    await act(async () => { refreshBtn.click() })

    expect(setRefreshKey).toHaveBeenCalledWith(expect.any(Function))
    expect((setRefreshKey.mock.calls[0][0] as (n: number) => number)(5)).toBe(6)
  })

  it('a real fullscreen toggle click calls the real setIsFullscreen with the inverse of the current value', async () => {
    const setIsFullscreen = vi.fn()
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ isFullscreen: false, setIsFullscreen })))

    const fsBtn = navButton('lucide-maximize')
    await act(async () => { fsBtn.click() })

    expect(setIsFullscreen).toHaveBeenCalledWith(true)
  })

  it('#1354 fix: clicking the A2UI toggle now actually switches the cached-iframe preview to the real A2UI mode', async () => {
    // Branch order was fixed to check `useA2UI && currentChat` before the
    // cached-iframe `currentChat?.demo` branch, so the toggle is no longer
    // dead code.
    const { PreviewPanel } = await import('@/components/chat/preview-panel')
    render(React.createElement(PreviewPanel, baseProps({ currentChat: { id: 'chat-1', demo: '/preview/abc' } })))

    expect(host.querySelector('iframe')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-a2ui"]')).toBeNull()

    const a2uiBtn = navButton('lucide-zap')
    expect(a2uiBtn).toBeTruthy()
    await act(async () => { a2uiBtn.click() })

    expect(host.querySelector('[data-testid="stub-a2ui"]')?.textContent).toBe('a2ui:chat-1')
    expect(host.querySelector('iframe')).toBeNull()

    // Toggling back off returns to the cached iframe.
    await act(async () => { a2uiBtn.click() })
    expect(host.querySelector('iframe')).not.toBeNull()
    expect(host.querySelector('[data-testid="stub-a2ui"]')).toBeNull()
  })
})
