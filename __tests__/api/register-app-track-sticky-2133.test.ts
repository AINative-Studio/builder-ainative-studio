import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #2133: register-app's `track` field must be STICKY across regens, the
 * same way name/tagline/color/idea already fall back to `existing` when the
 * client omits them. Before this fix, `track = b.track === 'company' ?
 * 'company' : 'app'` ran unconditionally — any regen call whose body didn't
 * resend `track` (or sent an invalid value) silently flipped an
 * already-registered company-track entry to 'app', which gates its public
 * /build/{slug} link behind the app-track login wall in middleware.ts.
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
  enrollCompany: vi.fn(),
  isEnrolled: vi.fn(),
  syncEnrollmentOwnerKey: vi.fn(),
  auth: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ registerApp: h.registerApp, resolveApp: h.resolveApp, resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/deploy', () => ({ deployPersistent: h.deployPersistent }))
vi.mock('@/lib/build/ready-gate', () => ({ checkAppReady: h.checkAppReady, resolveStoredApp: h.resolveStoredApp }))
vi.mock('@/lib/build/seed-check', () => ({ checkSeededData: h.checkSeededData }))
vi.mock('@/lib/git/company-repo', () => ({
  commitRegeneration: h.commitRegeneration,
  provisionCompanyRepo: h.provisionCompanyRepo,
}))
vi.mock('@/lib/build/instant-db', () => ({ BUILDER_WORKSPACE_ID: 'builder-ws-default' }))
vi.mock('@/lib/build/loop-enrollment', () => ({
  enrollCompany: h.enrollCompany, isEnrolled: h.isEnrolled, syncEnrollmentOwnerKey: h.syncEnrollmentOwnerKey,
}))

import { POST } from '@/app/api/build/register-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('POST /api/build/register-app — track is sticky across regens (#2133)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.resolveAppVerified.mockImplementation(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true }))
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/tidemark', dnsPointable: false })
    h.resolveApp.mockResolvedValue(null)
    h.resolveStoredApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps an existing company-track entry company-track when a regen omits track entirely', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark', track: 'company' })
    await POST(req({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark' }))
    await flush()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ track: 'company' }))
  })

  it('keeps an existing company-track entry company-track when a regen sends an invalid track value', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark', track: 'company' })
    await POST(req({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark', track: null }))
    await flush()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ track: 'company' }))
  })

  it('keeps an existing app-track entry app-track when a regen omits track', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'habanero-hub', chatId: 'chat-2', name: 'Habanero Hub', track: 'app' })
    await POST(req({ slug: 'habanero-hub', chatId: 'chat-2', name: 'Habanero Hub' }))
    await flush()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ track: 'app' }))
  })

  it('still honors an explicit, valid track change on a regen', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark', track: 'company' })
    await POST(req({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark', track: 'app' }))
    await flush()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ track: 'app' }))
  })

  it('defaults a genuinely new company (no existing row) to app-track when track is omitted', async () => {
    h.resolveApp.mockResolvedValue(null)
    h.isEnrolled.mockResolvedValue(false)
    await POST(req({ slug: 'brandnew', chatId: 'chat-1', name: 'Brand New' }))
    await flush()
    expect(h.registerApp).toHaveBeenCalledWith(expect.objectContaining({ track: 'app' }))
  })

  it('does not flip the nightly-loop enrollment track either, on a company-track regen that omits track', async () => {
    h.isEnrolled.mockResolvedValue(false)
    h.resolveApp.mockResolvedValue({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark', track: 'company' })
    await POST(req({ slug: 'tidemark', chatId: 'chat-2', name: 'Tidemark' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ track: 'company' }))
  })
})
