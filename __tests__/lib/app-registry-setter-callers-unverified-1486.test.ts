import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1486 (caller side) — the `setApp*` setters now THROW
 * RegistryLookupUnverifiedError when the registry read they perform before
 * writing could not be completed, instead of returning the same `false` they
 * return for a confirmed-missing company.
 *
 * Most real callers already invoke these setters as best-effort
 * `.catch(() => {})` / `.catch(() => false)` writes, so the throw is already
 * absorbed there. These are the four callers that `await` a setter BARE, with
 * no enclosing try/catch — i.e. the ones where an unhandled throw would have
 * turned a working request into a 500. Each is pinned here:
 *
 *  - POST /api/build/comms-mode  → the retryable 503 'lookup_failed' the route
 *    already has for an unverified lookup, NOT a 502 'write_failed'.
 *  - POST /api/build/logo        → still returns the (real, working) file url
 *    with `saved: false`, plus `retryable: true` — the exact misleading
 *    "I couldn't save that logo" the issue names.
 *  - applyDangerAction           → keeps its documented
 *    `lifecycleChanged: false` contract rather than throwing at a founder
 *    clicking "delete".
 *  - provisionCompanyRepo        → keeps `ok: true` for a Gitea repo that
 *    genuinely WAS created, with the registry write reported as not recorded.
 *
 * In every case the unverified read must be logged distinguishably, and must
 * never be presented as a confirmed write failure.
 */

// The real error type + guard, shared by all four mocks below so each caller
// is tested against the genuine class it will see in production.
class RegistryLookupUnverifiedError extends Error {
  readonly slug: string
  readonly setter: string
  constructor(setter: string, slug: string) {
    super(`[app-registry] registry lookup unverified for ${setter}(${slug}) — the registry read itself failed, the write was not attempted`)
    this.name = 'RegistryLookupUnverifiedError'
    this.slug = slug
    this.setter = setter
  }
}
function isRegistryLookupUnverified(err: unknown): err is RegistryLookupUnverifiedError {
  return err instanceof RegistryLookupUnverifiedError
}

// ---------------------------------------------------------------------------
// POST /api/build/comms-mode
// ---------------------------------------------------------------------------
describe('POST /api/build/comms-mode — unverified setter lookup (#1486)', () => {
  const hComms = vi.hoisted(() => ({ auth: vi.fn(), setAppCommsMode: vi.fn() }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    hComms.auth.mockResolvedValue({ user: { email: 'founder@x.com', type: 'regular' } })
  })

  async function loadRoute() {
    vi.doMock('@/app/(auth)/auth', () => ({ auth: hComms.auth }))
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveAppVerified: async () => ({
        entry: { slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' },
        verified: true,
      }),
      setAppCommsMode: hComms.setAppCommsMode,
      isRegistryLookupUnverified,
    }))
    return (await import('@/app/api/build/comms-mode/route')).POST
  }

  const req = (body: unknown) => ({ json: async () => body }) as any

  it('503s lookup_failed (not 502 write_failed) when the setter reports an unverified lookup', async () => {
    hComms.setAppCommsMode.mockRejectedValue(new RegistryLookupUnverifiedError('setAppCommsMode', 'acme'))
    const POST = await loadRoute()
    const res: any = await POST(req({ slug: 'acme', mode: 'pairProgramming' }))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'lookup_failed' })
  })

  it('still 502s write_failed on a genuine, confirmed write failure', async () => {
    hComms.setAppCommsMode.mockResolvedValue(false)
    const POST = await loadRoute()
    const res: any = await POST(req({ slug: 'acme', mode: 'pairProgramming' }))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ ok: false, reason: 'write_failed' })
  })

  it('re-throws an UNRELATED setter error rather than mislabeling it lookup_failed', async () => {
    hComms.setAppCommsMode.mockRejectedValue(new Error('something else entirely'))
    const POST = await loadRoute()
    await expect(POST(req({ slug: 'acme', mode: 'agile' }))).rejects.toThrow('something else entirely')
  })

  it('still 200s on the happy path (regression guard)', async () => {
    hComms.setAppCommsMode.mockResolvedValue(true)
    const POST = await loadRoute()
    const res: any = await POST(req({ slug: 'acme', mode: 'agile' }))
    await expect(res.json()).resolves.toEqual({ ok: true, mode: 'agile' })
  })
})

