import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1543 — a company's Gitea repo must land in the FOUNDER'S OWN workspace
 * org, not the single shared platform-wide org every company's repo was
 * previously filed under. ensureOrg(workspaceId) (lib/git/gitea-client.ts)
 * was always correctly generic; every call site hardcoded BUILDER_WORKSPACE_ID
 * instead of the real, already-resolved session.workspaceId (set at login via
 * resolveDefaultWorkspace() in app/(auth)/auth.ts). This was the ORIGINAL
 * locked decision in #354 ("one Gitea org per AINative workspace, one repo
 * per company") that drifted in implementation — not a new design.
 *
 * register-app/route.ts already resolves a session (for the ownerEmail
 * stamp) before calling runGitCommit — this just threads session.workspaceId
 * through too.
 */

const h = vi.hoisted(() => ({
  registerApp: vi.fn(),
  resolveApp: vi.fn(),
  resolveAppVerified: vi.fn(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true })),
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
  setAppWiring: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ registerApp: h.registerApp, resolveApp: h.resolveApp, resolveAppVerified: h.resolveAppVerified, setAppWiring: h.setAppWiring }))
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

import { POST } from '@/app/api/build/register-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('POST /api/build/register-app — provisions a new repo under the founder\'s own workspace org (#1543)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.resolveAppVerified.mockImplementation(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true }))
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/acme', dnsPointable: false })
    h.resolveApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
    h.setAppWiring.mockResolvedValue(true)
    // A company that's ZeroDB-provisioned but has no repo yet — the branch
    // that actually calls provisionCompanyRepo (new-repo creation).
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app', zerodbProjectId: 'proj_1' })
    h.resolveStoredApp.mockResolvedValue({ code: 'export default function App(){ return null }', files: null })
    h.toFileMapForCommit.mockReturnValue({ 'App.tsx': 'export default function App(){ return null }' })
    h.provisionCompanyRepo.mockResolvedValue({ ok: true, gitRepoUrl: 'https://git.example/ws-x/acme.git' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the signed-in founder\'s real session workspaceId when provisioning a new repo', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@acme.com' }, workspaceId: 'ws-real-founder-789' })

    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.provisionCompanyRepo).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-real-founder-789' }),
    )
  })

  it('falls back to the shared platform constant for an anonymous registration (no session)', async () => {
    h.auth.mockResolvedValue(null)

    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(h.provisionCompanyRepo).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'builder-ws-default' }),
    )
  })

  it('never fails registration when auth() itself throws — falls back to the shared constant', async () => {
    h.auth.mockRejectedValue(new Error('auth hiccup'))

    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()

    expect(res.status).toBe(200)
    expect(h.provisionCompanyRepo).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'builder-ws-default' }),
    )
  })

  it('two different founders\' companies resolve to two different workspace ids', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder-a@acme.com' }, workspaceId: 'ws-founder-a' })
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    const firstCallWorkspace = h.provisionCompanyRepo.mock.calls[0][0].workspaceId

    h.provisionCompanyRepo.mockClear()
    h.resolveApp.mockResolvedValue({ slug: 'beta', chatId: 'chat-2', name: 'Beta', track: 'app', zerodbProjectId: 'proj_2' })
    h.auth.mockResolvedValue({ user: { email: 'founder-b@beta.com' }, workspaceId: 'ws-founder-b' })
    await POST(req({ slug: 'beta', chatId: 'chat-2', name: 'Beta', track: 'app' }))
    await flush()
    const secondCallWorkspace = h.provisionCompanyRepo.mock.calls[0][0].workspaceId

    expect(firstCallWorkspace).toBe('ws-founder-a')
    expect(secondCallWorkspace).toBe('ws-founder-b')
    expect(firstCallWorkspace).not.toBe(secondCallWorkspace)
  })
})
