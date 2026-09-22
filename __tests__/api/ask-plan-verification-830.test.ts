import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — real, reproduced incident (#830): a real, paying
 * customer (agentive) asked Cody "what's the next steps for me to take?" and
 * was told "You're on the free tier... when you're ready to make it real...
 * that's when a plan makes sense" — despite having already upgraded.
 *
 * Root cause: `resolveActivePlan().catch(() => ({ plan: '' as const }))`
 * discarded the `verified` field on ANY error, collapsing "couldn't confirm
 * the plan this turn" into the exact same shape as "confirmed unpaid" — the
 * precise anti-pattern lib/ainative/active-plan.ts's own doc comment warns
 * against (the #762 bug class). Fixed by preserving `verified` and giving
 * Cody a third, honest "can't confirm right now" framing instead of ever
 * defaulting to "you're on the free tier" when verification failed.
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
  completeText: vi.fn(),
  createIssue: vi.fn(),
  listIssues: vi.fn(),
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
vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
  completeText: h.completeText,
}))
vi.mock('@/lib/git/gitea-client', () => ({
  createIssue: h.createIssue,
  listIssues: h.listIssues,
}))

import { POST } from '@/app/api/build/ask/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/ask' } as any
}

let capturedSystem = ''

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  capturedSystem = ''
  h.auth.mockResolvedValue(null)
  h.resolveApp.mockResolvedValue(null)
  h.loadChatWithFallback.mockResolvedValue([])
  h.saveExchange.mockResolvedValue(true)
  h.processConversation.mockResolvedValue(undefined)
  h.listIssues.mockResolvedValue({ ok: true, issues: [] })
  h.getClaudeCompletion.mockReturnValue({
    provider: 'anthropic', model: 'claude-x',
    client: { messages: { create: vi.fn(async (opts: any) => { capturedSystem = opts.system; return { content: [{ type: 'text', text: 'Real answer.' }] } }) } },
  })
  h.fetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/build/backlog')) return { ok: true, json: async () => ({ built: [], queued: [] }) }
    return { ok: true, json: async () => ({ ok: true }) }
  })
  vi.stubGlobal('fetch', h.fetch)
})

describe('POST /api/build/ask — plan verification honesty (#830)', () => {
  it('never claims "free tier" when resolveActivePlan genuinely could not confirm the plan this turn', async () => {
    h.resolveActivePlan.mockResolvedValue({ plan: '', verified: false })

    await POST(req({ question: 'what are the next steps for me to take?', idea: 'a community platform', companyId: 'agentive' }))

    expect(capturedSystem).not.toMatch(/FREE tier/)
    expect(capturedSystem).not.toMatch(/PAID AINative plan/)
    expect(capturedSystem).toMatch(/could not be confirmed/)
    expect(capturedSystem).toMatch(/Do NOT say they're on the free tier/)
  })

  it('never claims "free tier" when resolveActivePlan throws (the extra .catch() no longer silently defaults to unpaid)', async () => {
    h.resolveActivePlan.mockRejectedValue(new Error('core /auth/me timeout'))

    await POST(req({ question: 'what are the next steps for me to take?', idea: 'a community platform', companyId: 'agentive' }))

    expect(capturedSystem).not.toMatch(/FREE tier/)
    expect(capturedSystem).toMatch(/could not be confirmed/)
  })

  it('correctly frames a CONFIRMED unpaid founder as free tier (verified:true, plan:"")', async () => {
    h.resolveActivePlan.mockResolvedValue({ plan: '', verified: true })

    await POST(req({ question: 'what are the next steps for me to take?', idea: 'a community platform', companyId: 'freeco' }))

    expect(capturedSystem).toMatch(/The founder is on the FREE tier/)
  })

  it('correctly frames a CONFIRMED paid founder as paid (verified:true, real plan)', async () => {
    h.resolveActivePlan.mockResolvedValue({ plan: 'business', verified: true })

    await POST(req({ question: 'what are the next steps for me to take?', idea: 'a community platform', companyId: 'agentive' }))

    expect(capturedSystem).toMatch(/PAID AINative plan \(business\)/)
    expect(capturedSystem).not.toMatch(/could not be confirmed/)
  })
})
