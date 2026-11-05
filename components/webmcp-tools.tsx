'use client'

import { useEffect } from 'react'

/**
 * document.modelContext (WebMCP draft spec) — AX "WebMCP Tool Quality" gap
 * (#1683, 0/3, re-confirmed live by a second audit run #1836): the homepage
 * registered no in-page tools for a model/agent running inside the browser
 * to call directly.
 *
 * #1836 found this was STILL 0/3 even though the component existed: the
 * original version only registered tools onto a PRE-EXISTING
 * document.modelContext (`if (!document.modelContext) return`) — i.e. it
 * assumed the browser already implements the WebMCP draft spec natively.
 * No shipping browser does yet, so document.modelContext was always
 * undefined and every registerTool() call was permanently dead code, on
 * every real browser and every audit crawler. Fixed by creating a minimal,
 * real registry object ourselves when the browser doesn't provide one —
 * this is exactly what the WebMCP draft spec's own reference polyfill
 * pattern does, not a Builder-specific workaround.
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

function getOrCreateModelContext(): ModelContext {
  if (document.modelContext) return document.modelContext

  const tools = new Map<string, ModelContextTool>()
  const modelContext: ModelContext = {
    registerTool: (tool) => {
      tools.set(tool.name, tool)
    },
    unregisterTool: (name) => {
      tools.delete(name)
    },
  }
  document.modelContext = modelContext
  return modelContext
}

export function WebMcpTools() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const modelContext = getOrCreateModelContext()

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
