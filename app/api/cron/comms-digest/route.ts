/**
 * Comms digest cron (#743) — Cody's founder-facing email cadence. Scheduled
 * for 7am PST (see .github/workflows/comms-digest.yml) and CRON_SECRET-gated,
 * same pattern as the existing cron routes (app/api/cron/winback,
 * app/api/build/nightly-loop).
 *
 * For each enrolled company (reusing lib/build/loop-enrollment.ts's
 * listEnrolled() — the SAME enrollment mechanism the nightly loop already
 * iterates, not a second one):
 *   - commsMode 'agile' (or absent/default): a "yesterday / today / blockers"
 *     standup, grounded in TODAY's real 'daily' report document (the nightly
 *     loop's own durable output — lib/build/document-store.ts, written by
 *     app/api/build/nightly-loop/route.ts). No report yet → an honest "no
 *     updates to report" email, never fabricated status.
 *   - commsMode 'pairProgramming': a GitHub-style commit digest sourced from
 *     the company's real Gitea repo via getCommitsSince(), delta'd against
 *     the company's lastDigestAt (default 24h lookback when absent).
 *
 * A sweep loop — one sendCompanyEmail() call per company (the user's own
 * "one by one" framing), not a bulk blast. This is a SEPARATE, purpose-built
 * path from #742's nightly-loop/MCP-tool comms architecture — it calls
 * sendCompanyEmail directly and does not go through agent-runtime machinery.
 *
 * #742 shipped a baseline comms policy this cron ADOPTS: AppEntry.commsOptOut
 * (the founder's "don't proactively contact me" flag) is checked and honored
 * here too — this digest is proactive outreach Cody initiates on its own,
 * same as the nightly-loop's own comms-policy step. #742's frequency-cap.ts
 * (an in-memory per-process "once per window" limiter) is deliberately NOT
 * adopted here: this cron already has a durable, ZeroDB-persisted delta
 * marker for its own once-daily cadence (lastDigestAt, advanced only after a
 * confirmed send), which survives process restarts between GitHub Actions
 * runs — an in-memory cap would reset on every fresh invocation and add no
 * real protection on top of that.
 *
 * SAFETY: mirrors winback's dry-run-by-default posture — a real send requires
 * BOTH the CRON_SECRET AND an explicit `?send=true`, so a routine cron ping
 * or a probe never emails a real founder.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listEnrolled } from '@/lib/build/loop-enrollment'
import { resolveApp, setAppLastDigestAt } from '@/lib/build/app-registry'
import { listDocuments } from '@/lib/build/document-store'
import { chatScopeKey } from '@/lib/build/chat-store'
import { getCommitsSince } from '@/lib/git/gitea-client'
import { sendCompanyEmail } from '@/lib/build/company-email'
import { buildAgileDigest, buildPairProgrammingDigest } from '@/lib/build/comms-digest'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Default lookback for a pair-programming digest when the company has never
 *  had a digest sent before (no lastDigestAt yet) — one day, matching the
 *  nightly loop's own overnight cadence. */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000

export interface DigestSummary {
  companyId: string
  mode: 'agile' | 'pairProgramming'
  sent: boolean
  reason?: string
}

/** Find today's 'daily' report document content for a scope, or null when
 *  none exists yet. Newest-first (listDocuments already sorts that way). */
async function todaysDailyReport(scopeKey: string): Promise<{ content: string; createdAt: string } | null> {
  const docs = await listDocuments(scopeKey).catch(() => [])
  const today = new Date().toISOString().slice(0, 10)
  const match = docs.find((d) => d.type === 'daily' && d.createdAt.slice(0, 10) === today)
  return match ? { content: match.content, createdAt: match.createdAt } : null
}

/** Run the digest sweep. Exported so tests can drive it directly without
 *  going through the HTTP handler's auth gate. */
