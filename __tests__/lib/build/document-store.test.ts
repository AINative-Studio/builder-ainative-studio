import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DOC_KINDS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  documentScopeKey,
  normalizeType,
  normalizeKind,
  kindForType,
  isDocTab,
  filterByTab,
  countByKind,
  coerceDocument,
  toSummary,
  sortDocuments,
  starterDocumentTypes,
  createDocument,
  listDocuments,
  getDocument,
  hasReportForDate,
  deleteDocument,
  pruneDuplicateReports,
  planPruneReports,
  MAX_LOAD_DOCUMENTS,
  type BuildDocument,
} from '@/lib/build/document-store'

/**
 * #64 — Documents library store. Covers the pure core (scope key, type/kind
 * normalization, tab filtering/counting, coercion, summary projection, sort) and
 * the ZeroDB-backed I/O (create/list/get) by mocking global.fetch. The vitest env
 * is 'node'; fetch is stubbed per-test so no network is touched — same strategy as
 * the chat-store / task-store tests.
 */

const mkDoc = (over: Partial<BuildDocument> = {}): BuildDocument => ({
  id: over.id || 'd1',
  scopeKey: over.scopeKey || 'a::b',
  kind: over.kind || 'document',
  type: over.type || 'research',
  title: over.title || 'Doc',
  content: over.content || '## Executive Summary\nx\n## Key Findings\n- y\n## Sources\n- z',
  createdAt: over.createdAt || '2026-01-01T00:00:00Z',
})

// ---------- constants ----------
describe('DOC constants (#64)', () => {
  it('has exactly the two kinds', () => {
    expect([...DOC_KINDS]).toEqual(['document', 'report'])
  })
  it('has a label for every type', () => {
    for (const t of DOC_TYPES) expect(typeof DOC_TYPE_LABELS[t]).toBe('string')
    expect(DOC_TYPE_LABELS.roadmap).toBe('Product Roadmap')
    expect(DOC_TYPE_LABELS.daily).toBe('Daily Report')
  })
  it('starterDocumentTypes are the four durable Polsia-style docs', () => {
    expect(starterDocumentTypes()).toEqual(['research', 'roadmap', 'mission', 'market'])
  })
})

// ---------- documentScopeKey ----------
describe('documentScopeKey (#64)', () => {
  it('keys authed users by email::slug (same as chat/tasks/versions)', () => {
    const s = { user: { email: 'Founder@Example.com', type: 'real' } } as any
    expect(documentScopeKey(s, 'AcmeCo')).toBe('founder@example.com::acmeco')
  })
  it('keys guests by a stable guest key', () => {
    const s = { user: { id: 'u-9', type: 'guest' } } as any
    expect(documentScopeKey(s, 'Beta')).toBe('guest:u-9::beta')
  })
  it('normalizes a blank slug to "untitled"', () => {
    expect(documentScopeKey(null, '')).toBe('guest:anon::untitled')
  })
})

// ---------- normalizeType ----------
describe('normalizeType (#64)', () => {
  it('passes through the canonical types', () => {
    for (const t of DOC_TYPES) expect(normalizeType(t)).toBe(t)
  })
  it('maps loose aliases to canonical types', () => {
    expect(normalizeType('audit')).toBe('research')
    expect(normalizeType('competitor')).toBe('research')
    expect(normalizeType('product roadmap')).toBe('roadmap')
    expect(normalizeType('vision')).toBe('mission')
    expect(normalizeType('market research')).toBe('market')
    expect(normalizeType('nightly')).toBe('daily')
    expect(normalizeType('operational')).toBe('daily')
  })
  it('falls back to note for unknowns', () => {
    expect(normalizeType('gibberish')).toBe('note')
    expect(normalizeType('')).toBe('note')
    expect(normalizeType(null)).toBe('note')
  })
})

