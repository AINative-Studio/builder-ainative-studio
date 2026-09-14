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
 * Body (register):     { email, password, phone? }   (gclid + utm come from the cookies)
 * Body (resend):       { action:'resend', email }
 * Body (login-check):  { action:'login-check', email, password }
 * Body (send-otp):     { action:'send-otp', phone }
 * Body (verify-otp):   { action:'verify-otp', phone, code }
 * Returns (register):    { ok, email, verificationRequired, gclidAttached } | { ok:false, error }
 * Returns (resend):      { ok } | { ok:false, error }
 * Returns (login-check): { ok } | { ok:false, errorCode?, error }
 * Returns (send-otp):    { ok:true, expiresAt } | { ok:false, reason }
 * Returns (verify-otp):  { ok:true } | { ok:false, reason }
 *
 * `login-check` exists ONLY so the client can precisely classify a failed login
 * (next-auth's signIn collapses every provider error into one generic string, so
 * the UI otherwise can't tell AUTH_EMAIL_NOT_VERIFIED apart from a bad password).
 * The client calls it only AFTER a generic signIn failure — one extra core call
 * on the failure path, never on the happy path.
 *
 * #734 — phone capture + OTP verification. Core's real /api/v1/auth/register
 * has no documented phone field (checked: no existing call site sends one),
 * so a submitted `phone` is stored in Builder's own ZeroDB
 * (lib/build/founder-phones.ts) rather than assumed to be a core contract
 * field. `send-otp`/`verify-otp` are self-contained (lib/build/otp.ts) —
 * see that file's header for the real, honest gap this documents: sending
 * the actual SMS requires a Builder-owned ZeroVoice service credential that
 * does not exist in this environment yet, so the send is gated behind
 * ZEROVOICE_OTP_ENABLED (default off) and returns an honest
 * {ok:false, reason:'not_configured'} rather than a fabricated success.
 */

import { NextRequest } from 'next/server'
import { gclidFromRequest } from '@/lib/build/conversions'
import { reportMetaConversion, fbcFromRequest, fbpFromRequest } from '@/lib/build/meta-capi'
import { createHash } from 'crypto'
import { sendOtp, verifyOtp, toE164, checkOtpRateLimit } from '@/lib/build/otp'
import { recordFounderPhone, markFounderPhoneVerified } from '@/lib/build/founder-phones'

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

/**
 * #734 — generate + store + send a 6-digit OTP for a phone number, rate
 * limited per phone AND per IP (a few sends per hour) since this triggers a
 * real, billed SMS once ZEROVOICE_OTP_ENABLED is flipped on. See
 * lib/build/otp.ts's header for the honest not-configured gap.
 */
async function handleSendOtp(rawPhone: string, request: NextRequest) {
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, reason: 'invalid_phone' }, { status: 400 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  const rl = checkOtpRateLimit(phone, ip)
  if (!rl.ok) {
    return Response.json({ ok: false, reason: rl.reason }, { status: 429, headers: { 'Retry-After': '3600' } })
  }

  const result = await sendOtp(phone)
  const status = result.ok ? 200 : (result.reason === 'not_configured' ? 200 : 502)
  return Response.json(result, { status })
}

/**
 * #734 — verify a submitted code against the stored OTP. On success, marks
 * the phone verified in the founder-phone registry (best-effort — the
 * client is the source of truth for gating final signup submission; this
 * durable record is for later reference, not itself a hard gate).
 */
async function handleVerifyOtp(rawPhone: string, code: string, email: string) {
  const phone = toE164(rawPhone)
  if (!phone || !code) return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400 })

  const result = await verifyOtp(phone, code)
  if (result.ok && email) {
    markFounderPhoneVerified(email, phone).catch(() => {})
  }
  return Response.json(result, { status: result.ok ? 200 : 400 })
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const email = String(b?.email || '').trim().toLowerCase()

  // #74 — resend-verification action, kept in the register route so the client
  // has one builder-side endpoint for the whole signup/verification surface.
  if (b?.action === 'resend') return handleResend(email)
  if (b?.action === 'login-check') return handleLoginCheck(email, String(b?.password || ''))
  // #734 — phone OTP actions, same one-endpoint pattern as resend/login-check above.
  if (b?.action === 'send-otp') return handleSendOtp(String(b?.phone || ''), request)
  if (b?.action === 'verify-otp') return handleVerifyOtp(String(b?.phone || ''), String(b?.code || ''), email)

  const password = String(b?.password || '')
  const rawPhone = typeof b?.phone === 'string' ? b.phone : ''
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
    // #465 · Meta: report the CompleteRegistration conversion via CAPI server-side
    // (survives ad-blockers/ITP) — mirrors the Lead report in lib/build/lead's
    // route. Best-effort, full no-op unless Meta CAPI is configured. event_id is
    // deterministic (email-keyed, no timestamp, no slug — a company doesn't exist
    // yet at signup) and returned to the client below so its browser Pixel
    // CompleteRegistration call can reuse the SAME id for Meta to dedup the pair
    // — computed once here (server-side email normalization is the source of
    // truth) rather than re-derived client-side, where it could drift.
    const metaEventId = `register-${createHash('sha256').update(email).digest('hex').slice(0, 16)}`
    reportMetaConversion({
      eventName: 'CompleteRegistration',
      eventId: metaEventId,
      email,
      fbc: fbcFromRequest(request), fbp: fbpFromRequest(request),
      clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      custom: { source: 'builder' },
    }).catch(() => {})
    // #734 — store the phone (unverified) in Builder's own registry now that the
    // account exists. Best-effort: a storage failure never blocks registration
    // itself, matching the existing best-effort posture of the CAPI report above.
    const normalizedPhone = rawPhone ? toE164(rawPhone) : null
    if (normalizedPhone) {
      recordFounderPhone(email, normalizedPhone).catch(() => {})
    }
    return Response.json({
      ok: true,
      email,
      verificationRequired: Boolean(verificationRequired),
      gclidAttached: Boolean(gclid),
      metaEventId,
    })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
