/**
 * POST /api/build/register-phone (#944 Part 2) — mobile-first, passwordless
 * phone registration. Proxies core's native phone-identity endpoints
 * (core#8463/#8459); no Builder-side OTP logic here — core owns its own
 * send/verify (separate from lib/build/otp.ts's #734 add-on flow).
 *
 * As of 2026-10-06, core's /auth/register-phone and /auth/send-phone-otp
 * are merged but NOT live in production (core#8512, tracked separately,
 * owned by another team) — this route is built and tested against the
 * documented/code-read contract; do not assume it works end-to-end until
 * core#8512 closes.
 *
 * Body (send-otp):  { action: 'send-otp', phone: string }
 * Body (register):  { phone: string, otp_code: string, turnstileToken? }
 * Returns (send-otp): { ok: true } | { ok: false, reason: string }
 * Returns (register): { ok: true, accessToken, refreshToken, expiresIn } | { ok: false, error: string }
 */
import { NextRequest } from 'next/server'
import { toE164 } from '@/lib/build/phone'
import { turnstileEnabled, verifyTurnstileToken } from '@/lib/turnstile'
import { gclidFromRequest } from '@/lib/build/conversions'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

// Mirrors register/route.ts's private utmFromRequest exactly (not exported
// there, so duplicated rather than reaching into another route's internals).
function utmFromRequest(request: Request): Record<string, string> {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(/(?:^|; )ax_utm=([^;]*)/)
  if (!m) return {}
  try { return JSON.parse(decodeURIComponent(m[1])) } catch { return {} }
}

async function handleSendOtp(rawPhone: string) {
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, reason: 'invalid_phone' }, { status: 400 })

  try {
    const res = await fetch(`${CORE}/api/v1/auth/send-phone-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) {
      return Response.json({ ok: false, reason: 'send_failed' }, { status: res.status })
    }
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)

  if (b?.action === 'send-otp') return handleSendOtp(String(b?.phone || ''))

  const rawPhone = String(b?.phone || '')
  const otpCode = String(b?.otp_code || '')
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, error: 'invalid_phone' }, { status: 400 })
  if (!otpCode) return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })

  if (turnstileEnabled()) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const verification = await verifyTurnstileToken(
      typeof b?.turnstileToken === 'string' ? b.turnstileToken : null,
      ip,
    )
    if (!verification.success) {
      return Response.json({ ok: false, error: 'verification_failed' }, { status: 400 })
    }
  }

  // Review finding #4 (2026-10-06): the spec explicitly required forwarding
  // signup_source + ext the same way register/route.ts does — dropped in
  // the first pass, which would have silently broken ad-attribution (no
  // users.gclid set) and the card-free keyless bypass for every phone
  // signup. Same gclid/utm cookie reads, same nested ext.utm shape core
  // expects (auth.py reads gclid flat but utm from a NESTED ext.utm dict).
  const gclid = gclidFromRequest(request)
  const utm = utmFromRequest(request)

  try {
    const res = await fetch(`${CORE}/api/v1/auth/register-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        otp_code: otpCode,
        signup_source: 'builder',
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
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.detail?.message || 'registration failed')
      return Response.json({ ok: false, error: detail }, { status: res.status })
    }
    return Response.json({
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
