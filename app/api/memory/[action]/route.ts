import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * ZeroMemory proxy (#496) — the runtime-callable path for a generated app's
 * cognitive memory (remember/recall), scoped to the company's OWN ZeroDB
 * project namespace so one company can never read/write another's memories.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's ZeroMemory entry claims "no
 * separate provisioning needed — uses the SAME ZeroDB project API key
 * provisionInstantDb() already creates." That's real (live-verified,
 * 2026-09: POST /remember and /recall both return 200 with builder's own
 * service key) — but "no provisioning needed" was read as "already usable,"
 * when in fact NOTHING wired a generated app to call it at all. Cody could
 * select ZeroMemory in codegen, but the generated code had no real path to
 * use it — the exact class of lie #443 fixed for the founder-scoped 5,
 * never extended here. This closes that gap for ZeroMemory specifically.
 *
 * SCOPING: unlike the founder-scoped proxy (/api/primitive/[primitive]),
 * ZeroMemory doesn't need a founder's personal credential — it's called
 * with BUILDER'S OWN shared ZeroDB service key, matching /api/db's proven
 * shape exactly. The per-company boundary is the `namespace: project:{id}`
 * parameter, injected server-side from the SAME signed per-app data token
 * /api/db already verifies (lib/build/app-data-token.ts) — reused as-is,
 * not reinvented, so a generated app that already has this token (minted at
 * preview time, app/api/preview/[id]/route.ts) gets ZeroMemory for free.
 * A missing/forged token fails closed (401), same semantics as /api/db.
 *
 * SCOPE: only the two real, live-confirmed operations — remember (write)
 * and recall (semantic search read). No other memory/v2 sub-route was found
 * live (openapi discovery 404'd); this proxy deliberately does not guess at
 * unverified endpoints.
 *
 * POST /api/memory/remember  { content, memory_type? }
 * POST /api/memory/recall    { query }
 */

export const runtime = 'nodejs'

const MEMORY_API = process.env.ZEROMEMORY_API_URL || 'https://api.ainative.studio/api/v1/public/memory/v2'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Resolve the company's ZeroDB project id from the same signed per-app data
 *  token /api/db verifies — no separate token scheme, no separate minting. */
function resolveProjectId(request: NextRequest): string | null {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const token =
    bearer ||
    request.headers.get('x-ainative-db-token') ||
    request.nextUrl.searchParams.get('t') ||
    ''
  if (!token) return null // no token → no scoping possible → fail closed
  const payload = verifyAppDataToken(token)
  return payload?.projectId || null
}

async function memoryFetch(path: 'remember' | 'recall', body: Record<string, unknown>) {
  const res = await fetch(`${MEMORY_API}/${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `ZeroMemory error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const projectId = resolveProjectId(request)
  if (!projectId) return UNAUTHORIZED()

  const { action } = await params
  const body = await request.json().catch(() => ({}))
  const namespace = `project:${projectId}`

  if (action === 'remember') {
    const content = String(body?.content || '').trim()
    if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })
    return memoryFetch('remember', {
      content,
      memory_type: body?.memory_type || 'working',
      namespace,
    })
  }

  if (action === 'recall') {
    const query = String(body?.query || '').trim()
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })
    return memoryFetch('recall', { query, namespace })
  }

  return NextResponse.json({ error: `unknown memory action "${action}" — use /api/memory/remember or /api/memory/recall` }, { status: 404 })
}
