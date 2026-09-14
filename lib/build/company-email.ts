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
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

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

/**
 * Welcome email (#758) — fired once, at a founder's genuinely FIRST company
 * registration (never on a regeneration), written from Cody in first person.
 * Reuses `sendCompanyEmail` above rather than duplicating the Resend call —
 * per the issue's explicit instruction, this is NOT a Resend Broadcast/
 * Audience send; it's one transactional send to one specific founder.
 *
 * HONESTY, matching the framing already established in app/api/build/ask's
 * system prompt and components/build/screens/Live.tsx's provisioning banner
 * (both hardened by #748's fix): the preview IS a real, working app with
 * live data persistence through the sandbox data layer — that's true for
 * every registration regardless of plan. What is NOT true yet, unless
 * enrollment/provisioning has already run, is a permanent per-company
 * backend, real authentication, or a custom domain — those need either the
 * automatic nightly-loop enrollment (which this same registration call just
 * triggered, see register-app/route.ts) to progress, or a paid plan / the
 * founder's own "Provision cloud" click. This email must never claim the
 * permanent backend is live at signup — that exact class of overclaim was
 * #748's root cause and must not be reintroduced here.
 */
export function renderWelcomeEmail(companyName: string, slug: string): { subject: string; html: string; text: string } {
  const previewUrl = `${APP_URL}/build/${slug}`
  const subject = `${companyName} is live — here's what happens next`
  const text = [
    `Hey — Cody here. I just finished building ${companyName}, and it's live right now as a working preview:`,
    ``,
    previewUrl,
    ``,
    `That preview is a real, interactive app — create/read/update/delete and search all work through the ` +
      `platform's data layer already, not a mockup. What's still ahead is the permanent, production side: your ` +
      `own dedicated cloud project, real user authentication, and (if you want one) a custom domain. That kicks ` +
      `off automatically as you keep using the dashboard, or you can trigger it yourself any time from ` +
      `"Provision cloud" on your dashboard.`,
    ``,
    `From here, I keep working on ${companyName} in the background — a nightly loop that picks up backlog items ` +
      `on their own, and once you're enrolled you'll start getting a daily standup email from me with what moved.`,
    ``,
    `Come back to your dashboard any time: ${previewUrl}`,
    ``,
    `— Cody`,
  ].join('\n')
  const html = `<div style="font-family:'IBM Plex Mono',ui-monospace,monospace;max-width:520px;margin:0 auto;color:#141414;line-height:1.55">
  <p style="font-size:15px">Hey — Cody here. I just finished building <strong>${escapeHtml(companyName)}</strong>, and it's live right now as a working preview.</p>
  <p style="margin:24px 0"><a href="${previewUrl}" style="background:#ec3013;color:#fff;padding:12px 20px;text-decoration:none;font-weight:600;border-radius:0;display:inline-block">Open ${escapeHtml(companyName)} →</a></p>
  <p style="font-size:15px">That preview is a real, interactive app — create/read/update/delete and search all work through the platform's data layer already, not a mockup. What's still ahead is the permanent, production side: your own dedicated cloud project, real user authentication, and (if you want one) a custom domain. That kicks off automatically as you keep using the dashboard, or you can trigger it yourself any time from "Provision cloud" on your dashboard.</p>
  <p style="font-size:15px">From here, I keep working on ${escapeHtml(companyName)} in the background — a nightly loop that picks up backlog items on their own, and once you're enrolled you'll start getting a daily standup email from me with what moved.</p>
  <p style="font-size:15px">— Cody</p>
</div>`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/**
 * Send the welcome email for a brand-new company registration. Thin wrapper
 * around `sendCompanyEmail` — no duplicate Resend call, no new from-name
 * convention (uses the exact same "{companyName} via AINative" pattern every
 * other company email in this codebase already uses).
 */
export async function sendWelcomeEmail(
  companyName: string,
  to: string,
  slug: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { subject, html, text } = renderWelcomeEmail(companyName, slug)
  const result = await sendCompanyEmail(companyName, to, subject, html, text)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}
