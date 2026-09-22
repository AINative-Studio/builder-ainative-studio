import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #464 — bridging the two disconnected "Business+ auto-enrolls into the nightly
 * loop" stores.
 *
 * setAppPlan() (lib/build/app-registry.ts) stamps `enrolled: true` on the
 * app-registry row for Business/Enterprise/cody_vcto plans, but nothing ever
 * READ that flag — the nightly cron (app/api/build/nightly-loop/route.ts)
 * iterates a completely separate store, lib/build/loop-enrollment.ts, whose
 * only writer was the founder-initiated "Hire the swarm" button
 * (POST /api/build/enroll). A company upgrading to Business+ never actually
 * landed in that real store, so the nightly loop silently never ran for it.
 *
 * POST /api/build/subscription/verify now calls the REAL enrollCompany() when
 * the verified plan qualifies, guarded by isEnrolled() first (this route is
 * documented as safe to call repeatedly for the same checkout — page refresh,
 * retry — and enrollCompany() itself has no dedup, so an unguarded call would
 * double-enroll and make the nightly loop process the company twice per run).
 */

const h = vi.hoisted(() => ({
  deployCompanyFromGitea: vi.fn(async () => ({ ok: false, reason: 'no_repo' })),
  companyDeployEnabled: vi.fn(() => false),
  setAppPlan: vi.fn(async () => true),
  setAppRailwayService: vi.fn(async () => true),
  resolveApp: vi.fn(),
  enrollCompany: vi.fn(async () => true),
  isEnrolled: vi.fn(async () => false),
  runNightlyLoop: vi.fn(async () => ({ companyId: 'acme', briefing: null, taskId: 'task-1', status: 'dispatched', detail: 'task queued for the swarm' })),
}))

vi.mock('@/lib/build/company-deploy', () => ({
  deployCompanyFromGitea: h.deployCompanyFromGitea,
  companyDeployEnabled: h.companyDeployEnabled,
}))
vi.mock('@/lib/build/instant-db', () => ({
  BUILDER_WORKSPACE_ID: '5d2376e1-d4f0-4193-9a7f-84e4543a8f9a',
}))
vi.mock('@/lib/build/app-registry', () => ({
  setAppPlan: h.setAppPlan,
  claimCompanyProject: vi.fn(async () => ({ ok: true, claimed: false })),
  setAppOwner: vi.fn(async () => true),
  setAppRailwayService: h.setAppRailwayService,
  resolveApp: h.resolveApp,
}))
vi.mock('@/lib/build/learning', () => ({ markConverted: vi.fn(async () => {}) }))
vi.mock('@/lib/build/conversions', () => ({
  reportConversion: vi.fn(async () => {}),
  gclidFromRequest: vi.fn(() => null),
}))
vi.mock('@/lib/build/meta-capi', () => ({
  reportMetaConversion: vi.fn(async () => {}),
  fbcFromRequest: vi.fn(() => undefined),
  fbpFromRequest: vi.fn(() => undefined),
}))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: vi.fn(() => 'guest:anon'),
}))
vi.mock('@/lib/build/referral', () => ({
  creditReferrerOnSubscribe: vi.fn(async () => 0),
}))
vi.mock('@/lib/build/loop-enrollment', () => ({
  enrollCompany: h.enrollCompany,
  isEnrolled: h.isEnrolled,
}))
vi.mock('@/lib/build/autonomous-loop', () => ({
  runNightlyLoop: h.runNightlyLoop,
}))
vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn(async () => null) }))

import { POST } from '@/app/api/build/subscription/verify/route'

function req(body: unknown) {
  return {
    json: async () => body,
    headers: { get: (_: string) => null },
  } as any
}

function coreVerify(plan: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { paid: true, plan_id: plan, plan_name: plan } }),
  } as unknown as Response
}

