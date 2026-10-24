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
 * #1204 (Coverage Phase 4) — A2UIPreview (components/a2ui/A2UIPreview.tsx,
 * 342 lines, reached live via components/chat/preview-panel.tsx) had zero
 * test coverage. useAgentConnection (AgentConnection.tsx) and ComponentMapper
 * are each already independently tested elsewhere this pass
 * (AgentConnection-render-1204.test.tsx, ComponentMapper-render-1204.test.tsx)
 * — mocked here at their real exported boundaries so this file verifies only
 * A2UIPreview's own orchestration: state-driven view selection, control-bar
 * wiring, auto-connect, and the fallback-iframe wrapper component.
 */

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  sendAction: vi.fn(),
  state: {
    status: 'disconnected',
    component: null as any,
    error: null as Error | null,
    isConnected: false,
  },
}))

vi.mock('@/components/a2ui/AgentConnection', () => ({
  ConnectionStatus: {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error',
  },
  useAgentConnection: () => ({
    status: h.state.status,
    component: h.state.component,
    error: h.state.error,
    connect: h.connect,
    disconnect: h.disconnect,
    sendAction: h.sendAction,
    isConnected: h.state.isConnected,
  }),
  AgentConnectionStatus: ({ status }: { status: string }) =>
    React.createElement('div', { 'data-testid': 'stub-connection-status' }, status),
}))

vi.mock('@/components/a2ui/ComponentMapper', () => ({
  ComponentMapper: ({ component, onAction }: { component: any; onAction: (a: string, c: any) => void }) =>
    React.createElement(
      'button',
      { 'data-testid': 'stub-component-mapper', onClick: () => onAction('stub-action', { from: component?.id }) },
      `rendered:${component?.type}`
    ),
}))

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
  h.state = { status: 'disconnected', component: null, error: null, isConnected: false }
})

