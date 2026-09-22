import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — real, reproduced incident (#780): a founder TEXTED
 * Fieldko's real, live ZeroVoice number asking whether it could handle
 * two-way SMS. Cody's reply, sent back over that SAME number, said ZeroVoice
 * "isn't wired into this company yet" — self-contradicting in the most
 * direct way possible, since the founder's own message and Cody's own reply
 * both proved the opposite. Root cause: the #748 provisioning-status
 * grounding only checked general cloud provisioning (zerodbProjectId), with
 * zero awareness of app.zerovoiceProvisioned/app.zerovoiceE164 (both already
 * on AppEntry) — the same class of gap #748 fixed for general provisioning,
 * just never extended per-primitive.
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

describe('POST /api/build/ask — real ZeroVoice status grounding (#780)', () => {
  it('tells Cody ZeroVoice IS live, with the real number, when the company has one provisioned', async () => {
    h.resolveApp.mockResolvedValue({ zerovoiceProvisioned: true, zerovoiceE164: '+19377642838' })

    await POST(req({ question: 'can this handle two-way SMS?', idea: 'a field service company', companyId: 'fieldko' }))

    expect(capturedSystem).toMatch(/ZEROVOICE STATUS: this company HAS a real, live ZeroVoice phone number \(\+19377642838\)/)
    expect(capturedSystem).toMatch(/NEVER say/)
    expect(capturedSystem).toContain("isn't wired into this company yet")
  })

  it('tells Cody ZeroVoice is NOT provisioned, honestly, when the company has no number', async () => {
    h.resolveApp.mockResolvedValue({ zerovoiceProvisioned: false })

    await POST(req({ question: 'can this handle two-way SMS?', idea: 'a field service company', companyId: 'acme' }))

    expect(capturedSystem).toMatch(/ZEROVOICE STATUS: this company has NOT provisioned a ZeroVoice phone number yet/)
    expect(capturedSystem).toMatch(/Get a phone number/)
  })

  it('treats a provisioned flag with no real e164 as NOT provisioned (never half-true)', async () => {
    h.resolveApp.mockResolvedValue({ zerovoiceProvisioned: true, zerovoiceE164: undefined })

    await POST(req({ question: 'can this handle two-way SMS?', idea: 'a field service company', companyId: 'acme' }))

    expect(capturedSystem).toMatch(/has NOT provisioned a ZeroVoice phone number yet/)
  })

  it('degrades to the not-provisioned framing when the company cannot be resolved at all (fail closed, never fabricate)', async () => {
    h.resolveApp.mockResolvedValue(null)

    await POST(req({ question: 'can this handle two-way SMS?', idea: 'a field service company', companyId: 'ghost' }))

    expect(capturedSystem).toMatch(/has NOT provisioned a ZeroVoice phone number yet/)
  })
})