// A microtask flush so the fire-and-forget resolveApp().then(...) chain settles
// before assertions run — the route intentionally doesn't await this promise.
async function flush() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('POST /api/build/subscription/verify — #464 real loop-enrollment bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    h.deployCompanyFromGitea.mockReset().mockResolvedValue({ ok: false, reason: 'no_repo' })
    h.companyDeployEnabled.mockReset().mockReturnValue(false)
    h.setAppPlan.mockReset().mockResolvedValue(true)
    h.resolveApp.mockReset()
    h.enrollCompany.mockReset().mockResolvedValue(true)
    h.isEnrolled.mockReset().mockResolvedValue(false)
    h.runNightlyLoop.mockReset().mockResolvedValue({ companyId: 'acme', briefing: null, taskId: 'task-1', status: 'dispatched', detail: 'task queued for the swarm' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enrolls a Business-plan company into the REAL loop-enrollment store', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app', ownerEmail: 'Founder@Acme.com' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.enrolled).toBe(true)
    await flush()
    expect(h.isEnrolled).toHaveBeenCalledWith('acme')
    expect(h.enrollCompany).toHaveBeenCalledWith({
      companyId: 'acme',
      companyName: 'Acme',
      track: 'app',
      ownerKey: 'founder@acme.com', // normalized: trim + lowercase
    })
  })

  // #813 — a paid conversion must not just write an enrollment row; it must fire
  // the SAME first-dispatch the manual "Start Auto Mode" button uses, so a real
  // backlog task exists immediately rather than waiting on the next cron tick.
  it('#813 — fires ONE immediate runNightlyLoop dispatch right after enrolling a freshly-enrolled Business+ company', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'app', ownerEmail: 'Founder@Acme.com' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.runNightlyLoop).toHaveBeenCalledTimes(1)
    expect(h.runNightlyLoop).toHaveBeenCalledWith({ companyId: 'acme', companyName: 'Acme', track: 'app' })
  })

  it('#813 — does NOT fire a second dispatch for an ALREADY-enrolled company (idempotent on retry/refresh)', async () => {
    h.isEnrolled.mockResolvedValue(true)
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.enrollCompany).not.toHaveBeenCalled()
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
  })

  it('#841 — DOES dispatch for pro (was non-loop-eligible before #841 corrected the gate to Pro+)', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('pro'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.runNightlyLoop).toHaveBeenCalledTimes(1)
  })

  it('#813 — never fails checkout confirmation when runNightlyLoop rejects (best-effort dispatch)', async () => {
    h.runNightlyLoop.mockRejectedValue(new Error('agent swarm unavailable'))
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    await flush()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.paid).toBe(true)
    // The enrollment itself must still have gone through even though the dispatch failed.
    expect(h.enrollCompany).toHaveBeenCalled()
  })

  it('#813 — the enrollment write always happens BEFORE the dispatch is attempted', async () => {
    const order: string[] = []
    h.enrollCompany.mockImplementation(async () => { order.push('enroll'); return true })
    h.runNightlyLoop.mockImplementation(async () => { order.push('dispatch'); return { companyId: 'acme', briefing: null, taskId: 't-1', status: 'dispatched', detail: '' } })
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(order).toEqual(['enroll', 'dispatch'])
  })

  it('enrolls an Enterprise-plan company too', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('enterprise'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme', track: 'company' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'acme', track: 'company' }))
  })

  it('enrolls a cody_vcto-plan company too', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('cody_vcto'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalled()
  })

  it('#841 — DOES enroll a pro-plan company (was Business+ only)', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('pro'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    expect(json.enrolled).toBe(true)
    await flush()
    expect(h.enrollCompany).toHaveBeenCalled()
  })

  it('does NOT double-enroll an already-enrolled company (guarded by isEnrolled)', async () => {
    h.isEnrolled.mockResolvedValue(true)
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.isEnrolled).toHaveBeenCalledWith('acme')
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('defaults track to "app" when the registry entry has no track', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ track: 'app' }))
  })

  it('falls back to slug as companyName when the registry entry has no name', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'acme' }))
  })

  it('omits ownerKey when the company has no ownerEmail yet (anonymous build)', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(h.enrollCompany).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: undefined }))
  })

  it('never enrolls when the session is not paid', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { paid: false, plan_id: '', plan_name: '' } }) })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('never enrolls when no slug is provided', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    const res = await POST(req({ session_id: 'cs_test' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('never fails checkout confirmation when enrollCompany rejects', async () => {
    h.enrollCompany.mockRejectedValue(new Error('zerodb unavailable'))
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    const json = await res.json()
    await flush()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.paid).toBe(true)
    // enrollCompany threw, so the dispatch that would follow it never ran.
    expect(h.runNightlyLoop).not.toHaveBeenCalled()
  })

  it('never fails checkout confirmation when isEnrolled rejects', async () => {
    h.isEnrolled.mockRejectedValue(new Error('zerodb unavailable'))
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'chat-1', name: 'Acme' })
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('never fails checkout confirmation when resolveApp resolves null (registry lookup miss)', async () => {
    ;(fetch as any).mockResolvedValue(coreVerify('business'))
    h.resolveApp.mockResolvedValue(null)
    const res = await POST(req({ session_id: 'cs_test', slug: 'acme' }))
    await flush()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })
})
