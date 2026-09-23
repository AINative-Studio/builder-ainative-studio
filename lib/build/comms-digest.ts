/**
 * Comms digest content builders (#743) — pure, unit-testable content for the
 * two founder-facing cadence modes. No I/O here; the cron route
 * (app/api/cron/comms-digest) fetches the real data (daily report / Gitea
 * commits) and passes it in.
 *
 * HONESTY RULE (non-negotiable per the issue): when there's no real
 * underlying data, these builders say so plainly ("no updates to report") —
 * never fabricate generic status text or invented activity.
 */

import type { GiteaCommit } from '@/lib/git/gitea-client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

/**
 * The real Live dashboard URL for a company (#857 — real customer feedback,
 * Greg Rose: "It would be great if the emails included a link to that
 * project so I could just click and go there"). Neither digest mode ever
 * linked back to the dashboard at all — a founder had to navigate to the
 * site manually and find their company again. Matches the exact
 * `?screen=live&company=` deep-link shape checkout/route.ts's Stripe
 * success_url already uses.
 */
function dashboardUrl(companyId: string): string {
  return `${APP_URL}/build?screen=live&company=${encodeURIComponent(companyId)}`
}

export interface AgileDigestInput {
  companyName: string
  /** Real slug — builds the "jump back in" link to this company's Live
   *  dashboard. Omit only when genuinely unavailable; the email still sends
   *  without a link rather than a broken one. */
  companyId?: string
  /** Today's real 'daily' report content (buildDailyReport's markdown), if one
   *  exists for this run. Null when the nightly loop hasn't produced one yet
   *  (or ran but wasn't durably recorded) — an honest gap, not fabricated. */
  dailyReportContent: string | null
  dailyReportCreatedAt: string | null
}

export interface AgileDigest {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Render markdown-ish plain text (the daily report body) as simple HTML paragraphs. */
function textToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

/**
 * Build the 'agile' mode digest — the morning "yesterday / today / blockers"
 * standup, grounded in the real nightly-loop daily report when one exists.
 * When no real report is available for today, sends an honest "no updates to
 * report" email rather than inventing status.
 */
export function buildAgileDigest(input: AgileDigestInput): AgileDigest {
  const company = input.companyName || 'your company'
  const subject = `${company} — this morning's standup from Cody`
  const url = input.companyId ? dashboardUrl(input.companyId) : null
  const linkText = url ? `\n\nJump back in: ${url}` : ''
  const linkHtml = url ? `<p><a href="${url}">Jump back in →</a></p>` : ''

  if (!input.dailyReportContent) {
    const text =
      `Good morning,\n\n` +
      `Cody has no updates to report for ${company} this run — the nightly loop ` +
      `hasn't produced a report yet, or there was nothing new overnight.` +
      `${linkText}\n\n— Cody`
    return {
      subject,
      text,
      html: `<p>Good morning,</p><p>Cody has no updates to report for <strong>${escapeHtml(company)}</strong> this run — the nightly loop hasn't produced a report yet, or there was nothing new overnight.</p>${linkHtml}<p>— Cody</p>`,
    }
  }

  const text =
    `Good morning,\n\n` +
    `Here's Cody's standup for ${company}:\n\n` +
    `${input.dailyReportContent}` +
    `${linkText}\n\n— Cody`
  const html =
    `<p>Good morning,</p><p>Here's Cody's standup for <strong>${escapeHtml(company)}</strong>:</p>` +
    textToHtml(input.dailyReportContent) +
    linkHtml +
    `<p>— Cody</p>`

  return { subject, text, html }
}

export interface PairProgrammingDigestInput {
  companyName: string
  /** Real slug — builds the "jump back in" link to this company's Live
   *  dashboard, alongside (not instead of) the repo's own Full history link. */
  companyId?: string
  commits: GiteaCommit[]
  repoUrl?: string
  /** ISO instant the digest window started (the previous lastDigestAt, or the
   *  default lookback) — surfaced so the email is honest about its window. */
  sinceIso: string
}

export interface PairProgrammingDigest {
  subject: string
  html: string
  text: string
}

/** First line of a commit message (the subject line), trimmed. Pure. */
function commitSubject(message: string): string {
  return (message || '').split('\n')[0].trim() || '(no message)'
}

/**
 * Build the 'pairProgramming' mode digest — a GitHub-style commit activity
 * summary sourced from the company's real Gitea repo. When there are no new
 * commits since the last digest, sends an honest "no new activity" email
 * rather than inventing progress.
 */
export function buildPairProgrammingDigest(input: PairProgrammingDigestInput): PairProgrammingDigest {
  const company = input.companyName || 'your company'
  const subject = `${company} — ${input.commits.length} new commit${input.commits.length === 1 ? '' : 's'} from Cody`
  const url = input.companyId ? dashboardUrl(input.companyId) : null
  const linkText = url ? `\n\nJump back in: ${url}` : ''
  const linkHtml = url ? `<p><a href="${url}">Jump back in →</a></p>` : ''

  if (input.commits.length === 0) {
    const text =
      `Hi,\n\n` +
      `No new commits on ${company}'s repo since ${input.sinceIso} — Cody hasn't pushed any ` +
      `changes in this window.` +
      `${linkText}\n\n— Cody`
    return {
      subject: `${company} — no new activity`,
      text,
      html: `<p>Hi,</p><p>No new commits on <strong>${escapeHtml(company)}</strong>'s repo since ${escapeHtml(input.sinceIso)} — Cody hasn't pushed any changes in this window.</p>${linkHtml}<p>— Cody</p>`,
    }
  }

  const lines = input.commits.map((c) => {
    const subj = commitSubject(c.commit?.message || '')
    const author = c.commit?.author?.name || c.commit?.committer?.name || 'Cody'
    const sha = (c.sha || '').slice(0, 7)
    return `- ${subj} (${sha} by ${author})`
  })

  const text =
    `Hi,\n\n` +
    `Here's what Cody shipped on ${company} since ${input.sinceIso}:\n\n` +
    `${lines.join('\n')}\n\n` +
    (input.repoUrl ? `Full history: ${input.repoUrl}\n\n` : '') +
    (url ? `Jump back in: ${url}\n\n` : '') +
    `— Cody`

  const htmlLines = input.commits
    .map((c) => {
      const subj = escapeHtml(commitSubject(c.commit?.message || ''))
      const author = escapeHtml(c.commit?.author?.name || c.commit?.committer?.name || 'Cody')
      const sha = (c.sha || '').slice(0, 7)
      return c.html_url
        ? `<li><a href="${c.html_url}">${subj}</a> (${sha} by ${author})</li>`
        : `<li>${subj} (${sha} by ${author})</li>`
    })
    .join('\n')

  const html =
    `<p>Hi,</p><p>Here's what Cody shipped on <strong>${escapeHtml(company)}</strong> since ${escapeHtml(input.sinceIso)}:</p>` +
    `<ul>${htmlLines}</ul>` +
    (input.repoUrl ? `<p>Full history: <a href="${input.repoUrl}">${escapeHtml(input.repoUrl)}</a></p>` : '') +
    linkHtml +
    `<p>— Cody</p>`

  return { subject, text, html }
}
