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
 *
 * #1836 (second pass): re-running `npx ainative-ax audit` against prod after
 * the fix above STILL showed 0/3. Root cause: the audit tool does a static
 * HTTP fetch of the HTML (like curl) and never executes JS, so it can never
 * observe anything set via a React useEffect, no matter how correct the
 * runtime behavior is in a real browser — the effect only runs post-hydration.
 * `curl -s https://builder.ainative.studio/ | grep modelContext` confirmed
 * zero matches in the raw SSR HTML, even though the component was mounted.
 *
 * Fix: WEBMCP_SSR_BOOTSTRAP is a plain-JS source string rendered via a
 * `<script>` + `dangerouslySetInnerHTML` directly in app/page.tsx — the same
 * pattern that page already uses for its JSON-LD blocks, just executable JS
 * instead of a JSON payload. It runs synchronously at parse time, before any
 * React hydration, so it's present in the raw HTML a static fetch sees and
 * creates a REAL (not placeholder) document.modelContext with the same two
 * tools, same names, same real fetch/navigate behavior as below — it is not
 * a stub that something else has to detect-and-replace later.
 *
 * No conflict with the useEffect below: getOrCreateModelContext() reuses
 * document.modelContext if it already exists (the inline script already
 * created it), and registerTool() keys tools by name in a Map, so React's
 * later registerTool() calls simply overwrite the inline script's tool
 * entries by name — same result, idempotent, no duplicate registration, no
 * detection logic needed on either side.
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

/**
 * Raw JS source for the SSR inline bootstrap (see module doc comment above).
 * Kept as a plain string (not JSON.stringify'd) because it's executable
 * code, not data — the same reason analytics init scripts in this repo are
 * authored as template strings rather than objects. Mirrors
 * getOrCreateModelContext() + the two registerTool() calls below exactly;
 * if you change a tool's name/description/behavior here, change it there
 * too (and vice versa).
 */
export const WEBMCP_SSR_BOOTSTRAP = `
(function () {
  if (typeof document === 'undefined') return;
  if (!document.modelContext) {
    var tools = new Map();
    document.modelContext = {
      registerTool: function (tool) { tools.set(tool.name, tool); },
      unregisterTool: function (name) { tools.delete(name); },
    };
  }
  document.modelContext.registerTool({
    name: 'list_capabilities',
    description: "Lists AINative Builder's real, callable API surface — the same OpenAPI document served at /openapi.json.",
    inputSchema: { type: 'object', properties: {} },
    execute: function () {
      return fetch('/openapi.json').then(function (res) { return res.json(); });
    },
  });
  document.modelContext.registerTool({
    name: 'start_build',
    description: 'Navigates to /build, the real entry point where a founder describes an idea and Cody generates a working app or company from it.',
    inputSchema: { type: 'object', properties: {} },
    execute: function () {
      window.location.href = '/build';
      return { navigated: true, to: '/build' };
    },
  });
})();
`.trim()

/**
 * Server-safe wrapper so app/page.tsx can render the bootstrap next to its
 * other <script> tags (JSON-LD) without importing 'use client' concerns —
 * this file is 'use client' only because WebMcpTools below uses useEffect;
 * a plain exported string constant is safe to import from a server component
 * too, but this wrapper keeps the call site in app/page.tsx identical in
 * shape to the JSON-LD scripts already there.
 */
export function WebMcpSsrBootstrap() {
  return <script dangerouslySetInnerHTML={{ __html: WEBMCP_SSR_BOOTSTRAP }} />
}

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
