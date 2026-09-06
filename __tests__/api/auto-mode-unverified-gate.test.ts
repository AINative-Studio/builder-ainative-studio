import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * POST /api/build/auto-mode — the START AUTO MODE gate.
 *
 * Real bug (live, Enterprise account): the server-side plan gate used to
 * return `reason: 'not_paid'` whenever resolveActivePlan() couldn't verify
 * the caller's plan (a transient core /auth/me timeout/5xx) — identical to a
 * genuinely unpaid account. The panel treats 'not_paid' as "redirect to
 * pricing," so a real paying founder got silently bounced to checkout on a
 * blip that had nothing to do with their entitlement. Fixed: verification
 * failure now returns 'unverified' (retryable, no redirect) instead.
 */

vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: {}, accessToken: 'tok' }) }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: vi.fn() }))
vi.mock('@/lib/build/loop-enrollment', () => ({
  enrollCompany: vi.fn().mockResolvedValue(true),
  setLoopEnabled: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/build/autonomous-loop', () => ({ runNightlyLoop: vi.fn() }))
vi.mock('@/lib/build/auto-mode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/auto-mode')>('@/lib/build/auto-mode')
  return {
    ...actual,
    autoModeConfigured: () => true,
    startAutoRun: vi.fn(),
    getAutoRun: vi.fn(),
    appendAutoRunEvent: vi.fn().mockResolvedValue(null),
  }
})

function req(body: unknown) {
  return new Request('http://localhost/api/build/auto-mode', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any
}

afterEach(() => vi.clearAllMocks())

describe('POST /api/build/auto-mode — plan gate', () => {
  it('a confirmed unpaid account (verified:true, plan:"") gets not_paid — real gating still works', async () => {
    const { resolveActivePlan } = await import('@/lib/ainative/active-plan')
    ;(resolveActivePlan as any).mockResolvedValue({ plan: '', verified: true })
    const { POST } = await import('@/app/api/build/auto-mode/route')
    const res = await POST(req({ companyId: 'co-1', action: 'start' }))
    const data = await res.json()
    expect(data).toEqual({ ok: false, reason: 'not_paid' })
  })

  it('THE FIX: an UNVERIFIED plan check (core hiccup) never returns not_paid — no redirect', async () => {
    const { resolveActivePlan } = await import('@/lib/ainative/active-plan')
    ;(resolveActivePlan as any).mockResolvedValue({ plan: '', verified: false })
    const { POST } = await import('@/app/api/build/auto-mode/route')
    const res = await POST(req({ companyId: 'co-1', action: 'start' }))
    const data = await res.json()
    expect(data.reason).toBe('unverified')
    expect(data.reason).not.toBe('not_paid')
  })

  it('a real enterprise account (verified:true, plan:"enterprise") is never gated', async () => {
    const { resolveActivePlan } = await import('@/lib/ainative/active-plan')
    ;(resolveActivePlan as any).mockResolvedValue({ plan: 'enterprise', verified: true })
    const { startAutoRun } = await import('@/lib/build/auto-mode')
    ;(startAutoRun as any).mockResolvedValue({ companyId: 'co-1', duration: '4h', startedAt: 'now', expiresAt: null })
    const { runNightlyLoop } = await import('@/lib/build/autonomous-loop')
    ;(runNightlyLoop as any).mockResolvedValue({ taskId: 't1', status: 'dispatched' })
    const { POST } = await import('@/app/api/build/auto-mode/route')
    const res = await POST(req({ companyId: 'co-1', companyName: 'Co', action: 'start' }))
    const data = await res.json()
    expect(data.ok).toBe(true)
  })
})
