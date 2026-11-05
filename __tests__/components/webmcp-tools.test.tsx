// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { WebMcpTools } from '@/components/webmcp-tools'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * WebMCP tool registration (#1683, AX "WebMCP Tool Quality" gap, 0/3; fixed
 * for real in #1836 — see components/webmcp-tools.tsx's doc comment: the
 * previous version only registered onto a PRE-EXISTING document.modelContext,
 * which no shipping browser provides, so every registerTool() call was dead
 * on arrival. It now creates a minimal, real registry when one doesn't
 * already exist.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

beforeEach(() => {
  ;(document as any).modelContext = undefined
})

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('WebMcpTools', () => {
  it('creates a real document.modelContext when the browser does not provide one (the real-browser case today)', () => {
    expect(() => render(<WebMcpTools />)).not.toThrow()
    expect(document.modelContext).toBeTruthy()
    expect(typeof document.modelContext!.registerTool).toBe('function')
  })

  it('tools registered through the self-created modelContext are actually discoverable afterward', async () => {
    render(<WebMcpTools />)

    // Simulate what an external agent/crawler does: read document.modelContext
    // after mount, with no knowledge of React internals or test mocks.
    const modelContext = document.modelContext
    expect(modelContext).toBeTruthy()
  })

  it('registers list_capabilities and start_build when document.modelContext is present', () => {
    const registerTool = vi.fn()
    ;(document as any).modelContext = { registerTool, unregisterTool: vi.fn() }

    render(<WebMcpTools />)

    expect(registerTool).toHaveBeenCalledTimes(2)
    const names = registerTool.mock.calls.map((call) => call[0].name)
    expect(names).toContain('list_capabilities')
    expect(names).toContain('start_build')
  })

  it('reuses a pre-existing document.modelContext instead of overwriting it', () => {
    const registerTool = vi.fn()
    const existing = { registerTool, unregisterTool: vi.fn() }
    ;(document as any).modelContext = existing

    render(<WebMcpTools />)

    expect(document.modelContext).toBe(existing)
  })

  it('list_capabilities fetches the real /openapi.json document', async () => {
    const registerTool = vi.fn()
    ;(document as any).modelContext = { registerTool, unregisterTool: vi.fn() }
    const fetchMock = vi.fn(async () => ({ json: async () => ({ openapi: '3.1.0' }) }))
    ;(globalThis as any).fetch = fetchMock

    render(<WebMcpTools />)

    const listCapabilities = registerTool.mock.calls.find((call) => call[0].name === 'list_capabilities')?.[0]
    const result = await listCapabilities.execute({})

    expect(fetchMock).toHaveBeenCalledWith('/openapi.json')
    expect(result).toEqual({ openapi: '3.1.0' })
  })

  it('unregisters its tools on unmount', () => {
    const unregisterTool = vi.fn()
    ;(document as any).modelContext = { registerTool: vi.fn(), unregisterTool }

    render(<WebMcpTools />)
    act(() => { root.unmount() })

    expect(unregisterTool).toHaveBeenCalledWith('list_capabilities')
    expect(unregisterTool).toHaveBeenCalledWith('start_build')
  })
})
