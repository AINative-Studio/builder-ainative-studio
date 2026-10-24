// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — components/a2ui/AgentConnection.tsx (393 lines,
 * reached live via components/a2ui/index.tsx -> A2UIPreview.tsx ->
 * preview-panel.tsx -> chat-detail-client.tsx -> app/chats/[chatId]/page.tsx)
 * had zero test coverage despite real, genuinely bug-prone connection-state
 * logic: reconnect-with-backoff, a heartbeat interval, and an HTTP-fallback
 * path for sending actions when the socket isn't open.
 *
 * jsdom has no real WebSocket implementation — this file's own minimal,
 * controllable FakeWebSocket drives the real hook's onopen/onmessage/
 * onerror/onclose callbacks exactly like a real browser WebSocket would,
 * without needing a real network connection.
 */

type WSListener = (ev: any) => void

class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  onopen: WSListener | null = null
  onmessage: WSListener | null = null
  onerror: WSListener | null = null
  onclose: WSListener | null = null
  sent: string[] = []
  url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({})
  }

  // Test-only helpers to drive the real hook's real callbacks.
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
  }
  simulateMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
  simulateError() {
    this.onerror?.({})
  }
  simulateServerClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({})
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket as any)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAgentConnection — real connection-state coverage (#1204)', () => {
  it('auto-connects on mount, building a real ws:// URL with chatId, and reflects real CONNECTED status once the socket opens', async () => {
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://example.com/a2ui', chatId: 'chat-1' }))

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('ws://example.com/a2ui?chatId=chat-1')
    expect(result.current.status).toBe('connecting')

    act(() => { FakeWebSocket.instances[0].simulateOpen() })
    await waitFor(() => expect(result.current.isConnected).toBe(true))
  })

  it('parses a real "render" message and exposes the real component in state', async () => {
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1' }))
    act(() => { FakeWebSocket.instances[0].simulateOpen() })

    const fakeComponent = { type: 'text', id: 'comp-1', props: { text: 'hello' } }
    act(() => { FakeWebSocket.instances[0].simulateMessage({ type: 'render', payload: { component: fakeComponent } }) })

    await waitFor(() => expect(result.current.component).toEqual(fakeComponent))
  })

  it('a real "error" message sets both the hook\'s error state and fires onError', async () => {
    const onError = vi.fn()
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1', onError }))
    act(() => { FakeWebSocket.instances[0].simulateOpen() })

    act(() => { FakeWebSocket.instances[0].simulateMessage({ type: 'error', payload: { message: 'agent crashed' } }) })

    await waitFor(() => expect(result.current.error?.message).toBe('agent crashed'))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'agent crashed' }))
  })

  it('never crashes on genuinely malformed JSON from the server', async () => {
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1' }))
    act(() => { FakeWebSocket.instances[0].simulateOpen() })

    expect(() => {
      act(() => { FakeWebSocket.instances[0].onmessage?.({ data: '{not valid json' }) })
    }).not.toThrow()
    expect(result.current.error).toBeNull()
  })

  it('a real server close triggers a real reconnect attempt (a brand-new WebSocket instance) after the backoff interval', async () => {
    vi.useFakeTimers()
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1', reconnectInterval: 1000, maxReconnectAttempts: 3 }))
    act(() => { FakeWebSocket.instances[0].simulateOpen() })

    act(() => { FakeWebSocket.instances[0].simulateServerClose() })
    expect(FakeWebSocket.instances).toHaveLength(1) // not yet — waiting on the real backoff

    act(() => { vi.advanceTimersByTime(1000) })
    expect(FakeWebSocket.instances).toHaveLength(2) // a real second connection attempt fired
  })

  it('sendAction sends a real WebSocket message when the socket is open', async () => {
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1' }))
    act(() => { FakeWebSocket.instances[0].simulateOpen() })

    act(() => { result.current.sendAction('click', { targetId: 'btn-1' }) })

    const sent = FakeWebSocket.instances[0].sent
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0])).toMatchObject({ type: 'action', payload: { action: 'click', context: { targetId: 'btn-1' } } })
  })

  it('sendAction falls back to a real HTTP POST when the socket is not open', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1' }))
    // Deliberately never opened — readyState stays CONNECTING, never OPEN.

    act(() => { result.current.sendAction('click', { targetId: 'btn-1' }) })

    expect(global.fetch).toHaveBeenCalledWith('/api/a2ui/action', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ chatId: 'c1', action: 'click', context: { targetId: 'btn-1' } }),
    }))
  })

  it('disconnect() closes the real socket and sets status back to disconnected', async () => {
    const { useAgentConnection } = await import('@/components/a2ui/AgentConnection')
    const { result } = renderHook(() => useAgentConnection({ url: 'http://x', chatId: 'c1' }))
    act(() => { FakeWebSocket.instances[0].simulateOpen() })
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => { result.current.disconnect() })

    expect(result.current.status).toBe('disconnected')
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED)
  })
})

describe('AgentConnectionStatus — real render coverage (#1204)', () => {
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
  })

  it('shows the real "Connected" label and no Reconnect button while connected', async () => {
    const { AgentConnectionStatus, ConnectionStatus } = await import('@/components/a2ui/AgentConnection')
    render(React.createElement(AgentConnectionStatus, { status: ConnectionStatus.CONNECTED }))

    expect(host.textContent).toContain('Connected')
    expect(Array.from(host.querySelectorAll('button')).length).toBe(0)
  })

  it('shows a real Reconnect button and the real error message once disconnected with an error', async () => {
    const { AgentConnectionStatus, ConnectionStatus } = await import('@/components/a2ui/AgentConnection')
    const onReconnect = vi.fn()
    render(
      React.createElement(AgentConnectionStatus, {
        status: ConnectionStatus.DISCONNECTED,
        error: new Error('socket closed unexpectedly'),
        onReconnect,
      }),
    )

    expect(host.textContent).toContain('socket closed unexpectedly')
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn).not.toBeNull()
    btn.click()
    expect(onReconnect).toHaveBeenCalled()
  })

  it('never shows a Reconnect button while genuinely connecting or connected, even if onReconnect is supplied', async () => {
    const { AgentConnectionStatus, ConnectionStatus } = await import('@/components/a2ui/AgentConnection')
    render(React.createElement(AgentConnectionStatus, { status: ConnectionStatus.CONNECTING, onReconnect: vi.fn() }))

    expect(host.querySelectorAll('button').length).toBe(0)
  })
})
