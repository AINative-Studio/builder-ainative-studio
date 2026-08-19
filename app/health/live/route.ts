import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Liveness probe for the Railway healthcheck (configured path: /health/live).
 *
 * This MUST be dependency-free and always 200 while the process is up — a
 * liveness probe answers "is the server running?", not "are dependencies
 * healthy?". Previously no route existed at /health/live, so the healthcheck
 * fell through to auth middleware and 307-redirected to /login, which Railway
 * treats as unhealthy — new deploys never passed the probe and never swapped in
 * (they sat in "Initializing" until timeout, then stopped). Readiness (DB, etc.)
 * lives at /api/health?ready=1.
 */
export function GET() {
  return NextResponse.json(
    { status: 'ok', probe: 'live', timestamp: new Date().toISOString() },
    { status: 200 },
  )
}
