import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { listRecentRunHealth } from '@/lib/build/loop-enrollment'

export const runtime = 'nodejs'

/**
 * Admin-only read side for nightly-loop's per-shard run health (#1141).
 * #1130/PR #1134 added the write side (recordRunHealth(), called from
 * app/api/build/nightly-loop/route.ts after every shard invocation) but
 * nothing ever read it back — this is cross-company/per-shard operational
 * data, not founder-facing, so it's gated the same way as the other
 * internal-only aggregates (app/api/admin/funnel-summary/route.ts) rather
 * than added to any company's own dashboard.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.ok) return Response.json({ error: admin.message }, { status: admin.status })

  const { searchParams } = request.nextUrl
  const limitParam = parseInt(searchParams.get('limit') || '20', 10)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 20

  const runs = await listRecentRunHealth(limit)
  return Response.json({ runs })
}
