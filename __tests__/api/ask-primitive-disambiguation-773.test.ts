import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — real, reproduced incident (#773): a founder asked
 * "can I integrate stripe my stripe account for payments?" and Cody named
 * OpenCapStack (cap table/equity — unrelated to payments) TWICE in the same
 * conversation, despite ZeroInvoice/ZeroCommerce being correctly listed
 * with "Stripe" in their own descriptions in the SAME prompt. Root cause
 * (confirmed via direct code trace in the issue): the prompt never
 * distinguished "foundational substrate present for every company" from
 * "the primitive that actually answers this specific question" — the model
 * pattern-matched on the topic being finance-shaped instead of reading each
 * primitive's actual listed purpose.
 *
 * Fix: an explicit disambiguation instruction, naming the exact real
 * incident (payments/Stripe -> ZeroInvoice/ZeroCommerce, never OpenCapStack)
 * so this specific confusion can't recur even if the model's general
 * instruction-following on the broader principle is imperfect.
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
  h.resolveActivePlan.mockResolvedValue({ plan: '', verified: true })
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

describe('POST /api/build/ask — primitive disambiguation for payments questions (#773)', () => {
  it('the system prompt explicitly names payments/Stripe -> ZeroInvoice/ZeroCommerce, never OpenCapStack', async () => {
    await POST(req({
      question: 'can I integrate stripe my stripe account for payments?',
      idea: 'A knowledge marketplace where experts monetize what they know.',
      companyId: 'lumeo',
    }))

    expect(capturedSystem).toMatch(/PAYMENTS, STRIPE, CHECKOUT/)
    expect(capturedSystem).toContain('ZeroInvoice')
    expect(capturedSystem).toContain('ZeroCommerce')
    expect(capturedSystem).toMatch(/NEVER OpenCapStack/)
  })

  it('the disambiguation instruction is present regardless of the specific question asked (always-on grounding, not conditional)', async () => {
    await POST(req({ question: 'what is my company called', idea: 'a coffee shop', companyId: 'acme' }))

    expect(capturedSystem).toContain('PRIMITIVE DISAMBIGUATION')
    expect(capturedSystem).toMatch(/NEVER OpenCapStack/)
  })

  it('explains OpenCapStack is cap table/equity, not payments, so the model has the actual distinguishing fact', async () => {
    await POST(req({ question: 'stripe integration', idea: 'a marketplace', companyId: 'acme' }))

    expect(capturedSystem).toMatch(/cap table\/equity\/SAFEs\/vesting/)
  })
})
