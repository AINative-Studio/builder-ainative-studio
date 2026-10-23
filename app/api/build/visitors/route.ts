/**
 * GET /api/build/visitors?slug=X (#483/#563) — the real count behind the Live
 * dashboard's "visitors" hero metric, and the entries behind VisitorsPanel.
 * Read-only.
 *
 * Real gap fix: this metric was a permanent, hardcoded 0 with the copy "Live
 * from day one — Cody grows these nightly," but nothing anywhere ever grew
 * it — see lib/build/visitor-metrics.ts's module doc for the write side
 * (the mandated /api/db/visitors beacon every generated landing page fires
 * on mount) and obedience-gate.ts's `hasVisitorTrackingGap` for enforcement.
 */

import { NextRequest } from 'next/server'
import { resolveAppVerified } from '@/lib/build/app-registry'
import { listVisitors } from '@/lib/build/visitor-metrics'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  // #1316-class fix: see app/api/build/waitlist/route.ts's matching comment —
  // same anti-pattern, same fix. The plain `resolveApp()` this used to call
  // can't tell a confirmed-absent company apart from a registry read that
  // merely failed, and this route turned both into a confident
  // `visitors: 0` — fabricating "no visits yet" for the Live dashboard's
  // hero metric + VisitorsPanel during a transient hiccup. Fails closed
  // (503) only on a genuinely unverified lookup; a confirmed-absent company
  // still honestly reads visitors:0/entries:[] below.
  const { entry: app, verified } = await resolveAppVerified(slug)
  if (!verified) {
    return Response.json({ ok: false, reason: 'lookup_failed' }, { status: 503 })
  }
  if (!app) return Response.json({ visitors: 0, entries: [] })

  const entries = await listVisitors(app.zerodbProjectId, app.chatId)
  return Response.json({ visitors: entries.length, entries })
}
