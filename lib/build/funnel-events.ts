/**
 * Funnel event storage (#BLD-06.12) — a small, purpose-built ZeroDB table
 * for the two aggregate numbers the epic asks for (share of ventures
 * reaching the last step, time from first artifact to last step) that
 * GA4's UI doesn't expose cheaply to this team today. Mirrors the
 * ensureTable-then-write idempotent-create pattern already established in
 * lib/build/otp.ts — never a different persistence mechanism for the same
 * class of problem.
 *
 * Real scope (confirmed by direct code investigation, 2026-10-06): of the
 * 6 events the backlog doc names, idea_submitted is already instrumented
 * via the existing trackEvent() GA wiring (components/build/screens/
 * Intake.tsx), and kickoff_answered/question_answered/save have no real
 * call site yet — their parent features (kickoff questions, guided
 * mid-build Q&A, save/restore) are Epic 3/later-Epic-2 work not yet
 * built. Only step_viewed and last_step_reached are wired against real
 * UI in this pass; this module's type still names all 6 so later work
 * can wire the rest without a signature change.
 */
import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const FUNNEL_TABLE = 'builder_funnel_events'

export type FunnelEvent =
  | 'idea_submitted' | 'kickoff_answered' | 'step_viewed'
  | 'question_answered' | 'save' | 'last_step_reached'

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

async function ensureFunnelTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ table_name: FUNNEL_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* table might already exist */ }
}

/** Record a funnel event. Best-effort, fire-and-forget -- never blocks or
 * throws past the real UI action it's attached to. */
export async function recordFunnelEvent(
  event: FunnelEvent,
  opts: { companyId?: string | null; track: 'app' | 'company'; step: string },
): Promise<void> {
  if (!configured()) return
  await ensureFunnelTable()
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${FUNNEL_TABLE}/rows`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        row_data: {
          event, companyId: opts.companyId ?? null, track: opts.track, step: opts.step,
          timestamp: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch { /* best-effort — a missed funnel event is never worth blocking the UI over */ }
}
