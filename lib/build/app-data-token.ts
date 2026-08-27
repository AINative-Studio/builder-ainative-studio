/**
 * Per-app DATA TOKEN (#331) — the secure mechanism that scopes + authorizes a
 * generated app's /api/db calls to ITS OWN ZeroDB project, without a session.
 *
 * The problem: generated apps run in sandboxed iframes with no auth token, and the
 * old proxy used a single shared PROJECT_ID for every app (cross-tenant data bleed) —
 * or, worse, trusted a client-supplied slug (a trivial IDOR: name a victim's public
 * slug → read their data). Both are unacceptable.
 *
 * The fix: at provision time, the SERVER mints an unguessable token = payload + HMAC
 * signature, binding the app's {slug, projectId}. The token is embedded in the
 * generated app; /api/db VERIFIES the signature server-side and resolves the project
 * from the VERIFIED payload — never from a client-controlled slug. Forged/absent
 * tokens fail CLOSED (401). A malicious app only ever holds its OWN token, so it
 * cannot target another company's project.
 *
 * Signed with AUTH_SECRET (HMAC-SHA256). Pure + deterministic; no external calls.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const SECRET = process.env.AUTH_SECRET || 'fallback-secret-for-development'

export interface AppDataTokenPayload {
  /** ZeroDB project the app's data is scoped to. */
  projectId: string
  /** The app's brand slug (audit/debug; NOT used for resolution — projectId is). */
  slug: string
  /** Issued-at (epoch seconds). */
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

/**
 * Mint a signed per-app data token binding {projectId, slug}. Called SERVER-SIDE at
 * provision time. The result is safe to embed in the generated app's HTML — it grants
 * access ONLY to the bound project, and can't be forged without AUTH_SECRET.
 */
export function mintAppDataToken(projectId: string, slug: string, iatSeconds: number): string {
  if (!projectId) throw new Error('mintAppDataToken: projectId required')
  const payload: AppDataTokenPayload = { projectId, slug: slug || '', iat: iatSeconds }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  return `${payloadB64}.${sign(payloadB64)}`
}

/**
 * Verify a per-app data token and return its payload, or null if missing/malformed/
 * forged. Uses a timing-safe signature compare. FAIL CLOSED: callers must treat null
 * as "no access" (401) — never fall back to a shared project.
 */
export function verifyAppDataToken(token: string | null | undefined): AppDataTokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payloadB64)
  // constant-time compare to avoid signature-timing leaks
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
    if (!payload || typeof payload.projectId !== 'string' || !payload.projectId) return null
    return payload as AppDataTokenPayload
  } catch {
    return null
  }
}
