import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * Browser Agent proxy (#499) — the runtime-callable path for a generated
 * app's web data extraction / browser automation.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's Browser Agent entry documents a
 * real, live REST API (confirmed #411/#413: GET .../health lists real
 * endpoints) but nothing wired a generated app to actually call it — same
 * "Cody references a primitive with no real runtime path" class of bug #443
 * fixed for the founder-scoped 5, extended here exactly like #496 (ZeroMemory).
 *
 * SCOPING: Browser Agent is a SHARED capability, not "one resource per
 * founder identity" (no company-specific browser session/account exists to
 * scope by) — same shape as ZeroMemory. Called with BUILDER'S OWN service
 * key. Auth is the SAME signed per-app data token /api/db and /api/memory
 * already verify (lib/build/app-data-token.ts) — reused as-is so any
 * existing generated app already has what it needs. A missing/forged token
 * fails closed (401). Unlike ZeroMemory there is no per-company namespace to
 * inject (Browser Agent has no persistent per-caller state) — the token only
 * gates access, it doesn't scope a namespace.
 *
 * SCOPE: only the two live-confirmed operations — extract (read a page) and
 * act (drive a page). Live-verified directly (2026-09):
 *   POST /extract {url, extract_goal} -> 200 {success, data, session_id, url}
 *   POST /act     {url, instruction}  -> 200 {success, action_taken, session_id, url}
 * validate/task/extract-to-table/enrich-memory/batch-extract/enrich-memory-async
 * are real per /health but their request shapes were NOT independently
 * verified in this pass — deliberately not exposed here rather than guessing.
 *
 * POST /api/browser-agent/extract  { url, extract_goal }
 * POST /api/browser-agent/act      { url, instruction }
 */

export const runtime = 'nodejs'

const BROWSER_AGENT_API = process.env.BROWSER_AGENT_API_URL || 'https://api.ainative.studio/api/v1/public/browser'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Same signed per-app data token /api/db and /api/memory already verify —
 *  no separate token scheme, no separate minting. Gates access only; Browser
 *  Agent has no per-company namespace to inject. */
function hasValidToken(request: NextRequest): boolean {
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

async function browserFetch(path: 'extract' | 'act', body: Record<string, unknown>) {
  const res = await fetch(`${BROWSER_AGENT_API}/${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `Browser Agent error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!hasValidToken(request)) return UNAUTHORIZED()

  const { action } = await params
  const body = await request.json().catch(() => ({}))

  if (action === 'extract') {
    const url = String(body?.url || '').trim()
    const extractGoal = String(body?.extract_goal || '').trim()
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
    if (!extractGoal) return NextResponse.json({ error: 'extract_goal required' }, { status: 400 })
    return browserFetch('extract', { url, extract_goal: extractGoal })
  }

  if (action === 'act') {
    const url = String(body?.url || '').trim()
    const instruction = String(body?.instruction || '').trim()
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
    if (!instruction) return NextResponse.json({ error: 'instruction required' }, { status: 400 })
    return browserFetch('act', { url, instruction })
  }

  return NextResponse.json(
    { error: `unknown browser-agent action "${action}" — use /api/browser-agent/extract or /api/browser-agent/act` },
    { status: 404 },
  )
}
