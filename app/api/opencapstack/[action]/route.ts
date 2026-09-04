import { NextRequest, NextResponse } from 'next/server'
import { verifyAppDataToken } from '@/lib/build/app-data-token'
import { resolveApp } from '@/lib/build/app-registry'
import { loginServiceAccount } from '@/lib/build/opencapstack'

/**
 * OpenCapStack proxy (#503) — the runtime-callable path for a generated app
 * to read its own company's cap-table record.
 *
 * WHY THIS EXISTS: primitive-catalog.ts's OpenCapStack entry has REAL
 * checkout-time provisioning (lib/build/opencapstack.ts's provisionCapTable,
 * called from app/api/build/provision/route.ts) — a real cap-table company
 * record gets created for every company at checkout. But there was ZERO
 * runtime call path for a generated app to actually read it back — confirmed
 * via grep, `opencapstack` never appeared in the founder-scoped proxy
 * allowlist. Same "provisioned but cosmetic" gap class #443/#496/#500 fixed
 * for other primitives.
 *
 * A SECOND real gap closed alongside this one: provisionCapTable's real
 * companyId was computed at checkout and returned ONCE in the provision
 * response, then silently dropped — app-registry.ts's setAppProvisioned
 * accepted a `capstackCompanyId` field but had no matching AppEntry key to
 * land it on. Fixed in lib/build/app-registry.ts (AppEntry.opencapstackCompanyId
 * + setAppProvisioned's persistence) alongside this route — without that fix
 * this proxy would have nothing to look up.
 *
 * AUTH — DIFFERENT SHAPE FROM ZEROMEMORY/AGENT402/BROWSER-AGENT: OpenCapStack
 * has no AINative-federated auth. lib/build/opencapstack.ts's
 * loginServiceAccount() (exported for this reuse) logs in fresh per call with
 * a dedicated builder service account (OPENCAPSTACK_SERVICE_EMAIL/
 * OPENCAPSTACK_SERVICE_PASSWORD) — no cached/stored bearer token, matching
 * the exact "short-lived, not cached across requests" contract
 * provisionCapTable already uses in production. This route does the SAME
 * login-then-call, not a new auth implementation.
 *
 * VERIFICATION — BE HONEST ABOUT WHAT IS AND ISN'T PROVEN: the login step
 * and the POST /companies write are real, live-proven — every real company
 * that provisions successfully in production exercises them today. The GET
 * /companies/{id} read this route makes was NOT independently curl-verified
 * against the live API before shipping — this environment has no local
 * access to OPENCAPSTACK_SERVICE_EMAIL/PASSWORD (only set as Railway
 * production vars, not in this dev shell), so there was no way to test it
 * directly. The path is the standard REST convention for "read the resource
 * POST /companies just created" and OpenCapStack's own real Company
 * controller (controllers/Company.js, referenced in opencapstack.ts's own
 * comment) is a conventional REST resource, but this is an INFERRED shape,
 * not a proven one. If it 404s in practice, the honest error response below
 * surfaces that rather than masking it — this needs a real live check by
 * whoever has access to the production credentials before being treated as
 * fully verified, the same bar every other primitive fixed tonight met.
 *
 * SCOPE: read-only. No write/create exposed here — provisioning already owns
 * company creation; a generated app has no business creating a SECOND
 * OpenCapStack company for itself.
 *
 * GET /api/opencapstack/company
 */

export const runtime = 'nodejs'

const OCS_BASE = process.env.OPENCAPSTACK_API_URL || 'https://api.opencapstack.com/api/v1'

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'invalid or missing app data token' }, { status: 401 })

/** Resolve the calling company's slug from the same signed per-app data
 *  token /api/db, /api/memory, and /api/agent402 already verify — no
 *  separate token scheme. The token binds {projectId, slug}; slug is what
 *  this route needs to look up the company's stored opencapstackCompanyId. */
function resolveSlug(request: NextRequest): string | null {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const token =
    bearer ||
    request.headers.get('x-ainative-db-token') ||
    request.nextUrl.searchParams.get('t') ||
    ''
  if (!token) return null
  const payload = verifyAppDataToken(token)
  return payload?.slug || null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const slug = resolveSlug(request)
  if (!slug) return UNAUTHORIZED()

  const { action } = await params
  if (action !== 'company') {
    return NextResponse.json(
      { error: `unknown opencapstack action "${action}" — use /api/opencapstack/company` },
      { status: 404 },
    )
  }

  const entry = await resolveApp(slug).catch(() => null)
  const companyId = entry?.opencapstackCompanyId
  if (!companyId) {
    return NextResponse.json(
      { error: 'no OpenCapStack company provisioned for this app yet' },
      { status: 404 },
    )
  }

  const login = await loginServiceAccount()
  if (!login.ok || !login.token) {
    return NextResponse.json(
      { error: 'OpenCapStack service account login failed', detail: login.reason },
      { status: login.status || 502 },
    )
  }

  const res = await fetch(`${OCS_BASE}/companies/${encodeURIComponent(companyId)}`, {
    headers: { Authorization: `Bearer ${login.token}` },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: `OpenCapStack error: ${res.status}`, detail: data }, { status: res.status })
  }
  return NextResponse.json(data)
}
