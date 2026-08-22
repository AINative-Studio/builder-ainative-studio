/**
 * POST /api/build/lead (#207) — early EMAIL capture for the /build flow.
 *
 * A visitor can describe an idea and watch Cody build their whole company
 * ANONYMOUSLY, then leave without ever hitting the signup/paywall — so we never
 * had a way to reach the highest-intent non-converters. This captures an email
 * (offered as "save/share your company") EARLY, before the upgrade wall, so that
 * cohort becomes a reachable nurture list.
 *
 * Persists to the ZeroDB `builder_leads` table (server-key), best-effort. Also
 * attaches the email to the company's learning row (#270) so the recursive loop
 * can tie idea → build → lead → conversion. No password, no account required.
 *
 * Body: { email, slug?, idea?, brand?, track? }
 * Returns: { ok } | { ok:false, reason }
 */

import { NextRequest } from 'next/server'
import { reportConversion, gclidFromRequest } from '@/lib/build/conversions'

export const runtime = 'nodejs'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_leads'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const email = String(b?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, reason: 'invalid_email' }, { status: 400 })
  }
  if (!API_KEY || !PROJECT_ID) {
    // Degrade gracefully — don't error the UX if the store isn't configured.
    return Response.json({ ok: true, stored: false })
  }

  const row = {
    email,
    slug: String(b?.slug || '').slice(0, 60) || null,
    idea: String(b?.idea || '').slice(0, 500) || null,
    brand: String(b?.brand || '').slice(0, 120) || null,
    track: String(b?.track || '').slice(0, 20) || null,
    source: 'build_flow',
    createdAt: new Date().toISOString(),
  }

  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ row_data: row }),
        signal: AbortSignal.timeout(15000),
      },
    )
    // Best-effort: attach the email to the company's #270 learning row too, so the
    // non-converter cohort is reachable from the recursive-loop rollup.
    if (row.slug) {
      import('@/lib/build/learning')
        .then(({ logBuildOutcome }) => logBuildOutcome({ slug: row.slug!, email, converted: false }))
        .catch(() => {})
    }
    // #207: report the LEAD conversion to Google Ads (via core) keyed by gclid, so a
    // lead from an ad click is attributed. Best-effort; no-op for organic (no gclid).
    reportConversion({
      eventType: 'lead_captured', eventName: 'Builder — Lead Captured (email)',
      sessionId: `builder-${row.slug || 'anon'}`,
      gclid: gclidFromRequest(request),
      value: 5, currency: 'USD', slug: row.slug || undefined, email,
    }).catch(() => {})
    return Response.json({ ok: res.ok, stored: res.ok })
  } catch (e: any) {
    return Response.json({ ok: false, reason: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
