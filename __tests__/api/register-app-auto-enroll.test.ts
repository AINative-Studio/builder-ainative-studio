import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Auto-enroll every registered company into the nightly backlog loop
 * (previously enrollment only ever happened at Business+ paid upgrade via
 * subscription/verify, or a founder manually clicking "Hire the swarm" —
 * a free build had no path in at all; confirmed live this session: real
 * companies like Greg Rose's Castlo/Tidemark and even some of the owner's
 * own free-tier companies were never enrolled anywhere).
 *
 * register-app is called on EVERY registration, including regenerations of
 * an already-registered company — guarded by isEnrolled() first so a
 * regen doesn't re-enroll (enrollCompany() itself has no dedup).
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
  enrollCompany: vi.fn(),
  isEnrolled: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ registerApp: h.registerApp, resolveApp: h.resolveApp }))
vi.mock('@/lib/build/deploy', () => ({ deployPersistent: h.deployPersistent }))
vi.mock('@/lib/build/ready-gate', () => ({ checkAppReady: h.checkAppReady, resolveStoredApp: h.resolveStoredApp }))
vi.mock('@/lib/build/seed-check', () => ({ checkSeededData: h.checkSeededData }))
vi.mock('@/lib/git/company-repo', () => ({
  commitRegeneration: h.commitRegeneration,
  provisionCompanyRepo: h.provisionCompanyRepo,
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

describe('POST /api/build/register-app — auto-enroll into the nightly loop', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    // checked:true skips register-app's own 3x/2s re-check retry loop (a
    // store-miss recovery mechanism, unrelated to what THIS test file
    // covers) — checked:false here would make every test wait ~6 real
    // seconds for no reason.
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/acme', dnsPointable: false })
    h.resolveApp.mockResolvedValue(null)
    h.resolveStoredApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enrolls a brand-new app-track company on first registration', async () => {
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.isEnrolled).toHaveBeenCalledWith('acme')
    expect(h.enrollCompany).toHaveBeenCalledWith({
      companyId: 'acme', companyName: 'Acme', track: 'app', ownerKey: undefined,
    })
  })

  it('enrolls a company-track registration too', async () => {
    await POST(req({ slug: 'acme-co', chatId: 'chat-1', name: 'Acme Co', track: 'company' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ track: 'company' }))
  })

  it('captures the signed-in founder email as ownerKey', async () => {
    h.auth.mockResolvedValue({ user: { email: 'Founder@Acme.com' } })
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: 'founder@acme.com' }))
  })

  it('does NOT double-enroll a regeneration of an already-enrolled company', async () => {
    h.isEnrolled.mockResolvedValue(true)
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'old-chat', name: 'Acme', track: 'app', ownerEmail: 'a@b.com' })
    await POST(req({ slug: 'acme', chatId: 'chat-2', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.isEnrolled).toHaveBeenCalledWith('acme')
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('falls back to the slug as companyName when no name is given', async () => {
    await POST(req({ slug: 'acme', chatId: 'chat-1', track: 'app' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'acme' }))
  })

  it('never enrolls when registerApp itself fails', async () => {
    h.registerApp.mockResolvedValue(false)
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('never fails registration when enrollCompany rejects', async () => {
    h.enrollCompany.mockRejectedValue(new Error('zerodb unavailable'))
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('never fails registration when isEnrolled rejects', async () => {
    h.isEnrolled.mockRejectedValue(new Error('zerodb unavailable'))
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('never enrolls when required fields are missing (existing validation still applies)', async () => {
    const res = await POST(req({ chatId: 'chat-1' }))
    expect(res.status).toBe(400)
    await flush()
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })
})
