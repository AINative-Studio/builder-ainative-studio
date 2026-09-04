import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * Community proxy (#505) — the runtime-callable path for a generated app to
 * read the platform's community member directory, using BUILDER'S OWN shared
 * service key — the exact same shape Agent402's proxy (#500) uses.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's Community entry ("groups,
 * membership, events, social feeds and interactions") had zero builder-side
 * wiring — same "Cody references a primitive with no real runtime path"
 * class of bug #443 fixed for the founder-scoped 5.
 *
 * AUTH CONFIRMED LIVE (2026-09-04): builder's existing shared
 * ZERODB_API_KEY/AINATIVE_API_KEY authenticates directly against
 *   GET /api/v1/community/members -> 200, real member directory (4497 total)
 * via X-API-Key.
 *
 * SCOPE — deliberately narrow, real evidence for each cut:
 *  - GET /api/community/members -> real 200, safe, read-only, platform-wide
 *    member directory — no per-company/per-user identity needed.
 *  - feed, posts, events, messages, moderation were investigated and are
 *    NOT wired here:
 *      - GET /api/v1/community/feed  -> real 400 "Tenant ID is required" —
 *        needs per-company tenant scoping this pass didn't build; a real,
 *        buildable follow-up, not a dead end.
 *      - GET /api/v1/community/posts -> real 404 with builder's shared key —
 *        route requires a path/query shape not confirmed in this pass.
 *      - messages/moderation/events were not tested — write-capable or
 *        identity-scoped surfaces, deliberately left uninvestigated rather
 *        than guessed at.
 *
 * Reuses the SAME signed per-app data token /api/db, /api/memory,
 * /api/agent402, and /api/developer-program already verify
 * (lib/build/app-data-token.ts) purely as an authenticated-generated-app
 * gate — the member directory is platform-level, not company-scoped, so the
 * token confirms the caller is a real generated app without deriving any
 * namespace from it.
 *
 * GET /api/community/members
 */

export const runtime = 'nodejs'

const COMMUNITY_API = process.env.COMMUNITY_API_URL || 'https://api.ainative.studio/api/v1/community'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Confirms the caller is a real generated app via the same signed per-app
 *  data token every other tonight-built proxy verifies. No project scoping
 *  is derived from it — this is purely an authenticated-caller gate. */
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
  members: '/members',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!verifyCaller(request)) return UNAUTHORIZED()

  const { action } = await params
  const upstreamPath = ALLOWED_ACTIONS[action]
  if (!upstreamPath) {
    return NextResponse.json(
      { error: `unknown community action "${action}" — use /api/community/members` },
      { status: 404 },
    )
  }

  const res = await fetch(`${COMMUNITY_API}${upstreamPath}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `Community error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}
