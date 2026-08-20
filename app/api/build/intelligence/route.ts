/**
 * GET /api/build/intelligence (#207 · CRUSH-2) — same-origin proxy for the real
 * AINative platform-intelligence endpoint.
 *
 * The public endpoint (api.ainative.studio/api/v1/public/platform/intelligence)
 * returns 200 but sends NO CORS headers, so a browser fetch from
 * builder.ainative.studio is blocked — which silently killed every client-side
 * live-proof surface (the ticker, the Fork proof strip, the Live footer). This
 * server-side proxy fetches it from the Builder origin so the browser gets the
 * REAL numbers with no CORS problem. Short cache so the ticker stays live.
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const UPSTREAM =
  (process.env.NEXT_PUBLIC_AINATIVE_API_URL || 'https://api.ainative.studio') +
  '/api/v1/public/platform/intelligence'

export async function GET(_request: NextRequest) {
  try {
    const res = await fetch(UPSTREAM, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return Response.json({ stats: {} }, { status: 200 })
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // brief cache so the strip stays live but we don't hammer upstream
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
      },
    })
  } catch {
    return Response.json({ stats: {} }, { status: 200 })
  }
}
