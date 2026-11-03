'use client'

import { useEffect } from 'react'

/**
 * WebMCP (document.modelContext) registration (#1683, AX scan 2026-10-29,
 * "WebMCP Tool Quality 0/3" — no registration existed at all on the page).
 *
 * Exposes a small number of REAL, already-working Builder capabilities to an
 * in-page agent via the WebMCP draft spec's provideContext API — not stubs:
 *
 *  - askBuilder: forwards to the real, already-shipped /ask endpoint (#1679),
 *    itself a thin alias onto /api/build/help's grounded FAQ answerer. Same
 *    answer a human gets from the Help Center, same citations.
 *  - getBuilderCapabilities: fetches the real /openapi.json this repo already
 *    serves and documents (app/openapi.json/route.ts) — not a hand-maintained
 *    second copy of the API surface.
 *  - startBuild: points the agent at the real /build entry point, the actual
 *    product (BuildApp), rather than describing it in prose.
 *
 * `document.modelContext` is a draft browser API with no TypeScript lib types
 * yet — declared narrowly below to the one method this file actually calls.
 * No-ops safely (via the `'modelContext' in document` guard) in any browser
 * that doesn't implement it yet.
 */

declare global {
  interface Document {
    modelContext?: {
      provideContext: (context: {
        tools: Array<{
          name: string
          description: string
          inputSchema: Record<string, unknown>
          execute: (input: Record<string, unknown>) => Promise<unknown>
        }>
      }) => void
    }
  }
}

export function WebMcpModelContext() {
  useEffect(() => {
    if (typeof document === 'undefined' || !('modelContext' in document) || !document.modelContext) {
      return
    }

    document.modelContext.provideContext({
      tools: [
        {
          name: 'askBuilder',
          description:
            'Ask a question about AINative Builder itself — what it is, how provisioning/auth work, pricing, or any other product question. Answers are grounded in the same curated FAQ knowledge base the human-facing Help Center uses, with citations.',
          inputSchema: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question to ask about Builder.' },
            },
            required: ['question'],
          },
          execute: async (input: Record<string, unknown>) => {
            const res = await fetch('/ask', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question: input.question }),
            })
            return res.json()
          },
        },
        {
          name: 'getBuilderCapabilities',
          description:
            "Fetch AINative Builder's real, current OpenAPI specification — the actual agent-callable API surface (generate an app/company, read a company's state, manage a deployed app).",
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            const res = await fetch('/openapi.json')
            return res.json()
          },
        },
        {
          name: 'startBuild',
          description:
            'Get the URL to start building a real app or company on AINative Builder — the actual product entry point where an idea becomes a running product.',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => ({ url: 'https://builder.ainative.studio/build' }),
        },
      ],
    })
  }, [])

  return null
}