describe('A2UIPreview — real orchestration coverage (#1204)', () => {
  it('auto-connects on mount when disconnected and autoConnect defaults true', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123' }))

    expect(h.connect).toHaveBeenCalled()
  })

  it('never auto-connects when autoConnect is explicitly false', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    expect(h.connect).not.toHaveBeenCalled()
  })

  it('shows the real "Connecting to Agent" state while status is connecting', async () => {
    h.state.status = 'connecting'
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    expect(document.body.textContent).toContain('Connecting to Agent')
  })

  it('shows the real "Reconnecting to Agent" state while status is reconnecting', async () => {
    h.state.status = 'reconnecting'
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    expect(document.body.textContent).toContain('Reconnecting to Agent')
  })

  it('shows the real Connection Error state with the real error message and a working Try Again button', async () => {
    h.state.status = 'error'
    h.state.error = new Error('agent refused connection')
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    expect(document.body.textContent).toContain('Connection Error')
    expect(document.body.textContent).toContain('agent refused connection')

    const tryAgainBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Try Again')) as HTMLButtonElement
    await act(async () => { tryAgainBtn.click() })
    expect(h.connect).toHaveBeenCalled()
  })

  it('shows the real "No Preview Available" state with a real Connect button when disconnected with no component', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    expect(document.body.textContent).toContain('No Preview Available')
    const connectBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Connect') as HTMLButtonElement
    expect(connectBtn).toBeTruthy()
    await act(async () => { connectBtn.click() })
    expect(h.connect).toHaveBeenCalled()
  })

  it('renders the real ComponentMapper once connected with a real component, and wires real onAction through to sendAction', async () => {
    h.state.isConnected = true
    h.state.component = { type: 'button', id: 'btn-1' }
    const onAction = vi.fn()
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false, onAction }))

    const mapper = host.querySelector('[data-testid="stub-component-mapper"]') as HTMLButtonElement
    expect(mapper.textContent).toBe('rendered:button')

    await act(async () => { mapper.click() })
    expect(h.sendAction).toHaveBeenCalledWith('stub-action', { from: 'btn-1' })
    expect(onAction).toHaveBeenCalledWith('stub-action', { from: 'btn-1' })
  })

  it('never forwards an action to sendAction while paused (the real Pause control), but still calls local onAction logic path is skipped entirely', async () => {
    h.state.isConnected = true
    h.state.component = { type: 'button', id: 'btn-1' }
    const onAction = vi.fn()
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false, onAction }))

    const pauseBtn = host.querySelector('button[title="Pause updates"]') as HTMLButtonElement
    await act(async () => { pauseBtn.click() })
    expect(host.querySelector('button[title="Resume updates"]')).toBeTruthy()

    const mapper = host.querySelector('[data-testid="stub-component-mapper"]') as HTMLButtonElement
    await act(async () => { mapper.click() })

    expect(h.sendAction).not.toHaveBeenCalled()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a real Refresh click disconnects then reconnects after the real 100ms delay', async () => {
    vi.useFakeTimers()
    h.state.isConnected = true
    h.state.component = { type: 'text', id: 't1' }
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    const refreshBtn = host.querySelector('button[title="Refresh preview"]') as HTMLButtonElement
    await act(async () => { refreshBtn.click() })
    expect(h.disconnect).toHaveBeenCalled()
    expect(h.connect).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(100) })
    expect(h.connect).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('disables the real Refresh button while not connected', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    const refreshBtn = host.querySelector('button[title="Refresh preview"]') as HTMLButtonElement
    expect(refreshBtn.disabled).toBe(true)
  })

  it('toggles real fullscreen layout classes on the real Maximize/Minimize control', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', autoConnect: false }))

    const outer = host.firstElementChild as HTMLElement
    expect(outer.className).toContain('h-full')

    const fsBtn = host.querySelector('button[title="Enter fullscreen"]') as HTMLButtonElement
    await act(async () => { fsBtn.click() })

    expect(outer.className).toContain('fixed inset-0 z-50')
    expect(host.querySelector('button[title="Exit fullscreen"]')).toBeTruthy()
  })

  it('shows the real truncated chat id in the controls bar', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-1234567890' }))

    expect(document.body.textContent).toContain('Chat: chat-123...')
  })

  it('never renders the controls bar when showControls is false', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', showControls: false, autoConnect: false }))

    expect(host.querySelector('button[title="Refresh preview"]')).toBeNull()
  })

  it('never renders the real AgentConnectionStatus when showStatus is false', async () => {
    const { A2UIPreview } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreview, { chatId: 'chat-123', showStatus: false, autoConnect: false }))

    expect(host.querySelector('[data-testid="stub-connection-status"]')).toBeNull()
  })
})

describe('A2UIPreviewWithFallback — real fallback-iframe branch coverage (#1204)', () => {
  it('renders the real static iframe fallback when A2UI is disabled and a fallbackSrc is given', async () => {
    const { A2UIPreviewWithFallback } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreviewWithFallback, { chatId: 'chat-123', enableA2UI: false, fallbackSrc: 'https://preview.example.com/x' }))

    const iframe = host.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('src')).toBe('https://preview.example.com/x')
    expect(host.querySelector('button[title="Refresh preview"]')).toBeNull()
  })

  it('renders the real A2UIPreview (not the iframe) when enableA2UI is true even with a fallbackSrc present', async () => {
    const { A2UIPreviewWithFallback } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreviewWithFallback, { chatId: 'chat-123', enableA2UI: true, fallbackSrc: 'https://preview.example.com/x', autoConnect: false }))

    expect(host.querySelector('iframe')).toBeNull()
    expect(document.body.textContent).toContain('No Preview Available')
  })

  it('renders the real A2UIPreview when disabled but no fallbackSrc is given', async () => {
    const { A2UIPreviewWithFallback } = await import('@/components/a2ui/A2UIPreview')
    render(React.createElement(A2UIPreviewWithFallback, { chatId: 'chat-123', enableA2UI: false, autoConnect: false }))

    expect(host.querySelector('iframe')).toBeNull()
    expect(document.body.textContent).toContain('No Preview Available')
  })
})
