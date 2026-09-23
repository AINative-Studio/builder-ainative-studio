/**
 * Nightly-loop comms outreach policy (#742).
 *
 * BACKGROUND — the architecture gap this closes: #733 shipped two real MCP
 * tools (`contact_founder_for_feedback`, `send_project_update_email`) but
 * wired them ONLY into lib/agent/claude-agent.ts's `runHeadlessAgent`, gated
 * to `fullDiscipline` (complex codegen runs only). The nightly loop
 * (lib/build/autonomous-loop.ts's `runNightlyLoop`, invoked per company by
 * app/api/build/nightly-loop/route.ts) — the ONE system with a legitimate,
 * ongoing reason to email a founder about their live company — never calls
 * `runHeadlessAgent` at all. It dispatches free-text tasks to core's OpenClaw
 * swarm (POST /api/v1/public/agent-swarm/tasks), a completely separate
 * execution environment with no access to Builder's local MCP servers.
 *
 * OPTION A vs B (see the issue + this branch's PR description for the full
 * writeup): Option A — teaching the swarm task to call back into Builder's
 * own HTTP routes — needs a new authenticated-callback mechanism on core's
 * side (the swarm has no credential today that would let it call
 * /api/build/company-email as a scoped, non-founder-JWT caller); that's a
 * cross-repo, multi-day coordination effort this repo cannot land alone.
 * Option B — chosen here — runs the outreach DECISION locally, in THIS
 * repo's own process, where lib/build/company-email.ts's `sendCompanyEmail`
 * is already a plain importable function. This is deliberately SIMPLER than
 * the issue's own suggestion of a lightweight `runHeadlessAgent` invocation:
 * there is no need to spawn an agent (with its child-process/MCP-server
 * machinery) just to decide "do we have something genuine to say and are we
 * allowed to say it" — that's a small, fully deterministic policy, not a
 * task an LLM needs to reason about turn-by-turn. Growth/product work stays
 * on the swarm exactly as today; only comms gets this new local step,
 * alongside the swarm dispatch (not instead of it).
 *
 * POLICY (all four required by the issue):
 *  1. Genuine signal — `hasGenuineUpdate` inspects the REAL `NightlyRunResult`
 *     (never fabricates content). Only a 'dispatched' run with a real taskId
 *     counts as something to report; 'skipped' (no API key) and 'error' runs
 *     are honestly NOT reported as founder-facing "good news" outreach —
 *     an error is arguably interesting too, but this issue scopes the first
 *     real signal conservatively (a completed dispatch) rather than
 *     interrupting a founder's night over a routine dispatch hiccup a human
 *     operator would triage in logs, not an inbox ping. Extending to
 *     error-worthy outreach is a reasonable fast-follow, not done here.
 *  2. Frequency cap — at most one outreach email per company per
 *     COMMS_FREQUENCY_WINDOW_MS (default 24h), via the shared
 *     lib/build/frequency-cap.ts helper (built generically so #743's digest
 *     cron can adopt the same primitive rather than re-implementing it).
 *  3. Opt-out — AppEntry.commsOptOut (added this issue); checked BEFORE any
 *     send, and skipped honestly (never silently "succeeds").
 *  4. Quiet hours — per the issue's own scoping, only email is a live send
 *     path here (SMS/voice quiet-hours logic is explicitly NOT built
 *     speculatively for a channel this change doesn't trigger — see the
 *     issue's "Quiet hours" section). If a future change wires
 *     `contact_founder_for_feedback` (SMS/call) into this same policy, real
 *     quiet-hours-by-recipient-timezone logic MUST be added before that
 *     ships — a phone ringing/texting at 3am is real-world harm, not a UX
 *     nit, unlike an email landing in an inbox overnight.
 */

import { resolveApp, type AppEntry } from '@/lib/build/app-registry'
import { sendCompanyEmail } from '@/lib/build/company-email'
import { checkFrequencyCap, recordFrequencyCapHit } from '@/lib/build/frequency-cap'
import type { NightlyRunResult } from '@/lib/build/autonomous-loop'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