// ---------- kindForType + normalizeKind ----------
describe('kindForType / normalizeKind (#64)', () => {
  it('daily is a report; everything else is a document', () => {
    expect(kindForType('daily')).toBe('report')
    for (const t of ['research', 'roadmap', 'mission', 'market', 'note'] as const) {
      expect(kindForType(t)).toBe('document')
    }
  })
  it('normalizeKind only accepts report, else document', () => {
    expect(normalizeKind('report')).toBe('report')
    expect(normalizeKind('REPORT')).toBe('report')
    expect(normalizeKind('document')).toBe('document')
    expect(normalizeKind('nonsense')).toBe('document')
    expect(normalizeKind(undefined)).toBe('document')
  })
})

// ---------- isDocTab + filterByTab + countByKind ----------
describe('tabs (#64)', () => {
  it('isDocTab validates all/document/report only', () => {
    expect(isDocTab('all')).toBe(true)
    expect(isDocTab('document')).toBe(true)
    expect(isDocTab('report')).toBe(true)
    expect(isDocTab('nope')).toBe(false)
  })
  it('filterByTab returns everything for all/falsy', () => {
    const docs = [mkDoc({ kind: 'document' }), mkDoc({ id: 'd2', kind: 'report', type: 'daily' })]
    expect(filterByTab(docs, 'all')).toHaveLength(2)
    expect(filterByTab(docs, null)).toHaveLength(2)
    expect(filterByTab(docs, undefined)).toHaveLength(2)
  })
  it('filterByTab filters by kind', () => {
    const docs = [mkDoc({ kind: 'document' }), mkDoc({ id: 'd2', kind: 'report', type: 'daily' })]
    expect(filterByTab(docs, 'document')).toHaveLength(1)
    expect(filterByTab(docs, 'report')).toHaveLength(1)
    expect(filterByTab(docs, 'report')[0].kind).toBe('report')
  })
  it('filterByTab returns [] for an unknown tab', () => {
    expect(filterByTab([mkDoc()], 'bogus')).toEqual([])
  })
  it('countByKind returns a full record with all/document/report', () => {
    const docs = [
      mkDoc({ kind: 'document' }),
      mkDoc({ id: 'd2', kind: 'document' }),
      mkDoc({ id: 'd3', kind: 'report', type: 'daily' }),
    ]
    expect(countByKind(docs)).toEqual({ all: 3, document: 2, report: 1 })
  })
  it('countByKind is all-zero for an empty library (honest empty state)', () => {
    expect(countByKind([])).toEqual({ all: 0, document: 0, report: 0 })
  })
})

// ---------- coerceDocument ----------
describe('coerceDocument (#64)', () => {
  it('coerces a ZeroDB row_data into a BuildDocument', () => {
    const doc = coerceDocument(
      { row_data: { id: 'x', scope_key: 'a::b', kind: 'document', type: 'mission', title: 'M', content: 'body', created_at: '2026-02-02T00:00:00Z' } },
      'a::b',
    )
    expect(doc).not.toBeNull()
    expect(doc!.id).toBe('x')
    expect(doc!.type).toBe('mission')
    expect(doc!.kind).toBe('document')
  })
  it('drops rows with no title or no content', () => {
    expect(coerceDocument({ row_data: { title: '', content: 'x' } })).toBeNull()
    expect(coerceDocument({ row_data: { title: 'x', content: '' } })).toBeNull()
    expect(coerceDocument(null)).toBeNull()
  })
  it('derives kind from type when kind absent (old rows stay sane)', () => {
    const daily = coerceDocument({ title: 'D', content: 'c', type: 'daily' })
    expect(daily!.kind).toBe('report')
    const doc = coerceDocument({ title: 'D', content: 'c', type: 'research' })
    expect(doc!.kind).toBe('document')
  })
  it('normalizes an alias type on coercion', () => {
    const doc = coerceDocument({ title: 'D', content: 'c', type: 'audit' })
    expect(doc!.type).toBe('research')
  })
})

// ---------- toSummary + sortDocuments ----------
describe('toSummary / sortDocuments (#64)', () => {
  it('toSummary drops content and adds the type label', () => {
    const s = toSummary(mkDoc({ type: 'roadmap' }))
    expect(s).not.toHaveProperty('content')
    expect(s.typeLabel).toBe('Product Roadmap')
  })
  it('sortDocuments is newest-first + non-mutating', () => {
    const older = mkDoc({ id: 'o', createdAt: '2026-01-01T00:00:00Z' })
    const newer = mkDoc({ id: 'n', createdAt: '2026-03-01T00:00:00Z' })
    const input = [older, newer]
    const out = sortDocuments(input)
    expect(out.map((d) => d.id)).toEqual(['n', 'o'])
    expect(input.map((d) => d.id)).toEqual(['o', 'n']) // original untouched
  })
})

