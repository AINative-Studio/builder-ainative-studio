/**
 * Shared low-level Resend HTTP client (#733, extracted out of
 * lib/growth/winback-email.ts's `sendViaResend`).
 *
 * This is the ONE real, working email-sending call in this codebase — a
 * plain HTTP POST to https://api.resend.com/emails, no SDK dependency.
 * Originally hardcoded inline in winback-email.ts for Builder's own
 * growth/winback sends; extracted here so a second caller (company-email.ts,
 * Cody sending on a live company's behalf) can reuse the exact same real
 * call instead of duplicating the fetch logic. Never throws — a missing key,
 * a non-2xx response, or a network error all surface as a structured
 * `{ok:false, reason}`, matching this codebase's established fail-honest
 * pattern (see lib/build/zerovoice.ts's doc comments).
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''

export interface ResendSendResult {
  ok: boolean
  id?: string
  reason?: string
  status?: number
}

/**
 * Send one email via Resend's real HTTP API.
 * `from` must be a Resend-verified sender identity (domain or the shared
 * ainative.studio sender) — Resend itself will reject an unverified from
 * address with a 4xx, which this surfaces honestly via `reason`.
 */
export async function sendViaResend(
  from: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<ResendSendResult> {
  if (!RESEND_API_KEY) return { ok: false, reason: 'no_resend_api_key' }
  if (!to) return { ok: false, reason: 'no_recipient' }
  if (!subject) return { ok: false, reason: 'no_subject' }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: String(data?.message || data?.error || res.status).slice(0, 160),
      }
    }
    return { ok: true, id: data?.id ? String(data.id) : undefined, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

/** Whether Resend is configured at all in this environment. */
export function resendConfigured(): boolean {
  return Boolean(RESEND_API_KEY)
}
