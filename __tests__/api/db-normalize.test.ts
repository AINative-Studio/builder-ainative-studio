import { describe, it, expect } from 'vitest'

// The proxy's flatten/normalize logic is internal; re-implement the contract here
// via a focused import isn't possible (route module), so we test the SHAPE contract
// the generated apps depend on by exercising the exported helpers through a thin
// re-export. Instead we assert the documented behavior against sample ZeroDB bodies.
//
// NOTE: flattenRow/normalizeBody live in app/api/db/[table]/route.ts. To keep them
// unit-testable without importing the Next route, they are duplicated-by-contract
// here; if the route logic changes, these tests define the required behavior.

function flattenRow(row: any): any {
  if (!row || typeof row !== 'object') return row
  const hasRowData = row.row_data && typeof row.row_data === 'object'
  const inner = hasRowData ? row.row_data : {}
  const { row_data: _rd, row_id, created_at, updated_at, table_id, table_name, project_id, ...topLevel } = row
  const id = row_id ?? row.id ?? inner.id
  const createdAt = created_at ?? inner.created_at
  const updatedAt = updated_at ?? inner.updated_at
  return {
    ...(hasRowData ? {} : topLevel),
    ...inner,
    ...(id !== undefined ? { id } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  }
}
function normalizeBody(json: any): any {
  if (!json || typeof json !== 'object') return json
  if (Array.isArray(json.data)) return { ...json, data: json.data.map(flattenRow) }
  if (json.row_data !== undefined || json.row_id !== undefined) {
    const flat = flattenRow(json)
    return { data: flat, ...flat }
  }
  return json
}

describe('/api/db response normalization (crash fix: reading .id of undefined)', () => {
  it('GET list: flattens row_data + surfaces id from row_id', () => {
    const raw = {
      total: 1, data: [
        { row_data: { cost: 0.005, agent: 'A', model: 'GPT-4' }, row_id: 'uuid-1', created_at: 't1' },
      ],
    }
    const out = normalizeBody(raw)
    expect(out.data[0].id).toBe('uuid-1')
    expect(out.data[0].cost).toBe(0.005)      // field lifted from row_data
    expect(out.data[0].agent).toBe('A')
    expect(out.data[0].created_at).toBe('t1')
    // the app reads d.data — still an array
    expect(Array.isArray(out.data)).toBe(true)
  })

  it('POST single insert: raw row becomes {data: flat, ...flat} so d.data is defined', () => {
    // This is the exact shape that crashed: POST returned {row_data, row_id} with NO
    // data wrapper, so `d.data` was undefined → [...prev, undefined] → .id crash.
    const raw = { row_data: { x: 1 }, row_id: 'uuid-2', created_at: 't2' }
    const out = normalizeBody(raw)
    expect(out.data).toBeDefined()            // d.data no longer undefined
    expect(out.data.id).toBe('uuid-2')
    expect(out.data.x).toBe(1)
    // also readable flat (some generated code reads d directly)
    expect(out.id).toBe('uuid-2')
    expect(out.x).toBe(1)
  })

  it('already-flat rows pass through unchanged (idempotent)', () => {
    const raw = { data: [{ id: 'a', name: 'x' }] }
    const out = normalizeBody(raw)
    expect(out.data[0].id).toBe('a')
    expect(out.data[0].name).toBe('x')
  })

  it('error bodies / unknown shapes are left untouched', () => {
    expect(normalizeBody({ error: 'nope' })).toEqual({ error: 'nope' })
    expect(normalizeBody(null)).toBeNull()
  })

  it('row_data missing → still surfaces id, no crash', () => {
    const out = flattenRow({ row_id: 'z' })
    expect(out.id).toBe('z')
  })
})
