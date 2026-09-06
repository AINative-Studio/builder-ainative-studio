/**
 * GET /api/build/visitors?slug=X (#483/#563) — the real count behind the Live
 * dashboard's "visitors" hero metric. Read-only.
 *
 * Real gap fix: this metric was a permanent, hardcoded 0 with the copy "Live
 * from day one — Cody grows these nightly," but nothing anywhere ever grew
 * it — see lib/build/visitor-metrics.ts's module doc for the write side
 * (the mandated /api/db/visitors beacon every generated landing page fires
 * on mount) and obedience-gate.ts's `hasVisitorTrackingGap` for enforcement.
 */

import { NextRequest } from 'next/server'
import { resolveApp } from '@/lib/build/app-registry'
import { countVisitors } from '@/lib/build/visitor-metrics'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ visitors: 0 })

  const visitors = await countVisitors(app.zerodbProjectId)
  return Response.json({ visitors })
}
