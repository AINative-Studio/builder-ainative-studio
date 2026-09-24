import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * builder-ainative-studio#870 — register-app is the App track's real
 * slug-linking point (both chatId AND slug are in scope here), so its real
 * stages (ready_check, register, git_commit) are reported to core's
 * deployment-health API under entity_type "builder_app_generation". This is
 * the dominant real app-building traffic — #868 only wired the smaller
 * resolveTask() backlog-task pipeline, which core#6927's investigation found
 * left deployment_health_stages still at 0 rows even after that shipped.
 */

const h = vi.hoisted(() => ({
  registerApp: vi.fn(),
  resolveApp: vi.fn(),
  deployPersistent: vi.fn(),
  checkAppReady: vi.fn(),
  resolveStoredApp: vi.fn(),
  checkSeededData: vi.fn(),
  commitRegeneration: vi.fn(),
  provisionCompanyRepo: vi.fn(),
  toFileMapForCommit: vi.fn(),
  enrollCompany: vi.fn(),
  isEnrolled: vi.fn(),
  auth: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  reportDeploymentHealthStage: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ registerApp: h.registerApp, resolveApp: h.resolveApp }))
vi.mock('@/lib/build/deploy', () => ({ deployPersistent: h.deployPersistent }))
vi.mock('@/lib/build/ready-gate', () => ({ checkAppReady: h.checkAppReady, resolveStoredApp: h.resolveStoredApp }))
vi.mock('@/lib/build/seed-check', () => ({ checkSeededData: h.checkSeededData }))
vi.mock('@/lib/git/company-repo', () => ({
  commitRegeneration: h.commitRegeneration,
  provisionCompanyRepo: h.provisionCompanyRepo,
  toFileMapForCommit: h.toFileMapForCommit,
}))
vi.mock('@/lib/build/instant-db', () => ({ BUILDER_WORKSPACE_ID: 'builder-ws-default' }))
vi.mock('@/lib/build/loop-enrollment', () => ({ enrollCompany: h.enrollCompany, isEnrolled: h.isEnrolled }))
vi.mock('@/lib/build/company-email', () => ({ sendWelcomeEmail: h.sendWelcomeEmail }))
vi.mock('@/lib/build/deployment-health', () => ({ reportDeploymentHealthStage: h.reportDeploymentHealthStage }))

import { POST } from '@/app/api/build/register-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('POST /api/build/register-app — deployment-health stage reporting (#870)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/acme', dnsPointable: false })
    h.resolveApp.mockResolvedValue(null)
    h.resolveStoredApp.mockResolvedValue(null)
    h.toFileMapForCommit.mockReturnValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports ready_check + register under builder_app_generation, keyed on the real slug', async () => {
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'acme', 'ready_check', 'ok')
    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'acme', 'register', 'ok', undefined)
  })

  it('reports ready_check failed (and never reaches register) when the parse gate fails', async () => {
    h.checkAppReady.mockResolvedValue({ checked: true, ok: false, reason: 'syntax_error', error: 'Unexpected token' })

    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))

    expect(res.status).toBe(422)
    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'acme', 'ready_check', 'failed', 'syntax_error')
    expect(h.reportDeploymentHealthStage).not.toHaveBeenCalledWith(
      'builder_app_generation', expect.anything(), 'register', expect.anything(), expect.anything(),
    )
    expect(h.registerApp).not.toHaveBeenCalled()
  })

  it('does not report ready_check at all when the store-miss retry never resolves checked:true (fail-open path)', async () => {
    h.checkAppReady.mockResolvedValue({ checked: false, ok: true })

    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).not.toHaveBeenCalledWith(
      'builder_app_generation', expect.anything(), 'ready_check', expect.anything(),
    )
  }, 10_000)

  it('reports register failed when registerApp itself returns false', async () => {
    h.registerApp.mockResolvedValue(false)

    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith(
      'builder_app_generation', 'acme', 'register', 'failed', 'registerApp() returned false.',
    )
  })

  it('reports git_commit ok when a regeneration commit succeeds', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-old', gitRepoId: 'repo-1', ownerEmail: 'a@b.com' })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App() {}' })
    h.toFileMapForCommit.mockReturnValue({ 'App.tsx': 'export default function App() {}' })
    h.commitRegeneration.mockResolvedValue(true)

    await POST(req({ slug: 'acme', chatId: 'chat-old', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'acme', 'git_commit', 'ok')
  })

  it('reports git_commit failed when the commit throws', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-old', gitRepoId: 'repo-1', ownerEmail: 'a@b.com' })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App() {}' })
    h.toFileMapForCommit.mockReturnValue({ 'App.tsx': 'export default function App() {}' })
    h.commitRegeneration.mockRejectedValue(new Error('gitea unreachable'))

    await POST(req({ slug: 'acme', chatId: 'chat-old', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'acme', 'git_commit', 'failed')
  })

  it('never reports git_commit at all when there is nothing to commit (fresh, unprovisioned app)', async () => {
    h.resolveStoredApp.mockResolvedValue(null)
    h.toFileMapForCommit.mockReturnValue(null)

    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).not.toHaveBeenCalledWith(
      'builder_app_generation', expect.anything(), 'git_commit', expect.anything(),
    )
  })

  it('reports under the auto-suffixed slug (not the requested one) on a real collision', async () => {
    // A DIFFERENT chatId already owns 'acme' → this request gets auto-suffixed.
    h.resolveApp.mockImplementation(async (slug: string) =>
      slug === 'acme' ? { slug: 'acme', chatId: 'someone-elses-chat' } : null,
    )

    await POST(req({ slug: 'acme', chatId: 'chat-new', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.reportDeploymentHealthStage).toHaveBeenCalledWith('builder_app_generation', 'acme-2', 'register', 'ok', undefined)
  })

})
