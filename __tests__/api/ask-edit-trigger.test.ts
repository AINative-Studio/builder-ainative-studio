import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — real edit-request dispatch (#582). When a founder's
 * message is a genuine change request (detectEditIntent) against a
 * git-provisioned company, ask/route.ts now fires a REAL, detached call to
 * /api/build/edit-app — the same pipeline the nightly loop uses — instead of
 * only ever replying with a scripted "I'll wire that next" placeholder that
 * never did anything (the original WhatsApp bug report this issue was filed
 * from).
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  resolveActivePlan: vi.fn(),
  resolveApp: vi.fn(),
  loadChatWithFallback: vi.fn(),
  saveExchange: vi.fn(),
  processConversation: vi.fn(),
  getClaudeCompletion: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: h.resolveActivePlan }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: () => 'guest:anon',
  chatScopeKey: (owner: string, slug: string) => `${owner}::${slug}`,
  loadChatWithFallback: h.loadChatWithFallback,
  saveExchange: h.saveExchange,
  buildMessagesWithHistory: (history: any[], question: string) => [...history.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: question }],
}))
vi.mock('@/lib/agent/zeromemory', () => ({ processConversation: h.processConversation }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))

import { POST } from '@/app/api/build/ask/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/ask' } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.auth.mockResolvedValue(null)
  h.resolveActivePlan.mockResolvedValue({ plan: '' })
  h.loadChatWithFallback.mockResolvedValue([])
  h.saveExchange.mockResolvedValue(true)
  h.processConversation.mockResolvedValue(undefined)
  h.getClaudeCompletion.mockReturnValue({
    provider: 'anthropic',
    model: 'claude-x',
    client: { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Real answer.' }] })) } },
  })
  h.fetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/build/backlog')) {
      return { ok: true, json: async () => ({ built: [], queued: [] }) }
    }
    return { ok: true, json: async () => ({ ok: true, stage: 'completed' }) }
  })
  vi.stubGlobal('fetch', h.fetch)
})

describe('POST /api/build/ask — edit dispatch (#582)', () => {
  it('dispatches a real /api/build/edit-app call when the message is a genuine change request against a git-provisioned company', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1', zerodbProjectId: 'proj-1' })

    await POST(req({ question: 'change the headline to Grow Faster', idea: 'a CRM', companyId: 'ember-box' }))

    const editCall = h.fetch.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/edit-app'))
    expect(editCall).toBeDefined()
    const body = JSON.parse(editCall![1].body)
    expect(body).toEqual({ companyId: 'ember-box', request: 'change the headline to Grow Faster' })
  })

  it('does NOT dispatch an edit for a plain question', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })

    await POST(req({ question: 'what does this app do', idea: 'a CRM', companyId: 'ember-box' }))

    const editCall = h.fetch.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/edit-app'))
    expect(editCall).toBeUndefined()
  })

  it('does NOT dispatch an edit when the company is not git-provisioned, even for a real change request', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: undefined })

    await POST(req({ question: 'change the headline to Grow Faster', idea: 'a CRM', companyId: 'ember-box' }))

    const editCall = h.fetch.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/edit-app'))
    expect(editCall).toBeUndefined()
  })

  it('does NOT dispatch an edit when there is no companyId at all', async () => {
    await POST(req({ question: 'change the headline to Grow Faster', idea: 'a CRM' }))
    expect(h.resolveApp).not.toHaveBeenCalled()
    const editCall = h.fetch.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/edit-app'))
    expect(editCall).toBeUndefined()
  })

  it('still returns a real chat answer even when an edit was dispatched (never blocks the reply)', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    const res = await POST(req({ question: 'add a dark mode toggle', idea: 'a CRM', companyId: 'ember-box' }))
    const json = await res.json()
    expect(json.answer).toBe('Real answer.')
  })
})