// ---------- I/O: createDocument / listDocuments / getDocument ----------
describe('ZeroDB I/O (#64)', () => {
  const OK = { ok: true, status: 200, json: async () => ({ data: [] }) }
  beforeEach(() => {
    vi.stubEnv('ZERODB_API_KEY', 'test-key')
    vi.stubEnv('ZERODB_PROJECT_ID', 'proj-1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('createDocument returns null without a scope key or content', async () => {
    expect(await createDocument('', { title: 't', content: 'c' })).toBeNull()
    expect(await createDocument('a::b', { title: '', content: 'c' })).toBeNull()
    expect(await createDocument('a::b', { title: 't', content: '' })).toBeNull()
  })

  it('createDocument POSTs a row and returns the coerced document', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'row' }) })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await createDocument('a::b', { title: 'Mission', content: 'body', type: 'mission' })
    // ensureTable() fires first (build_documents table-missing fix), then the real row write.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [ensureUrl] = fetchMock.mock.calls[0]
    expect(String(ensureUrl)).toMatch(/\/database\/tables$/)
    const [url, opts] = fetchMock.mock.calls[1]
    expect(String(url)).toContain('/database/tables/build_documents/rows')
    expect(opts.method).toBe('POST')
    const sent = JSON.parse(opts.body)
    expect(sent.row_data.kind).toBe('document')
    expect(sent.row_data.type).toBe('mission')
    expect(doc!.title).toBe('Mission')
  })

  it('createDocument for a daily type derives the report kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'row' }) })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await createDocument('a::b', { title: 'Daily', content: 'body', type: 'daily' })
    expect(doc!.kind).toBe('report')
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(sent.row_data.kind).toBe('report')
  })

  it('createDocument swallows a failed write and returns null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    expect(await createDocument('a::b', { title: 't', content: 'c' })).toBeNull()
  })

  describe('ensureTable (build_documents table-missing production fix)', () => {
    // Live-confirmed in production: the build_documents table was never
    // created, so every real document generation (Research/Roadmap/Mission/
    // Market) and caller-authored write 404'd and got silently swallowed
    // into a generic "could not persist document" 502 — the same class of
    // bug as the build_media table-missing fix (#54).
    it('a failed ensureTable never blocks the real write — its own result stays authoritative', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) // ensureTable fails
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'row' }) }) // real write still succeeds
      vi.stubGlobal('fetch', fetchMock)
      const doc = await createDocument('a::b', { title: 'Mission', content: 'body', type: 'mission' })
      expect(doc!.title).toBe('Mission')
    })

    it('never throws when ensureTable itself throws (e.g. network error)', async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('network down')) // ensureTable throws
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'row' }) }) // real write still attempted + succeeds
      vi.stubGlobal('fetch', fetchMock)
      const doc = await createDocument('a::b', { title: 'Research', content: 'body', type: 'research' })
      expect(doc!.title).toBe('Research')
    })
  })

  it('listDocuments returns [] for an empty library (honest empty state)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(OK))
    expect(await listDocuments('a::b')).toEqual([])
  })

  it('listDocuments coerces + sorts rows newest-first', async () => {
    const rows = [
      { row_data: { id: 'old', scope_key: 'a::b', type: 'research', title: 'Old', content: 'c', created_at: '2026-01-01T00:00:00Z' } },
      { row_data: { id: 'new', scope_key: 'a::b', type: 'mission', title: 'New', content: 'c', created_at: '2026-05-01T00:00:00Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) }))
    const docs = await listDocuments('a::b')
    expect(docs.map((d) => d.id)).toEqual(['new', 'old'])
  })

  it('listDocuments returns [] without a scope key and never calls fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await listDocuments('')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listDocuments caps limit at MAX_LOAD_DOCUMENTS', async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK)
    vi.stubGlobal('fetch', fetchMock)
    await listDocuments('a::b', 99999)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.limit).toBe(MAX_LOAD_DOCUMENTS)
  })

  // ---- Real, live bug (found while investigating a separate VIEW-404 report):
  // ZeroDB's query engine cannot filter on `id` at all — it lives inside
  // row_data, and only scope_key is actually queryable there. Confirmed
  // directly against production: {filters:{scope_key,id}} and even
  // {filters:{id}} alone BOTH return zero rows for a row that indisputably
  // has that exact id, while {filters:{scope_key}} alone correctly returns
  // it. So getDocument() 404'd unconditionally for every real document until
  // fixed to filter ONLY on scope_key and match the id client-side. ----
  it('getDocument filters ONLY on scope_key (the field ZeroDB can actually query), then matches id client-side', async () => {
    const row = { row_data: { id: 'x', scope_key: 'a::b', type: 'research', title: 'R', content: 'full body', created_at: '2026-01-01T00:00:00Z' } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [row] }) })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await getDocument('a::b', 'x')
    expect(doc!.content).toBe('full body')
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.filters).toEqual({ scope_key: 'a::b' })
    expect(sent.filters).not.toHaveProperty('id')
  })

  it('getDocument returns null when not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(OK))
    expect(await getDocument('a::b', 'missing')).toBeNull()
  })

  it('getDocument returns null without scope/id and never calls fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await getDocument('', 'x')).toBeNull()
    expect(await getDocument('a::b', '')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ---- Real bug: "VIEW does nothing" ----
  // getDocument() used to trust rows[0] blindly — if the query layer ever
  // returned more than one candidate (or one that doesn't actually match the
  // requested id), the WRONG document could silently be returned with no
  // error at all. This is exactly the failure mode that reads as "View does
  // nothing" from the founder's side: clicking a specific report either loads
  // some other document unnoticed, or (with the frontend's now-fixed error
  // handling) surfaces a real error instead of nothing.
  it('getDocument picks the row whose id EXACTLY matches when multiple candidates come back', async () => {
    const rows = [
      { row_data: { id: 'wrong-id', scope_key: 'a::b', type: 'daily', title: 'Wrong', content: 'wrong body', created_at: '2026-01-01T00:00:00Z' } },
      { row_data: { id: 'x', scope_key: 'a::b', type: 'daily', title: 'Right', content: 'right body', created_at: '2026-01-01T00:00:00Z' } },
    ]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await getDocument('a::b', 'x')
    expect(doc!.id).toBe('x')
    expect(doc!.content).toBe('right body')
  })

  it('getDocument returns null (never a wrong document) when NONE of the scope\'s rows match the id exactly', async () => {
    const rows = [
      { row_data: { id: 'some-other-id', scope_key: 'a::b', type: 'daily', title: 'Wrong', content: 'wrong body', created_at: '2026-01-01T00:00:00Z' } },
    ]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await getDocument('a::b', 'x')
    expect(doc).toBeNull()
  })

  it('createDocument swallows a thrown fetch (network error) and returns null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    expect(await createDocument('a::b', { title: 't', content: 'c' })).toBeNull()
  })

  it('listDocuments swallows a thrown fetch and returns []', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await listDocuments('a::b')).toEqual([])
  })

  it('getDocument swallows a thrown fetch and returns null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await getDocument('a::b', 'x')).toBeNull()
  })
})

