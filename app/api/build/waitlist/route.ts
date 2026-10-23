/**
 * GET /api/build/waitlist?slug=X (#844) — the real signups behind the Live
 * dashboard's "waitlist" hero metric and a founder-facing waitlist list.
 * Read-only.
 *
 * Real gap fix: the hero-metrics "waitlist" tile was a permanent, hardcoded 0
 * even though the generated landing page's hero form already correctly
 * persists every signup via POST /api/db/waitlist — nothing ever read it
 * back, and there was no founder-facing way to ever see, export, or act on a
 * single real lead.
 */

import { NextRequest } from 'next/server'
import { resolveAppVerified } from '@/lib/build/app-registry'
import { listWaitlist } from '@/lib/build/waitlist-metrics'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  // #1316-class fix: the plain `resolveApp()` this used to call collapses
  // "no such company" and "the registry read itself failed" (a transient
  // ZeroDB hiccup) into the same `null` — which this route then turned into
  // a confident `entries: []`. The founder's Live dashboard (hero metric +
  // WaitlistPanel) read that as "no signups yet" for a company that may have
  // real leads sitting behind a registry read that just failed once. Fails
  // closed (503) only when the lookup genuinely could not be verified, same
  // as #1302/#1303/#1317 already do for the public render page and preview
  // token minting — never for a confirmed-absent company, which still
  // honestly reads entries:[] below.
  const { entry: app, verified } = await resolveAppVerified(slug)
  if (!verified) {
    return Response.json({ ok: false, reason: 'lookup_failed' }, { status: 503 })
  }
  if (!app) return Response.json({ entries: [] })

  const entries = await listWaitlist(app.zerodbProjectId)
  return Response.json({ entries })
}
