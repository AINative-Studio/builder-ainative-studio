import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * Developer Program proxy (#505) — the runtime-callable path for a generated
 * app to read builder's own platform-level developer analytics and request
 * logs, using BUILDER'S OWN shared service key — the exact same shape
 * Agent402's proxy (#500) uses.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's Developer Program entry ("Let the
 * app monetize itself: 0-40% markup + Stripe Connect payouts") had zero
 * builder-side wiring — same "Cody references a primitive with no real
 * runtime path" class of bug #443 fixed for the founder-scoped 5.
 *
 * AUTH CONFIRMED LIVE (2026-09-04): builder's existing shared
 * ZERODB_API_KEY/AINATIVE_API_KEY authenticates directly against
 *   GET /api/v1/public/developer/analytics -> 200, real platform metrics
 *   GET /api/v1/public/developer/logs      -> 200, real request-log entries
 * via X-API-Key. No separate credential needed.
 *
 * SCOPE — deliberately narrow, real evidence for each cut:
 *  - GET /api/developer-program/analytics -> real 200, safe, read-only,
 *    aggregate platform request/error metrics — no money moves.
 *  - GET /api/developer-program/logs      -> real 200, safe, read-only,
 *    request log entries — no money moves.
 *  - earnings and payouts are DELIBERATELY NOT wired: both live-tested and
 *    return a genuine 401 ("Could not validate credentials") with builder's
 *    shared key — these are per-developer-account resources, not
 *    account-level like analytics/logs, and correctly reject a platform key
 *    with no bound developer identity. Even if they did authenticate, this
 *    is real money (Stripe Connect payouts) — deliberately out of scope for
 *    a first pass, matching Agent402's (#500) exclusion of payments/Hedera
 *    operations from its proxy.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory, and
 * /api/agent402 already verify (lib/build/app-data-token.ts) purely as an
 * authenticated-generated-app gate — these endpoints are platform-level, not
 * company-scoped, so the token confirms the caller is a real generated app
 * without deriving any namespace from it.
 *
 * GET /api/developer-program/analytics
 * GET /api/developer-program/logs
 */

export const runtime = 'nodejs'

const DEVELOPER_API = process.env.DEVELOPER_PROGRAM_API_URL || 'https://api.ainative.studio/api/v1/public/developer'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Confirms the caller is a real generated app via the same signed per-app
 *  data token /api/db, /api/memory, and /api/agent402 verify. No project
 *  scoping is derived from it — this is purely an authenticated-caller gate. */
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
  analytics: '/analytics',
  logs: '/logs',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!verifyCaller(request)) return UNAUTHORIZED()

  const { action } = await params
  const upstreamPath = ALLOWED_ACTIONS[action]
  if (!upstreamPath) {
    return NextResponse.json(
      { error: `unknown developer-program action "${action}" — use /api/developer-program/analytics or /api/developer-program/logs` },
      { status: 404 },
    )
  }

  const res = await fetch(`${DEVELOPER_API}${upstreamPath}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `Developer Program error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}
