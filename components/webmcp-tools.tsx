'use client'

import { useEffect } from 'react'

/**
 * document.modelContext (WebMCP draft spec) — AX "WebMCP Tool Quality" gap
 * (#1683, 0/3): the homepage registered no in-page tools for a model/agent
 * running inside the browser to call directly.
 *
 * Registers a SMALL, REAL tool set — each maps to an already-working
 * Builder capability, not a stub:
 *  - list_capabilities: reads the real, already-served /openapi.json (the
 *    same document /.well-known/api-catalog points agents at) rather than
 *    hand-maintaining a second description of what Builder can do.
 *  - start_build: navigates to /build, the real product entry point.
 */

interface ModelContextTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

interface ModelContext {
  registerTool: (tool: ModelContextTool) => void
  unregisterTool?: (name: string) => void
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
}

const TOOL_NAMES = ['list_capabilities', 'start_build'] as const

export function WebMcpTools() {
  useEffect(() => {
    if (typeof document === 'undefined' || !document.modelContext) return
    const modelContext = document.modelContext

    modelContext.registerTool({
      name: 'list_capabilities',
      description:
        "Lists AINative Builder's real, callable API surface — the same OpenAPI document served at /openapi.json.",
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const res = await fetch('/openapi.json')
        return res.json()
      },
    })

    modelContext.registerTool({
      name: 'start_build',
      description:
        'Navigates to /build, the real entry point where a founder describes an idea and Cody generates a working app or company from it.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        window.location.href = '/build'
        return { navigated: true, to: '/build' }
      },
    })

    return () => {
      for (const name of TOOL_NAMES) {
        modelContext.unregisterTool?.(name)
      }
    }
  }, [])

  return null
}
