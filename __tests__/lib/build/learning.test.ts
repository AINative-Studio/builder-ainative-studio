import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { rollup, type LearningRow } from '@/lib/build/learning'

/**
 * lib/build/learning -- recursive-loop learning capture (#270).
 *
 * API_KEY, PROJECT_ID are frozen at module load time. Tests that need
 * configured() to return true call vi.resetModules() then set env then dynamic
 * import in that order. The static top-level import is used for pure-logic
 * (rollup) which has no env dependency.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async (url, init) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.body ?? {}),
      text: async () => JSON.stringify(r.body ?? {}),
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Helper: get a fresh configured module
async function freshConfigured() {
  vi.resetModules()
  process.env.ZERODB_API_KEY = 'k'
  process.env.ZERODB_PROJECT_ID = 'p'
  return import('@/lib/build/learning')
}

// ---------- unconfigured no-ops (fresh unconfigured module) ----------
describe('logBuildOutcome -- unconfigured no-ops', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns false without fetch when API_KEY is not set', async () => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const { logBuildOutcome } = await import('@/lib/build/learning')
    const fn = mockFetch(() => ({ ok: true }))
    expect(await logBuildOutcome({ slug: 'my-co', converted: false })).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when slug is empty', async () => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const { logBuildOutcome } = await import('@/lib/build/learning')
    const fn = mockFetch(() => ({ ok: true }))
    expect(await logBuildOutcome({ slug: '', converted: false })).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})

// ---------- logBuildOutcome -- configured paths ----------
describe('logBuildOutcome -- with configuration', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('POSTs a row and returns true on success', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { id: 'r1' } }))
    const { logBuildOutcome } = await freshConfigured()

    const result = await logBuildOutcome({ slug: 'my-co', idea: 'Idea', brand: 'Brand',
      track: 'company', chatId: 'chat-abc', codeStatus: 'success', domainFound: true, converted: false })

    expect(result).toBe(true)
    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/database/tables/builder_learning/rows')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.row_data).toMatchObject({ slug: 'my-co', idea: 'Idea', brand: 'Brand',
      track: 'company', chatId: 'chat-abc', codeStatus: 'success', domainFound: true, converted: false })
    expect(typeof body.row_data.createdAt).toBe('string')
  })

  it('clamps slug to 40 chars', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { logBuildOutcome } = await freshConfigured()
    await logBuildOutcome({ slug: 'a'.repeat(100), converted: false })
    expect(JSON.parse(fn.mock.calls[0][1].body).row_data.slug.length).toBeLessThanOrEqual(40)
  })

  it('clamps idea to 3000 chars', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { logBuildOutcome } = await freshConfigured()
    await logBuildOutcome({ slug: 'co', idea: 'x'.repeat(4000), converted: false })
    expect(JSON.parse(fn.mock.calls[0][1].body).row_data.idea.length).toBeLessThanOrEqual(3000)
  })

  it('clamps brand to 120 chars', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { logBuildOutcome } = await freshConfigured()
    await logBuildOutcome({ slug: 'co', brand: 'B'.repeat(200), converted: false })
    expect(JSON.parse(fn.mock.calls[0][1].body).row_data.brand.length).toBeLessThanOrEqual(120)
  })

  it('omits undefined optional fields from the row', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { logBuildOutcome } = await freshConfigured()
    await logBuildOutcome({ slug: 'co', converted: false })
    const row = JSON.parse(fn.mock.calls[0][1].body).row_data
    expect(row.idea).toBeUndefined()
    expect(row.brand).toBeUndefined()
    expect(row.track).toBeUndefined()
    expect(row.chatId).toBeUndefined()
    expect(row.codeStatus).toBeUndefined()
    expect(row.domainFound).toBeUndefined()
  })

  it('stores converted: false and converted: true correctly', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { logBuildOutcome } = await freshConfigured()
    await logBuildOutcome({ slug: 'co', converted: false })
    expect(JSON.parse(fn.mock.calls[0][1].body).row_data.converted).toBe(false)
    await logBuildOutcome({ slug: 'co', converted: true, plan: 'pro' })
    expect(JSON.parse(fn.mock.calls[1][1].body).row_data.converted).toBe(true)
  })

  it('returns false on non-ok API response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { logBuildOutcome } = await freshConfigured()
    expect(await logBuildOutcome({ slug: 'co', converted: false })).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const { logBuildOutcome } = await freshConfigured()
    expect(await logBuildOutcome({ slug: 'co', converted: false })).toBe(false)
  })
})

// ---------- markConverted ----------
describe('markConverted', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns false when slug is empty', async () => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    const { markConverted } = await import('@/lib/build/learning')
    const fn = mockFetch(() => ({ ok: true }))
    expect(await markConverted('', 'pro')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('appends a row with converted: true and the plan', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { markConverted } = await freshConfigured()
    expect(await markConverted('my-co', 'enterprise')).toBe(true)
    const body = JSON.parse(fn.mock.calls[0][1].body)
    expect(body.row_data).toMatchObject({ slug: 'my-co', plan: 'enterprise', converted: true })
  })
})

// ---------- readLearningRows -- unconfigured ----------
describe('readLearningRows -- unconfigured', () => {
  it('returns [] without fetch when not configured', async () => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const { readLearningRows } = await import('@/lib/build/learning')
    const fn = mockFetch(() => ({ ok: true }))
    expect(await readLearningRows()).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})

// ---------- readLearningRows -- configured ----------
describe('readLearningRows -- with configuration', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns rows sorted newest-first from row_data-wrapped array', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      { row_data: { slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' } },
      { row_data: { slug: 'co-b', converted: true, createdAt: '2026-01-01T00:00:03Z' } },
      { row_data: { slug: 'co-c', converted: false, createdAt: '2026-01-01T00:00:02Z' } },
    ] } }))
    const { readLearningRows } = await freshConfigured()
    const rows = await readLearningRows()
    expect(rows.map((r) => r.slug)).toEqual(['co-b', 'co-c', 'co-a'])
  })

  it('handles raw array response (no data wrapper)', async () => {
    mockFetch(() => ({ ok: true, body: [{ row_data: { slug: 'co-x', converted: false, createdAt: '2026-01-01' } }] }))
    const { readLearningRows } = await freshConfigured()
    const rows = await readLearningRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('co-x')
  })

  it('filters out rows without a slug', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      { row_data: { slug: 'co-a', converted: false, createdAt: '2026-01-01' } },
      { row_data: { converted: false, createdAt: '2026-01-02' } },
      { row_data: null },
    ] } }))
    const { readLearningRows } = await freshConfigured()
    const rows = await readLearningRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('co-a')
  })

  it('returns [] on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { readLearningRows } = await freshConfigured()
    expect(await readLearningRows()).toEqual([])
  })

  it('returns [] (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const { readLearningRows } = await freshConfigured()
    expect(await readLearningRows()).toEqual([])
  })

  it('includes limit=1000 in the query URL', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { data: [] } }))
    const { readLearningRows } = await freshConfigured()
    await readLearningRows()
    expect(String(fn.mock.calls[0][0])).toContain('limit=1000')
  })
})

// ---------- rollup (pure logic -- no I/O) ----------
function makeRow(over = {}) {
  return { slug: 'co-1', converted: false, createdAt: '2026-01-01T00:00:00Z', ...over }
}

describe('rollup', () => {
  it('returns zero-value rollup for empty rows', () => {
    const r = rollup([])
    expect(r.totalBuilds).toBe(0)
    expect(r.converted).toBe(0)
    expect(r.conversionRate).toBe(0)
    expect(r.codegenFailureRate).toBe(0)
    expect(r.nonConverterIdeas).toEqual([])
    expect(r.byTrack).toEqual({})
  })

  it('counts distinct builds (deduped by slug)', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' }),
      makeRow({ slug: 'co-a', converted: true, plan: 'pro', createdAt: '2026-01-01T00:00:05Z' }),
      makeRow({ slug: 'co-b', converted: false, createdAt: '2026-01-01T00:00:02Z' }),
    ]
    expect(rollup(rows).totalBuilds).toBe(2)
  })

  it('a conversion in any row for a slug marks it converted', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' }),
      makeRow({ slug: 'co-a', converted: true, plan: 'pro', createdAt: '2026-01-01T00:00:05Z' }),
    ]
    const r = rollup(rows)
    expect(r.converted).toBe(1)
    expect(r.conversionRate).toBe(1)
  })

  it('marks a slug converted when plan is set even if converted is false', () => {
    expect(rollup([makeRow({ slug: 'co-x', converted: false, plan: 'enterprise' })]).converted).toBe(1)
  })

  it('computes conversionRate correctly', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: true }),
      makeRow({ slug: 'co-b', converted: false }),
      makeRow({ slug: 'co-c', converted: false }),
      makeRow({ slug: 'co-d', converted: true }),
    ]
    const r = rollup(rows)
    expect(r.totalBuilds).toBe(4)
    expect(r.converted).toBe(2)
    expect(r.conversionRate).toBeCloseTo(0.5)
  })

  it('computes codegenFailureRate (2/3 with status have failure)', () => {
    const rows = [
      makeRow({ slug: 'co-a', codeStatus: 'success', converted: false }),
      makeRow({ slug: 'co-b', codeStatus: 'failure', converted: false }),
      makeRow({ slug: 'co-c', codeStatus: 'failure', converted: false }),
      makeRow({ slug: 'co-d' }),
    ]
    expect(rollup(rows).codegenFailureRate).toBeCloseTo(2 / 3)
  })

  it('returns codegenFailureRate=0 when no row has a codeStatus', () => {
    expect(rollup([makeRow({ slug: 'co-a', converted: false })]).codegenFailureRate).toBe(0)
  })

  it('excludes converted builds from nonConverterIdeas', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: false, idea: 'Idea A' }),
      makeRow({ slug: 'co-b', converted: true, idea: 'Idea B' }),
    ]
    const r = rollup(rows)
    expect(r.nonConverterIdeas).toHaveLength(1)
    expect(r.nonConverterIdeas[0].slug).toBe('co-a')
  })

  it('respects recentLimit for nonConverterIdeas', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ slug: `co-${i}`, converted: false, createdAt: `2026-01-0${i + 1}T00:00:00Z` }))
    expect(rollup(rows, 3).nonConverterIdeas).toHaveLength(3)
  })

  it('groups builds byTrack correctly', () => {
    const rows = [
      makeRow({ slug: 'co-a', track: 'company', converted: false }),
      makeRow({ slug: 'co-b', track: 'company', converted: true }),
      makeRow({ slug: 'co-c', track: 'app', converted: false }),
    ]
    const r = rollup(rows)
    expect(r.byTrack.company).toMatchObject({ builds: 2, converted: 1 })
    expect(r.byTrack.app).toMatchObject({ builds: 1, converted: 0 })
  })

  it('uses "unknown" for builds with no track', () => {
    expect(rollup([makeRow({ slug: 'co-a', converted: false })]).byTrack.unknown).toMatchObject({ builds: 1, converted: 0 })
  })

  it('deduplicates slug -- total is 1 from 2 rows with same slug', () => {
    const rows = [
      makeRow({ slug: 'co-a', idea: 'Newest idea', createdAt: '2026-01-01T00:00:05Z' }),
      makeRow({ slug: 'co-a', idea: 'Older idea', createdAt: '2026-01-01T00:00:01Z' }),
    ]
    expect(rollup(rows).totalBuilds).toBe(1)
  })

  it('keeps earliest createdAt for merged slug in nonConverterIdeas', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:05Z' }),
      makeRow({ slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' }),
    ]
    const r = rollup(rows)
    expect(r.totalBuilds).toBe(1)
    if (r.nonConverterIdeas.length > 0) {
      expect(r.nonConverterIdeas[0].createdAt).toBe('2026-01-01T00:00:01Z')
    }
  })

  it('includes updatedAt in the result', () => {
    expect(typeof rollup([]).updatedAt).toBe('string')
  })

  it('sorts nonConverterIdeas newest-first', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' }),
      makeRow({ slug: 'co-b', converted: false, createdAt: '2026-01-01T00:00:05Z' }),
    ]
    const r = rollup(rows)
    expect(r.nonConverterIdeas[0].slug).toBe('co-b')
    expect(r.nonConverterIdeas[1].slug).toBe('co-a')
  })

  it('returns converted=0 and conversionRate=0 when no builds have paid', () => {
    const rows = [makeRow({ slug: 'co-a', converted: false }), makeRow({ slug: 'co-b', converted: false })]
    const r = rollup(rows)
    expect(r.converted).toBe(0)
    expect(r.conversionRate).toBe(0)
  })
})