// ---------- hasReportForDate (real bug: 8-10x duplicate daily reports) ----------
describe('hasReportForDate', () => {
  beforeEach(() => {
    vi.stubEnv('ZERODB_API_KEY', 'test-key')
    vi.stubEnv('ZERODB_PROJECT_ID', 'proj-1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns true when a report of the given type already exists on that calendar date', async () => {
    const rows = [
      { row_data: { id: 'r1', scope_key: 'a::b', type: 'daily', title: 'Daily Operational Report — Sep 5, 2026', content: 'x', created_at: '2026-09-05T07:00:00Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) }))
    expect(await hasReportForDate('a::b', 'daily', '2026-09-05T07:05:00Z')).toBe(true)
  })

  it('returns false when no report exists yet for that date (first real run of the day)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) }))
    expect(await hasReportForDate('a::b', 'daily', '2026-09-05T07:00:00Z')).toBe(false)
  })

  it('is scoped by calendar date — a report from a DIFFERENT day does not count', async () => {
    const rows = [
      { row_data: { id: 'r1', scope_key: 'a::b', type: 'daily', title: 'Daily Operational Report — Sep 4, 2026', content: 'x', created_at: '2026-09-04T07:00:00Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) }))
    expect(await hasReportForDate('a::b', 'daily', '2026-09-05T07:00:00Z')).toBe(false)
  })

  it('is scoped by type — a durable document of a different type does not count as a report', async () => {
    const rows = [
      { row_data: { id: 'r1', scope_key: 'a::b', type: 'research', title: 'Research', content: 'x', created_at: '2026-09-05T07:00:00Z' } },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) }))
    expect(await hasReportForDate('a::b', 'daily', '2026-09-05T07:00:00Z')).toBe(false)
  })

  it('returns false (never blocks the write) without a scope or date', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await hasReportForDate('', 'daily', '2026-09-05T07:00:00Z')).toBe(false)
    expect(await hasReportForDate('a::b', 'daily', '')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns false (never throws) when the query fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await hasReportForDate('a::b', 'daily', '2026-09-05T07:00:00Z')).toBe(false)
  })

  it('the 10-duplicate live repro: 10 same-day reports already present still reports true (write correctly skipped)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      row_data: { id: `r${i}`, scope_key: 'a::b', type: 'daily', title: 'Daily Operational Report — Sep 5, 2026', content: 'x', created_at: `2026-09-05T0${i}:00:00Z` },
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows }) }))
    expect(await hasReportForDate('a::b', 'daily', '2026-09-05T09:00:00Z')).toBe(true)
  })
})

