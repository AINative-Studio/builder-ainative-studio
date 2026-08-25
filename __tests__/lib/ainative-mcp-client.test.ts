import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AiNativeMcpClient,
  connectMcpServer,
  McpFleet,
} from '@/lib/mcp/ainative-mcp-client'

/**
 * A hermetic mock of the MCP Streamable-HTTP transport. Each queued response maps
 * to one JSON-RPC method; the mock returns a Response-like object. NO real fetch /
 * MCP budget is used.
 */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; contentType?: string } = {}) {
  const headers = new Map<string, string>([['content-type', init.contentType ?? 'application/json']])
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: 'OK',
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

/** Build a fetch mock that answers by JSON-RPC method. */
function methodFetch(handlers: Record<string, () => Response>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body || '{}'))
    const method = parsed.method as string
    // Notifications have no id and expect no meaningful body.
    if (!('id' in parsed)) return jsonResponse('', { ok: true })
    const handler = handlers[method]
    if (!handler) return jsonResponse({ jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'Method not found' } })
    const res = handler()
    // Stamp the request id into result envelopes that don't set one.
    return res
  }) as unknown as typeof fetch
}

const BASE = { url: 'https://mcp.test/zerodb', apiKey: 'test_key', baseDelay: 1 }

describe('AiNativeMcpClient (#73)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is inert (not configured) when no url or key', () => {
    const noUrl = new AiNativeMcpClient({ apiKey: 'k' })
    expect(noUrl.isConfigured()).toBe(false)
    const noKey = new AiNativeMcpClient({ url: 'https://mcp.test/zerodb', apiKey: '' })
    expect(noKey.isConfigured()).toBe(false)
  })

  it('connect() returns false and never throws when unconfigured', async () => {
    const client = new AiNativeMcpClient({ apiKey: '' })
    await expect(client.connect()).resolves.toBe(false)
    expect(client.isConnected()).toBe(false)
  })

  it('connects via the initialize handshake', async () => {
    const fetchImpl = methodFetch({
      initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }),
    })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await expect(client.connect()).resolves.toBe(true)
    expect(client.isConnected()).toBe(true)
  })

  it('connect() returns false when the server rejects initialize', async () => {
    const fetchImpl = methodFetch({
      initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } }),
    })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await expect(client.connect()).resolves.toBe(false)
  })

  it('lists tools after connecting', async () => {
    const fetchImpl = methodFetch({
      initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      'tools/list': () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { tools: [{ name: 'zerodb_create_project' }, { name: 'zerodb_create_table' }] },
        }),
    })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await client.connect()
    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['zerodb_create_project', 'zerodb_create_table'])
  })

  it('listTools() returns [] when not connected', async () => {
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl: methodFetch({}) })
    expect(await client.listTools()).toEqual([])
  })

  it('calls a tool and returns its result', async () => {
    const fetchImpl = methodFetch({
      initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      'tools/call': () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: '{"project_id":"proj_123"}' }] },
        }),
    })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await client.connect()
    const res = await client.callTool('zerodb_create_project', { name: 'demo' })
    expect(res.isError).toBeFalsy()
    expect(res.content?.[0]?.text).toContain('proj_123')
  })

  it('callTool() surfaces a protocol error as isError (no throw)', async () => {
    const fetchImpl = methodFetch({
      initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      'tools/call': () => jsonResponse({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'boom' } }),
    })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await client.connect()
    const res = await client.callTool('zerodb_create_project')
    expect(res.isError).toBe(true)
    expect(res.content?.[0]?.text).toBe('boom')
  })

  it('callTool() returns isError when not connected', async () => {
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl: methodFetch({}) })
    const res = await client.callTool('x')
    expect(res.isError).toBe(true)
  })

  it('parses an SSE (text/event-stream) response body', async () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"t"}]}}\n\n'
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body || '{}'))
      if (parsed.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: 1, result: {} })
      if (!('id' in parsed)) return jsonResponse('', { ok: true })
      return jsonResponse(sse, { contentType: 'text/event-stream' })
    }) as unknown as typeof fetch
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await client.connect()
    const tools = await client.listTools()
    expect(tools[0]?.name).toBe('t')
  })

  it('retries transport failures with backoff then succeeds', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body || '{}'))
      if (parsed.method !== 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: parsed.id, result: {} })
      calls++
      if (calls < 2) return jsonResponse('err', { ok: false, status: 503 })
      return jsonResponse({ jsonrpc: '2.0', id: parsed.id, result: { tools: [] } })
    }) as unknown as typeof fetch
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl, maxRetries: 3 })
    await client.connect()
    const tools = await client.listTools()
    expect(tools).toEqual([])
    expect(calls).toBe(2)
  })

  it('captures a server session id from the response header', async () => {
    const withSession = () => {
      const base = jsonResponse({ jsonrpc: '2.0', id: 1, result: {} })
      ;(base.headers.get as unknown) = (k: string) =>
        k.toLowerCase() === 'mcp-session-id' ? 'sess-abc' : k.toLowerCase() === 'content-type' ? 'application/json' : null
      return base
    }
    const fetchImpl = methodFetch({ initialize: withSession })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await client.connect()
    expect(client.isConnected()).toBe(true)
  })

  it('disconnect() clears connected state', async () => {
    const fetchImpl = methodFetch({ initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }) })
    const client = new AiNativeMcpClient({ ...BASE, fetchImpl })
    await client.connect()
    await client.disconnect()
    expect(client.isConnected()).toBe(false)
  })
})

describe('connectMcpServer + McpFleet (#73)', () => {
  it('returns null for an unknown server id', async () => {
    expect(await connectMcpServer('bogus', { apiKey: 'k' })).toBeNull()
  })

  it('returns null for a stdio-transport server (HTTP client cannot connect)', async () => {
    expect(await connectMcpServer('gtm', { apiKey: 'k' })).toBeNull()
  })

  it('connects a known HTTP server by id', async () => {
    const fetchImpl = methodFetch({ initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }) })
    const client = await connectMcpServer('zerodb', { apiKey: 'k', baseDelay: 1, fetchImpl })
    expect(client).not.toBeNull()
    expect(client?.isConnected()).toBe(true)
  })

  it('McpFleet.use reuses a connected client and tracks connected()', async () => {
    const fetchImpl = methodFetch({ initialize: () => jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }) })
    const fleet = new McpFleet()
    const a = await fleet.use('zerodb', { apiKey: 'k', baseDelay: 1, fetchImpl })
    const b = await fleet.use('zerodb', { apiKey: 'k', baseDelay: 1, fetchImpl })
    expect(a).toBe(b) // reused
    expect(fleet.connected().length).toBe(1)
    await fleet.closeAll()
    expect(fleet.connected().length).toBe(0)
  })
})