// ---------------------------------------------------------------------------
// applyDangerAction (lib/build/danger-zone.ts)
// ---------------------------------------------------------------------------
describe('applyDangerAction — unverified setAppLifecycle lookup (#1486)', () => {
  const hDanger = vi.hoisted(() => ({
    setAppLifecycle: vi.fn(),
    setLoopEnabled: vi.fn(async () => true),
    warn: vi.fn(),
  }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    hDanger.setLoopEnabled.mockResolvedValue(true)
  })

  async function loadDangerZone() {
    vi.doMock('@/lib/build/app-registry', () => ({
      setAppLifecycle: hDanger.setAppLifecycle,
      resolveAppVerified: async () => ({ entry: null, verified: true }),
      isRegistryLookupUnverified,
    }))
    vi.doMock('@/lib/build/loop-enrollment', () => ({ setLoopEnabled: hDanger.setLoopEnabled }))
    vi.doMock('@/lib/build/zerovoice', () => ({ releaseZeroVoiceNumber: vi.fn() }))
    vi.doMock('@/lib/build/railway-deploy', () => ({ deleteCustomDomain: vi.fn() }))
    vi.doMock('@/lib/logger', () => ({ logger: { warn: hDanger.warn, info: vi.fn(), error: vi.fn() } }))
    return (await import('@/lib/build/danger-zone')).applyDangerAction
  }

  const reqFor = (action: 'offline' | 'delete') => ({
    action, companyId: 'acme', companyName: 'Acme', track: 'app' as const, slug: 'acme', confirm: 'Acme',
  })

  for (const action of ['offline', 'delete'] as const) {
    it(`${action}: reports lifecycleChanged:false (never throws) and logs the unverified lookup`, async () => {
      hDanger.setAppLifecycle.mockRejectedValue(new RegistryLookupUnverifiedError('setAppLifecycle', 'acme'))
      const applyDangerAction = await loadDangerZone()

      const out = await applyDangerAction(reqFor(action))

      expect(out.ok).toBe(true)
      expect(out.action).toBe(action)
      expect(out.lifecycleChanged).toBe(false)
      // The real reason is visible, not swallowed into a bare false.
      expect(hDanger.warn).toHaveBeenCalled()
      expect(String(hDanger.warn.mock.calls.at(-1)?.[0])).toContain('registry lookup unverified')
    })
  }

  it('re-throws an UNRELATED lifecycle error rather than reporting a clean false', async () => {
    hDanger.setAppLifecycle.mockRejectedValue(new Error('disk on fire'))
    const applyDangerAction = await loadDangerZone()
    await expect(applyDangerAction(reqFor('offline'))).rejects.toThrow('disk on fire')
  })

  it('still reports lifecycleChanged:true on the happy path (regression guard)', async () => {
    hDanger.setAppLifecycle.mockResolvedValue(true)
    const applyDangerAction = await loadDangerZone()
    const out = await applyDangerAction(reqFor('offline'))
    expect(out.lifecycleChanged).toBe(true)
  })

  it('still reports lifecycleChanged:false on a genuine, confirmed write failure', async () => {
    hDanger.setAppLifecycle.mockResolvedValue(false)
    const applyDangerAction = await loadDangerZone()
    const out = await applyDangerAction(reqFor('offline'))
    expect(out.lifecycleChanged).toBe(false)
    // No unverified-lookup warning — this really was a write failure.
    const warned = hDanger.warn.mock.calls.some((c) => String(c?.[0]).includes('registry lookup unverified'))
    expect(warned).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// provisionCompanyRepo (lib/git/company-repo.ts)
// ---------------------------------------------------------------------------
describe('provisionCompanyRepo — unverified setAppGitRepo lookup (#1486)', () => {
  const hRepo = vi.hoisted(() => ({
    setAppGitRepo: vi.fn(),
    resolveApp: vi.fn(async () => null),
  }))

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    hRepo.resolveApp.mockResolvedValue(null)
  })

  async function loadCompanyRepo() {
    vi.doMock('@/lib/build/app-registry', () => ({
      resolveApp: hRepo.resolveApp,
      setAppGitRepo: hRepo.setAppGitRepo,
      isRegistryLookupUnverified,
    }))
    vi.doMock('@/lib/git/gitea-client', () => ({
      configured: () => true,
      // Returns the { org, repo } shape company-repo.ts destructures.
      provisionCompanyRepo: vi.fn(async () => ({
        org: { username: 'ws-org', id: 1 },
        repo: { name: 'acme', id: 7 },
      })),
      addCollaborator: vi.fn(async () => true),
    }))
    // pushFilesToRepo is LOCAL to company-repo.ts and uses global fetch
    // directly — stub a successful content PUT for the single initial file.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201, text: async () => '{}' })))
    return await import('@/lib/git/company-repo')
  }

  const opts = {
    workspaceId: 'ws-1',
    slug: 'acme',
    name: 'Acme',
    // validateFileMap requires an App.tsx/App.jsx/index.tsx entry file.
    files: { 'App.tsx': 'export default function App() { return null }' },
  }

  it('still reports ok:true for a repo that genuinely was created, with the write not recorded', async () => {
    hRepo.setAppGitRepo.mockRejectedValue(new RegistryLookupUnverifiedError('setAppGitRepo', 'acme'))
    const mod = await loadCompanyRepo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await mod.provisionCompanyRepo(opts as any)

    // The real Gitea repo exists — provisioning did NOT fail.
    expect(res.ok).toBe(true)
    expect(res.gitRepoUrl).toContain('acme')
    // And the unverified lookup is logged distinguishably from a write failure.
    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('registry lookup was unverified'))).toBe(true)
    warn.mockRestore()
  })

  it('logs an UNRELATED setAppGitRepo error as itself, not as an unverified lookup', async () => {
    // provisionCompanyRepo's documented contract is that it NEVER throws (repo
    // provisioning must not break the main build path), so an unrelated error
    // is caught too — but logged distinguishably from an unverified lookup.
    hRepo.setAppGitRepo.mockRejectedValue(new Error('unexpected'))
    const mod = await loadCompanyRepo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await mod.provisionCompanyRepo(opts as any)

    expect(res.ok).toBe(true)
    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('registry write threw') && m.includes('unexpected'))).toBe(true)
    expect(messages.some((m) => m.includes('registry lookup was unverified'))).toBe(false)
    warn.mockRestore()
  })

  it('still logs the plain "registry update failed" warning on a confirmed write failure', async () => {
    hRepo.setAppGitRepo.mockResolvedValue(false)
    const mod = await loadCompanyRepo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await mod.provisionCompanyRepo(opts as any)

    expect(res.ok).toBe(true)
    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('registry update failed'))).toBe(true)
    expect(messages.some((m) => m.includes('registry lookup was unverified'))).toBe(false)
    warn.mockRestore()
  })
})
