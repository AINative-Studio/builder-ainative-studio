import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — company-track genuine requests become real tracked
 * work (#1533). Root cause: the #774 real-work-grounding gate only ever
 * filed a Gitea issue, gated on `app?.gitOrg`. `gitOrg` is set exclusively by
 * provisionCompanyRepo(), which requires a real file map to commit — a
 * company-track venture (business plan, thesis, cap table — no code) can
 * never produce one, so `gitOrg` can never be set for that track. A paid
 * company-track founder's genuine chat request was therefore tracked
 * NOWHERE: no Gitea issue (structurally impossible) and no build_tasks row
 * (no code path created one for a chat-originated request).
 *
 * Fix: alongside the existing app-track Gitea-issue branch, a company-track
 * founder with no git repo gets a plain build_tasks row instead (via
 * lib/build/task-store.ts's createTask, the same primitive #1522's
 * nightly-seeding branch and /api/build/tasks already read/write) — it
 * surfaces in the founder's real Tasks panel via listTasksForCompany().
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  resolveActivePlan: vi.fn(),
  resolveApp: vi.fn(),
  resolveAppVerified: vi.fn(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true })),
  loadChatWithFallback: vi.fn(),
  saveExchange: vi.fn(),
  processConversation: vi.fn(),
  getClaudeCompletion: vi.fn(),
  completeText: vi.fn(),
  createIssue: vi.fn(),
  listIssues: vi.fn(),
  createTask: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: h.resolveActivePlan }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp, resolveAppVerified: h.resolveAppVerified }))
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
vi.mock('@/lib/build/task-store', () => ({
  createTask: h.createTask,
}))

import { POST } from '@/app/api/build/ask/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/ask' } as any
}

const PAID_COMPANY_TRACK_NO_REPO = { gitOrg: undefined, zerodbProjectId: 'proj-1', plan: 'pro' }
const PAID_PROVISIONED_APP = { gitOrg: 'ws-acme', zerodbProjectId: 'proj-1', plan: 'pro' }

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.resolveAppVerified.mockImplementation(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true }))
  h.auth.mockResolvedValue(null)
  h.resolveActivePlan.mockResolvedValue({ plan: 'pro', verified: true })
  h.loadChatWithFallback.mockResolvedValue([])
  h.saveExchange.mockResolvedValue(true)
  h.processConversation.mockResolvedValue(undefined)
  h.listIssues.mockResolvedValue({ ok: true, issues: [] })
  h.createIssue.mockResolvedValue({ ok: true, issueNumber: 99, url: 'https://git.example/ws-acme/acme/issues/99' })
  h.createTask.mockResolvedValue({ id: 't_1', title: 'A real task' })
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

describe('POST /api/build/ask — company-track real-work grounding (#1533)', () => {
  it('creates a build_tasks row (not a Gitea issue) for a genuine request from a paid, company-track founder with no repo', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)

    await POST(req({
      question: 'The stripe integration',
      idea: 'a field service company',
      companyId: 'acme',
      track: 'company',
    }))

    expect(h.createIssue).not.toHaveBeenCalled()
    expect(h.createTask).toHaveBeenCalledWith(
      'guest:anon::acme',
      expect.objectContaining({ title: expect.stringContaining('stripe integration'), source: 'cody', stage: 'todo' }),
    )
  })

  it('still files a real Gitea issue (not a build_tasks row) for an app-track founder with a repo — unchanged behavior', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)

    await POST(req({ question: 'The stripe integration', idea: 'an app idea', companyId: 'acme', track: 'app' }))

    expect(h.createIssue).toHaveBeenCalled()
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('does NOT create a task for a plain question, even for company-track', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)

    await POST(req({ question: 'Can you add Stripe integration?', idea: 'a field service company', companyId: 'acme', track: 'company' }))

    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('never creates a task for a free-tier company-track founder', async () => {
    h.resolveActivePlan.mockResolvedValue({ plan: '', verified: true })
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)

    await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme', track: 'company' }))

    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('a task-store failure degrades to not filing (safe default), never crashes the chat reply', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)
    h.createTask.mockRejectedValue(new Error('zerodb unavailable'))

    const res = await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme', track: 'company' }))

    const json = await res.json()
    expect(json.answer).toBe('Real answer.')
  })

  it('the system prompt references the real backlog task, never a Gitea issue/PR, for the company-track path', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)
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

    await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme', track: 'company' }))

    expect(capturedSystem).toContain("I'll wire that next")
    expect(capturedSystem).toContain('Tasks panel')
    expect(capturedSystem).not.toContain('company repo')
    expect(capturedSystem).not.toMatch(/#0\b/)
  })
})
