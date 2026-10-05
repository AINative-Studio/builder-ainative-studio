import { NextRequest, NextResponse } from 'next/server'
import { resolveDbProject, pickAppSlug } from '@/lib/build/app-registry'

/**
 * ZeroDB Proxy API — allows generated apps to do CRUD without exposing API key.
 *
 * GET  /api/db/{table}         → list/query rows
 * POST /api/db/{table}         → insert row
 * PUT  /api/db/{table}?id=xxx  → update row
 * DELETE /api/db/{table}?id=xxx → delete row
 *
 * PER-COMPANY ISOLATION (#331): each request is scoped to the CURRENT company's
 * ZeroDB project — NOT one shared project for everybody. The company slug arrives on
 * every same-origin call automatically (the preview/host response sets a first-party
 * `ainative_app` cookie), so the generated app code needs NO change. We resolve
 * slug → provisioned zerodbProjectId server-side (resolveDbProject) and address the
 * ZeroDB rows/query/embeddings endpoints under that project, using the Builder's own
 * server key (never a per-app key in the browser) — the same admin-key-scoped-by-project
 * pattern already used in app/api/build/systems/route.ts::readProvisionedCounts.
 *
 * FALLBACK: un-provisioned / anonymous-guest apps (no slug, or a slug with no
 * provisioned project yet) fall back to the shared env project, so everything that
 * works today keeps working.
 */

const ZERODB_API = 'https://api.ainative.studio/api'
const DEFAULT_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
// Builder server key. Prefer AINATIVE_API_KEY (mirrors app-registry + systems route),
// fall back to ZERODB_API_KEY for backward compatibility with existing deploys.
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''

/**
 * The resolved data-plane scope for a single request (#331): which ZeroDB project the
 * proxy addresses and which key it uses. `apiKey` is always the Builder server key —
 * the browser never receives a per-app key; isolation comes from the project id.
 */
interface DbScope {
  projectId: string
  apiKey: string
  source: 'cookie' | 'query' | 'header' | 'env'
}

/**
 * Resolve the per-request DB scope from the CURRENT company (#331).
 *
 * Reads the company slug (precedence: first-party cookie `ainative_app` > `?app=`
 * query > `x-ainative-app` header), maps it to the company's provisioned
 * zerodbProjectId via the app registry, and returns that project scoped to the
 * Builder server key. If there is no slug or no provisioned project, falls back to the
 * shared env project so guest/un-provisioned apps keep working. Never throws.
 */
async function resolveScope(request: NextRequest): Promise<DbScope> {
  const cookieSlug = request.cookies.get('ainative_app')?.value
  const querySlug = request.nextUrl.searchParams.get('app')
  const headerSlug = request.headers.get('x-ainative-app')
  const slug = pickAppSlug({ cookie: cookieSlug, query: querySlug, header: headerSlug })
  const via: DbScope['source'] = (cookieSlug || '').trim()
    ? 'cookie'
    : (querySlug || '').trim()
      ? 'query'
      : (headerSlug || '').trim()
        ? 'header'
        : 'env'

  if (slug) {
    try {
      const { projectId } = await resolveDbProject(slug)
      if (projectId) return { projectId, apiKey: API_KEY, source: via }
    } catch {
      // fall through to env default
    }
  }
  return { projectId: DEFAULT_PROJECT_ID, apiKey: API_KEY, source: 'env' }
}

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

async function zerodbFetch(scope: DbScope, method: string, path: string, body?: any) {
  const res = await fetch(`${ZERODB_API}${path}`, {
    method,
    headers: {
      'X-API-Key': scope.apiKey,
      // Bearer + X-API-Key: mirror the systems route so the project-scoped path is
      // authorized whether core wants the header or the bearer form.
      Authorization: `Bearer ${scope.apiKey}`,
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

// Ensure table exists (auto-create on first use) — scoped to the resolved project.
async function ensureTable(scope: DbScope, table: string) {
  try {
    await fetch(`${ZERODB_API}/v1/projects/${scope.projectId}/database/tables`, {
      method: 'POST',
      headers: {
        'X-API-Key': scope.apiKey,
        Authorization: `Bearer ${scope.apiKey}`,
        'Content-Type': 'application/json',
      },
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
  const scope = await resolveScope(request)
  const searchParams = request.nextUrl.searchParams
  const limit = searchParams.get('limit') || '50'
  const filter = searchParams.get('filter')
  const search = searchParams.get('search')

  // SEMANTIC SEARCH (#317): a generated app couldn't do ZeroDB semantic search —
  // there was no same-origin path (the client can't hold the ZeroDB key, and the
  // proxy only did CRUD), so "I set it up but it never worked". Wire it here:
  //   GET /api/db/{table}?search=<text>[&threshold=0.7]
  // forwards to ZeroDB's embeddings/search (auto-embeds the text query, server-side
  // key). Returns { results, total_results, ... }. Semantic search is over the
  // project's vector store (namespace = table), so the app must have stored vectors.
  if (search) {
    const threshold = searchParams.get('threshold')
    return zerodbFetch(scope, 'POST', `/v1/projects/${scope.projectId}/embeddings/search`, {
      query: search,
      limit: parseInt(limit),
      namespace: table,
      ...(threshold ? { threshold: parseFloat(threshold) } : {}),
    })
  }

  if (filter) {
    // Query with filter
    try {
      const filters = JSON.parse(filter)
      return zerodbFetch(scope, 'POST', `/v1/projects/${scope.projectId}/database/tables/${table}/query`, {
        filters,
        limit: parseInt(limit),
      })
    } catch (_) {
      return NextResponse.json({ error: 'Invalid filter JSON' }, { status: 400 })
    }
  }

  return zerodbFetch(scope, 'GET', `/v1/projects/${scope.projectId}/database/tables/${table}/rows?limit=${limit}`)
}

// POST /api/db/{table} — insert row(s)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const scope = await resolveScope(request)
  const body = await request.json()

  // Auto-create table on first insert
  await ensureTable(scope, table)

  // Support both single row and batch
  if (Array.isArray(body)) {
    // Batch insert
    const results = []
    for (const row of body) {
      const res = await fetch(`${ZERODB_API}/v1/projects/${scope.projectId}/database/tables/${table}/rows`, {
        method: 'POST',
        headers: {
          'X-API-Key': scope.apiKey,
          Authorization: `Bearer ${scope.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ row_data: row }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) results.push(flattenRow(await res.json()))
    }
    return NextResponse.json({ inserted: results.length, data: results })
  }

  return zerodbFetch(scope, 'POST', `/v1/projects/${scope.projectId}/database/tables/${table}/rows`, {
    row_data: body,
  })
}

// PUT /api/db/{table}?id=xxx — update row
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const scope = await resolveScope(request)
  const rowId = request.nextUrl.searchParams.get('id')
  if (!rowId) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 })
  }

  const body = await request.json()
  return zerodbFetch(scope, 'PUT', `/v1/projects/${scope.projectId}/database/tables/${table}/rows/${rowId}`, {
    row_data: body,
  })
}

// DELETE /api/db/{table}?id=xxx — delete row
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params
  const scope = await resolveScope(request)
  const rowId = request.nextUrl.searchParams.get('id')
  if (!rowId) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 })
  }

  return zerodbFetch(scope, 'DELETE', `/v1/projects/${scope.projectId}/database/tables/${table}/rows/${rowId}`)
}
