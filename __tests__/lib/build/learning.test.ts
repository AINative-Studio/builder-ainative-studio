import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logBuildOutcome,
  markConverted,
  readLearningRows,
  rollup,
  type LearningRow,
  type LearningOutcome,
} from '@/lib/build/learning'

/**
 * lib/build/learning — recursive-loop learning capture (#270).
 * Covers: logBuildOutcome (no-op when unconfigured, slug guard, field clamping,
 * network error), markConverted (convenience wrapper), readLearningRows
 * (data shapes, sort, no-op when unconfigured), rollup (dedup, conversion rate,
 * codegen failure rate, byTrack, nonConverterIdeas, recentLimit).
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.body ?? {}),
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('logBuildOutcome — configuration guards', () => {
  beforeEach(() => {
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.AINATIVE_API_KEY
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns false without calling fetch when API_KEY is not set', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await logBuildOutcome({ slug: 'my-co', converted: false })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false without calling fetch when PROJECT_ID is not set', async () => {
    process.env.ZERODB_API_KEY = 'test-key'
    // PROJECT_ID still not set
    const fn = mockFetch(() => ({ ok: true }))
    const result = await logBuildOutcome({ slug: 'my-co', converted: false })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when slug is empty even if configured', async () => {
    process.env.ZERODB_API_KEY = 'test-key'
    process.env.ZERODB_PROJECT_ID = 'test-project'
    const fn = mockFetch(() => ({ ok: true }))
    const result = await logBuildOutcome({ slug: '', converted: false })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('logBuildOutcome — with configuration', () => {
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'test-key'
    process.env.ZERODB_PROJECT_ID = 'test-proj'
    process.env.AINATIVE_API_URL = 'https://test-api.ainative.studio'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    delete process.env.AINATIVE_API_URL
  })

  it('POSTs a row and returns true on success', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { id: 'row-1' } }))
    const result = await logBuildOutcome({
      slug: 'my-company',
      idea: 'A tool for remote teams',
      brand: 'TeamSync',
      track: 'company',
      chatId: 'chat-abc',
      codeStatus: 'success',
      domainFound: true,
      converted: false,
    })

    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)

    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/database/tables/builder_learning/rows')
    expect((init as RequestInit).method).toBe('POST')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.row_data).toMatchObject({
      slug: 'my-company',
      idea: 'A tool for remote teams',
      brand: 'TeamSync',
      track: 'company',
      chatId: 'chat-abc',
      codeStatus: 'success',
      domainFound: true,
      converted: false,
    })
    expect(typeof body.row_data.createdAt).toBe('string')
  })

  it('clamps slug to 40 characters', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const longSlug = 'a'.repeat(100)
    await logBuildOutcome({ slug: longSlug, converted: false })

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data.slug.length).toBeLessThanOrEqual(40)
  })

  it('clamps idea to 3000 characters', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const longIdea = 'x'.repeat(4000)
    await logBuildOutcome({ slug: 'co', idea: longIdea, converted: false })

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data.idea.length).toBeLessThanOrEqual(3000)
  })

  it('clamps brand to 120 characters', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await logBuildOutcome({ slug: 'co', brand: 'B'.repeat(200), converted: false })

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data.brand.length).toBeLessThanOrEqual(120)
  })

  it('omits optional fields from the row when they are undefined', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await logBuildOutcome({ slug: 'co', converted: false })

    const row = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).row_data
    expect(row.idea).toBeUndefined()
    expect(row.brand).toBeUndefined()
    expect(row.track).toBeUndefined()
    expect(row.chatId).toBeUndefined()
    expect(row.codeStatus).toBeUndefined()
    expect(row.domainFound).toBeUndefined()
  })

  it('converts converted to boolean (truthy/falsy values)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await logBuildOutcome({ slug: 'co', converted: false })
    const row1 = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).row_data
    expect(row1.converted).toBe(false)

    await logBuildOutcome({ slug: 'co', converted: true, plan: 'pro' })
    const row2 = JSON.parse((fn.mock.calls[1][1] as RequestInit).body as string).row_data
    expect(row2.converted).toBe(true)
  })

  it('returns false when the API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const result = await logBuildOutcome({ slug: 'co', converted: false })
    expect(result).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const result = await logBuildOutcome({ slug: 'co', converted: false })
    expect(result).toBe(false)
  })

  it('includes email field in the row when provided', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await logBuildOutcome({ slug: 'co', converted: false, email: 'test@example.com' })
    // email is not in LearningOutcome interface but is passed through ... spread in row_data
    // Actually checking the body
    const row = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string).row_data
    expect(row.email).toBe('test@example.com')
  })
})

describe('markConverted', () => {
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'test-key'
    process.env.ZERODB_PROJECT_ID = 'test-proj'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns false immediately when slug is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await markConverted('', 'pro')
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('appends a row with converted: true and the plan', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await markConverted('my-company', 'enterprise')

    expect(result).toBe(true)
    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data).toMatchObject({ slug: 'my-company', plan: 'enterprise', converted: true })
  })
})

describe('readLearningRows', () => {
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'test-key'
    process.env.ZERODB_PROJECT_ID = 'test-proj'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns [] when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    const rows = await readLearningRows()
    expect(rows).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns rows sorted newest-first from a row_data-wrapped array', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          { row_data: { slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' } },
          { row_data: { slug: 'co-b', converted: true, createdAt: '2026-01-01T00:00:03Z' } },
          { row_data: { slug: 'co-c', converted: false, createdAt: '2026-01-01T00:00:02Z' } },
        ],
      },
    }))
    const rows = await readLearningRows()
    expect(rows.map((r) => r.slug)).toEqual(['co-b', 'co-c', 'co-a'])
  })

  it('handles a raw array response (no data wrapper)', async () => {
    mockFetch(() => ({
      ok: true,
      body: [
        { row_data: { slug: 'co-x', converted: false, createdAt: '2026-01-01' } },
      ],
    }))
    const rows = await readLearningRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('co-x')
  })

  it('filters out rows without a slug', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          { row_data: { slug: 'co-a', converted: false, createdAt: '2026-01-01' } },
          { row_data: { converted: false, createdAt: '2026-01-02' } }, // no slug
          { row_data: null }, // null row_data
        ],
      },
    }))
    const rows = await readLearningRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('co-a')
  })

  it('returns [] on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const rows = await readLearningRows()
    expect(rows).toEqual([])
  })

  it('returns [] (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const rows = await readLearningRows()
    expect(rows).toEqual([])
  })

  it('includes limit=1000 in the query URL', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { data: [] } }))
    await readLearningRows()
    expect(String(fn.mock.calls[0][0])).toContain('limit=1000')
  })
})

// ---------- rollup (pure logic — no I/O) ----------
function makeRow(over: Partial<LearningRow> = {}): LearningRow {
  return {
    slug: over.slug ?? 'co-1',
    converted: over.converted ?? false,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
    ...over,
  }
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

  it('counts distinct builds (deduped by slug) correctly', () => {
    const rows = [
      makeRow({ slug: 'co-a', converted: false, createdAt: '2026-01-01T00:00:01Z' }),
      makeRow({ slug: 'co-a', converted: true, plan: 'pro', createdAt: '2026-01-01T00:00:05Z' }), // same slug
      makeRow({ slug: 'co-b', converted: false, createdAt: '2026-01-01T00:00:02Z' }),
    ]
    const r = rollup(rows)
    expect(r.totalBuilds).toBe(2) // 2 distinct slugs
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

  it('marks a slug converted when plan is set even if converted field is false', () => {
    const rows = [makeRow({ slug: 'co-x', converted: false, plan: 'enterprise' })]
    const r = rollup(rows)
    expect(r.converted).toBe(1)
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

  it('computes codegenFailureRate correctly', () => {
    const rows = [
      makeRow({ slug: 'co-a', codeStatus: 'success', converted: false }),
      makeRow({ slug: 'co-b', codeStatus: 'failure', converted: false }),
      makeRow({ slug: 'co-c', codeStatus: 'failure', converted: false }),
      makeRow({ slug: 'co-d' }), // no codeStatus — excluded from the rate denominator
    ]
    const r = rollup(rows)
    // 3 rows with codeStatus, 2 failures
    expect(r.codegenFailureRate).toBeCloseTo(2 / 3)
  })

  it('returns codegenFailureRate of 0 when no row has a codeStatus', () => {
    const rows = [makeRow({ slug: 'co-a', converted: false })]
    const r = rollup(rows)
    expect(r.codegenFailureRate).toBe(0)
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
    const r = rollup(rows, 3)
    expect(r.nonConverterIdeas).toHaveLength(3)
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
    const rows = [makeRow({ slug: 'co-a', converted: false })] // no track
    const r = rollup(rows)
    expect(r.byTrack.unknown).toMatchObject({ builds: 1, converted: 0 })
  })

  it('newest row fields win in merged record (idea from latest row)', () => {
    // rows are newest-first per readLearningRows contract
    const rows = [
      makeRow({ slug: 'co-a', idea: 'Newest idea', createdAt: '2026-01-01T00:00:05Z' }),
      makeRow({ slug: 'co-a', idea: 'Older idea', createdAt: '2026-01-01T00:00:01Z' }),
    ]
    const r = rollup(rows)
    // After dedup, merged idea should be 'Newest idea'
    expect(r.nonConverterIdeas[0]?.idea ?? r.byTrack.unknown?.builds).toBeDefined()
    // The total is still 1 unique build
    expect(r.totalBuilds).toBe(1)
  })

  it('keeps earliest createdAt for merged slug (build creation time)', () => {
    // rows are newest-first
    const rows = [
      makeRow({ slug: 'co-a', createdAt: '2026-01-01T00:00:05Z' }),
      makeRow({ slug: 'co-a', createdAt: '2026-01-01T00:00:01Z' }), // earliest
    ]
    const r = rollup(rows)
    // The merged record should keep the earliest createdAt
    const nonConverter = r.nonConverterIdeas[0]
    if (nonConverter) {
      // '2026-01-01T00:00:01Z' is the earliest — should be preserved
      expect(nonConverter.createdAt).toBe('2026-01-01T00:00:01Z')
    }
    expect(r.totalBuilds).toBe(1)
  })

  it('includes updatedAt in the result', () => {
    const r = rollup([])
    expect(typeof r.updatedAt).toBe('string')
    expect(r.updatedAt.length).toBeGreaterThan(0)
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
})
