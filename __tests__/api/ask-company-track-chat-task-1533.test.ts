import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — company-track genuine requests become a real
 * build_tasks row (#1533). #774's fix only grounds "I'll wire that" for an
 * app-track, git-provisioned company (createIssue against a real repo). A
 * company-track venture (business plan/thesis/cap table — no generated
 * code) can never acquire app.gitOrg (provisionCompanyRepo requires a real
 * file map to commit), so #774's gate always fails for this track, paid or
 * not — a paying company-track founder's genuine chat request was tracked
 * nowhere at all.
 *
 * Fix: the SAME classifier (isLikelyChangeRequest), gated the same way
 * (paid && !editTriggered), but for track === 'company' with no gitOrg,
 * files a plain build_tasks row (source: 'cody', stage: 'todo') instead of
 * a Gitea issue — the same primitive #1522's nightly-seeding branch already
 * uses for this track, just triggered from chat instead of the nightly loop.
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
  listTasks: vi.fn(),
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
  listTasks: h.listTasks,
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
  h.listTasks.mockResolvedValue([])
  h.createTask.mockResolvedValue({ id: 't_1', title: 'x', stage: 'todo', source: 'cody', scopeKey: 'guest:anon::acme', createdAt: '', updatedAt: '' })
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

describe('POST /api/build/ask — company-track chat requests become a tracked build_task (#1533)', () => {
  it('creates a real build_tasks row for a short, genuine-looking topic phrase on a paid, company-track, no-repo company', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)

    await POST(req({
      question: 'The stripe integration',
      idea: 'a field service company',
      companyId: 'acme',
      track: 'company',
    }))

    expect(h.createTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: expect.stringContaining('stripe integration'),
        source: 'cody',
        stage: 'todo',
      }),
    )
    // Never attempts a Gitea issue for a company-track venture with no repo.
    expect(h.createIssue).not.toHaveBeenCalled()
  })

  it('does NOT create a task for a plain question on the company track', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)

    await POST(req({
      question: 'Can you add Stripe integration?',
      idea: 'a field service company',
      companyId: 'acme',
      track: 'company',
    }))

    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('does NOT create a task for an unpaid company-track founder', async () => {
    h.resolveActivePlan.mockResolvedValue({ plan: '', verified: true })
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)

    await POST(req({
      question: 'The stripe integration',
      idea: 'a field service company',
      companyId: 'acme',
      track: 'company',
    }))

    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('still uses the Gitea-issue path, unchanged, for an app-track git-provisioned company — never double-files via build_tasks too', async () => {
    h.resolveApp.mockResolvedValue(PAID_PROVISIONED_APP)

    await POST(req({
      question: 'The stripe integration',
      idea: 'a field service company',
      companyId: 'acme',
      track: 'app',
    }))

    expect(h.createIssue).toHaveBeenCalled()
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('the system prompt references the tracked task honestly, never claiming a Gitea issue/repo for the company track', async () => {
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
    expect(capturedSystem).not.toContain('company repo')
    expect(capturedSystem).not.toMatch(/#\d+.*filed/)
  })

  it('a createTask failure degrades to NOT claiming "I\'ll wire that" (safe default), never crashes the reply', async () => {
    h.resolveApp.mockResolvedValue(PAID_COMPANY_TRACK_NO_REPO)
    h.createTask.mockResolvedValue(null)
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

    const res = await POST(req({ question: 'The stripe integration', idea: 'a field service company', companyId: 'acme', track: 'company' }))

    expect(capturedSystem).toMatch(/do NOT say "I'll wire that" or "it's/)
    const json = await res.json()
    expect(json.answer).toBe('Real answer.')
  })
})
