/**
 * Route-level coverage for two small, previously-untested (0%) routes
 * (#1202 — Coverage Phase 2, fifth pass):
 *
 *  - app/api/chat-llama/route.ts — the LLAMA-backed streaming chat
 *    endpoint (separate from the main chat-ws provider-routing path).
 *  - app/api/chats/[chatId]/route.ts — fetch a single chat's stored
 *    messages/demo URL, gated on session auth + ownership.
 *
 * Both are small, self-contained handlers with no module-scope client
 * construction, so they're imported and executed directly (no source-text
 * assertions needed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockJsonRequest, mockGetRequest, mockMalformedJsonRequest, mockParams, readJson } from '../helpers/api-route-harness'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getChatCountByIP: vi.fn(),
  createAnonymousChatLog: vi.fn(),
  getChatOwnership: vi.fn(),
  createChatOwnership: vi.fn(),
  streamText: vi.fn(),
  getPreview: vi.fn(),
  getChatDataDurable: vi.fn(),
  getFilesV2: vi.fn(),
  loadGeneration: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('ai', () => ({ streamText: h.streamText }))
vi.mock('@/lib/llama-provider', () => ({ llamaModel: 'mock-llama-model' }))
vi.mock('@/lib/db/queries', () => ({
  getChatCountByIP: h.getChatCountByIP,
  createAnonymousChatLog: h.createAnonymousChatLog,
  getChatOwnership: h.getChatOwnership,
  createChatOwnership: h.createChatOwnership,
}))
vi.mock('@/lib/entitlements', () => ({
  anonymousEntitlements: { maxMessagesPerDay: 10 },
}))
vi.mock('@/lib/preview-store', () => ({
  getPreview: h.getPreview,
  getChatDataDurable: h.getChatDataDurable,
}))
vi.mock('@/lib/preview-store-v2', () => ({
  getFiles: h.getFilesV2,
}))
vi.mock('@/lib/zerodb-store', () => ({
  loadGeneration: h.loadGeneration,
}))
vi.mock('@/lib/auth/session', () => ({
  getSession: h.getSession,
}))

describe('POST /api/chat-llama (#1202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.auth.mockResolvedValue(null)
    h.getChatCountByIP.mockResolvedValue(0)
    h.streamText.mockReturnValue({
      textStream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('hello from llama'))
          controller.close()
        },
      }),
    })
  })

  it('rejects a request with no message with a ChatSDKError bad_request response', async () => {
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', {})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns a 400-shaped error response when the body is malformed JSON', async () => {
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockMalformedJsonRequest('http://localhost/api/chat-llama')
    const res = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('streams a successful LLAMA response for an anonymous (unauthenticated) request, checking the IP rate-limit path', async () => {
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', { message: 'Build me a button' }, {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(h.getChatCountByIP).toHaveBeenCalledWith({ ipAddress: '203.0.113.5', differenceInHours: 24 })
    expect(h.streamText).toHaveBeenCalledWith(expect.objectContaining({ model: 'mock-llama-model' }))
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', { message: 'hi' }, {
      headers: { 'x-real-ip': '198.51.100.9' },
    })
    await POST(req)
    expect(h.getChatCountByIP).toHaveBeenCalledWith({ ipAddress: '198.51.100.9', differenceInHours: 24 })
  })

  it('falls back to the loopback address when neither IP header is present', async () => {
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', { message: 'hi' })
    await POST(req)
    expect(h.getChatCountByIP).toHaveBeenCalledWith({ ipAddress: '::1', differenceInHours: 24 })
  })

  it('skips the anonymous rate-limit check entirely for an authenticated session', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-42' } })
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', { message: 'hi, logged in' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(h.getChatCountByIP).not.toHaveBeenCalled()
  })

  it('returns a ChatSDKError response when streamText throws a real Error', async () => {
    h.streamText.mockImplementation(() => { throw new Error('llama upstream unavailable') })
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', { message: 'trigger a failure' })
    const res = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = await readJson(res)
    expect(body.code).toContain('bad_request')
  })

  it('returns a ChatSDKError response when something non-Error is thrown', async () => {
    h.streamText.mockImplementation(() => { throw 'a plain string failure' })
    const { POST } = await import('@/app/api/chat-llama/route')
    const req = mockJsonRequest('http://localhost/api/chat-llama', { message: 'trigger a non-Error throw' })
    const res = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/chats/[chatId] (#1202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires authentication: 401 when there is no session', async () => {
    h.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/abc123')
    const res = await GET(req, mockParams({ chatId: 'abc123' }))
    expect(res.status).toBe(401)
  })

  it('requires a non-empty chatId: 400 when it is blank', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/')
    const res = await GET(req, mockParams({ chatId: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 403 when a real ownership record belongs to a different user', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.getChatOwnership.mockResolvedValue({ user_id: 'someone-else' })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/chat-1')
    const res = await GET(req, mockParams({ chatId: 'chat-1' }))
    expect(res.status).toBe(403)
  })

  it('allows access when no ownership record exists (backward compat) and returns the stored chat data', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.getChatOwnership.mockResolvedValue(null)
    h.getChatDataDurable.mockResolvedValue({
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/chat-1')
    const res = await GET(req, mockParams({ chatId: 'chat-1' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.id).toBe('chat-1')
    expect(body.demo).toBe('/preview/chat-1')
    expect(body.latestVersion.demoUrl).toBe('/api/preview/chat-1')
    expect(body.messages).toHaveLength(2)
  })

  it('allows access when the ownership record belongs to the same user', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.getChatOwnership.mockResolvedValue({ user_id: 'user-1' })
    h.getChatDataDurable.mockResolvedValue({ messages: [] })
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/chat-1')
    const res = await GET(req, mockParams({ chatId: 'chat-1' }))
    expect(res.status).toBe(200)
  })

  it('returns 404 when no chat data is found for a known-ok chatId', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.getChatOwnership.mockResolvedValue(null)
    h.getChatDataDurable.mockResolvedValue(undefined)
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/missing-chat')
    const res = await GET(req, mockParams({ chatId: 'missing-chat' }))
    expect(res.status).toBe(404)
    const body = await readJson(res)
    expect(body.error).toBe('Chat not found')
  })

  it('returns a 500 when an unexpected exception is thrown (e.g. durable store read fails)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.getChatOwnership.mockRejectedValue(new Error('zerodb unavailable'))
    const { GET } = await import('@/app/api/chats/[chatId]/route')
    const req = mockGetRequest('http://localhost/api/chats/chat-1')
    const res = await GET(req, mockParams({ chatId: 'chat-1' }))
    expect(res.status).toBe(500)
    const body = await readJson(res)
    expect(body.error).toBe('Failed to retrieve chat details')
  })
})

describe('POST /api/chat/ownership (#1202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires a chatId: 400 when missing', async () => {
    h.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/chat/ownership/route')
    const req = mockJsonRequest('http://localhost/api/chat/ownership', {})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('creates a real ownership mapping for an authenticated session', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-7' } })
    const { POST } = await import('@/app/api/chat/ownership/route')
    const req = mockJsonRequest('http://localhost/api/chat/ownership', { chatId: 'chat-99' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(h.createChatOwnership).toHaveBeenCalledWith({ chatId: 'chat-99', userId: 'user-7' })
    expect(h.createAnonymousChatLog).not.toHaveBeenCalled()
  })

  it('logs an anonymous chat by IP when there is no session', async () => {
    h.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/chat/ownership/route')
    const req = mockJsonRequest('http://localhost/api/chat/ownership', { chatId: 'chat-anon' }, {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(h.createAnonymousChatLog).toHaveBeenCalledWith({ ipAddress: '203.0.113.9', chatId: 'chat-anon' })
    expect(h.createChatOwnership).not.toHaveBeenCalled()
  })

  it('falls back to x-real-ip, then "unknown", when resolving the anonymous client IP', async () => {
    h.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/chat/ownership/route')
    const req1 = mockJsonRequest('http://localhost/api/chat/ownership', { chatId: 'chat-a' }, {
      headers: { 'x-real-ip': '198.51.100.3' },
    })
    await POST(req1)
    expect(h.createAnonymousChatLog).toHaveBeenCalledWith({ ipAddress: '198.51.100.3', chatId: 'chat-a' })

    const req2 = mockJsonRequest('http://localhost/api/chat/ownership', { chatId: 'chat-b' })
    await POST(req2)
    expect(h.createAnonymousChatLog).toHaveBeenCalledWith({ ipAddress: 'unknown', chatId: 'chat-b' })
  })

  it('returns a 500 when the ownership write throws', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.createChatOwnership.mockRejectedValue(new Error('zerodb write failed'))
    const { POST } = await import('@/app/api/chat/ownership/route')
    const req = mockJsonRequest('http://localhost/api/chat/ownership', { chatId: 'chat-1' })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await readJson(res)
    expect(body.error).toBe('Failed to create ownership record')
  })
})

describe('GET /api/generation/[id]/files (#1202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when the id resolves to an empty chatId', async () => {
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest('http://localhost/api/generation//files')
    const res = await GET(req, mockParams({ id: '' }))
    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.files).toBeNull()
  })

  it('serves the in-memory V2 store map when present (fast path)', async () => {
    h.getFilesV2.mockReturnValue({ 'src/App.tsx': 'export default function App(){}' })
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest('http://localhost/api/generation/chat-1/files')
    const res = await GET(req, mockParams({ id: 'chat-1' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.source).toBe('memory')
    expect(body.files['src/App.tsx']).toContain('export default')
    expect(h.loadGeneration).not.toHaveBeenCalled()
  })

  it('falls back to the durable ZeroDB copy when the in-memory store misses', async () => {
    h.getFilesV2.mockReturnValue(null)
    h.loadGeneration.mockResolvedValue({ files: { 'src/App.tsx': 'durable content' } })
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest('http://localhost/api/generation/chat-2/files')
    const res = await GET(req, mockParams({ id: 'chat-2' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.source).toBe('durable')
  })

  it('returns 404 with files:null when neither store has a map (e.g. a single-file app)', async () => {
    h.getFilesV2.mockReturnValue(null)
    h.loadGeneration.mockResolvedValue({ files: null })
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest('http://localhost/api/generation/chat-3/files')
    const res = await GET(req, mockParams({ id: 'chat-3' }))
    expect(res.status).toBe(404)
    const body = await readJson(res)
    expect(body.files).toBeNull()
  })

  it('swallows an in-memory store throw and still checks the durable store', async () => {
    h.getFilesV2.mockImplementation(() => { throw new Error('in-memory store corrupted') })
    h.loadGeneration.mockResolvedValue({ files: { 'src/App.tsx': 'recovered' } })
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest('http://localhost/api/generation/chat-4/files')
    const res = await GET(req, mockParams({ id: 'chat-4' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.source).toBe('durable')
  })

  it('swallows a durable store throw and reports 404 instead of 500', async () => {
    h.getFilesV2.mockReturnValue(null)
    h.loadGeneration.mockRejectedValue(new Error('zerodb unavailable'))
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest('http://localhost/api/generation/chat-5/files')
    const res = await GET(req, mockParams({ id: 'chat-5' }))
    expect(res.status).toBe(404)
  })

  it('truncates an overlong id to 64 characters before using it as a chatId', async () => {
    h.getFilesV2.mockReturnValue(null)
    h.loadGeneration.mockResolvedValue({ files: null })
    const longId = 'x'.repeat(100)
    const { GET } = await import('@/app/api/generation/[id]/files/route')
    const req = mockGetRequest(`http://localhost/api/generation/${longId}/files`)
    await GET(req, mockParams({ id: longId }))
    expect(h.getFilesV2).toHaveBeenCalledWith(longId.slice(0, 64))
  })
})

describe('POST /api/credentials/[id]/test (#1202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires a credential id: 400 when missing', async () => {
    h.getSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/credentials/[id]/test/route')
    const req = mockJsonRequest('http://localhost/api/credentials//test', {})
    const res = await POST(req, mockParams({ id: '' }))
    expect(res.status).toBe(400)
  })

  it('reports a successful connection test for a real credential id', async () => {
    h.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    const { POST } = await import('@/app/api/credentials/[id]/test/route')
    const req = mockJsonRequest('http://localhost/api/credentials/cred-1/test', {})
    const res = await POST(req, mockParams({ id: 'cred-1' }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.valid).toBe(true)
  })

  it('returns a 500 failure shape when session resolution throws', async () => {
    h.getSession.mockRejectedValue(new Error('session service down'))
    const { POST } = await import('@/app/api/credentials/[id]/test/route')
    const req = mockJsonRequest('http://localhost/api/credentials/cred-1/test', {})
    const res = await POST(req, mockParams({ id: 'cred-1' }))
    expect(res.status).toBe(500)
    const body = await readJson(res)
    expect(body.valid).toBe(false)
    expect(body.error).toBe('session service down')
  })
})

describe('GET /api/a2ui (#1202)', () => {
  it('returns 426 Upgrade Required with WebSocket instructions for a real upgrade request', async () => {
    const { GET } = await import('@/app/api/a2ui/route')
    const req = mockGetRequest('http://localhost/api/a2ui?chatId=chat-1', {
      headers: { upgrade: 'websocket' },
    })
    const res = await GET(req)
    expect(res.status).toBe(426)
    expect(res.headers.get('Upgrade')).toBe('websocket')
    const body = await readJson(res)
    expect(body.error).toContain('WebSocket upgrade not supported')
  })

  it('treats the upgrade header case-insensitively', async () => {
    const { GET } = await import('@/app/api/a2ui/route')
    const req = mockGetRequest('http://localhost/api/a2ui', {
      headers: { upgrade: 'WebSocket' },
    })
    const res = await GET(req)
    expect(res.status).toBe(426)
  })

  it('returns API info JSON (not a WebSocket response) for a plain GET with a chatId', async () => {
    const { GET } = await import('@/app/api/a2ui/route')
    const req = mockGetRequest('http://localhost/api/a2ui?chatId=chat-42')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.name).toBe('A2UI WebSocket API')
    expect(body.chatId).toBe('chat-42')
  })

  it("reports chatId as 'not provided' when the query param is absent", async () => {
    const { GET } = await import('@/app/api/a2ui/route')
    const req = mockGetRequest('http://localhost/api/a2ui')
    const res = await GET(req)
    const body = await readJson(res)
    expect(body.chatId).toBe('not provided')
  })
})
