import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-poppy'
})

/**
 * #1842 — Poppy conversation storage + request deduplication.
 *
 * The fetch mock reflects ZeroDB's REAL behavior, matching the same honest
 * mock already used by __tests__/lib/build/anon-drafts.test.ts: `POST .../rows`
 * is a pure INSERT, never an upsert, so these tests exercise the real
 * append-only / latest-wins read path rather than a fabricated server-side
 * update. No real network calls are made.
 */
function mockZeroDb() {
  const tables = new Map<string, Array<{ row_id: string; row_data: Record<string, unknown> }>>()
  let nextId = 0

  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const ok = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response

    // Create table
    if (init?.method === 'POST' && u.endsWith('/database/tables')) return ok({})

    const match = u.match(/\/database\/tables\/([^/?]+)\/rows/)
    if (match) {
      const table = match[1]
      if (!tables.has(table)) tables.set(table, [])
      const rows = tables.get(table)!
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        rows.push({ row_id: `row-${nextId++}`, row_data: body.row_data })
        return ok({})
      }
      return ok(rows)
    }
    return ok({})
  })

  vi.stubGlobal('fetch', fn)
  return { tables, fn }
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('conversation storage (#1842)', () => {
  it('creates a conversation and loads it back by id', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const created = await mod.createConversation({
      clientId: 'https://agent.example/c',
      userId: 'u1',
      events: [{ id: 'evt_1', timestamp: new Date().toISOString(), type: 'message', message: { author: { type: 'agent' }, text: 'hi' } }],
    })
    expect(created).not.toBeNull()
    expect(created!.conversationId).toMatch(/^cnv_/)
    expect(created!.status).toBe('open')

    const loaded = await mod.loadConversation(created!.conversationId)
    expect(loaded?.events).toHaveLength(1)
  })

  it('enforces real ownership: another (client_id, user_id) sees nothing', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const created = await mod.createConversation({
      clientId: 'https://agent-a.example/c',
      userId: 'u1',
      events: [],
    })
    const id = created!.conversationId

    // Right owner → found
    expect(await mod.loadConversation(id, { clientId: 'https://agent-a.example/c', userId: 'u1' })).not.toBeNull()
    // Different user of the same agent → not found
    expect(await mod.loadConversation(id, { clientId: 'https://agent-a.example/c', userId: 'u2' })).toBeNull()
    // Different agent, same user id → not found
    expect(await mod.loadConversation(id, { clientId: 'https://agent-b.example/c', userId: 'u1' })).toBeNull()
  })

  it('returns null for an unknown conversation id, never throws', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    expect(await mod.loadConversation('cnv_nope')).toBeNull()
  })

  it('appends events with latest-wins reads over append-only storage', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const created = await mod.createConversation({ clientId: 'c', userId: 'u', events: [] })
    await new Promise((r) => setTimeout(r, 2))
    await mod.appendEvents(created!, [
      { id: 'evt_a', timestamp: new Date().toISOString(), type: 'message', message: { author: { type: 'agent' }, text: 'q' } },
    ])
    const loaded = await mod.loadConversation(created!.conversationId)
    expect(loaded?.events.map((e) => e.id)).toEqual(['evt_a'])
  })

  it('appendEvents can transition status to closed and needs_human', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const created = await mod.createConversation({ clientId: 'c', userId: 'u', events: [] })
    await new Promise((r) => setTimeout(r, 2))
    const flagged = await mod.appendEvents(created!, [], 'needs_human')
    expect(flagged!.status).toBe('needs_human')
    await new Promise((r) => setTimeout(r, 2))
    const closed = await mod.appendEvents(flagged!, [], 'closed')
    expect(closed!.status).toBe('closed')
    expect((await mod.loadConversation(created!.conversationId))?.status).toBe('closed')
  })

  it('generates distinct, prefixed ids', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const ids = new Set(Array.from({ length: 50 }, () => mod.newConversationId()))
    expect(ids.size).toBe(50)
    expect(mod.newEventId()).toMatch(/^evt_/)
  })

  it('reports storage unconfigured instead of pretending to persist', async () => {
    vi.stubEnv('ZERODB_API_KEY', '')
    vi.stubEnv('AINATIVE_API_KEY', '')
    vi.stubEnv('API_Key', '')
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    expect(mod.isPoppyStorageConfigured()).toBe(false)
    expect(await mod.createConversation({ clientId: 'c', userId: 'u', events: [] })).toBeNull()
    vi.unstubAllEnvs()
  })

  it('survives a ZeroDB read failure by returning null, never throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'err', json: async () => ({}) }) as unknown as Response))
    const mod = await import('@/lib/poppy/conversations')
    expect(await mod.loadConversation('cnv_x')).toBeNull()
  })
})

