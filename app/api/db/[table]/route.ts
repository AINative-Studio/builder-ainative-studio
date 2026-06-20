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

const ZERODB_API = 'https://api.ainative.studio'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '29e8754c-c67d-4a74-9167-a069d87ab1aa'
const API_KEY = process.env.ZERODB_API_KEY || ''

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
  return NextResponse.json(await res.json())
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
      if (res.ok) results.push(await res.json())
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