export async function runCommsDigestSweep(opts: { dryRun: boolean }): Promise<{
  ok: true
  dryRun: boolean
  total: number
  sent: number
  skipped: number
  failed: number
  results: DigestSummary[]
}> {
  const enrolled = await listEnrolled()
  const results: DigestSummary[] = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const e of enrolled) {
    const app = await resolveApp(e.companyId).catch(() => null)
    const recipient = app?.ownerEmail
    const mode: 'agile' | 'pairProgramming' = app?.commsMode === 'pairProgramming' ? 'pairProgramming' : 'agile'

    // Honor the founder's "don't proactively contact me" opt-out (#742,
    // AppEntry.commsOptOut) — the same baseline policy the nightly-loop's own
    // comms-policy step respects. This digest is proactive outreach Cody
    // initiates on its own, so it's in scope for the opt-out even though it's
    // a separate send path from #742's nightly-loop alerting.
    if (app?.commsOptOut) {
      skipped += 1
      results.push({ companyId: e.companyId, mode, sent: false, reason: 'comms_opted_out' })
      continue
    }

    if (!recipient) {
      skipped += 1
      results.push({ companyId: e.companyId, mode, sent: false, reason: 'no_owner_email' })
      continue
    }

    try {
      let subject: string
      let html: string
      let text: string

      if (mode === 'agile') {
        const scopeKey = e.ownerKey ? chatScopeKey(e.ownerKey, e.companyId) : ''
        const report = scopeKey ? await todaysDailyReport(scopeKey) : null
        const digest = buildAgileDigest({
          companyName: e.companyName,
          dailyReportContent: report?.content ?? null,
          dailyReportCreatedAt: report?.createdAt ?? null,
        })
        subject = digest.subject; html = digest.html; text = digest.text
      } else {
        if (!app?.gitOrg || !app?.gitRepoUrl) {
          skipped += 1
          results.push({ companyId: e.companyId, mode, sent: false, reason: 'no_git_repo' })
          continue
        }
        const sinceIso = app.lastDigestAt || new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString()
        const commits = await getCommitsSince(app.gitOrg, e.companyId, sinceIso)
        const digest = buildPairProgrammingDigest({
          companyName: e.companyName,
          commits,
          repoUrl: app.gitRepoUrl,
          sinceIso,
        })
        subject = digest.subject; html = digest.html; text = digest.text
      }

      if (opts.dryRun) {
        results.push({ companyId: e.companyId, mode, sent: false, reason: 'dry_run' })
        continue
      }

      const result = await sendCompanyEmail(e.companyName, recipient, subject, html, text)
      if (result.ok) {
        sent += 1
        results.push({ companyId: e.companyId, mode, sent: true })
        // Only advance lastDigestAt for pairProgramming — agile mode has no
        // delta state to track. Advanced AFTER a confirmed successful send.
        if (mode === 'pairProgramming') {
          await setAppLastDigestAt(e.companyId, new Date().toISOString()).catch(() => {})
        }
      } else {
        failed += 1
        results.push({ companyId: e.companyId, mode, sent: false, reason: result.reason || 'send_failed' })
      }
    } catch (err) {
      failed += 1
      results.push({ companyId: e.companyId, mode, sent: false, reason: (err as Error)?.message?.slice(0, 200) })
      logger.warn('Comms digest failed for company', { companyId: e.companyId, err: (err as Error)?.message })
    }
  }

  return { ok: true, dryRun: opts.dryRun, total: enrolled.length, sent, skipped, failed, results }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized comms-digest cron request', {
      path: '/api/cron/comms-digest',
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const send = url.searchParams.get('send') === 'true'

  try {
    const result = await runCommsDigestSweep({ dryRun: !send })
    logger.info('Comms digest sweep complete', {
      dryRun: result.dryRun, total: result.total, sent: result.sent, skipped: result.skipped, failed: result.failed,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Comms digest sweep failed', error as Error)
    return NextResponse.json({ error: 'Comms digest sweep failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
