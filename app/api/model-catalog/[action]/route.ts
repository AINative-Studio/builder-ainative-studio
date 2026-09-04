import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * Model Catalog proxy (#505) — the runtime-callable path for a generated app
 * to list AINative's available inference models, using BUILDER'S OWN shared
 * service key — same shape as Agent402/ZeroMemory/Browser Agent.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's Model Catalog entry ("47 models
 * across text/code/reasoning/image/video/audio/embedding") had no `apiBase`
 * at all and zero builder-side wiring — Cody could reference it in codegen
 * with no real runtime path, the same class of bug #443 fixed for the
 * founder-scoped 5.
 *
 * AUTH CONFIRMED BY DIRECT TESTING:
 *   curl .../api/v1/public/models (no key)      → 401 AUTH_REQUIRED
 *   curl .../api/v1/public/models -H "X-API-Key: <builder's real key>" → 200, 61 real models
 * Builder's existing shared key already authenticates — no separate
 * provisioning needed, matching Agent402/ZeroMemory's pattern.
 *
 * SCOPE — deliberately narrow, real evidence for the cut:
 *  - GET /api/model-catalog/list → real 200, safe, read-only, account-level.
 *  - A single-model lookup route also exists (.../models/{model_id}) but its
 *    real contract expects a UUID model_id, NOT the model's string `id`
 *    field returned by the list endpoint (confirmed live: passing the
 *    string id returns a 422 uuid_parsing error) — the real UUID values
 *    were not independently confirmed in this pass, so that lookup is
 *    deliberately NOT wired here rather than guessing at an unverified
 *    contract.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory,
 * /api/agent402, and /api/opencapstack already verify — purely an
 * authenticated-generated-app gate; the model list is account-level, not
 * per-company, so no namespace is derived from the token.
 *
 * GET /api/model-catalog/list
 */

export const runtime = 'nodejs'

const MODEL_CATALOG_API = process.env.MODEL_CATALOG_API_URL || 'https://api.ainative.studio/api/v1/public'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Same signed per-app data token every other shared-key proxy verifies —
 *  gates access only, no namespace to inject (account-level data). */
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
  list: '/models',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!verifyCaller(request)) return UNAUTHORIZED()

  const { action } = await params
  const upstreamPath = ALLOWED_ACTIONS[action]
  if (!upstreamPath) {
    return NextResponse.json(
      { error: `unknown model-catalog action "${action}" — use /api/model-catalog/list` },
      { status: 404 },
    )
  }

  const res = await fetch(`${MODEL_CATALOG_API}${upstreamPath}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `Model Catalog error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}
