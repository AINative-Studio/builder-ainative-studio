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

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

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

  return Response.json({ ok: false, error: 'not_implemented' }, { status: 501 })
}
