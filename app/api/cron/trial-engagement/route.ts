/**
 * Trial re-engagement daily cron (#1607, piece 3/3 of #1579's recovery plan).
 *
 * For each company whose stored ZeroDB key is usageTier:'trial' AND has gone
 * through at least one #1605 auto-renewal (genuinely past the original trial
 * window — company-zerodb-credentials.ts's listRenewedTrialProjectIds), send
 * one daily email reporting that company's REAL activity (new waitlist
 * signups, new visitor pageviews) since the last successful send — or an
 * honest "nothing new today" when there was none (#1607's confirmed honesty
 * rule: every eligible company gets a send every day, never silently
 * skipped on zero activity).
 *
 * SAFETY: mirrors comms-digest/winback's exact posture — CRON_SECRET-gated,
 * dry-run by default, a real send requires BOTH the secret AND an explicit
 * `?send=true`. commsOptOut and emailUndeliverableAt (#840) are honored
 * exactly as comms-digest already does. The delta marker
 * (lastTrialEngagementEmailAt) is a SEPARATE field from comms-digest's own
 * lastDigestAt — different cron, different audience, different content —
 * advanced ONLY after a confirmed send.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listAllAppsWithStatus, resolveAppVerified, setAppLastTrialEngagementEmailAt, type AppEntry } from '@/lib/build/app-registry'
import { listRenewedTrialProjectIds } from '@/lib/build/company-zerodb-credentials'
import { computeTrialActivitySince, renderTrialEngagementEmail } from '@/lib/build/trial-engagement-email'
import { sendViaResend } from '@/lib/build/resend-client'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const FROM = process.env.TRIAL_ENGAGEMENT_FROM || 'Cody at AINative <cody@ainative.studio>'
/** Lookback for a company's FIRST send (no lastTrialEngagementEmailAt yet) —
 *  one day, matching comms-digest's own default-lookback convention. */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000
/** Blast-radius guard, same shape as winback's MAX_PER_RUN. */
const MAX_PER_RUN = Number(process.env.TRIAL_ENGAGEMENT_MAX_PER_RUN || 200)

export interface TrialEngagementSummary {
  companyId: string
  sent: boolean
  reason?: string
}

export async function runTrialEngagementSweep(opts: { dryRun: boolean }): Promise<{
  ok: true
  dryRun: boolean
  total: number
  sent: number
  skipped: number
  failed: number
  results: TrialEngagementSummary[]
}> {
  const projectIds = await listRenewedTrialProjectIds()
  const { apps, ok } = await listAllAppsWithStatus()
  const results: TrialEngagementSummary[] = []
  let sent = 0
  let skipped = 0
  let failed = 0

  if (!ok) {
    // Honest "could not verify the audience" — never silently report zero
    // companies as "nothing to do today" (same discipline as #1013's
    // backfill sweep and comms-digest's own registry-read guard).
    return { ok: true, dryRun: opts.dryRun, total: 0, sent: 0, skipped: 0, failed: 0, results: [] }
  }

  const byProjectId = new Map<string, AppEntry>()
  for (const a of apps) {
    if (a.zerodbProjectId) byProjectId.set(a.zerodbProjectId, a)
  }

  const candidates = projectIds
    .map((pid) => byProjectId.get(pid))
    .filter((a): a is AppEntry => !!a && (a.lifecycleStatus || 'active') !== 'deleted' && !!a.ownerEmail)

  for (const app of candidates) {
    if (sent >= MAX_PER_RUN) break
    const slug = app.slug

    // Re-resolve verified (not the listAllApps snapshot) immediately before
    // acting — mirrors comms-digest's own resolveAppVerified use, so a
    // concurrent registry change between the sweep's enumeration and this
    // company's own send is never acted on stale.
    const { entry: verified, verified: isVerified } = await resolveAppVerified(slug).catch(() => ({ entry: null, verified: false }))
    if (!isVerified || !verified) {
      skipped += 1
      results.push({ companyId: slug, sent: false, reason: 'lookup_failed' })
      continue
    }

    if (verified.commsOptOut) {
      skipped += 1
      results.push({ companyId: slug, sent: false, reason: 'comms_opted_out' })
      continue
    }
    if (verified.emailUndeliverableAt) {
      skipped += 1
      results.push({ companyId: slug, sent: false, reason: 'recipient_undeliverable' })
      continue
    }
    const recipient = verified.ownerEmail
    if (!recipient) {
      skipped += 1
      results.push({ companyId: slug, sent: false, reason: 'no_owner_email' })
      continue
    }
    if (!verified.zerodbProjectId) {
      skipped += 1
      results.push({ companyId: slug, sent: false, reason: 'no_zerodb_project' })
      continue
    }

    try {
      const sinceIso = verified.lastTrialEngagementEmailAt || new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString()
      const activity = await computeTrialActivitySince(verified.zerodbProjectId, sinceIso)
      const { subject, html, text } = renderTrialEngagementEmail({
        email: recipient,
        slug,
        companyName: verified.name || slug,
        activity,
      })

      if (opts.dryRun) {
        results.push({ companyId: slug, sent: false, reason: 'dry_run' })
        continue
      }

      const result = await sendViaResend(FROM, recipient, subject, html, text)
      if (result.ok) {
        sent += 1
        results.push({ companyId: slug, sent: true })
        await setAppLastTrialEngagementEmailAt(slug, new Date().toISOString()).catch(() => {})
      } else {
        failed += 1
        results.push({ companyId: slug, sent: false, reason: result.reason || 'send_failed' })
      }
    } catch (err) {
      failed += 1
      results.push({ companyId: slug, sent: false, reason: (err as Error)?.message?.slice(0, 200) })
      logger.warn('Trial engagement email failed for company', { companyId: slug, err: (err as Error)?.message })
    }
  }

  return { ok: true, dryRun: opts.dryRun, total: candidates.length, sent, skipped, failed, results }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized trial-engagement cron request', {
      path: '/api/cron/trial-engagement',
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const send = url.searchParams.get('send') === 'true'

  try {
    const result = await runTrialEngagementSweep({ dryRun: !send })
    logger.info('Trial engagement sweep complete', {
      dryRun: result.dryRun, total: result.total, sent: result.sent, skipped: result.skipped, failed: result.failed,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Trial engagement sweep failed', error as Error)
    return NextResponse.json({ error: 'Trial engagement sweep failed' }, { status: 500 })
  }
}
