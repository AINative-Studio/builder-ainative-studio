/**
 * POST /api/auth/forgot-password (#7698) — real password reset for Builder.
 *
 * Builder does NOT have its own AINative password store: core owns the users
 * table, the reset token, and the reset email. So unlike `login/route.ts` (which
 * checks Builder's own local DB), this route is a thin PROXY to core, matching
 * the core-proxying pattern already used by `app/api/build/register/route.ts`.
 *
 * The live bug this closes (jeromepalencia@gmail.com, 2026-09-18): Builder's
 * "forgot password" button was a stub that never called anything, and core's
 * /auth/forgot-password had no way to know a request came from Builder — so any
 * reset that did happen produced an AINative-Studio-branded email whose link
 * landed the founder on ainative.studio instead of builder.ainative.studio.
 * We pass `app: 'builder'`, core's new optional field, which selects Builder
 * branding and a builder.ainative.studio reset link.
 *
 * Body (forgot): { email }
 * Body (reset):  { action: 'reset', token, password }
 * Returns:       { ok: true } | { ok: false, error }
 *
 * SECURITY: core deliberately returns the same success message whether or not
 * the account exists (no account enumeration). We mirror that exactly — never
 * surface a "no such user" distinction to the client.
 */

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Identifies Builder to core so the reset email is Builder-branded (#7698). */
const APP_ID = 'builder'

/**
 * Final step: exchange the emailed token + a new password for an updated
 * credential (core POST /api/v1/auth/reset-password, contract {token,
 * new_password}). Core answers 400 with a `detail` for an invalid/expired/
 * already-used token or a password that fails its strength rules — surface
 * that message so the founder knows which of the two actually happened.
 */
async function handleReset(token: string, password: string) {
  if (!token) return Response.json({ ok: false, error: 'Reset link is missing its token.' }, { status: 400 })
  if (password.length < 8) {
    return Response.json({ ok: false, error: 'Password must be at least 8 characters.' }, { status: 400 })
  }
  try {
    const res = await fetch(`${CORE}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: password }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      const detail =
        typeof data?.detail === 'string'
          ? data.detail
          : data?.detail?.message || 'That reset link is invalid or has expired.'
      return Response.json({ ok: false, error: detail }, { status: res.status })
    }
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)

  if (b?.action === 'reset') {
    return handleReset(String(b?.token || ''), String(b?.password || ''))
  }

  const email = String(b?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: 'Enter a valid email.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${CORE}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `app` is core's #7698 optional branding hook. Core falls back to
      // AINative defaults if it doesn't recognize the value, so this is safe
      // even against a core that predates the change.
      body: JSON.stringify({ email, app: APP_ID }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) {
      // Core rate-limits this endpoint (3/hour) to stop reset abuse — say so
      // plainly rather than showing a generic failure the founder will retry.
      if (res.status === 429) {
        return Response.json(
          { ok: false, error: 'Too many reset requests — try again in a little while.' },
          { status: 429 },
        )
      }
      return Response.json({ ok: false, error: 'Could not send the reset email.' }, { status: 502 })
    }
    // Neutral success — never reveals whether the account exists.
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
