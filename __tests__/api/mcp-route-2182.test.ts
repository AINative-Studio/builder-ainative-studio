/**
 * #2182 — POST /mcp: a real, minimal MCP (Model Context Protocol) server
 * endpoint, JSON-RPC 2.0 over HTTP. Distinct from the already-passing "MCP
 * Discovery" check (api subdomain's /.well-known/mcp.json) — this is a
 * genuinely callable server, answering tools/list and tools/call.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/openapi.json/route', () => ({
  GET: vi.fn(async () => Response.json({ openapi: '3.1.0', paths: { '/api/health': {} } })),
}))

import { POST } from '@/app/mcp/route'

function req(body: unknown): NextRequest {
  return new NextRequest(new Request('https://builder.ainative.studio/mcp', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

describe('POST /mcp (#2182)', () => {
  it('tools/list returns a valid JSON-RPC 2.0 envelope with the real tool set', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(Array.isArray(body.result.tools)).toBe(true)
    expect(body.result.tools.length).toBeGreaterThan(0)
    for (const tool of body.result.tools) {
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.inputSchema).toBe('object')
    }
  })

  it('tools/list includes the same two real tools components/webmcp-tools.tsx registers client-side', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    const body = await res.json()
    const names = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('list_capabilities')
    expect(names).toContain('start_build')
  })

  it('tools/call list_capabilities returns the real OpenAPI document (same source as GET /openapi.json)', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_capabilities' } }))
    const body = await res.json()
    expect(body.id).toBe(2)
    const content = JSON.parse(body.result.content[0].text)
    expect(content.openapi).toBe('3.1.0')
  })

  it('tools/call start_build returns the real build URL (a server cannot navigate a browser)', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'start_build' } }))
    const body = await res.json()
    const content = JSON.parse(body.result.content[0].text)
    expect(content.url).toBe('https://builder.ainative.studio/build')
  })

  it('tools/call with an unknown tool name returns a JSON-RPC error, not a 500', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nonexistent_tool' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBeTruthy()
    expect(typeof body.error.code).toBe('number')
  })

  it('initialize returns a real protocol/capabilities envelope', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 5, method: 'initialize', params: {} }))
    const body = await res.json()
    expect(body.result.protocolVersion).toBeTruthy()
    expect(body.result.capabilities).toBeTruthy()
  })

  it('an unknown method returns a JSON-RPC error, not a 500', async () => {
    const res = await POST(req({ jsonrpc: '2.0', id: 6, method: 'not_a_real_method' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error.code).toBe(-32601)
  })

  it('a malformed request (missing jsonrpc version) returns a JSON-RPC Invalid Request error, never a 500 or HTML page', async () => {
    const res = await POST(req({ id: 7, method: 'tools/list' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.error.code).toBe(-32600)
  })

  it('an unparseable JSON body returns a JSON-RPC error rather than throwing', async () => {
    const malformed = new NextRequest(new Request('https://builder.ainative.studio/mcp', {
      method: 'POST',
      body: 'not json at all',
    }))
    const res = await POST(malformed)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})
