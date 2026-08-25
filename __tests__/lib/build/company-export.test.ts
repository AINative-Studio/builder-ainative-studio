import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isExportFormat,
  exportFileName,
  exportContentType,
  toJsonExport,
  rowsToColumns,
  csvCell,
  tableToCsv,
  toCsvExport,
  serializeExport,
  exportConfigured,
  listProjectTables,
  fetchTableRows,
  buildCompanyExport,
  type CompanyExport,
} from '@/lib/build/company-export'

/**
 * #63.C — company data export ("you own your data"). Pure serialisers (JSON/CSV,
 * column derivation, RFC-4180 escaping, filenames) are tested with no network; the
 * ZeroDB read path is tested by mocking global fetch (no real API call).
 */

const SAMPLE: CompanyExport = {
  projectId: 'proj-1',
  exportedAt: '2026-08-25T00:00:00.000Z',
  tableCount: 1,
  rowCount: 2,
  tables: [
    { name: 'customers', rows: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace, Jr.' }] },
  ],
}

// ---------- format guard ----------
describe('isExportFormat', () => {
  it('accepts json + csv only', () => {
    expect(isExportFormat('json')).toBe(true)
    expect(isExportFormat('csv')).toBe(true)
    expect(isExportFormat('xml')).toBe(false)
    expect(isExportFormat('')).toBe(false)
    expect(isExportFormat(null)).toBe(false)
  })
})

// ---------- filenames + content type ----------
describe('exportFileName', () => {
  it('is safe, slugged, timestamped, correctly extended', () => {
    const at = new Date('2026-08-25T12:00:00Z')
    expect(exportFileName('Acme Co!', 'json', at)).toBe('acmeco-data-2026-08-25.json')
    expect(exportFileName('Acme Co!', 'csv', at)).toBe('acmeco-data-2026-08-25.zip')
  })
  it('falls back to "company" for an empty slug', () => {
    const at = new Date('2026-08-25T12:00:00Z')
    expect(exportFileName('', 'json', at)).toBe('company-data-2026-08-25.json')
  })
})

describe('exportContentType', () => {
  it('maps format → mime', () => {
    expect(exportContentType('json')).toContain('application/json')
    expect(exportContentType('csv')).toContain('text/csv')
  })
})

// ---------- JSON ----------
describe('toJsonExport', () => {
  it('round-trips to the same object', () => {
    expect(JSON.parse(toJsonExport(SAMPLE))).toEqual(SAMPLE)
  })
})

// ---------- CSV pure logic ----------
describe('rowsToColumns', () => {
  it('unions columns in first-seen order', () => {
    const cols = rowsToColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }])
    expect(cols).toEqual(['a', 'b', 'c'])
  })
  it('handles empty', () => {
    expect(rowsToColumns([])).toEqual([])
  })
})

describe('csvCell (RFC 4180)', () => {
  it('leaves plain values untouched', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
  })
  it('quotes + escapes commas, quotes, newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })
  it('serialises null/undefined as empty and objects as JSON', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell({ x: 1 })).toBe('"{""x"":1}"')
  })
})

describe('tableToCsv', () => {
  it('emits a header + escaped data rows', () => {
    const csv = tableToCsv(SAMPLE.tables[0])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('id,name')
    expect(lines[1]).toBe('1,Ada')
    expect(lines[2]).toBe('2,"Grace, Jr."')
  })
  it('returns empty string for an empty table', () => {
    expect(tableToCsv({ name: 'empty', rows: [] })).toBe('')
  })
})

describe('toCsvExport / serializeExport', () => {
  it('labels each table block', () => {
    const csv = toCsvExport(SAMPLE)
    expect(csv).toContain('# table: customers (2 rows)')
    expect(csv).toContain('id,name')
  })
  it('serializeExport dispatches by format', () => {
    expect(serializeExport(SAMPLE, 'json')).toBe(toJsonExport(SAMPLE))
    expect(serializeExport(SAMPLE, 'csv')).toBe(toCsvExport(SAMPLE))
  })
})

// ---------- ZeroDB read path (mocked) ----------
function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

describe('export read path (#63.C)', () => {
  beforeEach(() => { vi.stubEnv('AINATIVE_API_KEY', 'admin-key') })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('exportConfigured reflects the admin key', () => {
    expect(exportConfigured()).toBe(true)
  })

  it('listProjectTables parses a { tables: [...] } shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ tables: [{ name: 'customers' }, { name: 'orders' }] })))
    expect(await listProjectTables('proj-1')).toEqual(['customers', 'orders'])
  })

  it('listProjectTables parses a bare array shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson([{ table_name: 'a' }, 'b'])))
    expect(await listProjectTables('proj-1')).toEqual(['a', 'b'])
  })

  it('listProjectTables returns [] on error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response))
    expect(await listProjectTables('proj-1')).toEqual([])
  })

  it('fetchTableRows unwraps row_data when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [{ row_data: { id: 1 } }, { row_data: { id: 2 } }] })))
    expect(await fetchTableRows('proj-1', 'customers')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('buildCompanyExport collects tables + rows', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ tables: ['customers'] }))       // list tables
      .mockResolvedValueOnce(okJson({ data: [{ row_data: { id: 1 } }] })) // rows
    vi.stubGlobal('fetch', fetchMock)
    const r = await buildCompanyExport('proj-1')
    expect(r.ok).toBe(true)
    expect(r.export?.tableCount).toBe(1)
    expect(r.export?.rowCount).toBe(1)
    expect(r.export?.tables[0]).toEqual({ name: 'customers', rows: [{ id: 1 }] })
  })

  it('buildCompanyExport fails cleanly when not configured', async () => {
    vi.stubEnv('AINATIVE_API_KEY', '')
    vi.stubEnv('ZERODB_API_KEY', '')
    const r = await buildCompanyExport('proj-1')
    expect(r).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('buildCompanyExport fails cleanly with no project id', async () => {
    const r = await buildCompanyExport('')
    expect(r.ok).toBe(false)
  })
})
