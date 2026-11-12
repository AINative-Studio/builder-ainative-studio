/**
 * One-shot obedience-gate backlog backfill sweep (#1954).
 *
 * THE BUG THIS REPAIRS
 * `checkObedience()` (lib/build/obedience-gate.ts) only ever runs against a
 * company's code at the moment a chat session (app/api/chat-ws/route.ts) is
 * actively generating or re-prompting it. #1140 (merged 2026-10-20) wires a
 * `createTask()` call into that route's terminal `obFinal` block so a gap
 * found there becomes a real backlog item — but nothing ever re-checks a
 * company's CURRENT live code outside of that one moment. A company whose
 * last session predates #1140, or that simply has not had a new chat turn
 * since a gap was introduced, can ship with (or regress into) a real,
 * user-visible obedience gap that sits live and untracked indefinitely.
 *
 * Confirmed live (#1954): `wrench` and `beacon`'s production App.tsx/Hero.tsx
 * each have a waitlist/lead-capture form that silently drops every real
 * visitor's email forever (`fakeLeadCaptureGap`), verified by running this
 * repo's actual `checkObedience()` against their current generated files —
 * not a reimplementation or a guess.
 *
 * WHAT THIS SWEEP DOES
 * For every live (non-deleted) registered company, load its CURRENT
 * generated code (the same durable source `/api/generation/{id}/files`
 * serves), run `checkObedience()` against it, and `createTask()` a plain
 * `todo` row — same scope-key shape and same title/detail format #1140 uses
 * in chat-ws, so the existing Gitea resolver pipeline (task-resolver.ts,
 * #905) picks it up exactly the same way — for any company with an
 * unresolved gap that doesn't already have one.
 *
 * WHY A ONE-SHOT SWEEP AND NOT A CRON (same posture as zerodb-key-backfill.ts)
 * This repairs a backlog of companies whose last obedience check predates
 * either #1140 or the gate gaining a check it didn't have at generation
 * time. There is no way to tell from this script alone whether a company's
 * gap is "new since last swept" without re-running, so this is a reviewed,
 * re-runnable repair script — not a scheduled job — until a human decides
 * recurring re-scanning belongs in the nightly loop itself.
 *
 * SAFETY
 *  - DRY RUN BY DEFAULT. A real run creates real backlog tasks that the
 *    existing resolver pipeline turns into real Gitea issues on real
 *    founders' repos — `apply: false` is required to skip writing anything.
 *  - IDEMPOTENT. Before filing a task, checks the company's existing tasks
 *    (`listTasksForCompany`) for a non-terminal one already carrying the
 *    same first reason, so a re-run never piles up duplicate tasks for a
 *    gap that's already tracked.
 *  - NEVER RE-CHECKS A DELETED COMPANY. Same `isDeleted` gate as the
 *    zerodb-key-backfill sweep.
 *  - A FAILED REGISTRY READ IS NOT "NO COMPANIES NEED FIXING" (core#7395) —
 *    reported as `registryOk: false`, sweep does nothing.
 *  - CAPPED per run — each filed task is a real write plus the resolver
 *    pipeline's own real Gitea issue creation downstream, so an unbounded
 *    run is not an acceptable failure mode for a filter bug.
 */

import { listAllAppsWithStatus, type AppEntry } from '@/lib/build/app-registry'
import { loadGeneration } from '@/lib/zerodb-store'
import { checkObedience } from '@/lib/build/obedience-gate'
import { createTask, listTasksForCompany } from '@/lib/build/task-store'
import { openIssueForNewTask } from '@/lib/build/task-resolver'
import { chatScopeKey } from '@/lib/build/chat-store'

/** Same posture as MAX_BACKFILLS_PER_RUN in zerodb-key-backfill.ts. */
export const MAX_TASKS_FILED_PER_RUN = 50

export type ObedienceBackfillDisposition =
  /** No chatId on record — nothing to load code for. */
  | 'no_chat_id'
  /** Durable generation code could not be loaded (missing or read failure). */
  | 'no_code'
  /** Checked and clean — checkObedience() reported no gaps. */
  | 'clean'
  /** Has an unresolved gap, and a real run WOULD file a task (dry-run only). */
  | 'would_file_task'
  /** Has an unresolved gap, but a non-terminal task for it already exists. */
  | 'already_tracked'
  /** Has an unresolved gap; a new backlog task was filed. */
  | 'filed_task'
  /** Had an unresolved gap, task creation failed. */
  | 'file_failed'
  /** Would have filed a task, but the per-run cap was already reached. */
  | 'capped'

export interface ObedienceBackfillCompanyResult {
  slug: string
  disposition: ObedienceBackfillDisposition
  reasons?: string[]
  reason?: string
}

export interface ObedienceBackfillSweepResult {
  ok: boolean
  dryRun: boolean
  registryOk: boolean
  checked: number
  gapsFound: number
  tasksFiled: number
  failed: number
  byDisposition: Record<string, number>
  results: ObedienceBackfillCompanyResult[]
}

function isDeleted(app: { lifecycleStatus?: string }): boolean {
  return (app.lifecycleStatus || 'active') === 'deleted'
}

/**
 * Build the same code string a multi-file generation presents to
 * `checkObedience()` at generation time: every persisted file concatenated
 * with a `// FILE:` marker, falling back to the single-file blob when no
 * durable files map was ever persisted (older / single-file generations).
 */
