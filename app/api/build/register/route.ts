/**
 * POST /api/build/register (#207, #74) — real signup for the /build flow that
 * carries ad attribution. Registers the founder against CORE (where users.gclid
 * + the Stripe payment webhook live) and passes the gclid captured on ad
 * landing, so when they pay, core's Stripe webhook finds users.gclid and uploads
 * the conversion to Google Ads. This closes the ad-click → paid-subscription loop.
 *
 * #74 — Email-verification honesty. Core's /register returns
 * `email_verification_required` and `user.email_verified`. For
 * signup_source='builder' core currently auto-verifies (email_verified:true),
 * BUT core's /login can still 403 with AUTH_EMAIL_NOT_VERIFIED — so the client
 * MUST know the verification state instead of assuming it can log in. We surface
 * `verificationRequired` on the register response and expose a `resend` action
 * (core POST /api/v1/auth/resend-verification) so the UI can offer "check your
 * email / resend" rather than silently dead-ending the founder at login.
 *
 * Body (register):     { email, password }   (gclid + utm come from the cookies)
 * Body (resend):       { action:'resend', email }
 * Body (login-check):  { action:'login-check', email, password }
 * Returns (register):    { ok, email, verificationRequired, gclidAttached } | { ok:false, error }
 * Returns (resend):      { ok } | { ok:false, error }
 * Returns (login-check): { ok } | { ok:false, errorCode?, error }
 *
 * `login-check` exists ONLY so the client can precisely classify a failed login
 * (next-auth's signIn collapses every provider error into one generic string, so
 * the UI otherwise can't tell AUTH_EMAIL_NOT_VERIFIED apart from a bad password).
 * The client calls it only AFTER a generic signIn failure — one extra core call
 * on the failure path, never on the happy path.
 */

import { NextRequest } from 'next/server'
import { gclidFromRequest } from '@/lib/build/conversions'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function utmFromRequest(request: Request): Record<string, string> {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|; )ax_utm=([^;]*)/)
  if (!m) return {}
  try { return JSON.parse(decodeURIComponent(m[1])) } catch { return {} }
}

/**
 * Resend the email-verification link for an unverified account (#74). Core
 * returns 200 with a neutral message whether or not an unverified account
 * exists (it does not leak account existence), so we mirror that: we report
 * success on any 2xx and never echo the email back in an error.
 */
async function handleResend(email: string) {
  if (!EMAIL_RE.test(email)) return Response.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  try {
    const res = await fetch(`${CORE}/api/v1/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) {
      return Response.json({ ok: false, error: 'Could not resend the verification email.' }, { status: 502 })
    }
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}

/**
 * Classify a login failure (#74). Calls core /login and reports whether the
 * failure is the email-not-verified gate (so the UI can offer resend) or a
 * genuine credential error. Never returns tokens — establishing the session
 * remains next-auth's job. NEVER logs the password.
 */
async function handleLoginCheck(email: string, password: string) {
  if (!EMAIL_RE.test(email) || !password) {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }
  try {
    const res = await fetch(`${CORE}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
      signal: AbortSignal.timeout(25000),
    })
    if (res.ok) return Response.json({ ok: true })
    const data = await res.json().catch(() => null)
    const errorCode = typeof data?.error_code === 'string' ? data.error_code : undefined
    return Response.json(
      { ok: false, errorCode, error: 'login_failed' },
      { status: res.status === 403 ? 200 : res.status },
    )
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const email = String(b?.email || '').trim().toLowerCase()

  // #74 — resend-verification action, kept in the register route so the client
  // has one builder-side endpoint for the whole signup/verification surface.
  if (b?.action === 'resend') return handleResend(email)
  if (b?.action === 'login-check') return handleLoginCheck(email, String(b?.password || ''))

  const password = String(b?.password || '')
  if (!EMAIL_RE.test(email)) return Response.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  if (password.length < 8) return Response.json({ ok: false, error: 'weak_password', detail: 'Password must be at least 8 characters.' }, { status: 400 })

  const gclid = gclidFromRequest(request)
  const utm = utmFromRequest(request)

  try {
    const res = await fetch(`${CORE}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        // Card-free at signup by design — the Builder captures the card LATER, on
        // the Live page's Upgrade / custom-domain step (after Cody builds), never
        // here. signup_source='builder' is the keyless bypass core honors for this.
        signup_source: 'builder',
        // Ad attribution goes in `ext` (core's UserCreate contract, Refs #4712) —
        // promoted to users.gclid/utm_* on registration so the Stripe webhook can
        // attribute the eventual paid conversion back to the Google Ads click AND
        // to the campaign. Core reads gclid flat off ext, but utm from a NESTED
        // ext.utm dict (auth.py: _ext.get("utm")) — so nest the utm keys or the
        // campaign is silently dropped.
        ext: {
          gclid: gclid || undefined,
          utm: {
            utm_source: utm.utm_source || (gclid ? 'google' : undefined),
            utm_medium: utm.utm_medium || (gclid ? 'cpc' : undefined),
            utm_campaign: utm.utm_campaign || undefined,
          },
        },
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      // Surface a clean message (e.g. email already registered → tell them to log in).
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.detail?.message || 'registration failed')
      return Response.json({ ok: false, error: detail, gclidAttached: Boolean(gclid) }, { status: res.status })
    }
    // #74 — tell the client whether email verification is still pending. Core
    // signals this via `email_verification_required` (preferred) and
    // `user.email_verified`. For signup_source='builder' core auto-verifies
    // today (verificationRequired:false), but we forward the truth rather than
    // assume, so the UI stays correct if core's exemption policy changes.
    const verificationRequired =
      data?.email_verification_required === true ||
      (data?.user && data.user.email_verified === false)
    return Response.json({
      ok: true,
      email,
      verificationRequired: Boolean(verificationRequired),
      gclidAttached: Boolean(gclid),
    })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
