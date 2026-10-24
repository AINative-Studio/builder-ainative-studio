import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Auto-create the ad-test campaign on real build completion (#1017), from the
 * live client-triggered registration path.
 *
 * The hook point is deliberately AFTER the ready gate and the git commit — the
 * two stages #1015 identified as "this founder's build is genuinely complete",
 * not merely generated/registered. A company whose gate blocked never reaches
 * it, because the route returns 422 before that point.
 *
 * Mirrors register-app-welcome-email.test.ts's mock setup, since this is a
 * sibling fire-and-forget branch in the same route.
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
  auth: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  autoCreateAdTestCampaign: vi.fn(),
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
vi.mock('@/lib/build/loop-enrollment', () => ({ enrollCompany: h.enrollCompany, isEnrolled: h.isEnrolled }))
vi.mock('@/lib/build/company-email', () => ({ sendWelcomeEmail: h.sendWelcomeEmail }))
vi.mock('@/lib/build/ad-test-autocreate', () => ({ autoCreateAdTestCampaign: h.autoCreateAdTestCampaign }))

import { POST } from '@/app/api/build/register-app/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('POST /api/build/register-app — ad-test auto-create (#1017)', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.resolveAppVerified.mockImplementation(async (slug: string) => ({ entry: await h.resolveApp(slug), verified: true }))
    h.checkAppReady.mockResolvedValue({ checked: true, ok: true })
    h.deployPersistent.mockResolvedValue({ url: 'https://builder.ainative.studio/build/acme', dnsPointable: false })
    h.resolveApp.mockResolvedValue(null)
    h.resolveStoredApp.mockResolvedValue(null)
    h.registerApp.mockResolvedValue(true)
    h.auth.mockResolvedValue(null)
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
    h.sendWelcomeEmail.mockResolvedValue({ ok: true })
    h.autoCreateAdTestCampaign.mockResolvedValue({ created: true, campaignId: 'camp_auto_1' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fires auto-create for the registered slug on a completed build', async () => {
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.autoCreateAdTestCampaign).toHaveBeenCalledWith('acme')
  })

  it('fires for an ANONYMOUS registration too — no plan/tier/session gate (#1017)', async () => {
    h.auth.mockResolvedValue(null)
    await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(h.autoCreateAdTestCampaign).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire when the ready gate blocked the build (not a completed build)', async () => {
    h.checkAppReady.mockResolvedValue({ checked: true, ok: false, reason: 'syntax_error' })
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    expect(res.status).toBe(422)
    await flush()
    expect(h.autoCreateAdTestCampaign).not.toHaveBeenCalled()
  })

  it('never fails registration when auto-create rejects', async () => {
    h.autoCreateAdTestCampaign.mockRejectedValue(new Error('meta down'))
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('never fails registration when auto-create reports a non-creation', async () => {
    h.autoCreateAdTestCampaign.mockResolvedValue({ created: false, reason: 'disabled' })
    const res = await POST(req({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('uses the ACTUAL registered slug when the requested one collided and was suffixed', async () => {
    // A DIFFERENT chatId already owns "acme" → the route auto-suffixes.
    h.resolveApp.mockImplementation(async (slug: string) => {
      if (slug === 'acme') return { slug: 'acme', chatId: 'other-chat', name: 'Other', createdAt: '2026-01-01' }
      return null
    })
    const res = await POST(req({ slug: 'acme', chatId: 'chat-mine', name: 'Acme', track: 'app' }))
    const body = await res.json()
    await flush()
    expect(body.slug).toBe('acme-2')
    expect(h.autoCreateAdTestCampaign).toHaveBeenCalledWith('acme-2')
  })
})
