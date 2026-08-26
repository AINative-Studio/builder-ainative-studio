import { NextRequest, NextResponse } from 'next/server'

/**
 * ZeroDB Proxy API — allows generated apps to do CRUD without exposing API key.
 *
 * GET  /api/db/{table}         → list/query rows
 * POST /api/db/{table}         → insert row
 * PUT  /api/db/{table}?id=xxx  → update row
 * DELETE /api/db/{table}?id=xxx → delete row
 *
 * Guest users get the shared builder project.
 * Signed-in users could get their own project (future).
 */

const ZERODB_API = 'https://api.ainative.studio/api'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const API_KEY = process.env.ZERODB_API_KEY || ''

/**
 * Normalize a raw ZeroDB row into the FLAT shape generated apps expect.
 *
 * ZeroDB stores app fields nested under `row_data` and the id as `row_id`:
 *   { row_data: { cost, agent, ... }, row_id: "uuid", created_at, ... }
 * But the model naturally writes `row.id`, `row.cost`, etc. (flat), matching the
 * prompt's example. The mismatch made EVERY data-backed app crash — e.g.
 * `Cannot read properties of undefined (reading 'id')` — because `row.id` was
 * undefined (it's `row_id`) and fields lived under `row_data`. Flatten here so the
 * proxy returns exactly what generated code reads: fields at top level, plus a
 * stable `id`. Idempotent for rows that are already flat.
 */
function flattenRow(row: any): any {
  if (!row || typeof row !== 'object') return row
  const hasRowData = row.row_data && typeof row.row_data === 'object'
  const inner = hasRowData ? row.row_data : {}
  // Start from the row's OWN top-level fields (so already-flat rows keep their
  // fields), drop the ZeroDB envelope keys, then overlay the row_data fields.
  const { row_data: _rd, row_id, created_at, updated_at, table_id, table_name, project_id, ...topLevel } = row
  const id = row_id ?? row.id ?? inner.id
  const createdAt = created_at ?? inner.created_at
  const updatedAt = updated_at ?? inner.updated_at
  return {
    ...(hasRowData ? {} : topLevel), // preserve fields on already-flat rows
    ...inner,                        // app fields from row_data win
    ...(id !== undefined ? { id } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  }
}

/** Normalize a ZeroDB response body so `data` is always a flat array (list) or a
 *  flat object (single insert/update). Leaves unknown shapes untouched. */
function normalizeBody(json: any): any {
  if (!json || typeof json !== 'object') return json
  // List responses: { data: [ {row_data,...}, ... ], total, ... }
  if (Array.isArray(json.data)) {
    return { ...json, data: json.data.map(flattenRow) }
  }
  // Single-row responses (insert/update) come back as the raw row itself:
  // { row_data, row_id, ... }. Wrap in { data } so the app can read either
  // `res.data` (matches the list shape) or the flat fields directly.
  if (json.row_data !== undefined || json.row_id !== undefined) {
    const flat = flattenRow(json)
    return { data: flat, ...flat }
  }
  return json
}

async function zerodbFetch(method: string, path: string, body?: any) {
  const res = await fetch(`${ZERODB_API}${path}`, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json({ error: `ZeroDB error: ${res.status}`, detail: text }, { status: res.status })
  }
  return NextResponse.json(normalizeBody(await res.json()))
}

// Ensure table exists (auto-create on first use)
async function ensureTable(table: string) {
  try {
    await fetch(`${ZERODB_API}/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_name: table }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (_) {
    // Table might already exist — that's fine
  }
}

// GET /api/db/{table} — list or query rows
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const searchParams = request.nextUrl.searchParams
  const limit = searchParams.get('limit') || '50'
  const filter = searchParams.get('filter')

  if (filter) {
    // Query with filter
    try {
      const filters = JSON.parse(filter)
      return zerodbFetch('POST', `/v1/projects/${PROJECT_ID}/database/tables/${table}/query`, {
        filters,
        limit: parseInt(limit),
      })
    } catch (_) {
      return NextResponse.json({ error: 'Invalid filter JSON' }, { status: 400 })
    }
  }

  return zerodbFetch('GET', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows?limit=${limit}`)
}

// POST /api/db/{table} — insert row(s)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const body = await request.json()

  // Auto-create table on first insert
  await ensureTable(table)

  // Support both single row and batch
  if (Array.isArray(body)) {
    // Batch insert
    const results = []
    for (const row of body) {
      const res = await fetch(`${ZERODB_API}/v1/projects/${PROJECT_ID}/database/tables/${table}/rows`, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ row_data: row }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) results.push(flattenRow(await res.json()))
    }
    return NextResponse.json({ inserted: results.length, data: results })
  }

  return zerodbFetch('POST', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows`, {
    row_data: body,
  })
}

// PUT /api/db/{table}?id=xxx — update row
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const rowId = request.nextUrl.searchParams.get('id')
  if (!rowId) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 })
  }

  const body = await request.json()
  return zerodbFetch('PUT', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows/${rowId}`, {
    row_data: body,
  })
}

// DELETE /api/db/{table}?id=xxx — delete row
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const rowId = request.nextUrl.searchParams.get('id')
  if (!rowId) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 })
  }

  return zerodbFetch('DELETE', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows/${rowId}`)
}
