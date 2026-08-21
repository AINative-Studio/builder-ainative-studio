import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Deploy-freshness / version signal (issue #261).
 *
 * Returns the commit SHA the running build was compiled from so a human or
 * monitor can `curl` prod and confirm it serves the EXPECTED commit — catching
 * silent stale/rolled-back deploys that still report SUCCESS (a rolled-back
 * deploy served old code while the deploy showed green; nothing surfaced it).
 *
 * Public, dependency-free, and cheap: no DB, no auth. Must always 200 while the
 * process is up. If no SHA env var is set the SHA is reported as 'unknown'
 * rather than crashing.
 *
 * SHA source order:
 *   1. RAILWAY_GIT_COMMIT_SHA   — injected by Railway at build/deploy
 *   2. VERCEL_GIT_COMMIT_SHA    — injected by Vercel
 *   3. NEXT_PUBLIC_BUILD_SHA    — manual fallback (baked at build time)
 *
 * Assert after deploy:  test "$(curl -s $URL/api/version | jq -r .commit)" = "$EXPECTED_SHA"
 */
export function GET() {
  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    'unknown'

  const builtAt =
    process.env.BUILD_TIME || process.env.NEXT_PUBLIC_BUILD_TIME || null

  return NextResponse.json(
    {
      service: 'builder',
      commit,
      builtAt,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  )
}
