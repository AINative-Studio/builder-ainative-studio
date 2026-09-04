import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * AINativeNGO proxy — the runtime-callable path for a generated app to read
 * AINativeNGO's ("InstitutionOS") account-level institution list, using
 * BUILDER'S OWN shared service key — same shape as Agent402/ZeroMemory.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's AINativeNGO entry claimed "Live API
 * verified at ngo.ainative.studio" but had zero builder-side wiring — Cody
 * could reference it in codegen with no real runtime path.
 *
 * AUTH CONFIRMED BY DIRECT TESTING, NOT ASSUMPTION:
 *   curl https://ngo.ainative.studio/api/v1/institutions -H "X-API-Key: <builder's real key>"
 *   -> 200, real institution rows (e.g. "Hope Community Foundation")
 * Builder's existing shared ZERODB_API_KEY/AINATIVE_API_KEY already
 * authenticates — no separate provisioning or service account needed.
 *
 * SCOPE — deliberately narrow:
 *  - GET /api/ainative-ngo/institutions -> real 200, safe, read-only,
 *    account-level (not per-company — AINativeNGO's real API is a shared
 *    directory, no per-company scoping mechanism exists in the wired op).
 *  - The other ~359 endpoints in AINativeNGO's real OpenAPI spec (grants,
 *    board governance, compliance, donors, memory/graph, audit, permissions)
 *    were NOT independently verified in this pass — deliberately not wired
 *    rather than guessed at. Most also require an {institution_id} this
 *    route has no way to resolve per-company yet.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory, and
 * /api/agent402 already verify — purely an authenticated-caller gate, no
 * per-company namespace injected (this operation is account-level).
 *
 * GET /api/ainative-ngo/institutions
 */

export const runtime = 'nodejs'

const AINATIVE_NGO_API = process.env.AINATIVE_NGO_API_URL || 'https://ngo.ainative.studio/api/v1'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Confirms the caller is a real generated app via the same signed per-app
 *  data token /api/db, /api/memory, and /api/agent402 verify. No project
 *  scoping is derived from it — this operation is account-level. */
function verifyCaller(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const token =
    bearer ||
    request.headers.get('x-ainative-db-token') ||
    request.nextUrl.searchParams.get('t') ||
    ''
  if (!token) return false
  return verifyAppDataToken(token) !== null
}

const ALLOWED_ACTIONS: Record<string, string> = {
  institutions: '/institutions',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!verifyCaller(request)) return UNAUTHORIZED()

  const { action } = await params
  const upstreamPath = ALLOWED_ACTIONS[action]
  if (!upstreamPath) {
    return NextResponse.json(
      { error: `unknown ainative-ngo action "${action}" — use /api/ainative-ngo/institutions` },
      { status: 404 },
    )
  }

  const res = await fetch(`${AINATIVE_NGO_API}${upstreamPath}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `AINativeNGO error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}
