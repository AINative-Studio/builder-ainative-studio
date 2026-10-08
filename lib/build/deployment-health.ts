/**
 * Deployment-health stage reporting (builder-ainative-studio#868, #870).
 *
 * core#6925 built a generic, auth-required stage-reporting API. Two separate
 * Builder pipelines produce/modify apps and both were found unwired:
 *
 *  - resolveTask() (lib/build/task-resolver.ts, #868): the backlog-task
 *    auto-resolution pipeline (nightly loop + chat-triggered edits). Reports
 *    under entity_type "builder_company_task", entity_id = the BuildTask id.
 *  - register-app / company-app routes (#870): the real App-track and
 *    Company-track app-GENERATION pipelines — the dominant real traffic,
 *    confirmed via core#6927's investigation to have been the reason
 *    deployment_health_stages still had 0 rows even after #868 shipped.
 *    Reports under entity_type "builder_app_generation", entity_id = slug
 *    (the one identifier both routes have in scope, unlike chat-ws itself
 *    which only ever knows a chatId — see #870's own investigation for why
 *    chat-ws is not the right place to hook this).
 *
 * Auth: neither pipeline reliably has a founder JWT in scope (resolveTask()
 * runs from the unattended nightly loop; register-app/company-app run before
 * or independent of any billing/session gate). The endpoint accepts either a
 * JWT or an X-API-Key (core's get_current_user_flexible), so this uses the
 * same service-level AINative API key app-registry.ts already uses for
 * Builder's own infrastructure writes (builder_app_registry) — rows are
 * attributed to whichever AINative account owns that key, which is correct
 * here since this reports on Builder's own pipelines, not founder-supplied
 * data.
 *
 * Best-effort throughout, matching the existing startDecisionTrace/
 * addTraceStep pattern in task-resolver.ts: a reporting-call failure must
 * NEVER affect the real pipeline outcome it's called from.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()

export type DeploymentHealthEntityType = 'builder_company_task' | 'builder_app_generation'
export type DeploymentHealthStage =
  | 'implement' | 'commit' | 'coverage' | 'merge' | 'deploy' // resolveTask() stages
  | 'generate' | 'ready_check' | 'register' | 'git_commit'   // app-generation stages
export type DeploymentHealthStatus = 'ok' | 'failed' | 'skipped'

/**
 * Report one stage outcome for a builder entity (a backlog task or an app
 * generation). Never throws — a reporting failure is swallowed so it can
 * never affect the real pipeline outcome the caller already computed.
 */
export async function reportDeploymentHealthStage(
  entityType: DeploymentHealthEntityType,
  entityId: string,
  stage: DeploymentHealthStage,
  taskStatus: DeploymentHealthStatus,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!API_KEY || !entityId) return

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      await fetch(
        `${AINATIVE_API}/api/v1/public/deployment-health/${entityType}/${encodeURIComponent(entityId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'X-API-Key': API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ stage, status: taskStatus, reason, metadata }),
          signal: controller.signal,
        },
      )
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Best-effort — never let a reporting hiccup affect the real pipeline.
  }
}

// ---------------------------------------------------------------------------
// Reading stages back (#1015)
// ---------------------------------------------------------------------------

/**
 * One stage row as core returns it on the GET side of the same endpoint.
 * Shape captured live from
 * `GET /api/v1/public/deployment-health/builder_app_generation/flo`:
 *   { id, entity_type, entity_id, stage, status, reason, metadata, user_id,
 *     created_at }
 * Only the fields this module actually reasons about are typed as required.
 */
export interface DeploymentHealthStageRow {
  stage: string
  status: string
  reason?: string | null
  created_at?: string
  metadata?: Record<string, unknown> | null
}

export interface DeploymentHealthRead {
  /**
   * TRUE only when core genuinely answered with a parseable stage list.
   *
   * This distinction is the whole point: "we could not read the stages" must
   * never be indistinguishable from "the stages are confirmed absent." The
   * registration reconciler acts on ABSENCE (re-driving a company's ready-gate
   * and git commit), so a network blip reported as an empty success would hand
   * it a licence to re-drive every company on the platform — the exact
   * false-confirmed-miss class resolveAppVerified() had to fix for the
   * registry read.
   */
  ok: boolean
  stages: DeploymentHealthStageRow[]
}

/**
 * Read back the real recorded stages for one builder entity.
 *
 * There is no list/summary variant of this endpoint (verified live: requesting
 * `.../builder_app_generation/summary` just returns an entity literally named
 * "summary" with zero stages), so callers that need to sweep must enumerate
 * candidates from the registry and call this per slug — see
 * lib/build/registration-reconcile.ts.
 *
 * Never throws. Returns `ok: false` on any failure, including a malformed
 * body, so a caller can tell an unverified read from a verified-empty one.
 */
export async function fetchDeploymentHealthStages(
  entityType: DeploymentHealthEntityType,
  entityId: string,
): Promise<DeploymentHealthRead> {
  if (!API_KEY || !entityId) return { ok: false, stages: [] }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(
        `${AINATIVE_API}/api/v1/public/deployment-health/${entityType}/${encodeURIComponent(entityId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'X-API-Key': API_KEY,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        },
      )
      if (!res.ok) return { ok: false, stages: [] }
      const body = (await res.json().catch(() => null)) as { stages?: unknown } | null
      if (!body || !Array.isArray(body.stages)) return { ok: false, stages: [] }
      return { ok: true, stages: body.stages as DeploymentHealthStageRow[] }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { ok: false, stages: [] }
  }
}

/**
 * What a company's app-generation stage set says about whether its
 * registration pipeline actually FINISHED.
 *
 *  - `stuck`             — the #1015 bug class. `generate` is ok, but the
 *                          ready-gate never adjudicated this app at all. The
 *                          code exists; nothing verified or committed it.
 *  - `complete`          — `ready_check` already ran. Nothing to re-drive.
 *  - `never_generated`   — no successful `generate` stage. NOT this bug class:
 *                          there is no generated code to verify or commit, so
 *                          re-driving would invent work, not finish it.
 *  - `generation_failed` — `generate` itself failed. Same reasoning.
 *  - `ready_check_failed`— the gate ran and genuinely REJECTED the app. Already
 *                          adjudicated; repair/regeneration is a different path
 *                          (/api/build/repair-app), not reconciliation.
 *  - `unverifiable`      — the read failed. Fail closed, always.
 */
export type RegistrationHealthDisposition =
  | 'stuck'
  | 'complete'
  | 'never_generated'
  | 'generation_failed'
  | 'ready_check_failed'
  | 'unverifiable'

export function classifyRegistrationHealth(read: DeploymentHealthRead): RegistrationHealthDisposition {
  if (!read.ok) return 'unverifiable'

  const has = (stage: string, status?: string) =>
    read.stages.some((s) => s.stage === stage && (status === undefined || s.status === status))

  // `ready_check` existing at all — ok OR failed — means the gate genuinely ran
  // for this company, so there is nothing unfinished for the reconciler to
  // re-drive. Distinguish the two only to report honestly.
  if (has('ready_check', 'failed')) return 'ready_check_failed'
  if (has('ready_check')) return 'complete'

  // git_commit without ready_check shouldn't happen (register-app reports the
  // gate first), but if it did, the route demonstrably ran — treat as complete
  // rather than re-committing someone's code a second time.
  if (has('git_commit')) return 'complete'

  if (!has('generate')) return 'never_generated'
  if (!has('generate', 'ok')) return 'generation_failed'

  // generate is ok and the ready gate never adjudicated: exactly Flo.
  return 'stuck'
}
