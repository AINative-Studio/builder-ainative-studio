/**
 * Trial re-engagement email (#1607, piece 3/3 of #1579's recovery plan).
 *
 * A founder whose unpaid trial key has been auto-renewed (#1605) can now run
 * their app indefinitely without ever paying. The product goal here is
 * DAU/engagement first (not a one-shot "come back" nudge): a recurring daily
 * email reporting the company's REAL activity — new signups, new visits —
 * both proves the app is genuinely alive after the trial "expired" moment,
 * and creates a repeated, low-friction conversion surface.
 *
 * NOT a modification of either existing sender — a third, parallel caller of
 * the same shared primitives:
 *   - lib/growth/winback-email.ts (#344): Builder → founder direction, the
 *     Cody-voice template conventions, the dry-run-by-default + suppression-
 *     log idempotency pattern. Wrong fit as-is: one-shot + 30d suppression,
 *     dormancy-triggered — this needs a genuine DAILY cadence instead.
 *   - app/api/cron/comms-digest (#743): the real daily-cron machinery
 *     (CRON_SECRET + ?send=true gate, durable ZeroDB delta marker advanced
 *     only after a confirmed send, commsOptOut/emailUndeliverableAt checks).
 *     Wrong audience/content as-is: loop-enrolled companies, dev-standup
 *     copy — nothing to do with trial/payment state.
 *
 * AUDIENCE (confirmed with the user before building): a company whose
 * stored ZeroDB key is usageTier:'trial' AND has gone through at least one
 * #1605 auto-renewal (company-zerodb-credentials.ts's
 * listRenewedTrialProjectIds — genuinely past the original trial window, not
 * a founder who signed up minutes ago), further filtered to active
 * (non-deleted) companies with a resolvable ownerEmail.
 *
 * HONESTY (confirmed with the user before building): every eligible company
 * gets a send every day, even with ZERO new activity — an honest "nothing
 * new today" message rather than being silently skipped. Matches
 * comms-digest.ts's own non-negotiable rule: "never fabricate generic status
 * text or invented activity."
 */

import { listVisitors, type VisitorEntry } from '@/lib/build/visitor-metrics'
import { listWaitlist, type WaitlistEntry } from '@/lib/build/waitlist-metrics'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

/** Deep link back into the owner's dashboard, UTM-tagged for attribution —
 *  same shape as winback-email.ts's ctaUrl, distinct campaign tag. */
export function ctaUrl(slug: string): string {
  const u = new URL(`${APP_URL}/build`)
  u.searchParams.set('screen', 'live')
  u.searchParams.set('company', slug)
  u.searchParams.set('utm_source', 'trial_engagement')
  u.searchParams.set('utm_medium', 'email')
  u.searchParams.set('utm_campaign', 'daily_activity')
  return u.toString()
}

export interface TrialActivitySummary {
  newSignups: number
  newVisits: number
}

/**
 * Real activity for a company SINCE a given instant — new waitlist signups
 * and new visitor pageviews, sourced from the exact same real metrics the
 * Live dashboard already computes (no new metrics pipeline). Never
 * fabricated: a read failure on either source degrades that count to 0
 * rather than throwing — matches listWaitlist/listVisitors's own documented
 * "honest empty state" contract, not a lie about zero activity (a genuine
 * read failure here just means this email under-reports for one day, which
 * is strictly safer than over-reporting activity that didn't happen).
 */
export async function computeTrialActivitySince(
  projectId: string,
  sinceIso: string,
): Promise<TrialActivitySummary> {
  const since = new Date(sinceIso).getTime()
  const [waitlist, visitors] = await Promise.all([
    listWaitlist(projectId).catch(() => [] as WaitlistEntry[]),
    listVisitors(projectId).catch(() => [] as VisitorEntry[]),
  ])
  const newSignups = Number.isFinite(since)
    ? waitlist.filter((w) => new Date(w.joinedAt).getTime() > since).length
    : waitlist.length
  const newVisits = Number.isFinite(since)
    ? visitors.filter((v) => new Date(v.visitedAt).getTime() > since).length
    : visitors.length
  return { newSignups, newVisits }
}

export interface TrialEngagementTarget {
  email: string
  slug: string
  companyName: string
  activity: TrialActivitySummary
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/**
 * Render the daily activity email. Always sends — zero activity renders an
 * honest "nothing new today" line, never a fabricated/generic status (#1607's
 * confirmed honesty rule). Cody's voice (◇, first-person, Modernist plain),
 * matching winback-email.ts's established template conventions.
 */
export function renderTrialEngagementEmail(t: TrialEngagementTarget): { subject: string; html: string; text: string } {
  const cta = ctaUrl(t.slug)
  const { newSignups, newVisits } = t.activity
  const hasActivity = newSignups > 0 || newVisits > 0

  const activityLine = hasActivity
    ? [
        newSignups > 0 ? `${newSignups} new signup${newSignups === 1 ? '' : 's'}` : null,
        newVisits > 0 ? `${newVisits} new visit${newVisits === 1 ? '' : 's'}` : null,
      ]
        .filter(Boolean)
        .join(' and ')
    : null

  const subject = hasActivity
    ? `◇ ${t.companyName}: ${activityLine} today`
    : `◇ ${t.companyName} — nothing new today`

  const bodyLine = hasActivity
    ? `${t.companyName} picked up ${activityLine} in the last day. It's real — your app is live and working right now.`
    : `No new activity for ${t.companyName} in the last day. Your app is still live and collecting real data whenever someone visits.`

  const text = [
    bodyLine,
    ``,
    `See it live: ${cta}`,
    ``,
    `This trial is running on a renewed, free key — when you're ready, upgrading keeps it running without any usage limit.`,
    ``,
    `— Cody`,
  ].join('\n')

  const html = `<div style="font-family:'IBM Plex Mono',ui-monospace,monospace;max-width:520px;margin:0 auto;color:#141414;line-height:1.55">
  <p style="font-size:15px">${escapeHtml(bodyLine)}</p>
  <p style="margin:28px 0"><a href="${cta}" style="background:#ec3013;color:#fff;padding:12px 20px;text-decoration:none;font-weight:600;border-radius:0;display:inline-block">See it live →</a></p>
  <p style="font-size:14px;color:#555">This trial is running on a renewed, free key — when you're ready, upgrading keeps it running without any usage limit.</p>
  <p style="font-size:15px">— Cody</p>
</div>`

  return { subject, html, text }
}
