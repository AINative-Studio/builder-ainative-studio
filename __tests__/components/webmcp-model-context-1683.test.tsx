// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { WebMcpModelContext } from '@/components/webmcp-model-context'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1683 — WebMCP Tool Quality AX gap (0/3): no document.modelContext
 * registration existed anywhere on the page. Confirms the registration
 * happens on mount, with the real tool set, and never throws in a browser
 * that doesn't implement the draft API yet.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(node)
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  delete (document as any).modelContext
  vi.restoreAllMocks()
})

describe('WebMcpModelContext', () => {
  it('registers the real tool set via document.modelContext.provideContext on mount', () => {
    const provideContext = vi.fn()
    ;(document as any).modelContext = { provideContext }

    render(<WebMcpModelContext />)

    expect(provideContext).toHaveBeenCalledTimes(1)
    const { tools } = provideContext.mock.calls[0][0]
    const names = tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['askBuilder', 'getBuilderCapabilities', 'startBuild'])
    for (const tool of tools) {
      expect(typeof tool.execute).toBe('function')
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('does not throw when document.modelContext is unimplemented', () => {
    delete (document as any).modelContext
    expect(() => render(<WebMcpModelContext />)).not.toThrow()
  })

  it('askBuilder tool forwards to the real /ask endpoint', async () => {
    const provideContext = vi.fn()
    ;(document as any).modelContext = { provideContext }
    const fetchMock = vi.fn(async () => ({ json: async () => ({ answer: 'real answer', sources: [] }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<WebMcpModelContext />)
    const { tools } = provideContext.mock.calls[0][0]
    const askBuilder = tools.find((t: { name: string }) => t.name === 'askBuilder')

    const result = await askBuilder.execute({ question: 'what is builder' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/ask',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'what is builder' }),
      }),
    )
    expect(result).toEqual({ answer: 'real answer', sources: [] })
  })

  it('getBuilderCapabilities tool fetches the real /openapi.json', async () => {
    const provideContext = vi.fn()
    ;(document as any).modelContext = { provideContext }
    const fetchMock = vi.fn(async () => ({ json: async () => ({ openapi: '3.1.0' }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<WebMcpModelContext />)
    const { tools } = provideContext.mock.calls[0][0]
    const getCaps = tools.find((t: { name: string }) => t.name === 'getBuilderCapabilities')

    const result = await getCaps.execute({})

    expect(fetchMock).toHaveBeenCalledWith('/openapi.json')
    expect(result).toEqual({ openapi: '3.1.0' })
  })

  it('startBuild tool returns the real /build entry point URL', async () => {
    const provideContext = vi.fn()
    ;(document as any).modelContext = { provideContext }

    render(<WebMcpModelContext />)
    const { tools } = provideContext.mock.calls[0][0]
    const startBuild = tools.find((t: { name: string }) => t.name === 'startBuild')

    const result = await startBuild.execute({})

    expect(result).toEqual({ url: 'https://builder.ainative.studio/build' })
  })
})
