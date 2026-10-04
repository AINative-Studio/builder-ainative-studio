/**
 * Cloudflare Turnstile server-side verification (#930).
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

export interface TurnstileVerifyResult {
  success: boolean
  reason?: string
}

/**
 * Verify a client-submitted Turnstile token against Cloudflare's siteverify
 * endpoint. Fails closed: a missing token, a missing secret key, or any
 * network/parse error is treated as a failed verification, never silently
 * skipped. Never throws.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { success: false, reason: 'turnstile_not_configured' }
  if (!token) return { success: false, reason: 'missing_token' }

  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteIp) body.set('remoteip', remoteIp)

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => null)
    if (!data || typeof data.success !== 'boolean') {
      return { success: false, reason: 'invalid_verify_response' }
    }
    if (!data.success) {
      return { success: false, reason: String(data['error-codes']?.[0] || 'verification_failed').slice(0, 160) }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
