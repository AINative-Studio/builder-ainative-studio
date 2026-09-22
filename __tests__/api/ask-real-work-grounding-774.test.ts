import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — grounding "I'll wire that"/"it's in the queue" in
 * REAL tracked work (#774, Gap 2). Real incident: a paid, git-provisioned
 * founder said "The stripe integration" (a topic phrase, not an imperative
 * edit — detectEditIntent correctly stayed silent), and Cody replied "I'll
 * have this wired in the next run" with ZERO task or issue ever created.
 *
 * Fix: a paid, git-provisioned founder's non-imperative, non-question
 * message now gets checked by isLikelyChangeRequest (a cheap heuristic for
 * short messages, a secondary classifier call for longer/ambiguous ones) —
 * if it looks like a genuine request, a REAL Gitea issue is filed in the
 * company's own repo before Cody replies, and the "I'll wire that" framing
 * is now conditioned on real work (an edit dispatch OR a filed issue)
 * having actually happened this turn.
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

const PAID_PROVISIONED_APP = { gitOrg: 'ws-acme', zerodbProjectId: 'proj-1', plan: 'pro' }

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.auth.mockResolvedValue(null)
  // paid=true, verified=true — resolveActivePlan resolves to a real,
  // CONFIRMED plan (#830: verified must be true or gateInstructions falls
  // through to the "couldn't confirm" framing instead of paid/free).
  h.resolveActivePlan.mockResolvedValue({ plan: 'pro', verified: true })
  h.loadChatWithFallback.mockResolvedValue([])
  h.saveExchange.mockResolvedValue(true)
  h.processConversation.mockResolvedValue(undefined)
  h.listIssues.mockResolvedValue({ ok: true, issues: [] })
  h.createIssue.mockResolvedValue({ ok: true, issueNumber: 99, url: 'https://git.example/ws-acme/acme/issues/99' })
  h.getClaudeCompletion.mockReturnValue({
    provider: 'anthropic',
    model: 'claude-x',
    client: { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Real answer.' }] })) } },
  })
  h.completeText.mockResolvedValue({ text: 'NO', provider: 'anthropic', model: 'claude-x' })
  h.fetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/build/backlog')) {
      return { ok: true, json: async () => ({ built: [], queued: [] }) }
    }
    return { ok: true, json: async () => ({ ok: true, stage: 'completed' }) }
  })
  vi.stubGlobal('fetch', h.fetch)
})

describe('POST /api/build/ask — real-work grounding for "I\'ll wire that" (#774)', () => {
  it('files a real Gitea issue for a short, genuine-looking topic phrase (the exact "The stripe integration" shape) — heuristic path, no classifier call needed', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)

    await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme' }))

    expect(h.createIssue).toHaveBeenCalledWith(
      'ws-acme', 'acme',
      expect.stringContaining('stripe integration'),
      expect.any(String),
    )
    // Short message auto-qualifies — the classifier is never even called.
    expect(h.completeText).not.toHaveBeenCalled()
  })

  it('does NOT file an issue for a plain question, even one that mentions a feature', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)

    await POST(req({ question: 'Can you add Stripe integration?', idea: 'a field service company', companyId: 'acme' }))

    expect(h.createIssue).not.toHaveBeenCalled()
  })

  it('calls the secondary classifier for a longer, ambiguous message, and files an issue when it says YES', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)
    h.completeText.mockResolvedValue({ text: 'YES', provider: 'anthropic', model: 'claude-x' })

    await POST(req({
      question: 'My customers keep asking why they cannot pay through the app directly with their own cards',
      idea: 'a field service company',
      companyId: 'acme',
    }))

    expect(h.completeText).toHaveBeenCalled()
    expect(h.createIssue).toHaveBeenCalled()
  })

  it('does NOT file an issue for a longer message when the classifier says NO', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)
    h.completeText.mockResolvedValue({ text: 'NO', provider: 'anthropic', model: 'claude-x' })

    await POST(req({
      question: 'Thanks for the update, that all makes sense to me and I appreciate the detail',
      idea: 'a field service company',
      companyId: 'acme',
    }))

    expect(h.completeText).toHaveBeenCalled()
    expect(h.createIssue).not.toHaveBeenCalled()
  })

  it('never files an issue when the company is not git-provisioned, even for a genuine short request', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: undefined, plan: 'pro' })

    await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme' }))

    expect(h.createIssue).not.toHaveBeenCalled()
  })

  it('never files an issue for a free-tier founder', async () => {
    h.resolveActivePlan.mockResolvedValue({ plan: '', verified: true })
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)

    await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme' }))

    expect(h.createIssue).not.toHaveBeenCalled()
  })

  it('never files a SEPARATE issue when detectEditIntent already dispatched a real edit task — avoids double-filing the same request', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)

    await POST(req({ question: 'change the headline to Grow Faster', idea: 'a field service company', companyId: 'acme' }))

    const editCall = h.fetch.mock.calls.find((c: any[]) => String(c[0]).includes('/api/build/edit-app'))
    expect(editCall).toBeDefined()
    expect(h.createIssue).not.toHaveBeenCalled()
  })

  it('a classifier timeout/failure degrades to NOT filing (safe default), never crashes the chat reply', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)
    h.completeText.mockRejectedValue(new Error('provider unavailable'))

    const res = await POST(req({
      question: 'My customers keep asking why they cannot pay through the app directly with their own cards',
      idea: 'a field service company',
      companyId: 'acme',
    }))

    expect(h.createIssue).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.answer).toBe('Real answer.')
  })

  it('the system prompt only uses "I\'ll wire that" framing when real work happened this turn', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)
    let capturedSystem = ''
    h.getClaudeCompletion.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-x',
      client: {
        messages: {
          create: vi.fn(async (opts: any) => {
            capturedSystem = opts.system
            return { content: [{ type: 'text', text: 'Real answer.' }] }
          }),
        },
      },
    })

    await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme' }))

    expect(capturedSystem).toContain("I'll wire that next")
    expect(capturedSystem).toContain('#99')
  })

  it('the system prompt explicitly forbids "I\'ll wire that" framing when NOTHING real happened this turn', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)
    let capturedSystem = ''
    h.getClaudeCompletion.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-x',
      client: {
        messages: {
          create: vi.fn(async (opts: any) => {
            capturedSystem = opts.system
            return { content: [{ type: 'text', text: 'Real answer.' }] }
          }),
        },
      },
    })

    await POST(req({ question: 'what does this app do', idea: 'a field service company', companyId: 'acme' }))

    expect(capturedSystem).toMatch(/do NOT say "I'll wire that" or "it's/)
  })
})

