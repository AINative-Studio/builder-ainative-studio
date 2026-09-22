import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'
import { resolveCompanyZerodbKey } from '@/lib/build/company-zerodb-credentials'

/**
 * ZeroDB Proxy API — lets a generated app do CRUD without exposing an API key.
 *
 * GET  /api/db/{table}         → list/query rows
 * POST /api/db/{table}         → insert row
 * PUT  /api/db/{table}?id=xxx  → update row
 * DELETE /api/db/{table}?id=xxx → delete row
 *
 * SECURITY (#331): the app's data is scoped to ITS OWN ZeroDB project via a signed
 * per-app DATA TOKEN (lib/build/app-data-token), NOT a shared project and NOT a
 * client-supplied slug. resolveProject() verifies the token server-side and returns
 * the bound projectId; a missing/forged token FAILS CLOSED to the shared default
 * ONLY for the legacy/unprovisioned case (documented). This closes the cross-tenant
 * IDOR (a caller can't target another company by naming its slug — they'd need that
 * company's unguessable signed token).
 *
 * KEY SCOPING (#806/#844, confirmed live on BOTH the read and write paths): resolving
 * the right PROJECT was never enough — every call here also used one shared,
 * service-wide ZERODB_API_KEY, which ZeroDB rejects against a per-company project:
 *   403 {"error_code":"API_KEY_PROJECT_MISMATCH"}
 * So for every provisioned company, reads returned nothing and writes (real waitlist
 * signups) were silently lost behind the generated app's `.catch(() => {})` success UI.
 * resolveScope() now resolves BOTH the project AND the key actually scoped to it:
 * the shared key ONLY for the shared/legacy project (which it IS correctly scoped to),
 * and the per-company key stored at provision time (company-zerodb-credentials.ts)
 * otherwise. Same fail-closed posture as resolveProject: an unresolvable per-company
 * key is a real error surfaced honestly (502), NEVER a fallback to the shared key —
 * falling back would re-create the cross-tenant mis-scoping and the silent data loss.
 */

const ZERODB_API = 'https://api.ainative.studio/api'
const SHARED_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
/** The SHARED project's own key — correct for SHARED_PROJECT_ID, wrong for every
 *  per-company project (see KEY SCOPING above). Never used outside that project. */
const SHARED_API_KEY = process.env.ZERODB_API_KEY || ''

/**
 * Resolve the ZeroDB project for THIS request from the per-app data token (#331).
 * Token sources (server-verified, never a raw slug): Authorization: Bearer <token>,
 * x-ainative-db-token header, or ?t= query. Returns the token-bound projectId when
 * valid. For an ABSENT token we fall back to the shared project (legacy/unprovisioned
 * apps generated before tokens) — but a PRESENT-but-INVALID token FAILS CLOSED (null)
 * so a forged token never silently reads the shared pool. Callers treat null as 401.
 */
function resolveProject(request: NextRequest): { projectId: string; shared: boolean } | null {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const token =
    bearer ||
    request.headers.get('x-ainative-db-token') ||
    request.nextUrl.searchParams.get('t') ||
    ''
  if (!token) {
    // No token at all → legacy/unprovisioned app → shared project (documented).
    return { projectId: SHARED_PROJECT_ID, shared: true }
  }
  const payload = verifyAppDataToken(token)
  if (!payload) return null // present but invalid/forged → FAIL CLOSED
  // A token can legitimately name the shared project too (an app provisioned
  // against the shared pool) — that's still the shared key's own project.
  return { projectId: payload.projectId, shared: payload.projectId === SHARED_PROJECT_ID }
}

/** A fully-resolved request scope: the project AND the key genuinely scoped to it. */
interface DbScope {
  projectId: string
  apiKey: string
}

/**
 * Resolve {projectId, apiKey} for this request, or a structured failure.
 * - invalid/forged token        → { unauthorized: true }        → 401 (#331, unchanged)
 * - shared/legacy project       → the shared service key        → unchanged behavior
 * - per-company project         → that project's OWN stored key → the #806/#844 fix
 * - per-company, no stored key  → { keyReason }                 → 502, FAIL CLOSED
 */
