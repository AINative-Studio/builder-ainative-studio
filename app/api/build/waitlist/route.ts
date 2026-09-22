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
import { resolveApp } from '@/lib/build/app-registry'
import { listWaitlist } from '@/lib/build/waitlist-metrics'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ entries: [] })

  const entries = await listWaitlist(app.zerodbProjectId)
  return Response.json({ entries })
}
