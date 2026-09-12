import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * ZeroMemory integration (builder#674) — Builder previously called only the
 * flattest possible shape of /recall and /remember, missing real, already-
 * shipped capabilities: hybrid graph search (use_graph, Refs #3426, live-
 * verified by core 2026-09-10 for the Code Triggers feature) and entity
 * attribution (entity_id, which server-side auto-relates every entity
 * extracted from the memory's content to entity_id via /relate — real
 * Context Graph structure for free, no separate call needed on Builder's
 * side).
 *
 * recall stays intentionally UNSCOPED (no entity_id/namespace of its own) —
 * its whole purpose is cross-product learning from OTHER companies' past
 * builds. storeGenerationMemory now writes each generation into a real
 * `session:{chatId}` namespace instead of the implicit global pool (item 3
 * of #674's adoption gap), so recall explicitly sends
 * allow_cross_namespace: true to keep searching across every session's
 * memories rather than silently narrowing to just its own.
 */

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.AINATIVE_API_URL = 'https://api.test'
  vi.resetModules()
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('recallPastPerformance', () => {
  it('sends use_graph: true on every recall call', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ results: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { recallPastPerformance } = await import('@/lib/agent/zeromemory')
    await recallPastPerformance('build a CRM for florists')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/public/memory/v2/recall')
    const body = JSON.parse(String(init.body))
    expect(body.use_graph).toBe(true)
    expect(body.query).toBe('build a CRM for florists')
  })

  it('sends allow_cross_namespace: true on every recall call, so per-session-namespaced memories are still found', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ results: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { recallPastPerformance } = await import('@/lib/agent/zeromemory')
    await recallPastPerformance('build a CRM for florists')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.allow_cross_namespace).toBe(true)
  })

  it('never sends entity_id or a namespace of its own — recall must stay unscoped for cross-product learning', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ results: [] }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { recallPastPerformance } = await import('@/lib/agent/zeromemory')
    await recallPastPerformance('build a scheduling app')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.entity_id).toBeUndefined()
    expect(body.namespace).toBeUndefined()
  })

  it('still parses results from either data.results or data.memories (back-compat)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ results: [{ content: 'prior build used ZeroPipeline for CRM ideas' }] }),
    })))
    const { recallPastPerformance } = await import('@/lib/agent/zeromemory')
    const context = await recallPastPerformance('build a CRM')
    expect(context).toContain('prior build used ZeroPipeline')
  })

  it('returns empty string on a non-ok response, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: false })))
    const { recallPastPerformance } = await import('@/lib/agent/zeromemory')
    await expect(recallPastPerformance('anything')).resolves.toBe('')
  })

  it('returns empty string when no API key is configured, without calling fetch', async () => {
    // Both env vars getMemoryConfig() falls back through must be cleared —
    // a real ZERODB_API_KEY/AINATIVE_API_KEY may already be set in the real
    // shell environment this test runs in (this repo's own .env), so a
    // plain `delete` of one isn't enough to prove the true no-key path.
    process.env.ZERODB_API_KEY = ''
    process.env.AINATIVE_API_KEY = ''
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { recallPastPerformance } = await import('@/lib/agent/zeromemory')
    const result = await recallPastPerformance('anything')
    expect(result).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('storeGenerationMemory', () => {
  it('includes entity_id when a chatId is passed', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const { storeGenerationMemory } = await import('@/lib/agent/zeromemory')
    await storeGenerationMemory('build a florist CRM', true, 0.8, { source: 'test' }, 'chat-abc123')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/public/memory/v2/remember')
    const body = JSON.parse(String(init.body))
    expect(body.entity_id).toBe('chat-abc123')
  })

  it('namespaces the memory to session:{chatId} when a chatId is passed (#674 item 3)', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const { storeGenerationMemory } = await import('@/lib/agent/zeromemory')
    await storeGenerationMemory('build a florist CRM', true, 0.8, { source: 'test' }, 'chat-abc123')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.namespace).toBe('session:chat-abc123')
  })

  it('omits entity_id and namespace entirely when no chatId is passed (exact pre-existing behavior preserved)', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const { storeGenerationMemory } = await import('@/lib/agent/zeromemory')
    await storeGenerationMemory('build a florist CRM', true, 0.8, { source: 'test' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect('entity_id' in body).toBe(false)
    expect('namespace' in body).toBe(false)
  })

  it('never throws when the remember call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: string, _init?: RequestInit) => { throw new Error('network down') }))
    const { storeGenerationMemory } = await import('@/lib/agent/zeromemory')
    await expect(
      storeGenerationMemory('x', false, 0.1, undefined, 'chat-1'),
    ).resolves.toBeUndefined()
  })

  it('preserves existing metadata fields alongside entity_id', async () => {
    const fetchMock = vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const { storeGenerationMemory } = await import('@/lib/agent/zeromemory')
    await storeGenerationMemory('x', true, 0.9, { dbBacked: true, multiFile: false }, 'chat-2')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.metadata.dbBacked).toBe(true)
    expect(body.metadata.multiFile).toBe(false)
    expect(body.entity_id).toBe('chat-2')
    expect(body.namespace).toBe('session:chat-2')
  })
})