async function resolveScope(
  request: NextRequest,
): Promise<{ scope?: DbScope; unauthorized?: boolean; keyReason?: string }> {
  const project = resolveProject(request)
  if (!project) return { unauthorized: true }
  if (project.shared) {
    return { scope: { projectId: project.projectId, apiKey: SHARED_API_KEY } }
  }
  const resolved = await resolveCompanyZerodbKey(project.projectId)
  if (!resolved.ok || !resolved.apiKey) {
    return { keyReason: resolved.reason || 'not_stored' }
  }
  return { scope: { projectId: project.projectId, apiKey: resolved.apiKey } }
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

async function zerodbFetch(apiKey: string, method: string, path: string, body?: any) {
  const res = await fetch(`${ZERODB_API}${path}`, {
    method,
    headers: {
      'X-API-Key': apiKey,
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
async function ensureTable(table: string, projectId: string, apiKey: string) {
  try {
    await fetch(`${ZERODB_API}/v1/projects/${projectId}/database/tables`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_name: table }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (_) {
    // Table might already exist — that's fine
  }
}

/** 401 response for a present-but-invalid per-app token (#331 fail-closed). */
const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/**
 * 502 for a company whose project-scoped key can't be resolved (#806/#844).
 * FAIL CLOSED and say so plainly — the alternative (retrying with the shared
 * service key) is the exact mis-scoping that silently dropped real data.
 * `not_stored` is expected for a company provisioned BEFORE this fix shipped:
 * it keeps failing, as it does today, but now with an honest, diagnosable
 * reason instead of an opaque ZeroDB 403.
 */
const KEY_UNAVAILABLE = (reason: string) =>
  NextResponse.json(
    {
      error: 'project data key unavailable',
      reason,
      detail:
        "This company's ZeroDB project has no stored project-scoped API key, so the request cannot be authorized against it. Re-provision the company to mint and store one.",
    },
    { status: 502 },
  )

// GET /api/db/{table} — list or query rows
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const resolved = await resolveScope(request)
  if (resolved.unauthorized) return UNAUTHORIZED()
  if (!resolved.scope) return KEY_UNAVAILABLE(resolved.keyReason || 'not_stored')
  const { projectId: PROJECT_ID, apiKey: API_KEY } = resolved.scope
  const { table } = await params
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
    return zerodbFetch(API_KEY, 'POST', `/v1/projects/${PROJECT_ID}/embeddings/search`, {
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
      return zerodbFetch(API_KEY, 'POST', `/v1/projects/${PROJECT_ID}/database/tables/${table}/query`, {
        filters,
        limit: parseInt(limit),
      })
    } catch (_) {
      return NextResponse.json({ error: 'Invalid filter JSON' }, { status: 400 })
    }
  }

  return zerodbFetch(API_KEY, 'GET', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows?limit=${limit}`)
}

// POST /api/db/{table} — insert row(s)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const resolved = await resolveScope(request)
  if (resolved.unauthorized) return UNAUTHORIZED()
  if (!resolved.scope) return KEY_UNAVAILABLE(resolved.keyReason || 'not_stored')
  const { projectId: PROJECT_ID, apiKey: API_KEY } = resolved.scope
  const { table } = await params
  const body = await request.json()

  // Auto-create table on first insert
  await ensureTable(table, PROJECT_ID, API_KEY)

  // FIRST-WRITE RACE (verified live 2026-08-27): ZeroDB's table create is slow /
  // eventually consistent, so the very first insert into a brand-new table can
  // 404 even though ensureTable was awaited — a generated app's FIRST save
  // silently failed (reproduced from a live app iframe; the identical request
  // succeeded seconds later). On 404, re-ensure, back off briefly, retry once.
  const insertOnce = async (row: unknown) =>
    fetch(`${ZERODB_API}/v1/projects/${PROJECT_ID}/database/tables/${table}/rows`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(10000),
    })
  const insertWithRetry = async (row: unknown) => {
    let res = await insertOnce(row)
    if (res.status === 404) {
      await ensureTable(table, PROJECT_ID, API_KEY)
      await new Promise((r) => setTimeout(r, 1500))
      res = await insertOnce(row)
    }
    return res
  }

  // Support both single row and batch
  if (Array.isArray(body)) {
    // Batch insert
    const results = []
    for (const row of body) {
      const res = await insertWithRetry(row)
      if (res.ok) results.push(flattenRow(await res.json()))
    }
    return NextResponse.json({ inserted: results.length, data: results })
  }

  const res = await insertWithRetry(body)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json({ error: `ZeroDB error: ${res.status}`, detail: text }, { status: res.status })
  }
  return NextResponse.json(normalizeBody(await res.json()))
}

// PUT /api/db/{table}?id=xxx — update row
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const resolved = await resolveScope(request)
  if (resolved.unauthorized) return UNAUTHORIZED()
  if (!resolved.scope) return KEY_UNAVAILABLE(resolved.keyReason || 'not_stored')
  const { projectId: PROJECT_ID, apiKey: API_KEY } = resolved.scope
  const { table } = await params
  const rowId = request.nextUrl.searchParams.get('id')
  if (!rowId) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 })
  }

  const body = await request.json()
  return zerodbFetch(API_KEY, 'PUT', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows/${rowId}`, {
    row_data: body,
  })
}

// DELETE /api/db/{table}?id=xxx — delete row
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const resolved = await resolveScope(request)
  if (resolved.unauthorized) return UNAUTHORIZED()
  if (!resolved.scope) return KEY_UNAVAILABLE(resolved.keyReason || 'not_stored')
  const { projectId: PROJECT_ID, apiKey: API_KEY } = resolved.scope
  const { table } = await params
  const rowId = request.nextUrl.searchParams.get('id')
  if (!rowId) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 })
  }

  return zerodbFetch(API_KEY, 'DELETE', `/v1/projects/${PROJECT_ID}/database/tables/${table}/rows/${rowId}`)
}
