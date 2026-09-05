import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/enroll — the "Hire the swarm" direct enrollment action, now
 * guarded by isEnrolled() (real bug fix).
 *
 * Real, live bug: this route called enrollCompany() with NO dedup guard at
 * all — unlike register-app and subscription/verify, which both already
 * guarded enrollCompany() with isEnrolled() first. Live.tsx's enrollNightly()
 * fires this route from a useEffect keyed on `activePlan`, with only
 * component-local `enrolled` state (not hydrated from the server) preventing
 * re-fires — so every remount/reload of the Live dashboard for a company on a
 * plan with nightlyLoop re-POSTed here, and each call appended ANOTHER
 * enabled enrollment row (enrollCompany() itself is a bare append, by design,
 * with no dedup). listEnrolled() then returned that company once PER
 * duplicate row, and the nightly-loop cron's `for (const e of enrolled)` loop
 * ran the full per-company pipeline (swarm dispatch + daily report append +
 * media routine) once per duplicate — the confirmed root cause of "Daily
 * Operational Report" appearing 8-10x for a single real day.
 */

const h = vi.hoisted(() => ({
  enrollCompany: vi.fn(),
  isEnrolled: vi.fn(),
  auth: vi.fn(),
  deriveOwnerKey: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ enrollCompany: h.enrollCompany, isEnrolled: h.isEnrolled }))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/chat-store', () => ({ deriveOwnerKey: h.deriveOwnerKey }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { POST } from '@/app/api/build/enroll/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/enroll — dedup guard', () => {
  beforeEach(() => {
    Object.values(h).forEach((fn) => fn.mockReset())
    h.auth.mockResolvedValue(null)
    h.deriveOwnerKey.mockReturnValue('owner-key')
    h.enrollCompany.mockResolvedValue(true)
    h.isEnrolled.mockResolvedValue(false)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('enrolls a brand-new company (not yet enrolled)', async () => {
    const res = await POST(req({ companyId: 'beacon', companyName: 'Beacon', track: 'app' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(h.isEnrolled).toHaveBeenCalledWith('beacon')
    expect(h.enrollCompany).toHaveBeenCalledTimes(1)
  })

  it('does NOT call enrollCompany again when the company is already enrolled (the real fix)', async () => {
    h.isEnrolled.mockResolvedValue(true)
    const res = await POST(req({ companyId: 'beacon', companyName: 'Beacon', track: 'app' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, alreadyEnrolled: true })
    expect(h.enrollCompany).not.toHaveBeenCalled()
  })

  it('repeated calls for the same company enroll exactly once total (simulates repeated "Hire the swarm" / remount fires)', async () => {
    // First call: not yet enrolled.
    h.isEnrolled.mockResolvedValueOnce(false)
    await POST(req({ companyId: 'beacon', companyName: 'Beacon', track: 'app' }))
    // Every subsequent call: now enrolled.
    h.isEnrolled.mockResolvedValue(true)
    await POST(req({ companyId: 'beacon', companyName: 'Beacon', track: 'app' }))
    await POST(req({ companyId: 'beacon', companyName: 'Beacon', track: 'app' }))
    await POST(req({ companyId: 'beacon', companyName: 'Beacon', track: 'app' }))
    expect(h.enrollCompany).toHaveBeenCalledTimes(1)
  })

  it('still requires companyId, companyName, and track', async () => {
    const res = await POST(req({ companyId: 'beacon' }))
    expect(res.status).toBe(400)
    expect(h.isEnrolled).not.toHaveBeenCalled()
  })
})
