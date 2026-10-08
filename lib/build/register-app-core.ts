/**
 * The two pipeline steps that turn generated code into a REAL, verified,
 * committed application — extracted from `POST /api/build/register-app`
 * (#1015) so a server-side reconciliation pass can run the identical logic.
 *
 * WHY THIS FILE EXISTS
 * register-app's POST handler is the ONLY place in the codebase that runs the
 * pre-deploy ready gate (`checkAppReady`) and the git commit
 * (`commitRegeneration`/`provisionCompanyRepo`), and it is itself called from
 * exactly ONE place: a client-side `useEffect` in
 * components/build/artifacts/Preview.tsx, gated on local React state. If the
 * founder's tab closes, generation stalls before `status` flips to 'ready', or
 * a network blip drops the request, those two steps never run server-side for
 * that company — ever. The live case (#1015, company "Flo"): core's
 * deployment-health telemetry shows `generate: ok` and `register: ok` and NO
 * `ready_check` / `git_commit` rows at all, and the founder's live page renders
 * nothing of their actual idea.
 *
 * WHY EXTRACTION RATHER THAN AN INTERNAL FETCH BACK INTO THE ROUTE
 * The route's handler does considerably more than these two steps, and the rest
 * of it is actively wrong to re-run for an hours-old company with no founder
 * session in scope:
 *  - `auth()` drives both owner resolution and the slug-collision decision. A
 *    sweep is unauthenticated, so `callerIsOwner` is false and a slug whose
 *    chatId no longer matches gets auto-suffixed to `{slug}-2` — the exact
 *    Meridian bug the route's own comments document, except this time it would
 *    be inflicted on a live, shareable URL.
 *  - `sendWelcomeEmail` would re-greet a founder who signed up hours ago.
 *  - `deployPersistent` and `enrollCompany` re-fire side effects that already
 *    succeeded (the `register: ok` stage proves it).
 * The two things a stuck company is genuinely missing are the gate and the
 * commit. Those are the two things this module owns, and both the route and the
 * reconciler call it — so the client-triggered path and the server-side repair
 * path can never drift apart.
 *
 * Every function here keeps the route's original failure posture verbatim:
 * the gate FAILS OPEN on an unverifiable app (a store outage must never block a
 * legitimate build) and only BLOCKS on proven-broken code; the commit is
 * strictly best-effort and never throws at its caller.
 */

import { checkAppReady, resolveStoredApp, type ReadyCheck } from '@/lib/build/ready-gate'
import { commitRegeneration, provisionCompanyRepo, toFileMapForCommit } from '@/lib/git/company-repo'
import { BUILDER_WORKSPACE_ID } from '@/lib/build/instant-db'
import { reportDeploymentHealthStage } from '@/lib/build/deployment-health'

/** Extra store-miss re-checks before an unverifiable app is accepted. */
const READY_GATE_RETRIES = 3
const READY_GATE_RETRY_DELAY_MS = 2000

export interface ReadyGateResult {
  /** The final gate verdict. */
  ready: ReadyCheck
  /** True only when the gate has REAL proof the app is broken. */
  blocked: boolean
}

/**
 * Run the pre-deploy parse gate for one app and report the `ready_check` stage.
 *
 * Store-miss RETRY (the aerosol root cause, 2026-08-27): register can race the
 * durable persist — a store miss fail-opened and a truncated app got registered
 * while its code was still landing. Re-check up to 3× before accepting an
 * unverifiable app; genuine store outages still fail open.
 *
 * Reports `ready_check` ONLY when the gate actually reached a verdict. An
 * unverifiable app reports nothing rather than a fabricated `ok` — which also
 * keeps it visible to the reconciler as still-unfinished work.
 */
export async function runReadyGate(
  slug: string,
  chatId: string,
  opts: { retryDelayMs?: number } = {},
): Promise<ReadyGateResult> {
  const delay = opts.retryDelayMs ?? READY_GATE_RETRY_DELAY_MS
  const unverifiable = { checked: false, ok: true } as ReadyCheck

  let ready = await checkAppReady(chatId).catch(() => unverifiable)
  for (let i = 0; !ready.checked && i < READY_GATE_RETRIES; i++) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    ready = await checkAppReady(chatId).catch(() => unverifiable)
  }

  if (ready.checked && !ready.ok) {
    await reportDeploymentHealthStage('builder_app_generation', slug, 'ready_check', 'failed', ready.reason)
    return { ready, blocked: true }
  }
  if (ready.checked) {
    await reportDeploymentHealthStage('builder_app_generation', slug, 'ready_check', 'ok')
  }
  return { ready, blocked: false }
}

/** The registry fields the commit decision actually depends on. */
export interface GitCommitTargets {
  gitRepoId?: string
  zerodbProjectId?: string
}

export interface GitCommitResult {
  /** Whether a real commit/provision call was made (drives stage reporting). */
  attempted: boolean
  committed: boolean
}

/**
 * Commit a company's current generated code to its real git repo (#349),
 * provisioning the repo first if the company is provisioned but has none yet,
 * and report the `git_commit` stage.
 *
 * Reports NO stage when nothing was attempted — a free, unprovisioned company
 * legitimately has nowhere to commit, and recording a phantom `failed` there
 * would make a correct outcome look broken (and would keep re-triggering the
 * reconciler forever).
 *
 * Never throws: a Gitea hiccup is reported as an attempted failure, matching
 * the route's original best-effort posture.
 */
export async function runGitCommit(opts: {
  slug: string
  chatId: string
  existing: GitCommitTargets | null | undefined
  taskLabel?: string
}): Promise<GitCommitResult> {
  const { slug, chatId, existing, taskLabel } = opts
  let committed = false
  let attempted = false

  try {
    const stored = await resolveStoredApp(chatId)
    // Every real generated app that only has flat `.code` (a single-file app —
    // the majority case) used to be silently skipped here, because the original
    // guard only ever checked `.files` (the multi-file map, populated only for
    // Sandpack-routed generations). toFileMapForCommit falls back to a synthetic
    // single-entry map so single-file apps get git-provisioned/committed too.
    const fileMap = toFileMapForCommit(stored)
    if (fileMap) {
      if (existing?.gitRepoId) {
        attempted = true
        committed = await commitRegeneration({ slug, files: fileMap, taskLabel })
      } else if (existing?.zerodbProjectId) {
        attempted = true
        const git = await provisionCompanyRepo({
          workspaceId: BUILDER_WORKSPACE_ID,
          slug,
          files: fileMap,
        })
        committed = git.ok
      }
    }
  } catch (err) {
    console.warn(`[register-app-core] Git commit error for ${slug}:`, err)
    attempted = true
  }

  if (attempted) {
    await reportDeploymentHealthStage('builder_app_generation', slug, 'git_commit', committed ? 'ok' : 'failed')
  }
  return { attempted, committed }
}
