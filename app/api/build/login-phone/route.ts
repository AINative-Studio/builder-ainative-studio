/**
 * POST /api/build/login-phone (#944 Part 2) — mobile-first, passwordless
 * phone login. Proxies core's /auth/login-phone. No Turnstile gate — login
 * isn't the bot-signup surface Turnstile protects (register-phone's
 * register action is gated; this mirrors register/route.ts's own
 * login-check path, which also isn't gated).
 *
 * As of 2026-10-06, core's /auth/login-phone is merged but NOT live in
 * production (core#8512, tracked separately) — built/tested against the
 * documented/code-read contract only.
 *
 * Body:    { phone: string, otp_code: string }
 * Returns: { ok: true, accessToken, refreshToken, expiresIn }
 *        | { ok: false, error: string, errorCode?: 'NO_SUCH_PHONE_ACCOUNT' }
 *
 * `errorCode: 'NO_SUCH_PHONE_ACCOUNT'` (core returning 404) is the signal
 * Auth.tsx uses to route a founder with no existing account into
 * register-phone instead of showing a dead-end error.
 */
import { NextRequest } from 'next/server'
import { toE164 } from '@/lib/build/phone'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const rawPhone = String(b?.phone || '')
  const otpCode = String(b?.otp_code || '')
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, error: 'invalid_phone' }, { status: 400 })
  if (!otpCode) return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })

  try {
    const res = await fetch(`${CORE}/api/v1/auth/login-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp_code: otpCode }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.detail?.message || 'login failed')
      return Response.json(
        { ok: false, error: detail, errorCode: res.status === 404 ? 'NO_SUCH_PHONE_ACCOUNT' : undefined },
        { status: res.status },
      )
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