describe('planPruneReports (pure)', () => {
  const report = (id: string, day: string, type = 'daily'): BuildDocument => ({
    id, scopeKey: 'a::b', kind: 'report', type: type as BuildDocument['type'],
    title: 'Daily Operational Report', content: 'x', createdAt: `${day}T00:00:00Z`,
  })
  const doc = (id: string, day: string): BuildDocument => ({
    id, scopeKey: 'a::b', kind: 'document', type: 'research',
    title: 'Research', content: 'x', createdAt: `${day}T00:00:00Z`,
  })

  it('the real Beacon repro: 20 reports across 2 real days collapses to keeping just the newest per day', () => {
    const sep5 = Array.from({ length: 10 }, (_, i) => report(`s5-${i}`, '2026-09-05'))
    const sep4 = Array.from({ length: 10 }, (_, i) => report(`s4-${i}`, '2026-09-04'))
    // Give each a distinct createdAt so "newest" is well-defined, matching real data.
    sep5.forEach((d, i) => { d.createdAt = `2026-09-05T11:0${i}:00Z` })
    sep4.forEach((d, i) => { d.createdAt = `2026-09-04T11:5${i}:00Z` })
    const toDelete = planPruneReports([...sep5, ...sep4])
    expect(toDelete).toHaveLength(18)
    // The newest of each day must survive (not appear in the delete list).
    expect(toDelete.some((d) => d.id === 's5-9')).toBe(false)
    expect(toDelete.some((d) => d.id === 's4-9')).toBe(false)
  })

  it('never touches durable documents, even ones sharing a day with duplicate reports', () => {
    const r1 = report('r1', '2026-09-05')
    const r2 = report('r2', '2026-09-05')
    r1.createdAt = '2026-09-05T00:00:00Z'
    r2.createdAt = '2026-09-05T01:00:00Z' // newer — survives
    const toDelete = planPruneReports([r1, r2, doc('d1', '2026-09-05'), doc('d2', '2026-09-05')])
    expect(toDelete.map((d) => d.id)).toEqual(['r1'])
  })

  it('a single report for a day is never flagged as a duplicate', () => {
    expect(planPruneReports([report('r1', '2026-09-05')])).toEqual([])
  })

  it('different report types on the same day are tracked independently', () => {
    const toDelete = planPruneReports([
      report('r1', '2026-09-05', 'daily'),
      report('r2', '2026-09-05', 'weekly'),
    ])
    expect(toDelete).toEqual([])
  })

  it('empty input produces nothing to delete', () => {
    expect(planPruneReports([])).toEqual([])
  })
})

