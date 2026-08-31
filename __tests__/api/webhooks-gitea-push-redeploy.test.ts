import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #392 — Gitea `push` webhook triggers a redeploy of an ALREADY-provisioned
 * company's dedicated Railway service (deferred follow-up from #381; the
 * only prior deploy trigger was a new paid checkout, #389 — a company never
 * updated again after its first deploy).
 *
 * Deliberately narrow: this NEVER provisions a new company. Every branch
 * mirrors the honesty/never-throw conventions established in
 * subscription-verify-deploy.test.ts (#389) — mock every I/O collaborator so
 * no network/Railway call is real.
 */

const h = vi.hoisted(() => ({
  deployCompanyFromGitea: vi.fn(),
  companyDeployEnabled: vi.fn(() => true),
  setAppRailwayService: vi.fn(async () => true),
  resolveApp: vi.fn(),
  handlePRWebhook: vi.fn(async () => ({ ok: true, verdict: 'approve', summary: 'ok' })),
}))
const { deployCompanyFromGitea, companyDeployEnabled, setAppRailwayService, resolveApp, handlePRWebhook } = h

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

import { POST, handlePushRedeploy } from '@/app/api/webhooks/gitea/route'

function req(event: string, body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-gitea-event' ? event : headers[k] ?? null) },
    text: async () => JSON.stringify(body),
  } as any
}

const pushPayload = (overrides: Partial<{ ref: string; repository: any }> = {}) => ({
  ref: 'refs/heads/main',
  repository: { name: 'acme', owner: { login: 'ws-w1' } },
  ...overrides,
})

describe('handlePushRedeploy (pure orchestration, #392)', () => {
  beforeEach(() => {
    deployCompanyFromGitea.mockReset()
    companyDeployEnabled.mockReset().mockReturnValue(true)
    setAppRailwayService.mockReset().mockResolvedValue(true)
    resolveApp.mockReset()
  })

  it('ignores a push to a non-main branch — never calls resolveApp at all', async () => {
    const result = await handlePushRedeploy(pushPayload({ ref: 'refs/heads/task/foo' }))
    expect(result.ok).toBe(true)
    expect(result.reason).toMatch(/ignored_branch/)
    expect(resolveApp).not.toHaveBeenCalled()
  })

  it('rejects a payload missing repository info, never throws', async () => {
    const result = await handlePushRedeploy({ ref: 'refs/heads/main' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_payload')
  })

  it('is a silent no-op for a company unknown to the registry', async () => {
    resolveApp.mockResolvedValue(null)
    const result = await handlePushRedeploy(pushPayload())
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('unknown_company')
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })

  it('is a silent no-op for a company that has NEVER been deployed (no railwayServiceId) — never auto-provisions', async () => {
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1' })
    const result = await handlePushRedeploy(pushPayload())
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('not_yet_provisioned')
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })

  it('skips cleanly when RAILWAY_DEPLOY_ENABLED is off, even for an already-provisioned company', async () => {
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1', railwayServiceId: 'company-acme' })
    companyDeployEnabled.mockReturnValue(false)
    const result = await handlePushRedeploy(pushPayload())
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('deploy_disabled')
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })

  it('redeploys an already-provisioned company on a real main-branch push, alreadyProvisioned=true', async () => {
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1', railwayServiceId: 'company-acme' })
    deployCompanyFromGitea.mockResolvedValue({
      ok: true,
      serviceName: 'company-acme',
      url: 'https://company-acme-production.up.railway.app',
    })
    const result = await handlePushRedeploy(pushPayload())
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('redeployed')
    expect(deployCompanyFromGitea).toHaveBeenCalledWith('ws-1', 'acme', true)
    expect(setAppRailwayService).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ railwayServiceId: 'company-acme', deployUrl: 'https://company-acme-production.up.railway.app' }),
    )
  })

  it('falls back to BUILDER_WORKSPACE_ID when the company has no persisted workspaceId', async () => {
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', railwayServiceId: 'company-acme' })
    deployCompanyFromGitea.mockResolvedValue({ ok: true, serviceName: 'company-acme' })
    await handlePushRedeploy(pushPayload())
    expect(deployCompanyFromGitea).toHaveBeenCalledWith('5d2376e1-d4f0-4193-9a7f-84e4543a8f9a', 'acme', true)
  })

  it('surfaces a real deploy failure honestly — never fabricates success', async () => {
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1', railwayServiceId: 'company-acme' })
    deployCompanyFromGitea.mockResolvedValue({ ok: false, reason: 'railway up failed: build error' })
    const result = await handlePushRedeploy(pushPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/build error/)
    expect(setAppRailwayService).not.toHaveBeenCalled()
  })

  it('never throws — a thrown collaborator error is caught and surfaced as a structured failure', async () => {
    resolveApp.mockRejectedValue(new Error('zerodb timeout'))
    const result = await handlePushRedeploy(pushPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/zerodb timeout/)
  })
})

describe('POST /api/webhooks/gitea — push event routing (#392)', () => {
  beforeEach(() => {
    deployCompanyFromGitea.mockReset()
    companyDeployEnabled.mockReset().mockReturnValue(true)
    setAppRailwayService.mockReset().mockResolvedValue(true)
    resolveApp.mockReset()
    handlePRWebhook.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('responds immediately for a push event WITHOUT waiting for the redeploy to finish', async () => {
    resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', workspaceId: 'ws-1', railwayServiceId: 'company-acme' })
    let resolveDeploy: (v: any) => void = () => {}
    deployCompanyFromGitea.mockReturnValue(new Promise((resolve) => { resolveDeploy = resolve }))

    const res = await POST(req('push', pushPayload()))
    const json = await res.json()

    // The route returned WITHOUT the deploy call having resolved yet — proves
    // it isn't awaited on the response path (a real `railway up` can take
    // minutes; Gitea must get a fast ack regardless).
    expect(json.ok).toBe(true)
    expect(deployCompanyFromGitea).toHaveBeenCalled()

    resolveDeploy({ ok: true, serviceName: 'company-acme' })
    await new Promise((r) => setTimeout(r, 0)) // let the detached promise settle
  })

  it('ignores a non-main-branch push at the route level too — never even attempts a redeploy', async () => {
    const res = await POST(req('push', pushPayload({ ref: 'refs/heads/task/foo' })))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(resolveApp).not.toHaveBeenCalled()
  })

  it('unrelated events are ignored, unaffected by the new push handling', async () => {
    const res = await POST(req('issue', {}))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message).toMatch(/Ignored event/)
    expect(handlePRWebhook).not.toHaveBeenCalled()
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })

  it('pull_request handling is completely unaffected by the push addition (regression)', async () => {
    const res = await POST(req('pull_request', { action: 'opened', number: 1, repository: { name: 'acme', owner: { login: 'ws-w1' } }, pull_request: {} }))
    const json = await res.json()
    expect(handlePRWebhook).toHaveBeenCalledTimes(1)
    expect(json.ok).toBe(true)
    expect(deployCompanyFromGitea).not.toHaveBeenCalled()
  })
})
