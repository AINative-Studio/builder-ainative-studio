/**
 * /api/build/claim-subdomain (#78) — claim a company's {slug}.ainative.studio host.
 *
 * Product rule (Toby): the subdomain must NOT resolve until the company is on a PAID
 * plan AND has explicitly CLAIMED it. Until then the shareable preview is the PATH
 * form /build/{slug}. This route is the explicit claim action, gated behind a paid
 * plan exactly like the custom-domain / BYO-domain flows (#53/#240).
 *
 *   POST { slug } → claim the subdomain. Requires a signed-in founder and a paid plan
 *     (re-read server-side from the registry; never trusted from the client). Sets
 *     subdomainClaimed=true so the edge middleware begins serving {slug}.ainative.studio.
 *   GET  ?slug=   → report whether the subdomain is currently claimed (for the UI).
 *     Reads through resolveAppVerified() so a failed registry read returns a
 *     distinct 503 { unverified: true } instead of a confident `claimed: false`
 *     (#1454 — see the GET handler's comment).
 *
 * Idempotent: claiming an already-claimed subdomain is a no-op success.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { claimSubdomain, resolveAppVerified } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim().slice(0, 40)
  if (!slug) return Response.json({ ok: false, error: 'slug required' }, { status: 400 })

  // Claiming a subdomain is an account-scoped action on a real, owned company.
  const session = await auth()
  if (!session?.user) {
    return Response.json({ ok: false, reason: 'signin', error: 'Sign in to claim your subdomain.' }, { status: 401 })
  }

  const res = await claimSubdomain(slug)
  if (!res.ok) {
    // not_paid → 402 (payment required) so the UI can route the founder to upgrade.
    // lookup_failed → 503 (#1454): claimSubdomain() now distinguishes "the
    // registry read failed" from "this company isn't registered," so a transient
    // ZeroDB hiccup is a retryable 503 rather than a 404 that tells a paying
    // founder their own company doesn't exist.
    const status =
      res.reason === 'not_paid' ? 402
      : res.reason === 'lookup_failed' ? 503
      : res.reason === 'not_registered' ? 404
      : 400
    return Response.json(
      { ok: false, reason: res.reason, ...(res.reason === 'lookup_failed' ? { unverified: true } : {}) },
      { status },
    )
  }
  return Response.json({ ok: true, claimed: res.claimed })
}

export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug') || ''

  // #832-class bug (#1454): resolveApp()'s plain `null` return collapsed "no such
  // company" with "the registry read itself failed," and this route then collapsed
  // BOTH onto a confident `{ claimed: false }`. A transient ZeroDB timeout/rate-limit
  // therefore told a founder who had already claimed {slug}.ainative.studio that it
  // was unclaimed, prompting them to claim it again — with no way for the UI to tell
  // "not claimed" from "couldn't check." resolveAppVerified() separates the two, and
  // an unverified read is an honest, retryable 503 (same shape as connect-domain).
  const { entry, verified } = await resolveAppVerified(slug).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) {
    return Response.json(
      { ok: false, unverified: true, reason: 'lookup_failed' },
      { status: 503 },
    )
  }
  return Response.json({ ok: true, claimed: entry?.subdomainClaimed === true })
}
