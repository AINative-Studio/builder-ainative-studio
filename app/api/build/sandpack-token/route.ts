/**
 * GET /api/build/sandpack-token?slug=X&chatId=Y (#1574) — mints the same
 * per-company data + primitive-proxy tokens app/build/[slug]/page.tsx mints
 * server-side for the standalone share-page Sandpack preview
 * (lib/build/preview-tokens.ts), for the ONE caller that has no server
 * boundary to mint from directly: components/build/artifacts/Preview.tsx —
 * the client component rendering a Sandpack multi-file preview inside the
 * founder's own, in-session Live dashboard.
 *
 * ROOT CAUSE this closes (#1561's own documented follow-up, confirmed live
 * on a real company, `groundwork`): without a token, the generated app's
 * `/api/db/*` calls fall through to app/api/db/[table]/route.ts's
 * documented legacy/unprovisioned fallback (shared project) — the write
 * still 200s, so the UI shows a clean success, but it lands in the WRONG
 * ZeroDB project, invisible to the founder's own dashboard reading from
 * their company's real scoped project. Exactly the "founder can't see their
 * own real signups" class of bug #844 was written to close, reopened here
 * for the Sandpack path specifically.
 *
 * SECURITY: no new trust boundary. Mirrors the EXACT binding check
 * app/api/preview/[id]/route.ts's own token minting already uses and that
 * route is already public/unauthenticated by design — a token is minted
 * only when the given `slug`'s OWN registered chatId matches the given
 * `chatId`. Knowing a company's slug alone (public, it's the company's own
 * `/build/{slug}` URL) is not enough; the caller must ALSO know that
 * company's real, opaque chatId (never exposed to a different company's
 * session) for the binding to succeed. No session/auth check is added on
 * top of this because none exists on the sibling preview route either —
 * this is the same security model, just reachable from a second caller.
 */
import { NextRequest } from 'next/server'
import { mintPreviewDbToken, mintPreviewPrimitiveTokens } from '@/lib/build/preview-tokens'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim() || null
  const chatId = request.nextUrl.searchParams.get('chatId')?.trim() || ''
  if (!slug || !chatId) {
    return Response.json({ dbToken: '', primitiveTokens: {} }, { status: 400 })
  }

  const [dbToken, primitiveTokens] = await Promise.all([
    mintPreviewDbToken(slug, chatId),
    mintPreviewPrimitiveTokens(slug, chatId),
  ])

  return Response.json({ dbToken, primitiveTokens })
}
