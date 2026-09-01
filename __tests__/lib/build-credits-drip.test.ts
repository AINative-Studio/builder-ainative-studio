import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #450 — drip token: once a hobbyist founder exhausts their base allowance +
 * ecosystem bonus, they get ONE additional build per UTC calendar day instead
 * of a hard wall. Exercises the CONFIGURED path (ZeroDB env set, fetch
 * stubbed), mirroring build-credits-ecosystem.test.ts's conventions.
 */

const OWNER = 'founder@example.com'

function buildRow(createdAt: string, ownerEmail = OWNER, primitives: string[] = []) {
  return { row_data: { ownerEmail, event: 'build', slug: 's', primitives, createdAt } }
}

let fetchMock: ReturnType<typeof vi.fn>

async function loadModule() {
  vi.resetModules()
  return await import('@/lib/build/build-credits')
}

beforeEach(() => {
  vi.stubEnv('AINATIVE_API_KEY', 'test-key')
  vi.stubEnv('ZERODB_PROJECT_ID', 'proj-123')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('getBuildCreditStatus — drip token (#450)', () => {
  it('does NOT grant a drip while still within the base allowance', async () => {
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    const rows = [buildRow('2026-09-01T10:00:00.000Z')] // 1 of FREE_BUILD_LIMIT used
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.remaining).toBe(FREE_BUILD_LIMIT - 1)
    expect(s.allowed).toBe(true)
    expect(s.viaDripToken).toBeUndefined()
  })

  it('grants a drip build once base+bonus is exhausted and none was used today', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'))
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    const rows = Array.from({ length: FREE_BUILD_LIMIT }, () => buildRow('2026-09-01T10:00:00.000Z'))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.allowed).toBe(true)
    expect(s.viaDripToken).toBe(true)
    expect(s.remaining).toBe(1)
  })

  it('does NOT grant a second drip on the same UTC day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T18:00:00.000Z'))
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    // Base exhausted yesterday, PLUS a drip build already used today.
    const rows = [
      ...Array.from({ length: FREE_BUILD_LIMIT }, () => buildRow('2026-09-01T10:00:00.000Z')),
      buildRow('2026-09-02T09:00:00.000Z'), // today's drip already used
    ]
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.allowed).toBe(false)
    expect(s.viaDripToken).toBeUndefined()
  })

  it('resets the drip on a new UTC day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-03T00:30:00.000Z')) // next day, just past midnight UTC
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    const rows = [
      ...Array.from({ length: FREE_BUILD_LIMIT }, () => buildRow('2026-09-01T10:00:00.000Z')),
      buildRow('2026-09-02T23:59:00.000Z'), // yesterday's drip
    ]
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.allowed).toBe(true)
    expect(s.viaDripToken).toBe(true)
  })

  it('never applies to starter/paid tiers — their own real limit governs', async () => {
    const { getBuildCreditStatus, STARTER_BUILD_LIMIT } = await loadModule()
    const rows = Array.from({ length: STARTER_BUILD_LIMIT }, (_, i) => buildRow(`2026-09-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'starter')
    expect(s.allowed).toBe(false)
    expect(s.viaDripToken).toBeUndefined()
  })

  it('unlimited tiers never reach the drip path at all', async () => {
    const { getBuildCreditStatus } = await loadModule()
    const s = await getBuildCreditStatus(OWNER, 'pro')
    expect(s.unlimited).toBe(true)
    expect(s.viaDripToken).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("only THIS owner's most recent build determines drip eligibility", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'))
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    const rows = [
      ...Array.from({ length: FREE_BUILD_LIMIT }, () => buildRow('2026-09-01T10:00:00.000Z')),
      buildRow('2026-09-02T09:00:00.000Z', 'someone-else@example.com'), // other owner's drip today
    ]
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.allowed).toBe(true)
    expect(s.viaDripToken).toBe(true) // this owner hasn't used today's drip
  })
})
