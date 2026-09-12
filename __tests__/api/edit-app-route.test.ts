import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/edit-app (#582) — the first real "edit an already-deployed
 * company's app from live chat" capability. Reuses resolveTask (the exact
 * same nightly-loop pipeline: implement → commit+PR → coverage-gated verify
 * → auto-merge/redeploy) via a real BuildTask row, rather than a second,
 * parallel implementation with different safety properties.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  auth: vi.fn(),
  deriveOwnerKey: vi.fn(() => 'owner-key'),
  chatScopeKey: vi.fn((owner: string, slug: string) => `${owner}::${slug}`),
  createTask: vi.fn(),
  resolveTask: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/chat-store', () => ({ deriveOwnerKey: h.deriveOwnerKey, chatScopeKey: h.chatScopeKey }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/task-store', () => ({ createTask: h.createTask }))
vi.mock('@/lib/build/task-resolver', () => ({ resolveTask: h.resolveTask }))

import { POST } from '@/app/api/build/edit-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => typeof fn.mockReset === 'function' && fn.mockReset())
  h.deriveOwnerKey.mockReturnValue('owner-key')
  h.chatScopeKey.mockImplementation((owner: string, slug: string) => `${owner}::${slug}`)
  h.auth.mockResolvedValue(null)
})

describe('POST /api/build/edit-app', () => {
  it('requires companyId and request', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('fails honestly when the company is not git-provisioned', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: undefined })
    const res = await POST(req({ companyId: 'ember-box', request: 'change the headline' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toMatch(/not git-provisioned/i)
    expect(h.createTask).not.toHaveBeenCalled()
    expect(h.resolveTask).not.toHaveBeenCalled()
  })

  it('creates a real tracked task and resolves it via the SAME pipeline as the nightly loop', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.createTask.mockResolvedValue({ id: 't1', scopeKey: 'owner-key::ember-box', title: 'change the headline', stage: 'todo', source: 'cody', createdAt: '', updatedAt: '' })
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed', prUrl: 'https://git.ainative.studio/pr/1', merged: true, redeployed: true, coveragePercent: 90 })

    const res = await POST(req({ companyId: 'ember-box', request: 'change the headline to Grow Faster' }))
    const json = await res.json()

    expect(h.createTask).toHaveBeenCalledWith('owner-key::ember-box', expect.objectContaining({
      title: 'change the headline to Grow Faster',
      stage: 'todo',
      source: 'cody',
    }))
    expect(h.resolveTask).toHaveBeenCalledWith('owner-key::ember-box', expect.objectContaining({ id: 't1' }), 'ember-box')
    expect(json.ok).toBe(true)
    expect(json.stage).toBe('completed')
    expect(json.merged).toBe(true)
  })

  it('returns the real failure reason when resolveTask fails (never fabricates success)', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.createTask.mockResolvedValue({ id: 't2', scopeKey: 'owner-key::ember-box', title: 'x', stage: 'todo', source: 'cody', createdAt: '', updatedAt: '' })
    h.resolveTask.mockResolvedValue({ ok: false, stage: 'failed', reason: 'Coverage verification failed.' })

    const res = await POST(req({ companyId: 'ember-box', request: 'add a feature' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('Coverage verification failed.')
  })

  it('fails honestly (never throws) when createTask itself fails', async () => {
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.createTask.mockResolvedValue(null)
    const res = await POST(req({ companyId: 'ember-box', request: 'change the color' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(h.resolveTask).not.toHaveBeenCalled()
  })

  it('scopes the task to the signed-in owner + company, not just the company', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })
    h.deriveOwnerKey.mockReturnValue('founder@example.com')
    h.resolveApp.mockResolvedValue({ gitOrg: 'ws-1' })
    h.createTask.mockResolvedValue({ id: 't3', scopeKey: 'founder@example.com::ember-box', title: 'x', stage: 'todo', source: 'cody', createdAt: '', updatedAt: '' })
    h.resolveTask.mockResolvedValue({ ok: true, stage: 'completed' })

    await POST(req({ companyId: 'ember-box', request: 'change the color' }))
    expect(h.createTask).toHaveBeenCalledWith('founder@example.com::ember-box', expect.anything())
  })
})
