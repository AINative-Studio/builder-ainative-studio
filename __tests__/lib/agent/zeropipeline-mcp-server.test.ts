/**
 * ZeroPipeline MCP server (builder#555) — unit tests for the tool-handler
 * logic. Mocks the HTTP layer (global fetch) and asserts real request shapes
 * (method, URL, headers, query params, body) and real response parsing for
 * the prioritized 13-tool core CRM subset.
 *
 * A real, live process handshake (spawn the server, real MCP initialize +
 * tools/list + tools/call over stdio, including one real network round trip
 * to the live https://pipeline.ainative.studio/api/v1 that got back a real
 * HTTP 401) was also run manually during development — see the PR description
 * for the transcript. These tests cover the handler logic in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOLS, getConfig } from '@/lib/agent/mcp-servers/zeropipeline-mcp-server.mjs'

function toolByName(name: string) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('zeropipeline-mcp-server', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    process.env.ZEROPIPELINE_API_KEY = 'zp-test-key'
    delete process.env.ZEROPIPELINE_API_BASE_URL
    delete process.env.ZEROPIPELINE_AGENT_NAME
    delete process.env.ZEROPIPELINE_AGENT_TYPE
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.ZEROPIPELINE_API_KEY
    delete process.env.ZEROPIPELINE_API_BASE_URL
    delete process.env.ZEROPIPELINE_AGENT_NAME
    delete process.env.ZEROPIPELINE_AGENT_TYPE
    vi.restoreAllMocks()
  })

  describe('getConfig', () => {
    it('reads the API key and default base URL from env', () => {
      const { apiKey, baseUrl } = getConfig()
      expect(apiKey).toBe('zp-test-key')
      expect(baseUrl).toBe('https://pipeline.ainative.studio/api/v1')
    })

    it('honors ZEROPIPELINE_API_BASE_URL override, stripping trailing slashes', () => {
      process.env.ZEROPIPELINE_API_BASE_URL = 'https://staging.pipeline.example.com/api/v1/'
      const { baseUrl } = getConfig()
      expect(baseUrl).toBe('https://staging.pipeline.example.com/api/v1')
    })

    it('returns an empty apiKey when unset (never throws)', () => {
      delete process.env.ZEROPIPELINE_API_KEY
      expect(getConfig().apiKey).toBe('')
    })
  })

  describe('missing API key — fails closed, never throws', () => {
    it('list_pipelines returns a structured error without calling fetch', async () => {
      delete process.env.ZEROPIPELINE_API_KEY
      const result = await toolByName('list_pipelines').handler({})
      expect(global.fetch).not.toHaveBeenCalled()
      expect(result.error).toBe(true)
      expect(result.message).toMatch(/ZEROPIPELINE_API_KEY/)
    })

    it('create_deal returns a structured error without calling fetch', async () => {
      delete process.env.ZEROPIPELINE_API_KEY
      const result = await toolByName('create_deal').handler({ name: 'D', pipeline_id: 'p', stage_id: 's' })
      expect(global.fetch).not.toHaveBeenCalled()
      expect(result.error).toBe(true)
    })
  })

  describe('list_pipelines', () => {
    it('issues a GET to /pipelines with default pagination and bearer auth', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      const result = await toolByName('list_pipelines').handler({})
      expect(result).toEqual({ items: [] })

      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      const u = new URL(url as string)
      expect(u.origin + u.pathname).toBe('https://pipeline.ainative.studio/api/v1/pipelines')
      expect(u.searchParams.get('limit')).toBe('25')
      expect(u.searchParams.get('offset')).toBe('0')
      expect((init as RequestInit).method).toBe('GET')
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer zp-test-key',
        'Content-Type': 'application/json',
      })
    })

    it('honors explicit limit/offset', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_pipelines').handler({ limit: 10, offset: 20 })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.searchParams.get('limit')).toBe('10')
      expect(u.searchParams.get('offset')).toBe('20')
    })

    it('sends X-Agent-Name/X-Agent-Type headers when configured', async () => {
      process.env.ZEROPIPELINE_AGENT_NAME = 'cody'
      process.env.ZEROPIPELINE_AGENT_TYPE = 'coding-agent'
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_pipelines').handler({})
      const init = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit
      expect(init.headers).toMatchObject({ 'X-Agent-Name': 'cody', 'X-Agent-Type': 'coding-agent' })
    })
  })

  describe('get_pipeline', () => {
    it('issues a GET to /pipelines/:id', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'pipe-1', stages: [] }))
      const result = await toolByName('get_pipeline').handler({ pipeline_id: 'pipe-1' })
      expect(result).toEqual({ id: 'pipe-1', stages: [] })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.pathname).toBe('/api/v1/pipelines/pipe-1')
    })

    it('URL-encodes the pipeline id', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}))
      await toolByName('get_pipeline').handler({ pipeline_id: 'a b/c' })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.pathname).toBe('/api/v1/pipelines/a%20b%2Fc')
    })
  })

  describe('list_deals', () => {
    it('applies filters and maps query -> q', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_deals').handler({
        pipeline_id: 'p1',
        stage_id: 's1',
        status: 'open',
        customer_id: 'c1',
        query: 'acme',
        limit: 5,
        offset: 0,
      })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.pathname).toBe('/api/v1/deals')
      expect(u.searchParams.get('pipeline_id')).toBe('p1')
      expect(u.searchParams.get('stage_id')).toBe('s1')
      expect(u.searchParams.get('status')).toBe('open')
      expect(u.searchParams.get('customer_id')).toBe('c1')
      expect(u.searchParams.get('q')).toBe('acme')
      expect(u.searchParams.has('query')).toBe(false)
    })

    it('omits undefined filters entirely (never sends "undefined")', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_deals').handler({})
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.searchParams.has('pipeline_id')).toBe(false)
      expect(u.searchParams.has('status')).toBe(false)
    })
  })

  describe('create_deal', () => {
    it('POSTs to /deals with required fields + default currency', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'd1' }, 201))
      const result = await toolByName('create_deal').handler({
        name: 'Big Deal',
        pipeline_id: 'p1',
        stage_id: 's1',
      })
      expect(result).toEqual({ id: 'd1' })
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(new URL(url as string).pathname).toBe('/api/v1/deals')
      expect((init as RequestInit).method).toBe('POST')
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toEqual({ name: 'Big Deal', pipeline_id: 'p1', stage_id: 's1', currency: 'USD' })
    })

    it('includes optional value/customer_id/currency when provided', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'd1' }, 201))
      await toolByName('create_deal').handler({
        name: 'Big Deal',
        pipeline_id: 'p1',
        stage_id: 's1',
        value: 5000,
        customer_id: 'c1',
        currency: 'EUR',
      })
      const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(body).toEqual({
        name: 'Big Deal',
        pipeline_id: 'p1',
        stage_id: 's1',
        currency: 'EUR',
        value: 5000,
        customer_id: 'c1',
      })
    })
  })

  describe('update_deal', () => {
    it('PATCHes only the provided fields', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'd1', status: 'won' }))
      const result = await toolByName('update_deal').handler({ deal_id: 'd1', status: 'won' })
      expect(result).toEqual({ id: 'd1', status: 'won' })
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(new URL(url as string).pathname).toBe('/api/v1/deals/d1')
      expect((init as RequestInit).method).toBe('PATCH')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: 'won' })
    })

    it('returns a structured error and does not call fetch when no fields are given', async () => {
      const result = await toolByName('update_deal').handler({ deal_id: 'd1' })
      expect(global.fetch).not.toHaveBeenCalled()
      expect(result.error).toBe(true)
      expect(result.message).toMatch(/at least one field/)
    })
  })

  describe('move_deal_stage', () => {
    it('PATCHes stage_id only', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'd1', stage_id: 's2' }))
      await toolByName('move_deal_stage').handler({ deal_id: 'd1', stage_id: 's2' })
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(new URL(url as string).pathname).toBe('/api/v1/deals/d1')
      expect((init as RequestInit).method).toBe('PATCH')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ stage_id: 's2' })
    })
  })

  describe('get_deal_score', () => {
    it('GETs /deals/:id/score', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ deal_id: 'd1', score: 72 }))
      const result = await toolByName('get_deal_score').handler({ deal_id: 'd1' })
      expect(result).toEqual({ deal_id: 'd1', score: 72 })
      expect(new URL(vi.mocked(global.fetch).mock.calls[0][0] as string).pathname).toBe('/api/v1/deals/d1/score')
    })
  })

  describe('list_customers', () => {
    it('maps limit -> page_size and defaults page to 1', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_customers').handler({ limit: 50 })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.pathname).toBe('/api/v1/customers')
      expect(u.searchParams.get('page_size')).toBe('50')
      expect(u.searchParams.get('page')).toBe('1')
    })

    it('passes through status/source/tags filters', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_customers').handler({ status: 'active', source: 'vc_import', tags: 'investor,vc' })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.searchParams.get('status')).toBe('active')
      expect(u.searchParams.get('source')).toBe('vc_import')
      expect(u.searchParams.get('tags')).toBe('investor,vc')
    })
  })

  describe('create_customer', () => {
    it('POSTs to /customers with only name required', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'c1' }, 201))
      const result = await toolByName('create_customer').handler({ name: 'Jane Doe' })
      expect(result).toEqual({ id: 'c1' })
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(new URL(url as string).pathname).toBe('/api/v1/customers')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'Jane Doe' })
    })

    it('includes all optional fields (email, tags array, meta object) when provided', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'c1' }, 201))
      await toolByName('create_customer').handler({
        name: 'Jane Doe',
        email: 'jane@example.com',
        tags: ['investor', 'vc'],
        meta: { website: 'https://example.com' },
      })
      const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(body).toEqual({
        name: 'Jane Doe',
        email: 'jane@example.com',
        tags: ['investor', 'vc'],
        meta: { website: 'https://example.com' },
      })
    })
  })

  describe('list_activities', () => {
    it('derives related_to_id/related_to_type from customer_id when related_to_id is absent', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_activities').handler({ customer_id: 'c1' })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.searchParams.get('related_to_id')).toBe('c1')
      expect(u.searchParams.get('related_to_type')).toBe('customer')
    })

    it('prefers an explicit related_to_id over customer_id', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_activities').handler({ related_to_id: 'deal-1', related_to_type: 'deal', customer_id: 'c1' })
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.searchParams.get('related_to_id')).toBe('deal-1')
      expect(u.searchParams.get('related_to_type')).toBe('deal')
    })

    it('defaults limit to 50', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_activities').handler({})
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.searchParams.get('limit')).toBe('50')
    })
  })

  describe('log_activity', () => {
    it('POSTs required fields to /activities', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'a1' }, 201))
      const result = await toolByName('log_activity').handler({
        activity_type: 'call',
        related_to_type: 'deal',
        related_to_id: 'd1',
      })
      expect(result).toEqual({ id: 'a1' })
      const [url, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(new URL(url as string).pathname).toBe('/api/v1/activities')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        activity_type: 'call',
        related_to_type: 'deal',
        related_to_id: 'd1',
      })
    })
  })

  describe('list_tasks', () => {
    it('GETs /tasks with default limit', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }))
      await toolByName('list_tasks').handler({})
      const u = new URL(vi.mocked(global.fetch).mock.calls[0][0] as string)
      expect(u.pathname).toBe('/api/v1/tasks')
      expect(u.searchParams.get('limit')).toBe('25')
    })
  })

  describe('create_task', () => {
    it('POSTs to /tasks with only title required', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 't1' }, 201))
      const result = await toolByName('create_task').handler({ title: 'Follow up' })
      expect(result).toEqual({ id: 't1' })
      const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
      expect(body).toEqual({ title: 'Follow up' })
    })
  })

  describe('error handling', () => {
    it('surfaces a structured error on a non-2xx JSON response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: 'Could not validate credentials' }, 401))
      const result = await toolByName('list_pipelines').handler({})
      expect(result).toEqual({ error: true, status: 401, message: 'Could not validate credentials' })
    })

    it('surfaces a network error without throwing', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))
      const result = await toolByName('list_pipelines').handler({})
      expect(result.error).toBe(true)
      expect(result.message).toMatch(/Network error/)
    })

    it('handles a non-JSON error body gracefully', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response)
      const result = await toolByName('list_pipelines').handler({})
      expect(result.error).toBe(true)
      expect(result.status).toBe(500)
    })
  })

  describe('tool inventory', () => {
    it('exposes exactly the 13 prioritized core CRM tools', () => {
      const names = TOOLS.map((t: { name: string }) => t.name).sort()
      expect(names).toEqual(
        [
          'list_pipelines',
          'get_pipeline',
          'list_deals',
          'create_deal',
          'update_deal',
          'move_deal_stage',
          'get_deal_score',
          'list_customers',
          'create_customer',
          'list_activities',
          'log_activity',
          'list_tasks',
          'create_task',
        ].sort(),
      )
    })

    it('every tool has a name, description, and inputSchema', () => {
      for (const tool of TOOLS as Array<{ name: string; description: string; inputSchema: unknown }>) {
        expect(tool.name).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.inputSchema).toMatchObject({ type: 'object' })
      }
    })
  })
})