describe('request deduplication — spec section 4 (#1842)', () => {
  const base = { clientId: 'https://agent.example/c', userId: 'u1', path: '/poppy/conversations' }

  it('a first-time request id is new', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const outcome = await mod.checkRequest({ ...base, requestId: 'msg_1', bodyHash: mod.hashBody('{"a":1}') })
    expect(outcome.kind).toBe('new')
  })

  it('REPLAYS the original response for an identical retry — does not reprocess', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const bodyHash = mod.hashBody('{"id":"msg_1"}')
    await mod.recordRequest({
      ...base,
      requestId: 'msg_1',
      bodyHash,
      responseStatus: 201,
      responseBody: { conversation_id: 'cnv_original' },
    })

    const outcome = await mod.checkRequest({ ...base, requestId: 'msg_1', bodyHash })
    expect(outcome.kind).toBe('replay')
    if (outcome.kind !== 'replay') return
    // The ORIGINAL conversation_id comes back, not a newly created one.
    expect(outcome.status).toBe(201)
    expect(outcome.body).toEqual({ conversation_id: 'cnv_original' })
  })

  it('returns conflict for the same id with a DIFFERENT body', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    await mod.recordRequest({
      ...base,
      requestId: 'msg_1',
      bodyHash: mod.hashBody('{"text":"first"}'),
      responseStatus: 201,
      responseBody: { conversation_id: 'cnv_1' },
    })
    const outcome = await mod.checkRequest({
      ...base,
      requestId: 'msg_1',
      bodyHash: mod.hashBody('{"text":"DIFFERENT"}'),
    })
    expect(outcome.kind).toBe('conflict')
  })

  it('returns conflict for the same id replayed at a DIFFERENT path', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const bodyHash = mod.hashBody('{"id":"msg_1"}')
    await mod.recordRequest({
      ...base,
      requestId: 'msg_1',
      bodyHash,
      responseStatus: 201,
      responseBody: { conversation_id: 'cnv_1' },
    })
    const outcome = await mod.checkRequest({
      ...base,
      path: '/poppy/conversations/cnv_1/close',
      requestId: 'msg_1',
      bodyHash,
    })
    expect(outcome.kind).toBe('conflict')
  })

  it('scopes ids per (client_id, user_id): two agents may reuse the same id', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    const bodyHash = mod.hashBody('{"id":"msg_1"}')
    await mod.recordRequest({
      ...base,
      requestId: 'msg_1',
      bodyHash,
      responseStatus: 201,
      responseBody: { conversation_id: 'cnv_a' },
    })
    // Same request id, different user → must NOT collide.
    expect(
      (await mod.checkRequest({ ...base, userId: 'u2', requestId: 'msg_1', bodyHash })).kind,
    ).toBe('new')
    // Same request id, different Personal Agent → must NOT collide.
    expect(
      (await mod.checkRequest({ ...base, clientId: 'https://other.example/c', requestId: 'msg_1', bodyHash })).kind,
    ).toBe('new')
  })

  it('hashBody is stable and body-sensitive', async () => {
    mockZeroDb()
    const mod = await import('@/lib/poppy/conversations')
    expect(mod.hashBody('{"a":1}')).toBe(mod.hashBody('{"a":1}'))
    expect(mod.hashBody('{"a":1}')).not.toBe(mod.hashBody('{"a":2}'))
  })
})
