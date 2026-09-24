/**
 * Deployment-health stage reporting (builder-ainative-studio#868).
 *
 * core#6925 built a generic, auth-required stage-reporting API specifically
 * so resolveTask() (lib/build/task-resolver.ts) could report its real
 * pipeline stages (implement -> commit -> coverage -> merge -> deploy)
 * somewhere queryable, instead of only a free-text `output` string on one
 * BuildTask row. That wiring was scoped as a follow-up in #6925 but never
 * built — deployment_health_stages had 0 rows in production 3+ weeks after
 * shipping because nothing ever called it. This is that follow-up.
 *
 * Auth: resolveTask() runs both from the unattended nightly loop (no founder
 * session/JWT exists there — see task-resolution-loop.ts) and from an
 * authenticated founder request (edit-app/route.ts). The endpoint accepts
 * either a JWT or an X-API-Key (core's get_current_user_flexible), so this
 * uses the same service-level AINative API key app-registry.ts already uses
 * for Builder's own infrastructure writes (builder_app_registry) — the row
 * is attributed to whichever AINative account owns that key, which is
 * correct here since this reports on Builder's own pipeline, not founder-
 * supplied data.
 *
 * Best-effort throughout, matching the existing startDecisionTrace/
 * addTraceStep pattern in task-resolver.ts: a reporting-call failure must
 * NEVER affect the real task resolution outcome.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()

export type DeploymentHealthStage = 'implement' | 'commit' | 'coverage' | 'merge' | 'deploy'
export type DeploymentHealthStatus = 'ok' | 'failed' | 'skipped'

/**
 * Report one stage outcome for a builder company task. Never throws — a
 * reporting failure is swallowed so it can never affect the real resolution
 * outcome resolveTask() already computed.
 */
export async function reportDeploymentHealthStage(
  taskId: string,
  stage: DeploymentHealthStage,
  taskStatus: DeploymentHealthStatus,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!API_KEY || !taskId) return

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      await fetch(
        `${AINATIVE_API}/api/v1/public/deployment-health/builder_company_task/${encodeURIComponent(taskId)}`,
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
