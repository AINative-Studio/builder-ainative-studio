/**
 * Per-app PRIMITIVE PROXY token (#443) — the preview-iframe equivalent of
 * app-data-token.ts, scoped to binding {slug, primitive} rather than
 * {slug, projectId}. A DEPLOYED company app never needs this: its own
 * Railway service reads COMPANY_SLUG directly from process.env (Railway-
 * injected, not client-forgeable — the same trust boundary /api/db already
 * relies on for a deployed service). This token only exists to give the
 * SAME shared-process PREVIEW IFRAME (multiple companies' code, one Next.js
 * process) an unforgeable way to say "I am company X" without a session.
 *
 * Signed with AUTH_SECRET (HMAC-SHA256), same algorithm as app-data-token.ts.
 * A distinct `purpose` tag in the signed payload stops a /api/db token from
 * being replayed here (or vice versa) even though both use AUTH_SECRET.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { FounderScopedPrimitive } from './primitive-credentials'

const SECRET = process.env.AUTH_SECRET || 'fallback-secret-for-development'
const PURPOSE = 'primitive-proxy-v1'

export interface PrimitiveProxyTokenPayload {
  purpose: typeof PURPOSE
  slug: string
  primitive: FounderScopedPrimitive
  iat: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', SECRET).update(payloadB64).digest())
}

/** Mint a signed proxy token binding {slug, primitive}. Called SERVER-SIDE at
 *  preview-render time (mirrors mintPreviewDbToken in app/api/preview/[id]/route.ts). */
export function mintPrimitiveProxyToken(
  slug: string,
  primitive: FounderScopedPrimitive,
  iatSeconds: number,
): string {
  if (!slug) throw new Error('mintPrimitiveProxyToken: slug required')
  const payload: PrimitiveProxyTokenPayload = { purpose: PURPOSE, slug, primitive, iat: iatSeconds }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  return `${payloadB64}.${sign(payloadB64)}`
}

/** Verify a primitive-proxy token; null if missing/malformed/forged/wrong-purpose.
 *  FAIL CLOSED: callers must treat null as "no access" (401). */
export function verifyPrimitiveProxyToken(token: string | null | undefined): PrimitiveProxyTokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
    if (!payload || payload.purpose !== PURPOSE || typeof payload.slug !== 'string' || !payload.slug) return null
    return payload as PrimitiveProxyTokenPayload
  } catch {
    return null
  }
}
