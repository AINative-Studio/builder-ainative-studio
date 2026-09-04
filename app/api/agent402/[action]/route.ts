import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'

/**
 * Agent402 proxy (#500) — the runtime-callable path for a generated app to
 * read Agent402's account-level info (capabilities, projects), using
 * BUILDER'S OWN shared service key — the exact same shape ZeroMemory's proxy
 * (#496) uses, confirmed by direct testing, not assumption.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's Agent402 entry (x402/Hedera
 * payments + agent finance) had zero builder-side wiring — Cody could
 * reference it in codegen with no real runtime path, the same class of bug
 * #443 fixed for the founder-scoped 5.
 *
 * AUTH RESOLVED (this was a real open question, not skipped): Agent402's own
 * /v1/public/provision documents a wallet-signature (EIP-191) flow to obtain
 * a dedicated key — that looked like a hard blocker requiring a real
 * product/security decision. Directly tested instead: builder's EXISTING
 * shared ZERODB_API_KEY/AINATIVE_API_KEY already authenticates against
 * Agent402 with no wallet involved —
 *   curl .../v1/public/projects -H "X-API-Key: <builder's real key>" → 200
 *   curl .../v1/public/keys     -H "X-API-Key: <builder's real key>" → 405 (wrong verb, NOT 401/403 — auth succeeded)
 * "Usage billed via AINative Studio credits" (from /v1/public/capabilities)
 * confirms this is intentional — Agent402 is billed through the same
 * AINative account builder's shared key already belongs to.
 *
 * SCOPE — deliberately narrow, real evidence for each cut:
 *  - GET /api/agent402/capabilities → real 200, safe, no project scope needed.
 *  - GET /api/agent402/projects     → real 200, safe, read-only, no project scope needed.
 *  - Agent memory (remember/list) was tested and is NOT wired here: Agent402's
 *    own backend fails with a genuine external 502/401 on BOTH the write
 *    (POST .../agent-memory) and read (GET .../agent-memory) paths — its
 *    `project_id` path param is silently ignored in favor of a hardcoded
 *    internal project id that its own service key can't authenticate against.
 *    This is a real bug in Agent402 itself, not a builder-side gap — filed
 *    separately rather than building against a broken upstream.
 *  - Payments/on-chain/Hedera/x402-signing/billing operations are
 *    deliberately NOT wired — real-money and on-chain-transaction risk,
 *    out of scope for a first pass; a generated app has no business
 *    initiating payments through a shared platform key.
 *
 * Reuses the SAME signed per-app data token /api/db and /api/memory verify
 * (lib/build/app-data-token.ts) purely as an authenticated-generated-app
 * gate — Agent402's own responses here aren't company-scoped (capabilities/
 * projects are account-level, not per-company), so the token isn't used to
 * inject a namespace, only to confirm the caller is a real generated app.
 *
 * GET /api/agent402/capabilities
 * GET /api/agent402/projects
 */

export const runtime = 'nodejs'

const AGENT402_API = process.env.AGENT402_API_URL || 'https://agent-402-production.up.railway.app'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Confirms the caller is a real generated app via the same signed per-app
 *  data token /api/db and /api/memory verify. No project scoping is derived
 *  from it here — Agent402's wired operations are account-level, not
 *  per-company — this is purely an authenticated-caller gate. */
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
  capabilities: '/v1/public/capabilities',
  projects: '/v1/public/projects',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!verifyCaller(request)) return UNAUTHORIZED()

  const { action } = await params
  const upstreamPath = ALLOWED_ACTIONS[action]
  if (!upstreamPath) {
    return NextResponse.json(
      { error: `unknown agent402 action "${action}" — use /api/agent402/capabilities or /api/agent402/projects` },
      { status: 404 },
    )
  }

  const res = await fetch(`${AGENT402_API}${upstreamPath}`, {
    headers: { 'X-API-Key': API_KEY },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `Agent402 error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}