describe('fetchBacklogSummary — real Gitea issues ground the backlog (#774, Gap 2)', () => {
  it('includes real open/closed Gitea issues in the system prompt for a git-provisioned company', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-acme', zerodbProjectId: 'proj-1', plan: 'pro' })
    h.listIssues.mockResolvedValue({
      ok: true,
      issues: [
        { id: 1, number: 12, title: 'Add dark mode', state: 'open', html_url: 'x' },
        { id: 2, number: 11, title: 'Wire ZeroCommerce checkout', state: 'closed', html_url: 'x' },
      ],
    })
    let capturedSystem = ''
    h.getClaudeCompletion.mockReturnValue({
      provider: 'anthropic', model: 'claude-x',
      client: { messages: { create: vi.fn(async (opts: any) => { capturedSystem = opts.system; return { content: [{ type: 'text', text: 'Real answer.' }] } }) } },
    })

    await POST(req({ question: 'what is the status of my build', idea: 'a store', companyId: 'acme' }))

    expect(h.listIssues).toHaveBeenCalledWith('ws-acme', 'acme', expect.objectContaining({ state: 'all' }))
    expect(capturedSystem).toContain('REAL TRACKED REQUESTS')
    expect(capturedSystem).toContain('#12 Add dark mode')
    expect(capturedSystem).toContain('#11 Wire ZeroCommerce checkout')
  })

  it('omits the Gitea section entirely for a company with no git repo yet', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: undefined, zerodbProjectId: 'proj-1', plan: 'pro' })
    let capturedSystem = ''
    h.getClaudeCompletion.mockReturnValue({
      provider: 'anthropic', model: 'claude-x',
      client: { messages: { create: vi.fn(async (opts: any) => { capturedSystem = opts.system; return { content: [{ type: 'text', text: 'Real answer.' }] } }) } },
    })

    await POST(req({ question: 'what is the status of my build', idea: 'a store', companyId: 'acme' }))

    expect(h.listIssues).not.toHaveBeenCalled()
    expect(capturedSystem).not.toContain('REAL TRACKED REQUESTS')
  })

  it('degrades gracefully (no crash, section omitted) when Gitea is unreachable', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-acme', zerodbProjectId: 'proj-1', plan: 'pro' })
    h.listIssues.mockResolvedValue({ ok: false, reason: 'gitea unreachable' })

    const res = await POST(req({ question: 'what is the status of my build', idea: 'a store', companyId: 'acme' }))
    const json = await res.json()
    expect(json.answer).toBe('Real answer.')
  })
})
