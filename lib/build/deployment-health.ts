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
