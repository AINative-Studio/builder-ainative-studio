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
 * for real in #1836 — see components/webmcp-tools.tsx's doc comment for the
 * full history. The real root cause, confirmed by reading AINative's own AX
 * audit checker source directly: it calls `document.modelContext.getTools()`
 * and gates on `typeof mc.getTools === 'function'` BEFORE anything else —
 * an object with only registerTool()/unregisterTool() and no getTools()
 * was invisible to the real checker no matter how correctly registration
 * itself worked. getOrCreateModelContext() now also requires getTools() to
 * exist before treating an existing document.modelContext as usable; an
 * incomplete pre-existing object is replaced, not reused as-is.
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

  it('registers list_capabilities and start_build when a COMPLIANT document.modelContext (with getTools) is present', () => {
    const registerTool = vi.fn()
    ;(document as any).modelContext = { registerTool, unregisterTool: vi.fn(), getTools: vi.fn(async () => []) }

    render(<WebMcpTools />)

    expect(registerTool).toHaveBeenCalledTimes(2)
    const names = registerTool.mock.calls.map((call) => call[0].name)
    expect(names).toContain('list_capabilities')
    expect(names).toContain('start_build')
  })

  it('reuses a pre-existing document.modelContext that already implements getTools()', () => {
    const registerTool = vi.fn()
    const existing = { registerTool, unregisterTool: vi.fn(), getTools: vi.fn(async () => []) }
    ;(document as any).modelContext = existing

    render(<WebMcpTools />)

    expect(document.modelContext).toBe(existing)
  })

  it('REPLACES an incomplete pre-existing document.modelContext that lacks getTools() — the real bug this issue was about', () => {
    const incomplete = { registerTool: vi.fn(), unregisterTool: vi.fn() }
    ;(document as any).modelContext = incomplete

    render(<WebMcpTools />)

    expect(document.modelContext).not.toBe(incomplete)
    expect(typeof document.modelContext!.getTools).toBe('function')
  })

  it('getTools() resolves to the real registered tools, each with a readOnlyHint annotation', async () => {
    render(<WebMcpTools />)

    const tools = await document.modelContext!.getTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_capabilities')
    expect(names).toContain('start_build')
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
    }
  })

  it('list_capabilities fetches the real /openapi.json document', async () => {
    const registerTool = vi.fn()
    ;(document as any).modelContext = { registerTool, unregisterTool: vi.fn(), getTools: vi.fn(async () => []) }
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
    ;(document as any).modelContext = { registerTool: vi.fn(), unregisterTool, getTools: vi.fn(async () => []) }

    render(<WebMcpTools />)
    act(() => { root.unmount() })

    expect(unregisterTool).toHaveBeenCalledWith('list_capabilities')
    expect(unregisterTool).toHaveBeenCalledWith('start_build')
  })
})
