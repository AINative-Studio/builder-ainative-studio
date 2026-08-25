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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
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
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.row_data.kind).toBe('report')
  })

  it('createDocument swallows a failed write and returns null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    expect(await createDocument('a::b', { title: 't', content: 'c' })).toBeNull()
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

  it('getDocument returns the full document filtered by scope + id', async () => {
    const row = { row_data: { id: 'x', scope_key: 'a::b', type: 'research', title: 'R', content: 'full body', created_at: '2026-01-01T00:00:00Z' } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [row] }) })
    vi.stubGlobal('fetch', fetchMock)
    const doc = await getDocument('a::b', 'x')
    expect(doc!.content).toBe('full body')
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.filters).toEqual({ scope_key: 'a::b', id: 'x' })
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
