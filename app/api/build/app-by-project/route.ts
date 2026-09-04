/**
 * GET /api/build/app-by-project (#2134 ainative-website / #330 this repo) —
 * internal service-to-service lookup: given a ZeroDB project id, return the
 * Builder app (if any) whose builder_app_registry entry was provisioned
 * against it.
 *
 * Why this exists: the AINative dashboard (website repo) shows a user's
 * ZeroDB project but has no way to know a Builder app exists for it — Greg
 * Rose saw his ZeroDB project but not the "Social Media Multi-Poster" app
 * Cody was building for him, with no link back. builder_app_registry (this
 * repo's ZeroDB table, see lib/build/app-registry.ts) already stores
 * zerodbProjectId alongside slug at provision time (#243) — the join key
 * was never actually missing, just not queryable from the website side.
 * This endpoint closes that gap so the dashboard project page can render a
 * real "Open in Builder" link.
 *
 * Auth: HMAC-SHA256 signed `token` query param, same BUILDER_CALLBACK_SECRET
 * scheme as POST /api/webhooks/ad-budget-confirmed — but signs the query
 * params (project_id + ts) rather than a request body, since GET has none.
 * Internal service call, not user-session-gated (the website's backend
 * already knows which zerodbProjectId belongs to which of ITS logged-in
 * users; this endpoint only needs to trust the CALLER, not re-authenticate
 * the end user).
 *
 * Query: ?project_id=<zerodbProjectId>&token=<payloadB64>.<sig>
 * Returns: { app: { slug, name, deployUrl, liveUrl } | null } | { error }
 */

import { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { listAllApps } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

const SECRET = process.env.BUILDER_CALLBACK_SECRET || ''
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
// Matches the ad-budget-confirmed webhook's replay window — a signed lookup
// from more than 15 minutes ago has no legitimate reason to arrive now.
const MAX_AGE_SECONDS = 15 * 60

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', SECRET).update(payloadB64).digest())
}

interface LookupPayload {
  project_id: string
  ts: number
}

/** Verify the token against the project_id actually being queried — a
 *  structurally valid signature for a DIFFERENT project_id must not be
 *  accepted for this one (tamper/reuse check). */
function verifyToken(queryProjectId: string, token: string | null): LookupPayload | null {
  if (!SECRET || !token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload: LookupPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return null
  }
  if (!payload?.project_id || payload.project_id !== queryProjectId) return null
  if (!Number.isFinite(payload?.ts) || Math.abs(Date.now() / 1000 - payload.ts) > MAX_AGE_SECONDS) return null
  return payload
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('project_id') || ''
  const token = request.nextUrl.searchParams.get('token')
  const payload = verifyToken(projectId, token)
  if (!payload) {
    return Response.json({ ok: false, reason: 'invalid_signature' }, { status: 401 })
  }

  const apps = await listAllApps().catch(() => [])
  const match = apps.find((e) => e.zerodbProjectId === projectId)
  if (!match) {
    return Response.json({ app: null })
  }

  return Response.json({
    app: {
      slug: match.slug,
      name: match.name || match.slug,
      deployUrl: `${APP}/build/${match.slug}`,
      liveUrl: `${APP}/build?screen=live&company=${encodeURIComponent(match.slug)}`,
    },
  })
}
