import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #324 GR-15 — build-credits folds the ecosystem-runway bonus into the
 * EFFECTIVE limit. These tests exercise the CONFIGURED path (ZeroDB env set,
 * fetch stubbed) that the base build-credits.test.ts can't reach:
 *   - bonus recomputed from per-build persisted primitives (latest constants win),
 *   - effective limit = baseLimit + bonus → the 402 threshold moves,
 *   - bonus capped at ECOSYSTEM_BONUS_MAX_TOTAL,
 *   - recordBuild persists the server-computed primitives list with the row.
 */

const OWNER = 'founder@example.com'
const QUALIFYING = ['ZeroDB', 'AI Kit', 'ZeroInvoice', 'ZeroPipeline'] // 2 ecosystem
const SUBSTRATE_ONLY = ['ZeroDB', 'AI Kit'] // 0 ecosystem

function buildRow(primitives?: string[], ownerEmail = OWNER) {
  return { row_data: { ownerEmail, event: 'build', slug: 's', primitives } }
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
})

describe('getBuildCreditStatus — ecosystem runway (#324 GR-15)', () => {
  it('no primitives composed → base free limit, no bonus', async () => {
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [buildRow(SUBSTRATE_ONLY), buildRow([])] }),
    })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(2)
    expect(s.baseLimit).toBe(FREE_BUILD_LIMIT)
    expect(s.ecosystemBonus).toBe(0)
    expect(s.limit).toBe(FREE_BUILD_LIMIT)
  })

  it('a qualifying build raises the effective limit past the base 402 threshold', async () => {
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    // Owner has used ALL base free builds, but one composed 2 ecosystem primitives.
    const rows = [buildRow(QUALIFYING), buildRow([]), buildRow([])]
    expect(rows.length).toBe(FREE_BUILD_LIMIT)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })

    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(FREE_BUILD_LIMIT)
    expect(s.ecosystemBonus).toBe(1)
    expect(s.limit).toBe(FREE_BUILD_LIMIT + 1)
    expect(s.remaining).toBe(1)
    expect(s.allowed).toBe(true) // would have been 402 without the bonus
  })

  it('without the bonus the same usage is blocked (the 402 threshold)', async () => {
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    const rows = Array.from({ length: FREE_BUILD_LIMIT }, () => buildRow([]))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.ecosystemBonus).toBe(0)
    expect(s.allowed).toBe(false)
  })

  it('total bonus is capped — endless qualifying builds cannot mint infinite runway', async () => {
    const mod = await loadModule()
    const { ECOSYSTEM_BONUS_MAX_TOTAL } = await import('@/lib/build/ecosystem-bonus')
    const rows = Array.from({ length: 10 }, () => buildRow(QUALIFYING))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })

    const s = await mod.getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.ecosystemBonus).toBe(ECOSYSTEM_BONUS_MAX_TOTAL)
    expect(s.limit).toBe(s.baseLimit + ECOSYSTEM_BONUS_MAX_TOTAL)
    expect(s.allowed).toBe(false) // 10 used > 3 + 2 — the wall still exists
  })

  it("only THIS owner's builds count toward used and bonus", async () => {
    const { getBuildCreditStatus } = await loadModule()
    const rows = [
      buildRow(QUALIFYING, 'someone-else@example.com'),
      buildRow(QUALIFYING, 'someone-else@example.com'),
      buildRow([], OWNER),
    ]
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows }) })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(1)
    expect(s.ecosystemBonus).toBe(0)
  })

  it('legacy rows without a primitives field earn no bonus (never over-grant)', async () => {
    const { getBuildCreditStatus } = await loadModule()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [buildRow(undefined), buildRow(undefined)] }),
    })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(2)
    expect(s.ecosystemBonus).toBe(0)
  })

  it('non-ok store response and bad JSON both fail SOFT to zero counts', async () => {
    const { getBuildCreditStatus } = await loadModule()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    let s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(0)
    expect(s.allowed).toBe(true)

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad json') } })
    s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(0)
    expect(s.ecosystemBonus).toBe(0)
  })

  it('reads the data envelope when rows is absent', async () => {
    const { getBuildCreditStatus } = await loadModule()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [buildRow(QUALIFYING), buildRow([])] }),
    })
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(2)
    expect(s.ecosystemBonus).toBe(1)
  })

  it('missing owner email fails open without touching the store', async () => {
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    const s = await getBuildCreditStatus('', 'hobbyist')
    expect(s.limit).toBe(FREE_BUILD_LIMIT)
    expect(s.allowed).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('store failure fails SOFT — zero used/bonus, still allowed', async () => {
    const { getBuildCreditStatus, FREE_BUILD_LIMIT } = await loadModule()
    fetchMock.mockRejectedValue(new Error('network'))
    const s = await getBuildCreditStatus(OWNER, 'hobbyist')
    expect(s.used).toBe(0)
    expect(s.ecosystemBonus).toBe(0)
    expect(s.limit).toBe(FREE_BUILD_LIMIT)
    expect(s.allowed).toBe(true)
  })

  it('unlimited tiers never touch the store and carry no bonus fields of interest', async () => {
    const { getBuildCreditStatus } = await loadModule()
    const s = await getBuildCreditStatus(OWNER, 'pro')
    expect(s.unlimited).toBe(true)
    expect(s.ecosystemBonus).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('recordBuild — persists composed primitives (#324 GR-15)', () => {
  it('writes the primitives list into the row', async () => {
    const { recordBuild } = await loadModule()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const ok = await recordBuild(OWNER, 'my-app', QUALIFYING)
    expect(ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.row_data.primitives).toEqual(QUALIFYING)
    expect(body.row_data.event).toBe('build')
    expect(body.row_data.ownerEmail).toBe(OWNER)
  })

  it('write failure (non-ok / thrown) returns false — never blocks the build', async () => {
    const { recordBuild } = await loadModule()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await recordBuild(OWNER, 's', QUALIFYING)).toBe(false)
    fetchMock.mockRejectedValueOnce(new Error('network'))
    expect(await recordBuild(OWNER, 's', QUALIFYING)).toBe(false)
  })

  it('unconfigured or ownerless writes are skipped (false, no fetch)', async () => {
    const { recordBuild } = await loadModule()
    expect(await recordBuild('', 's', QUALIFYING)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults primitives to [] when omitted or malformed', async () => {
    const { recordBuild } = await loadModule()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    await recordBuild(OWNER, 'my-app')
    await recordBuild(OWNER, 'my-app', 'zeroinvoice' as unknown as string[])
    const first = JSON.parse(fetchMock.mock.calls[0][1].body)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(first.row_data.primitives).toEqual([])
    expect(second.row_data.primitives).toEqual([])
  })
})