function codeForObedienceCheck(gen: {
  generatedCode?: string
  files?: Record<string, string> | null
}): string {
  if (gen.files && Object.keys(gen.files).length > 0) {
    return Object.entries(gen.files)
      .filter(([path]) => path.endsWith('.ts') || path.endsWith('.tsx'))
      .map(([path, content]) => `// FILE: ${path}\n${content}`)
      .join('\n\n')
  }
  return gen.generatedCode || ''
}

/** Same title format #1140's chat-ws createTask() call uses, so idempotency matching works identically either way. */
function taskTitleFor(firstReason: string): string {
  return `Fix generation compliance gap: ${firstReason}`
}

function hasOpenTaskForReason(existing: { stage: string; title: string }[], firstReason: string): boolean {
  const title = taskTitleFor(firstReason)
  return existing.some(
    (t) => t.title === title && t.stage !== 'completed' && t.stage !== 'rejected' && t.stage !== 'failed',
  )
}

/**
 * Run the obedience-gate backlog backfill sweep.
 *
 * `dryRun` defaults to TRUE — same posture as every other backfill sweep in
 * this repo (zerodb-key-backfill.ts, loop-winback.ts, etc.): an accidental
 * call must never create real backlog tasks / Gitea issues against real
 * founders' repos.
 *
 * `onlySlugs` scopes the run to named companies, matching
 * `scripts/backfill-zerodb-keys-args.ts`'s `--only` contract.
 */
export async function runObedienceBackfillSweep(
  opts: { dryRun?: boolean; onlySlugs?: string[] } = {},
): Promise<ObedienceBackfillSweepResult> {
  const dryRun = opts.dryRun !== false
  const only = (opts.onlySlugs || []).map((s) => (s || '').trim()).filter(Boolean)
  const onlySet = only.length ? new Set(only) : null

  const empty = (registryOk: boolean): ObedienceBackfillSweepResult => ({
    ok: true,
    dryRun,
    registryOk,
    checked: 0,
    gapsFound: 0,
    tasksFiled: 0,
    failed: 0,
    byDisposition: {},
    results: [],
  })

  const { apps, ok: registryOk } = await listAllAppsWithStatus()
  if (!registryOk) {
    console.error(
      '[obedience-backfill] ABORTED — company registry read failed. ' +
        'An empty result here is NOT "every company is clean"; re-run once the read recovers.',
    )
    return empty(false)
  }

  const results: ObedienceBackfillCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let checked = 0
  let gapsFound = 0
  let tasksFiled = 0
  let failed = 0

  const record = (r: ObedienceBackfillCompanyResult) => {
    results.push(r)
    byDisposition[r.disposition] = (byDisposition[r.disposition] || 0) + 1
  }

  for (const app of apps as AppEntry[]) {
    const slug = app.slug
    if (onlySet && !onlySet.has(slug)) continue
    if (isDeleted(app)) continue

    const chatId = (app.chatId || '').trim()
    if (!chatId) {
      record({ slug, disposition: 'no_chat_id' })
      continue
    }

    let gen: Awaited<ReturnType<typeof loadGeneration>>
    try {
      gen = await loadGeneration(chatId)
    } catch (e: any) {
      record({ slug, disposition: 'no_code', reason: String(e?.message || e).slice(0, 160) })
      continue
    }
    const code = gen ? codeForObedienceCheck(gen) : ''
    if (!code.trim()) {
      record({ slug, disposition: 'no_code' })
      continue
    }

    checked++

    const idea = gen?.prompt || app.idea || slug
    // No reliable CompanyRole on record for an already-registered company —
    // irrelevant anyway: landingPageOnly skips the only check that reads it
    // (findPrimitiveComplianceGaps).
    const obedience = checkObedience(code, idea, undefined, { landingPageOnly: true })
    if (obedience.ok) {
      record({ slug, disposition: 'clean' })
      continue
    }

    gapsFound++
    const firstReason = obedience.reasons[0] || 'obedience-gate check failed'

    if (dryRun) {
      record({ slug, disposition: 'would_file_task', reasons: obedience.reasons })
      continue
    }

    const existing = await listTasksForCompany(slug)
    if (hasOpenTaskForReason(existing, firstReason)) {
      record({ slug, disposition: 'already_tracked', reasons: obedience.reasons })
      continue
    }

    if (tasksFiled >= MAX_TASKS_FILED_PER_RUN) {
      record({
        slug,
        disposition: 'capped',
        reason: `per-run cap of ${MAX_TASKS_FILED_PER_RUN} reached — re-run to continue`,
        reasons: obedience.reasons,
      })
      continue
    }

    const scopeKey = chatScopeKey(app.ownerEmail || 'guest:anon', slug)
    const task = await createTask(scopeKey, {
      title: taskTitleFor(firstReason),
      detail: obedience.reasons.join('\n'),
      stage: 'todo',
      source: 'cody',
    }).catch(() => null)

    if (!task) {
      failed++
      record({ slug, disposition: 'file_failed', reasons: obedience.reasons })
      continue
    }

    // #1973-class gap: open this task's real Gitea issue now rather than
    // leaving it to a future tier-capped nightly resolveTask() pass — the
    // same fix #1928 already applied to every other createTask() call site
    // that wasn't resolveTask() itself. Best-effort; a filed task is still a
    // real win even if this fails or the company has no gitOrg yet.
    void openIssueForNewTask(scopeKey, app.gitOrg, slug, task)

    tasksFiled++
    record({ slug, disposition: 'filed_task', reasons: obedience.reasons })
  }

  return {
    ok: true,
    dryRun,
    registryOk: true,
    checked,
    gapsFound,
    tasksFiled,
    failed,
    byDisposition,
    results,
  }
}
