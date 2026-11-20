/**
 * POST /mcp (#2182, AX/agent-readiness scan 2026-11-19) — a real, minimal
 * MCP (Model Context Protocol) server endpoint, JSON-RPC 2.0 over HTTP,
 * answering `tools/list` and `tools/call` for the real tool set.
 *
 * Distinct from the already-passing "MCP Discovery" check (`api` subdomain
 * /.well-known/mcp.json, a discovery/metadata document on a different
 * host) — this is a genuinely CALLABLE server here on
 * builder.ainative.studio, the gap the AX audit's NLWeb /ask sub-check
 * actually probes for ("/mcp responds to tools/list with a valid JSON-RPC
 * 2.0 envelope").
 *
 * Tool set deliberately mirrors components/webmcp-tools.tsx's real,
 * already-shipped in-browser WebMCP registration (`list_capabilities`,
 * `start_build`) rather than inventing a second, possibly-drifting
 * catalog — but re-expressed for a server context, since that component's
 * tools are browser-only (`fetch` against the SAME origin, `window.
 * location` navigation) and have no meaning called from a server process:
 *
 *   - `list_capabilities`: returns the SAME real OpenAPI document
 *     /openapi.json already serves (calls that route's own GET() handler
 *     directly — no second hand-maintained spec).
 *   - `start_build`: a server process cannot navigate a browser. Its real,
 *     honest server-side action is to return the actionable URL
 *     (https://builder.ainative.studio/build) rather than silently no-op
 *     or fabricate a "navigated" result that never happened — the calling
 *     agent decides what to do with that URL (e.g. fetch it, or hand it to
 *     the human it's assisting).
 */

import { NextRequest } from 'next/server'
import { GET as openApiGet } from '@/app/openapi.json/route'

export const runtime = 'nodejs'

const JSONRPC_VERSION = '2.0'

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: Record<string, unknown>
}

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean }
}

const TOOLS: McpTool[] = [
  {
    name: 'list_capabilities',
    description:
      "Lists AINative Builder's real, callable API surface — the same OpenAPI document served at /openapi.json.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'start_build',
    description:
      'Returns the real entry point (https://builder.ainative.studio/build) where a founder describes an idea and Cody generates a working app or company from it. A server-side caller cannot be navigated like a browser — this returns the URL to act on instead.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
]

function jsonRpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: JSONRPC_VERSION, id, result })
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: JSONRPC_VERSION, id: id ?? null, error: { code, message } }, { status: 200 })
}

async function callTool(name: string): Promise<unknown> {
  if (name === 'list_capabilities') {
    const res = await openApiGet()
    return res.json()
  }
  if (name === 'start_build') {
    return { url: 'https://builder.ainative.studio/build' }
  }
  throw new Error(`unknown tool: ${name}`)
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as JsonRpcRequest | null

  if (!body || body.jsonrpc !== JSONRPC_VERSION || typeof body.method !== 'string') {
    // -32600: Invalid Request (JSON-RPC 2.0 spec).
    return jsonRpcError(body?.id, -32600, 'Invalid Request: expected {jsonrpc: "2.0", id, method, params?}')
  }

  const { id, method, params } = body

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS })
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    if (typeof toolName !== 'string') {
      return jsonRpcError(id, -32602, 'Invalid params: "name" is required')
    }
    try {
      const result = await callTool(toolName)
      return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
    } catch (e: any) {
      // -32601: Method not found (reused here for "unknown tool", same
      // convention the MCP spec itself uses for an unrecognized tool name).
      return jsonRpcError(id, -32601, e?.message || 'tool call failed')
    }
  }

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'ainative-builder', version: '1.0.0' },
      capabilities: { tools: {} },
    })
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`)
}
