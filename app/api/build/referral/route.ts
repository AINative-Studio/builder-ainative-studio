/**
 * /api/build/referral (#59) — the Refer & Earn surface.
 *
 * GET  → the SERVER-verified user's own referral { code, link, stats } for the
 *        Refer & Earn view. The identity is ALWAYS taken from the session (never
 *        the query), so a user only ever sees their own code + stats. Guests get
 *        an empty code (no shareable identity until they have a real account #49).
 *
 * POST { code } → attribute the now-authenticated user's SIGNUP to a referral
 *        code they landed with (captured client-side in the `ax_ref` cookie,
 *        exactly like `ax_gclid`). The referred identity is the SERVER session's
 *        durable owner key — never trusted from the body — so one user can't
 *        attribute a signup on behalf of another. Self-referral is rejected.
 *        This creates a PENDING referral; the reward is credited later, on the
 *        referred user's subscription-verify (subscription/verify/route.ts).
 *
 * AX (our moat): this endpoint is the machine surface too — a user's own agent
 * can read their referral link + stats the same way the UI does.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import {
  getReferralSummary,
  attributeSignup,
  refCodeFromRequest,
  normalizeCode,
  isValidCode,
} from '@/lib/build/referral'

export const runtime = 'nodejs'

/** Best origin for building the shareable link (proxy-aware, env-overridable). */
function resolveOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.BUILDER_ORIGIN
  if (env) return env.replace(/\/+$/, '')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (host) return `${proto}://${host}`
  return request.nextUrl.origin
}

/**
 * GET — the authed user's own referral code, shareable link, and live stats
 * (friends referred / credits earned / credits pending). Never 500s: on any
 * failure it yields an empty code so the view still renders.
 */
export async function GET(request: NextRequest) {
  const session = await auth().catch(() => null)
  const origin = resolveOrigin(request)
  const summary = await getReferralSummary(session as any, origin).catch(() => ({
    code: '',
    link: '',
    stats: { friendsReferred: 0, creditsEarned: 0, creditsPending: 0 },
  }))
  return Response.json(summary)
}

/**
 * POST — attribute the authenticated user's signup to a referral code. The code
 * comes from the body OR the `ax_ref` cookie (body wins). The referred identity
 * is the server session. Guests can't be attributed (no durable account yet).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const code = normalizeCode(body?.code) || refCodeFromRequest(request)
  if (!isValidCode(code)) return Response.json({ ok: false, error: 'invalid_code' }, { status: 400 })

  const session = await auth().catch(() => null)
  const type = (session as any)?.user?.type as string | undefined
  const referredKey = deriveOwnerKey(session as any)
  // Must be a REAL account — a guest has no durable identity to attribute.
  if (!referredKey || referredKey.startsWith('guest:') || type === 'guest') {
    return Response.json({ ok: false, error: 'not_signed_in' }, { status: 401 })
  }

  const record = await attributeSignup(code, referredKey).catch(() => null)
  if (!record) {
    // Either a self-referral, a bad code, or a store failure — never leak which.
    return Response.json({ ok: false, error: 'not_attributed' }, { status: 200 })
  }
  return Response.json({ ok: true, status: record.status })
}
