import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — saveExchange must be AWAITED, not fired with `void`
 * (#704 follow-up). Real bug found live investigating #608: `void
 * saveExchange(...)` fired immediately before `return Response.json(...)`
 * left almost no wall-clock time for the save to complete before the
 * handler returned — confirmed live: 0 rows ever landed in build_chat
 * despite dozens of real POST calls, all returning 200 with a real answer.
 * This proves the fix: the mocked saveExchange must have resolved before
 * the handler's returned Response is available to the caller.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActivePlan: vi.fn(),
  resolveApp: vi.fn(),
  loadChatWithFallback: vi.fn(),
  saveExchange: vi.fn(),
  processConversation: vi.fn(),
  getClaudeCompletion: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: h.resolveActivePlan }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: () => 'guest:anon',
  chatScopeKey: (owner: string, slug: string) => `${owner}::${slug}`,
  loadChatWithFallback: h.loadChatWithFallback,
  saveExchange: h.saveExchange,
  buildMessagesWithHistory: (history: any[], q: string) => [...history, { role: 'user', content: q }],
}))
vi.mock('@/lib/agent/zeromemory', () => ({ processConversation: h.processConversation }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))
vi.mock('@/lib/build/chat-summary', () => ({ ensureChatSummary: vi.fn(async () => null) }))

import { POST } from '@/app/api/build/ask/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/ask' } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.auth.mockResolvedValue(null)
  h.resolveActivePlan.mockResolvedValue({ plan: '' })
  h.resolveApp.mockResolvedValue(null)
  h.loadChatWithFallback.mockResolvedValue([])
  h.processConversation.mockResolvedValue(undefined)
})

describe('POST /api/build/ask — saveExchange is awaited before responding (#704 follow-up)', () => {
  it('has already resolved saveExchange by the time the handler returns', async () => {
    let saveResolved = false
    h.saveExchange.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      saveResolved = true
      return true
    })
    h.getClaudeCompletion.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-x',
      client: { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Real answer.' }] })) } },
    })

    const res = await POST(req({ question: 'what does this do', idea: 'a CRM', companyId: 'ember-box' }))
    const json = await res.json()

    expect(json.answer).toBe('Real answer.')
    expect(h.saveExchange).toHaveBeenCalledTimes(1)
    // The critical assertion: by the time the handler has fully returned its
    // response, the save has ALREADY completed — not just been fired.
    expect(saveResolved).toBe(true)
  })

  it('still returns the real answer even if saveExchange itself unexpectedly rejects', async () => {
    // saveExchange/appendChatTurn already catch their own errors internally
    // and resolve false rather than reject — this simulates the unrealistic
    // "throws anyway" case to prove the route's own defense-in-depth .catch().
    h.saveExchange.mockRejectedValue(new Error('zerodb down'))
    h.getClaudeCompletion.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-x',
      client: { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Real answer.' }] })) } },
    })

    const res = await POST(req({ question: 'what does this do', idea: 'a CRM', companyId: 'ember-box' }))
    const json = await res.json()
    expect(json.answer).toBe('Real answer.')
  })
})