describe('deleteDocument', () => {
  beforeEach(() => {
    vi.stubEnv('ZERODB_API_KEY', 'test-key')
    vi.stubEnv('ZERODB_PROJECT_ID', 'proj-1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('queries for the exact id then deletes the matched row by its real row_id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ row_id: 'row-abc', row_data: { id: 'd1' } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'deleted' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await deleteDocument('a::b', 'd1')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const deleteCall = fetchMock.mock.calls[1]
    expect(String(deleteCall[0])).toContain('/rows/row-abc')
    expect(deleteCall[1]?.method).toBe('DELETE')
  })

  // ---- Real, live bug (shares getDocument's root cause): filtering by `id`
  // silently returns zero rows against ZeroDB, since only scope_key is
  // actually queryable in row_data — meaning deleteDocument() was an
  // unconditional no-op in production regardless of whether the document
  // existed. Fixed the same way: filter ONLY on scope_key, match client-side. ----
  it('filters ONLY on scope_key (the field ZeroDB can actually query) — never sends id as a filter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ row_id: 'row-abc', row_data: { id: 'd1' } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'deleted' }) })
    vi.stubGlobal('fetch', fetchMock)
    await deleteDocument('a::b', 'd1')
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.filters).toEqual({ scope_key: 'a::b' })
    expect(sent.filters).not.toHaveProperty('id')
  })

  it('finds and deletes the exact row even among OTHER rows in the same scope (client-side match)', async () => {
    const rows = [
      { row_id: 'row-other', row_data: { id: 'd-other' } },
      { row_id: 'row-target', row_data: { id: 'd1' } },
    ]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: rows }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'deleted' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await deleteDocument('a::b', 'd1')).toBe(true)
    const deleteCall = fetchMock.mock.calls[1]
    expect(String(deleteCall[0])).toContain('/rows/row-target')
    expect(String(deleteCall[0])).not.toContain('/rows/row-other')
  })

  it('returns false when no row matches the exact id (defensive, same guard as getDocument)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) }))
    expect(await deleteDocument('a::b', 'missing')).toBe(false)
  })

  it('returns false without a scope or id', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await deleteDocument('', 'd1')).toBe(false)
    expect(await deleteDocument('a::b', '')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws when the query fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await deleteDocument('a::b', 'd1')).toBe(false)
  })
})

describe('pruneDuplicateReports', () => {
  beforeEach(() => {
    vi.stubEnv('ZERODB_API_KEY', 'test-key')
    vi.stubEnv('ZERODB_PROJECT_ID', 'proj-1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('lists, plans, and deletes duplicates end to end — real Beacon-shaped repro', async () => {
    const rows = [
      { row_data: { id: 'new', scope_key: 'a::b', kind: 'report', type: 'daily', title: 'Daily Operational Report', content: 'x', created_at: '2026-09-05T11:07:00Z' } },
      { row_data: { id: 'old', scope_key: 'a::b', kind: 'report', type: 'daily', title: 'Daily Operational Report', content: 'x', created_at: '2026-09-05T11:03:00Z' } },
    ]
    const fetchMock = vi.fn()
      // listDocuments
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: rows }) })
      // deleteDocument('old') → re-query by id
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ row_id: 'row-old', row_data: rows[1].row_data }] }) })
      // deleteDocument('old') → the actual DELETE
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: 'deleted' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await pruneDuplicateReports('a::b')).toEqual({ deleted: 1 })
  })

  it('returns { deleted: 0 } without a scope', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await pruneDuplicateReports('')).toEqual({ deleted: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns { deleted: 0 } when there is nothing to prune', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) }))
    expect(await pruneDuplicateReports('a::b')).toEqual({ deleted: 0 })
  })
})