/** No more than one proactive comms email per company within this window. */
const COMMS_FREQUENCY_WINDOW_MS = Number(process.env.COMMS_FREQUENCY_WINDOW_MS || 24 * 60 * 60 * 1000)

function frequencyCapKey(companyId: string): string {
  return `nightly-comms:${companyId}`
}

export type CommsSkipReason =
  | 'opted_out'
  | 'no_genuine_update'
  | 'rate_limited'
  | 'no_founder_email'
  | 'company_not_found'
  | 'send_failed'

export interface CommsOutreachResult {
  status: 'sent' | 'skipped'
  reason?: CommsSkipReason
  emailId?: string
}

/**
 * The real signal: is there something genuine to tell the founder tonight?
 * Never fabricates content — grounded entirely in the REAL NightlyRunResult
 * the swarm dispatch already produced. Pure + unit-testable.
 */
export function hasGenuineUpdate(result: NightlyRunResult): boolean {
  return result.status === 'dispatched' && Boolean(result.taskId)
}

/**
 * Compose the actual email content — grounded in the real run result, never
 * invented. Includes a link back to the Live dashboard (#857 — real customer
 * feedback, Greg Rose: "It would be great if the emails included a link to
 * that project so I could just click and go there") so the founder can jump
 * straight back in instead of navigating to the site and finding their
 * company again.
 */
export function buildOutreachEmail(
  companyId: string,
  companyName: string,
  result: NightlyRunResult,
): { subject: string; text: string } {
  const subject = `Cody's overnight update on ${companyName}`
  const lines = [
    `Hey — Cody here with a quick update on ${companyName}.`,
    '',
    `Last night's run queued a task for the swarm (id: ${result.taskId}).`,
  ]
  if (result.briefing) {
    lines.push('', `Briefing that informed the run:`, result.briefing)
  }
  const url = `${APP_URL}/build?screen=live&company=${encodeURIComponent(companyId)}`
  lines.push('', `Jump back in: ${url}`, '', `— Cody`)
  return { subject, text: lines.join('\n') }
}

/**
 * Decide whether to reach out about tonight's run, and if so, send it.
 * Checks — in order, each an honest early-exit, never a fabricated success:
 *   1. Company resolves in the registry (need a real founder email + name).
 *   2. Opt-out (`commsOptOut`) is not set.
 *   3. There's a genuine update to report (`hasGenuineUpdate`).
 *   4. The per-company frequency cap allows it.
 * Only once all four pass does this call `sendCompanyEmail`. Best-effort at
 * the very top of the call stack too — a hiccup here must never break the
 * nightly loop's own swarm-dispatch/report/media/task-resolution pipeline.
 */
export async function runNightlyCommsOutreach(
  companyId: string,
  companyName: string,
  result: NightlyRunResult,
): Promise<CommsOutreachResult> {
  try {
    const app: AppEntry | null = await resolveApp(companyId)
    if (!app) return { status: 'skipped', reason: 'company_not_found' }

    if (app.commsOptOut) return { status: 'skipped', reason: 'opted_out' }

    if (!hasGenuineUpdate(result)) return { status: 'skipped', reason: 'no_genuine_update' }

    const founderEmail = (app.ownerEmail || '').trim()
    if (!founderEmail) return { status: 'skipped', reason: 'no_founder_email' }

    const cap = checkFrequencyCap(frequencyCapKey(companyId), COMMS_FREQUENCY_WINDOW_MS)
    if (!cap.ok) return { status: 'skipped', reason: 'rate_limited' }

    const { subject, text } = buildOutreachEmail(companyId, companyName, result)
    const sendResult = await sendCompanyEmail(companyName, founderEmail, subject, '', text)
    if (!sendResult.ok) return { status: 'skipped', reason: 'send_failed' }

    // Only consume the cap on a CONFIRMED send — a failed send must not burn
    // the company's once-per-window allowance.
    recordFrequencyCapHit(frequencyCapKey(companyId))
    return { status: 'sent', emailId: sendResult.id }
  } catch {
    // Never break the nightly loop over a comms hiccup.
    return { status: 'skipped', reason: 'send_failed' }
  }
}
