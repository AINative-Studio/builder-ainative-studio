import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * lib/ainative/active-plan — server-side ActivePlan resolution used by every
 * paid-gated route (auto-mode, growth, swarm, …).
 *
 * Real bug (live, Enterprise account): a transient core `/auth/me` failure
 * (timeout, 5xx, network error) used to resolve to the EXACT SAME shape as a
 * confirmed "no plan" account — {plan:'', signedIn:true} — so a caller like
 * auto-mode's isGated() could not tell "couldn't verify right now" apart from
 * "genuinely not paid," and silently bounced a real paying founder to
 * checkout on a blip that had nothing to do with their entitlement. The fix
 * adds `verified` so callers can fail toward "can't tell yet" instead of
 * "must upgrade."
 */

vi.mock('@/app/(auth)/auth', () => ({ auth: vi.fn() }))

async function freshWithSession(session: unknown) {
  vi.resetModules()
  const { auth } = await import('@/app/(auth)/auth')
  ;(auth as any).mockResolvedValue(session)
  return import('@/lib/ainative/active-plan')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveActivePlan', () => {
  it('returns verified:true, plan:"" for an anonymous session (no access token) — a real "not paid" answer', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { resolveActivePlan } = await freshWithSession(null)
    const result = await resolveActivePlan()
    expect(result).toMatchObject({ plan: '', signedIn: false, verified: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns verified:true, plan:"enterprise" for an admin account (staff bypass)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ role: 'ADMIN', is_superuser: true, email: 'admin@ainative.studio' }),
    }))
    const { resolveActivePlan } = await freshWithSession({ accessToken: 'tok' })
    const result = await resolveActivePlan()
    expect(result).toMatchObject({ plan: 'enterprise', admin: true, verified: true, signedIn: true })
  })

  it('returns verified:true, plan:"enterprise" for a real paying enterprise account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ role: 'USER', plan: 'enterprise', email: 'founder@co.com' }),
    }))
    const { resolveActivePlan } = await freshWithSession({ accessToken: 'tok' })
    const result = await resolveActivePlan()
    expect(result).toMatchObject({ plan: 'enterprise', admin: false, verified: true })
  })

  it('returns verified:true, plan:"" for a real, confirmed unpaid account (core answered, no plan field)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ role: 'USER', email: 'free@co.com' }),
    }))
    const { resolveActivePlan } = await freshWithSession({ accessToken: 'tok' })
    const result = await resolveActivePlan()
    expect(result).toMatchObject({ plan: '', verified: true })
  })

  // ---- The real bug: transient failure must be DISTINGUISHABLE from confirmed-unpaid ----
  it('THE BUG: a core 5xx now returns verified:false — never identical to confirmed-unpaid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const { resolveActivePlan } = await freshWithSession({ accessToken: 'tok' })
    const result = await resolveActivePlan()
    expect(result.plan).toBe('')
    expect(result.verified).toBe(false)
  })

  it('THE BUG: a network error / timeout now returns verified:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    const { resolveActivePlan } = await freshWithSession({ accessToken: 'tok' })
    const result = await resolveActivePlan()
    expect(result.plan).toBe('')
    expect(result.verified).toBe(false)
  })

  it('never throws when auth() itself throws', async () => {
    vi.resetModules()
    const { auth } = await import('@/app/(auth)/auth')
    ;(auth as any).mockRejectedValue(new Error('session error'))
    vi.stubGlobal('fetch', vi.fn())
    const { resolveActivePlan } = await import('@/lib/ainative/active-plan')
    await expect(resolveActivePlan()).resolves.toMatchObject({ plan: '', verified: true, signedIn: false })
  })
})
