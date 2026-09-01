import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Refs core#6667 — mcp.ainative.studio (and strapi/prd-generator/gtm) 301'd
 * into builder's SPA, which had no route at all for /build/{server}/{path}
 * and fell through to a generic 404 HTML page. A real MCP client sending a
 * JSON-RPC POST got HTML back with no useful signal.
 *
 * hostedMcpNotImplemented() makes the failure honest: a JSON-RPC-shaped
 * error with a clear reason, not a silent success and not raw HTML.
 */

import { hostedMcpNotImplemented } from '@/lib/build/hosted-mcp-not-implemented'

function makeRequest(body?: unknown) {
  return new NextRequest('https://builder.ainative.studio/build/mcp/zerodb', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('hostedMcpNotImplemented', () => {
  it('returns HTTP 501, not a 2xx or a silent HTML page', async () => {
    const handler = hostedMcpNotImplemented('zerodb')
    const res = await handler(makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    expect(res.status).toBe(501)
  })

  it('returns a JSON-RPC-shaped error body, not HTML', async () => {
    const handler = hostedMcpNotImplemented('zerodb')
    const res = await handler(makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error).toBeDefined()
    expect(typeof body.error.message).toBe('string')
    expect(body.error.message).toContain('zerodb')
  })

  it('echoes back the request JSON-RPC id for correlation', async () => {
    const handler = hostedMcpNotImplemented('memory')
    const res = await handler(makeRequest({ jsonrpc: '2.0', id: 'req-42', method: 'tools/list' }))
    const body = await res.json()
    expect(body.id).toBe('req-42')
  })

  it('does not crash on a request with no JSON body (e.g. GET)', async () => {
    const handler = hostedMcpNotImplemented('strapi')
    const req = new NextRequest('https://builder.ainative.studio/build/strapi', {
      method: 'GET',
    })
    const res = await handler(req)
    expect(res.status).toBe(501)
    const body = await res.json()
    expect(body.id).toBeNull()
  })

  it('names the requested server in the error detail', async () => {
    const handler = hostedMcpNotImplemented('prd-generator')
    const res = await handler(makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const body = await res.json()
    expect(body.error.data.server).toBe('prd-generator')
  })
})
