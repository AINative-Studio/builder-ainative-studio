/**
 * #343 — seeded-data check for the ready path.
 *
 * extractDbTables is pure; checkSeededData is exercised against a stubbed
 * global fetch. The invariant under test: the check is CHEAP, definitive when
 * it can be, and STRICTLY FAIL-OPEN (a ZeroDB hiccup never claims "unseeded").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { extractDbTables, checkSeededData } from '@/lib/build/seed-check'

const realFetch = global.fetch

afterEach(() => {
  global.fetch = realFetch
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('ZERODB_API_KEY', 'test-key')
})

function mockZerodb(handler: (url: string) => { status: number; body?: any }) {
  global.fetch = vi.fn(async (input: any) => {
    const url = String(input)
    const { status, body } = handler(url)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
    } as any
  }) as any
}

describe('extractDbTables', () => {
  it('extracts tables from plain string literals', () => {
    const code = `fetch('/api/db/tasks').then(r => r.json())`
    expect(extractDbTables(code)).toEqual(['tasks'])
  })

  it('extracts from template literals with query strings and ids', () => {
    const code =
      'await fetch(`/api/db/notes?id=${id}`, { method: "PUT" });' +
      "await fetch('/api/db/tags?filter=' + f);"
    expect(extractDbTables(code)).toEqual(['notes', 'tags'])
  })

  it('dedupes repeated references', () => {
    const code = `
      fetch('/api/db/orders')
      fetch('/api/db/orders', { method: 'POST' })
      fetch('/api/db/orders?id=' + id, { method: 'DELETE' })
    `
    expect(extractDbTables(code)).toEqual(['orders'])
  })

  it('skips fully dynamic table segments (cannot know statically)', () => {
    expect(extractDbTables('fetch(`/api/db/${table}`)')).toEqual([])
  })

  it('returns empty for non-data-backed code and empty input', () => {
    expect(extractDbTables('const x = 1')).toEqual([])
    expect(extractDbTables('')).toEqual([])
  })
})

describe('checkSeededData', () => {
  it('short-circuits (checked, not data-backed) when code has no /api/db', async () => {
    global.fetch = vi.fn() as any
    const res = await checkSeededData('export default function App(){return null}')
    expect(res.dataBacked).toBe(false)
    expect(res.checked).toBe(true)
    expect(res.seeded).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports seeded when a referenced table has rows', async () => {
    mockZerodb((url) =>
      url.includes('/tables/tasks/rows')
        ? { status: 200, body: { data: [{ row_id: 'r1', row_data: { title: 'Ship #343' } }] } }
        : { status: 404 },
    )
    const res = await checkSeededData(`fetch('/api/db/tasks')`)
    expect(res.dataBacked).toBe(true)
    expect(res.checked).toBe(true)
    expect(res.seeded).toBe(true)
    expect(res.seededTables).toEqual(['tasks'])
  })

  it('reports definitively unseeded when tables are missing (404)', async () => {
    mockZerodb(() => ({ status: 404 }))
    const res = await checkSeededData(`fetch('/api/db/tasks'); fetch('/api/db/tags')`)
    expect(res.dataBacked).toBe(true)
    expect(res.checked).toBe(true)
    expect(res.seeded).toBe(false)
    expect(res.detail).toContain('NO seeded rows')
  })

  it('reports unseeded when a table exists but is empty', async () => {
    mockZerodb(() => ({ status: 200, body: { data: [] } }))
    const res = await checkSeededData(`fetch('/api/db/tasks')`)
    expect(res.checked).toBe(true)
    expect(res.seeded).toBe(false)
  })

  it('FAIL-OPEN: network error → unchecked, never claims unseeded', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as any
    const res = await checkSeededData(`fetch('/api/db/tasks')`)
    expect(res.dataBacked).toBe(true)
    expect(res.checked).toBe(false)
    expect(res.seeded).toBe(false)
    expect(res.detail).toContain('fail-open')
  })

  it('FAIL-OPEN: 5xx → unchecked', async () => {
    mockZerodb(() => ({ status: 500 }))
    const res = await checkSeededData(`fetch('/api/db/tasks')`)
    expect(res.checked).toBe(false)
  })

  it('a positive result is definitive even when a sibling probe fails', async () => {
    mockZerodb((url) =>
      url.includes('/tables/tasks/rows')
        ? { status: 200, body: { data: [{ id: 'r1' }] } }
        : { status: 503 },
    )
    const res = await checkSeededData(`fetch('/api/db/tasks'); fetch('/api/db/flaky')`)
    expect(res.checked).toBe(true)
    expect(res.seeded).toBe(true)
    expect(res.seededTables).toEqual(['tasks'])
  })

  it('FAIL-OPEN: no API key configured → unchecked, no fetch', async () => {
    vi.stubEnv('ZERODB_API_KEY', '')
    vi.stubEnv('AINATIVE_API_KEY', '')
    global.fetch = vi.fn() as any
    const res = await checkSeededData(`fetch('/api/db/tasks')`)
    expect(res.checked).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('probes at most 3 tables (cheap ready path)', async () => {
    mockZerodb(() => ({ status: 404 }))
    const code = ['a', 'b', 'c', 'd', 'e'].map((t) => `fetch('/api/db/${t}')`).join(';')
    const res = await checkSeededData(code)
    expect((global.fetch as any).mock.calls.length).toBe(3)
    expect(res.tables).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('targets the provided (per-company) project id when given', async () => {
    mockZerodb(() => ({ status: 200, body: { data: [{ id: 'x' }] } }))
    await checkSeededData(`fetch('/api/db/tasks')`, 'company-project-123')
    expect(String((global.fetch as any).mock.calls[0][0])).toContain('/projects/company-project-123/')
  })
})
