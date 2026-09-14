/**
 * General-purpose company → customer email (#733, child of #414).
 *
 * Before this, the only real email-sending integration in this codebase was
 * lib/growth/winback-email.ts's Resend call — hardcoded for Builder's own
 * growth/winback emails (re-engaging a churned FOUNDER), not reusable for an
 * arbitrary live company reaching its OWN customers. This module is that
 * general-purpose sender: it reuses the exact same real Resend HTTP call
 * (lib/build/resend-client.ts, extracted out of winback-email.ts so both
 * callers share one implementation rather than duplicating the fetch logic),
 * with a per-company from-name.
 *
 * From-address: Resend requires the `from` domain to be a verified sending
 * identity on the account (checked against Resend's real API docs, per the
 * issue's own instruction not to invent per-company verified subdomains —
 * that's real, separate scope: per-company domain verification via Resend's
 * Domains API). Every send here therefore uses AINative's own already-
 * verified sender (`noreply@ainative.studio`), with the COMPANY's name as the
 * display name — e.g. `"Acme Robotics via AINative <noreply@ainative.studio>"`
 * — so the recipient sees which company is reaching them while the actual
 * envelope domain stays one Resend already trusts. This is a real constraint,
 * not an arbitrary choice: Resend rejects sends from an unverified `from`
 * domain outright (a 403), so a literal `"{companyName} <noreply@{slug}.
 * ainative.studio>"` would fail on every single send until that subdomain
 * were separately verified — out of scope here.
 *
 * Fails closed like every other primitive client in this codebase: no
 * RESEND_API_KEY, no recipient, or a real Resend API failure all surface as
 * `{ok:false, reason}` — never a fabricated success.
 */

import { sendViaResend } from '@/lib/build/resend-client'

const FROM_DOMAIN = process.env.COMPANY_EMAIL_FROM_DOMAIN || 'noreply@ainative.studio'

export interface CompanyEmailResult {
  ok: boolean
  id?: string
  reason?: string
}

function escapeFromName(name: string): string {
  // Resend's `from` header takes a plain display name — strip characters that
  // would break the "Name <email>" syntax rather than attempt full RFC 5322
  // encoding for a display name only.
  return name.replace(/[<>"]/g, '').trim()
}

/**
 * Send an email to a customer/user on a live company's behalf. `companyName`
 * becomes the visible from-name ("{companyName} via AINative"); the
 * underlying send domain is always AINative's own verified Resend sender.
 */
export async function sendCompanyEmail(
  companyName: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<CompanyEmailResult> {
  if (!companyName || !companyName.trim()) return { ok: false, reason: 'no_company_name' }
  if (!to) return { ok: false, reason: 'no_recipient' }
  if (!subject) return { ok: false, reason: 'no_subject' }
  if (!html && !text) return { ok: false, reason: 'no_body' }

  const safeName = escapeFromName(companyName)
  const from = `${safeName} via AINative <${FROM_DOMAIN}>`

  const result = await sendViaResend(from, to, subject, html, text)
  if (!result.ok) return { ok: false, reason: result.reason || 'send_failed' }
  return { ok: true, id: result.id }
}
