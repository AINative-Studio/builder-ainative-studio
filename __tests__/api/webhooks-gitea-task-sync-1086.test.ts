import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1086 — the Gitea webhook route's `pull_request` branch now ALSO calls
 * `syncTaskFromPREvent` (fire-and-forget, same contract as the push handler's
 * `handlePushRedeploy` in webhooks-gitea-push-redeploy.test.ts) after running
 * the existing committee/standards gate. This file covers ONLY the wiring —
 * that the sync is invoked with the right arguments and doesn't block the
 * response or affect the gate's own behavior. The sync's own state-mapping
 * logic is covered by task-sync-from-git-1086.test.ts.
 */

const h = vi.hoisted(() => ({
  deployCompanyFromGitea: vi.fn(),
  companyDeployEnabled: vi.fn(() => true),
  setAppRailwayService: vi.fn(async () => true),
  resolveApp: vi.fn(),
  handlePRWebhook: vi.fn(async () => ({ ok: true, verdict: 'approve', summary: 'ok' })),
  syncTaskFromPREvent: vi.fn(async () => ({ ok: true, reason: 'updated_existing' })),
}))
const { handlePRWebhook, syncTaskFromPREvent } = h

vi.mock('@/lib/build/company-deploy', () => ({
  deployCompanyFromGitea: h.deployCompanyFromGitea,
  companyDeployEnabled: h.companyDeployEnabled,
}))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppRailwayService: h.setAppRailwayService,
}))
vi.mock('@/lib/build/instant-db', () => ({
  BUILDER_WORKSPACE_ID: '5d2376e1-d4f0-4193-9a7f-84e4543a8f9a',
}))
vi.mock('@/lib/git/committee-pr-gate', () => ({
  handlePRWebhook: h.handlePRWebhook,
}))
vi.mock('@/lib/git/task-sync-from-git', () => ({
  syncTaskFromPREvent: h.syncTaskFromPREvent,
}))

import { POST } from '@/app/api/webhooks/gitea/route'

function req(event: string, body: unknown) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-gitea-event' ? event : null) },
    text: async () => JSON.stringify(body),
  } as any
}

const prPayload = (over: Partial<{ action: string; number: number; pull_request: any; repository: any }> = {}) => ({
  action: 'opened',
  number: 1,
  pull_request: { number: 1, title: 'Task work', head: { ref: 'task/t1' } },
  repository: { name: 'acme', owner: { login: 'ws-w1' } },
  ...over,
})

describe('POST /api/webhooks/gitea — task sync wiring (#1086)', () => {
  beforeEach(() => {
    handlePRWebhook.mockClear().mockResolvedValue({ ok: true, verdict: 'approve', summary: 'ok' })
    syncTaskFromPREvent.mockClear().mockResolvedValue({ ok: true, reason: 'updated_existing' })
  })

  it('calls syncTaskFromPREvent with the PR payload and the gate verdict after handlePRWebhook resolves', async () => {
    const res = await POST(req('pull_request', prPayload()))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(handlePRWebhook).toHaveBeenCalledTimes(1)
    // Let the fire-and-forget promise's .then settle before asserting.
    await new Promise((r) => setTimeout(r, 0))
    expect(syncTaskFromPREvent).toHaveBeenCalledTimes(1)
    const call = syncTaskFromPREvent.mock.calls[0] as any[]
    const [input, verdict] = call
    expect(input.action).toBe('opened')
    expect(input.pullRequest.head.ref).toBe('task/t1')
    expect(input.repository.name).toBe('acme')
    expect(verdict).toBe('approve')
  })

  it('does not call syncTaskFromPREvent when the payload has no pull_request/repository', async () => {
    const res = await POST(req('pull_request', { action: 'opened', number: 1 }))
    await res.json()
    await new Promise((r) => setTimeout(r, 0))
    expect(syncTaskFromPREvent).not.toHaveBeenCalled()
  })

  it('does not await the sync on the response path — the route responds before sync settles', async () => {
    let resolveSync: (v: any) => void = () => {}
    syncTaskFromPREvent.mockReturnValue(new Promise((resolve) => { resolveSync = resolve }))
    const res = await POST(req('pull_request', prPayload()))
    const json = await res.json()
    // The route already returned a real JSON body — proves it didn't block
    // on the still-pending sync promise.
    expect(json.ok).toBe(true)
    resolveSync({ ok: true, reason: 'updated_existing' })
    await new Promise((r) => setTimeout(r, 0))
  })

  it('a sync failure never surfaces as a webhook failure — the gate verdict still wins the response', async () => {
    syncTaskFromPREvent.mockResolvedValue({ ok: false, reason: 'update_failed' })
    const res = await POST(req('pull_request', prPayload()))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.verdict).toBe('approve')
  })

  it('a thrown sync rejection never surfaces as a webhook failure', async () => {
    syncTaskFromPREvent.mockRejectedValue(new Error('zerodb down'))
    const res = await POST(req('pull_request', prPayload()))
    const json = await res.json()
    expect(json.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('push events are unaffected — never call syncTaskFromPREvent', async () => {
    const res = await POST(req('push', { ref: 'refs/heads/main', repository: { name: 'acme', owner: { login: 'ws-w1' } } }))
    await res.json()
    await new Promise((r) => setTimeout(r, 0))
    expect(syncTaskFromPREvent).not.toHaveBeenCalled()
  })
})
