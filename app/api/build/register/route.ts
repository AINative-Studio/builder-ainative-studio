/**
 * POST /api/build/register (#207) — real signup for the /build flow that carries
 * ad attribution. Registers the founder against CORE (where users.gclid + the
 * Stripe payment webhook live) and passes the gclid captured on ad landing, so
 * when they pay, core's Stripe webhook finds users.gclid and uploads the
 * conversion to Google Ads. This closes the ad-click → paid-subscription loop.
 *
 * Body: { email, password }  (gclid + utm come from the request cookies)
 * Returns: { ok, email } | { ok:false, error }
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

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const email = String(b?.email || '').trim().toLowerCase()
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
    return Response.json({ ok: true, email, gclidAttached: Boolean(gclid) })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
