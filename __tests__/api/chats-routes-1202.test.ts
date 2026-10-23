import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2, pass 4) — the three app/api/chats* route files
 * had zero route-level coverage: GET /api/chats (list), GET
 * /api/chats/[chatId] (detail, auth-gated + ownership check), and GET
 * /api/chats/[chatId]/code (extract code from stored chat content).
 *
 * All real I/O (auth, preview store, ZeroDB, chat-ownership DB lookup) is
 * mocked at the module boundary.
 */

const authMock = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: authMock.auth }))

const previewStore = vi.hoisted(() => ({
  getAllChats: vi.fn((): any[] => []),
  getPreview: vi.fn(),
  getChatDataDurable: vi.fn(),
}))
vi.mock('@/lib/preview-store', () => previewStore)

const zerodbStore = vi.hoisted(() => ({
  listGenerations: vi.fn().mockResolvedValue([]),
  loadGeneration: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/zerodb-store', () => zerodbStore)

const dbQueries = vi.hoisted(() => ({
  getChatOwnership: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/db/queries', () => dbQueries)

beforeEach(() => {
  vi.clearAllMocks()
  previewStore.getAllChats.mockReturnValue([])
  zerodbStore.listGenerations.mockResolvedValue([])
  zerodbStore.loadGeneration.mockResolvedValue(null)
  dbQueries.getChatOwnership.mockResolvedValue(null)
  authMock.auth.mockResolvedValue(null)
})

function params(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

describe('#1202 GET /api/chats', () => {
  it('returns in-memory chats when ZeroDB has nothing extra', async () => {
    previewStore.getAllChats.mockReturnValue([
      { id: 'c1', title: 'Chat One', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    const { GET } = await import('@/app/api/chats/route')

    const res = await GET({} as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([{ id: 'c1', title: 'Chat One', createdAt: '2026-01-01T00:00:00.000Z' }])
  })

  it('merges ZeroDB chats in, deduping by chat_id and keeping the oldest row', async () => {
    zerodbStore.listGenerations.mockResolvedValue([
      { chat_id: 'c2', prompt: 'Build an app for widgets', created_at: '2026-01-02T00:00:00.000Z' },
      { chat_id: 'c2', prompt: 'Build an app for widgets', created_at: '2026-01-01T00:00:00.000Z' },
      { chat_id: '', prompt: 'ignored, no chat_id' },
      { chat_id: 'c3', prompt: '' },
    ])
    const { GET } = await import('@/app/api/chats/route')

    const res = await GET({} as any)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: 'c2',
      createdAt: '2026-01-01T00:00:00.000Z',
      demo: '/preview/c2',
    })
    expect(body.data[0].title).toBe('app for widgets')
  })

  it('deduplicates across memory and ZeroDB chats sharing the same id', async () => {
    previewStore.getAllChats.mockReturnValue([{ id: 'shared', title: 'Memory version', createdAt: 'x' }])
    zerodbStore.listGenerations.mockResolvedValue([
      { chat_id: 'shared', prompt: 'zerodb version', created_at: 'y' },
    ])
    const { GET } = await import('@/app/api/chats/route')

    const res = await GET({} as any)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].title).toBe('Memory version')
  })

  it('falls back to memory-only chats when ZeroDB listGenerations throws', async () => {
    previewStore.getAllChats.mockReturnValue([{ id: 'm1', title: 'Still here', createdAt: 'x' }])
    zerodbStore.listGenerations.mockRejectedValue(new Error('zerodb down'))
    const { GET } = await import('@/app/api/chats/route')

    const res = await GET({} as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([{ id: 'm1', title: 'Still here', createdAt: 'x' }])
  })

  it('returns 500 when getAllChats itself throws', async () => {
    previewStore.getAllChats.mockImplementation(() => {
      throw new Error('store corrupted')
    })
    const { GET } = await import('@/app/api/chats/route')

    const res = await GET({} as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Failed to fetch chats' })
  })
})

describe('#1202 GET /api/chats/[chatId]', () => {
  it('returns 401 when there is no authenticated session', async () => {
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const res = await GET({} as any, params('c1'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when chatId is empty', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'u1' } })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const res = await GET({} as any, params(''))
    expect(res.status).toBe(400)
  })

  it('returns 403 when the chat is owned by a different user', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'u1' } })
    dbQueries.getChatOwnership.mockResolvedValue({ user_id: 'someone-else' })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const res = await GET({} as any, params('c1'))
    expect(res.status).toBe(403)
  })

  it('allows access when no ownership record exists (backward compat)', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'u1' } })
    dbQueries.getChatOwnership.mockResolvedValue(null)
    previewStore.getChatDataDurable.mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
    })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const res = await GET({} as any, params('c1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('c1')
    expect(body.demo).toBe('/preview/c1')
    expect(body.messages).toHaveLength(1)
  })

  it('returns 404 when no chat data is found', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'u1' } })
    previewStore.getChatDataDurable.mockResolvedValue(undefined)
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const res = await GET({} as any, params('missing'))
    expect(res.status).toBe(404)
  })

  it('returns 500 when an unexpected error is thrown', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'u1' } })
    previewStore.getChatDataDurable.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const res = await GET({} as any, params('c1'))
    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/chats/[chatId]/code', () => {
  it('returns 404 when no content exists in memory or ZeroDB', async () => {
    previewStore.getPreview.mockReturnValue(undefined)
    zerodbStore.loadGeneration.mockResolvedValue(null)
    const { GET } = await import('@/app/api/chats/[chatId]/code/route')
    const res = await GET({} as any, params('c1'))
    expect(res.status).toBe(404)
  })

  it('extracts code from a fenced markdown block', async () => {
    previewStore.getPreview.mockReturnValue('Some text\n```tsx\nconst x = 1\n```\nmore text')
    const { GET } = await import('@/app/api/chats/[chatId]/code/route')
    const res = await GET({} as any, params('c1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe('const x = 1')
    expect(body.language).toBe('jsx')
  })

  it('falls back to raw content when no code fence is present', async () => {
    previewStore.getPreview.mockReturnValue('  plain code, no fences  ')
    const { GET } = await import('@/app/api/chats/[chatId]/code/route')
    const res = await GET({} as any, params('c1'))

    const body = await res.json()
    expect(body.code).toBe('plain code, no fences')
  })

  it('falls back to the durable ZeroDB generation when memory has nothing', async () => {
    previewStore.getPreview.mockReturnValue(undefined)
    zerodbStore.loadGeneration.mockResolvedValue({ generatedCode: '```js\nconsole.log(1)\n```' })
    const { GET } = await import('@/app/api/chats/[chatId]/code/route')
    const res = await GET({} as any, params('c1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe('console.log(1)')
  })

  it('returns 404 when the ZeroDB fallback also fails', async () => {
    previewStore.getPreview.mockReturnValue(undefined)
    zerodbStore.loadGeneration.mockRejectedValue(new Error('zerodb unreachable'))
    const { GET } = await import('@/app/api/chats/[chatId]/code/route')
    const res = await GET({} as any, params('c1'))
    expect(res.status).toBe(404)
  })
})
