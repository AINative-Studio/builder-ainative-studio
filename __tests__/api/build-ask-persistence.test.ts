import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #52 — /api/build/ask persistence + Cody memory.
 *
 * Properties under test:
 *   - POST loads prior history and includes it (before the current question) in the
 *     model `messages`, so follow-ups have context,
 *   - POST persists the completed user+cody exchange (appendExchange),
 *   - the conversation OWNER is the SESSION email for a real account, else the
 *     body/query guestId (a body email is never trusted),
 *   - GET returns the persisted thread ({ turns }) and an honest empty state.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  getClaudeCompletion: vi.fn(),
  chatKey: vi.fn(),
  loadConversation: vi.fn(),
  appendExchange: vi.fn(),
  messagesCreate: vi.fn(),
  completionsCreate: vi.fn(),
}))

// Stub the OpenAI client so the AINative fallback never hits the real network.
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.completionsCreate } }
  },
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))
vi.mock('@/lib/build/tier-models', () => ({
  modelsForTier: () => ({ bedrockModel: 'bedrock-x', ainativeModel: 'ainative-x' }),
}))
vi.mock('@/lib/build/primitive-catalog', () => ({
  selectPrimitives: () => ({ names: ['ZeroDB'] }),
  catalogPromptBlock: () => 'CATALOG',
}))
// Real toMessages so we test the true mapping; the rest are spies.
vi.mock('@/lib/build/chat-store', async () => {
  const actual = await vi.importActual<any>('@/lib/build/chat-store')
  return {
    ...actual,
    chatKey: h.chatKey,
    loadConversation: h.loadConversation,
    appendExchange: h.appendExchange,
  }
})

import { POST, GET } from '@/app/api/build/ask/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}
function getReq(url: string) {
  return { url } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn: any) => fn.mockReset?.())
  h.auth.mockResolvedValue(null)
  h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
  h.chatKey.mockImplementation((owner: string, slug: string) =>
    owner && slug ? `${owner.toLowerCase()}:${slug.toLowerCase()}` : '',
  )
  h.loadConversation.mockResolvedValue([])
  h.appendExchange.mockResolvedValue(true)
  h.messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Cody answer' }] })
  h.completionsCreate.mockResolvedValue({ choices: [{ message: { content: 'Fallback answer' } }] })
  h.getClaudeCompletion.mockReturnValue({
    provider: 'anthropic', model: 'claude-x', client: { messages: { create: h.messagesCreate } },
  })
})

describe('POST /api/build/ask (#52 memory + persistence)', () => {
  it('400 when question is missing', async () => {
    const res = await POST(postReq({ companyId: 'acme' }))
    expect(res.status).toBe(400)
  })

  it('includes prior history BEFORE the current question in the model messages', async () => {
    h.loadConversation.mockResolvedValue([
      { role: 'user', text: 'build a todo app' },
      { role: 'cody', text: 'done, it is live' },
    ])
    const res = await POST(postReq({ question: 'make it cheaper', companyId: 'acme', guestId: 'g1' }))
    expect(res.status).toBe(200)

    const passed = h.messagesCreate.mock.calls[0][0].messages
    expect(passed).toEqual([
      { role: 'user', content: 'build a todo app' },
      { role: 'assistant', content: 'done, it is live' },
      { role: 'user', content: 'make it cheaper' },
    ])
  })

  it('persists the completed exchange', async () => {
    await POST(postReq({ question: 'hi', companyId: 'acme', guestId: 'g1' }))
    expect(h.appendExchange).toHaveBeenCalledWith('g1:acme', 'hi', 'Cody answer')
  })

  it('keys the conversation by the SESSION email for a real account (ignores guestId)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
    await POST(postReq({ question: 'hi', companyId: 'acme', guestId: 'g1' }))
    const [ownerArg, slugArg] = h.chatKey.mock.calls[0]
    expect(ownerArg).toBe('founder@acme.com')
    expect(slugArg).toBe('acme')
  })

  it('falls back to the guestId as owner for a GUEST session', async () => {
    h.auth.mockResolvedValue({ user: { email: 'guest-x@example.com', type: 'guest' } })
    await POST(postReq({ question: 'hi', companyId: 'acme', guestId: 'g1' }))
    expect(h.chatKey.mock.calls[0][0]).toBe('g1')
  })

  it('still answers (no persistence) when there is no key — degraded mode', async () => {
    h.chatKey.mockReturnValue('')
    const res = await POST(postReq({ question: 'hi', companyId: '', guestId: '' }))
    expect(res.status).toBe(200)
    expect(h.loadConversation).not.toHaveBeenCalled()
    expect(h.appendExchange).not.toHaveBeenCalled()
  })

  it('passes history to the AINative fallback (system + history + question) and persists', async () => {
    h.getClaudeCompletion.mockReturnValue(null)
    h.loadConversation.mockResolvedValue([{ role: 'user', text: 'earlier' }])
    const res = await POST(postReq({ question: 'next', companyId: 'acme', guestId: 'g1' }))
    expect(res.status).toBe(200)
    const msgs = h.completionsCreate.mock.calls[0][0].messages
    expect(msgs[0].role).toBe('system')
    expect(msgs.slice(1)).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'user', content: 'next' },
    ])
    expect(h.appendExchange).toHaveBeenCalledWith('g1:acme', 'next', 'Fallback answer')
  })
})

describe('GET /api/build/ask (#52 rehydrate)', () => {
  it('returns the persisted thread as { turns }', async () => {
    h.loadConversation.mockResolvedValue([
      { role: 'user', text: 'q', createdAt: '1' },
      { role: 'cody', text: 'a', createdAt: '2' },
    ])
    const res = await GET(getReq('https://x/api/build/ask?slug=acme&guestId=g1'))
    const body = await res.json()
    expect(body.turns).toEqual([
      { role: 'user', text: 'q' },
      { role: 'cody', text: 'a' },
    ])
    expect(h.chatKey).toHaveBeenCalledWith('g1', 'acme')
  })

  it('honest empty state ({ turns: [] }) when there is no key', async () => {
    h.chatKey.mockReturnValue('')
    const res = await GET(getReq('https://x/api/build/ask'))
    const body = await res.json()
    expect(body.turns).toEqual([])
    expect(h.loadConversation).not.toHaveBeenCalled()
  })
})
