/**
 * One-shot completeness-gate backlog backfill sweep (#1990).
 *
 * THE BUG THIS REPAIRS
 * `findMissingLocalImports()`/`findUndeclaredJsxComponents()` (lib/build/
 * completeness-gate.ts) only ever run against a generation at the moment
 * `checkAppReady()` (lib/build/ready-gate.ts) gates it before persistence.
 * Nothing re-checks a company's CURRENT durable code after that — a company
 * generated before the completeness gate existed (or before it was wired
 * into a given code path) can ship with a truncated multi-file payload (a
 * local import with no matching definition anywhere in the payload, or a
 * JSX tag used but never imported) and sit live, broken, indefinitely.
 *
 * Confirmed live (#1990): real company "Agentive" (slug
 * `a-community-of-marketers-focused-on-agent-led-vA8NFX`, generated
 * 2026-09-22, predating this gate's rollout) imports `TrainingPanel`,
 * `CommunityPanel`, and `SponsorsPanel` in its durable `App.tsx` — none of
 * the three exist anywhere in its persisted files. `stubMissingLocalComponents()`
 * keeps the preview from crashing, but 3 of the app's 5 real sidebar nav
 * destinations render a permanently empty panel with no error at all.
 *
 * WHAT THIS SWEEP DOES
 * For every live (non-deleted) registered company, load its CURRENT durable
 * generation code (the same source `/api/generation/{id}/files` serves), run
 * `findMissingLocalImports()`/`findUndeclaredJsxComponents()` against it —
 * the exact same pure detectors `checkAppReady()` already uses at generation
 * time — and `createTask()` a plain `todo` row for any company with an
 * unresolved gap that doesn't already have one. Same scope-key/title/detail
 * shape `runObedienceBackfillSweep()` (#1954/PR #1955, merged) uses, so the
 * existing Gitea resolver pipeline (task-resolver.ts, #905) picks it up
 * exactly the same way.
 *
 * ALSO RUNS `findTruncatedFiles()` (#2013) — a STRICT per-file Babel parse,
 * catching the class neither import/JSX-shape detector can see: a file that
 * got cut off mid-statement (no closing brace, no export, nothing left to
 * import or render) rather than one that imports/renders something missing.
 * Real repro: company "luminary" (chatId xW3lIi44cTNLYsOdeOUzj),
 * `ContactFormSection.tsx` ends right after `e.preventDefault();` with no
 * return/JSX/export at all — `findMissingLocalImports`/
 * `findUndeclaredJsxComponents` both report that file clean, since it
 * declares no local import and uses no undeclared JSX tag; it just stops.
 *
 * WHY A ONE-SHOT SWEEP AND NOT A CRON (same posture as obedience-backfill.ts)
 * There is no way to tell from this script alone whether a company's gap is
 * "new since last swept" without re-running, so this is a reviewed,
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
 *  - NEVER RE-CHECKS A DELETED COMPANY. Same `isDeleted` gate as
 *    obedience-backfill.ts / zerodb-key-backfill.ts.
 *  - A FAILED REGISTRY READ IS NOT "NO COMPANIES NEED FIXING" (core#7395) —
 *    reported as `registryOk: false`, sweep does nothing.
 *  - CAPPED per run — each filed task is a real write plus the resolver
 *    pipeline's own real Gitea issue creation downstream, so an unbounded
 *    run is not an acceptable failure mode for a filter bug.
 */

import { listAllAppsWithStatus, type AppEntry } from '@/lib/build/app-registry'
import { loadGeneration } from '@/lib/zerodb-store'
import {
  findMissingLocalImports,
  findUndeclaredJsxComponents,
  findTruncatedFiles,
} from '@/lib/build/completeness-gate'
import { createTask, listTasksForCompany } from '@/lib/build/task-store'
import { chatScopeKey } from '@/lib/build/chat-store'

/** Same posture as MAX_TASKS_FILED_PER_RUN in obedience-backfill.ts. */
export const MAX_TASKS_FILED_PER_RUN = 50

export type CompletenessBackfillDisposition =
  /** No chatId on record — nothing to load code for. */
  | 'no_chat_id'
  /** Durable generation code could not be loaded (missing or read failure). */
  | 'no_code'
  /** Checked and clean — no missing imports / undeclared JSX found. */
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

export interface CompletenessBackfillCompanyResult {
  slug: string
  disposition: CompletenessBackfillDisposition
  missingImports?: string[]
  undeclaredJsx?: string[]
  truncatedFiles?: string[]
  reason?: string
}

export interface CompletenessBackfillSweepResult {
  ok: boolean
  dryRun: boolean
  registryOk: boolean
  checked: number
  gapsFound: number
  tasksFiled: number
  failed: number
  byDisposition: Record<string, number>
  results: CompletenessBackfillCompanyResult[]
}

function isDeleted(app: { lifecycleStatus?: string }): boolean {
  return (app.lifecycleStatus || 'active') === 'deleted'
}

/** Same message shape ready-gate.ts uses for these checks, so a reviewer recognizes it instantly. */
function firstReasonFor(missing: string[], undeclared: string[], truncated: string[]): string {
  if (missing.length > 0) {
    return `imported local module(s) never defined in the payload: ${missing.join(', ')}`
  }
  if (undeclared.length > 0) {
    return `undeclared JSX component(s) — used but never imported: ${undeclared.join(', ')}`
  }
  return `file(s) fail a strict parse — truncated/incomplete generation: ${truncated.join(', ')}`
}

/** Same title format as #1140/obedience-backfill.ts's createTask() calls, so idempotency matching works identically either way. */
function taskTitleFor(firstReason: string): string {
  return `Fix generation completeness gap: ${firstReason}`
}

function hasOpenTaskForReason(existing: { stage: string; title: string }[], firstReason: string): boolean {
  const title = taskTitleFor(firstReason)
  return existing.some(
    (t) => t.title === title && t.stage !== 'completed' && t.stage !== 'rejected' && t.stage !== 'failed',
  )
}

/**
 * Run the completeness-gate backlog backfill sweep.
 *
 * `dryRun` defaults to TRUE — same posture as every other backfill sweep in
 * this repo (obedience-backfill.ts, zerodb-key-backfill.ts, loop-winback.ts,
 * etc.): an accidental call must never create real backlog tasks / Gitea
 * issues against real founders' repos.
 *
 * `onlySlugs` scopes the run to named companies, matching
 * `scripts/backfill-zerodb-keys-args.ts`'s `--only` contract.
 */
export async function runCompletenessBackfillSweep(
  opts: { dryRun?: boolean; onlySlugs?: string[] } = {},
): Promise<CompletenessBackfillSweepResult> {
  const dryRun = opts.dryRun !== false
  const only = (opts.onlySlugs || []).map((s) => (s || '').trim()).filter(Boolean)
  const onlySet = only.length ? new Set(only) : null

  const empty = (registryOk: boolean): CompletenessBackfillSweepResult => ({
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
      '[completeness-backfill] ABORTED — company registry read failed. ' +
        'An empty result here is NOT "every company is clean"; re-run once the read recovers.',
    )
    return empty(false)
  }

  const results: CompletenessBackfillCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let checked = 0
  let gapsFound = 0
  let tasksFiled = 0
  let failed = 0

  const record = (r: CompletenessBackfillCompanyResult) => {
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
    const code = gen?.generatedCode || ''
    if (!code.trim()) {
      record({ slug, disposition: 'no_code' })
      continue
    }

    checked++

    const files = gen?.files ?? undefined
    const missing = findMissingLocalImports(code, files)
    const undeclared = findUndeclaredJsxComponents(code, files)
    const truncated = findTruncatedFiles(files)

    if (missing.length === 0 && undeclared.length === 0 && truncated.length === 0) {
      record({ slug, disposition: 'clean' })
      continue
    }

    gapsFound++
    const firstReason = firstReasonFor(missing, undeclared, truncated)

    if (dryRun) {
      record({
        slug,
        disposition: 'would_file_task',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
      })
      continue
    }

    const existing = await listTasksForCompany(slug)
    if (hasOpenTaskForReason(existing, firstReason)) {
      record({
        slug,
        disposition: 'already_tracked',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
      })
      continue
    }

    if (tasksFiled >= MAX_TASKS_FILED_PER_RUN) {
      record({
        slug,
        disposition: 'capped',
        reason: `per-run cap of ${MAX_TASKS_FILED_PER_RUN} reached — re-run to continue`,
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
      })
      continue
    }

    const detailLines = [
      ...missing.map((m) => `Missing local import definition: ${m}`),
      ...undeclared.map((u) => `Undeclared JSX component used but never imported: ${u}`),
      ...truncated.map((t) => `File fails a strict parse (truncated/incomplete generation): ${t}`),
    ]

    const scopeKey = chatScopeKey(app.ownerEmail || 'guest:anon', slug)
    const task = await createTask(scopeKey, {
      title: taskTitleFor(firstReason),
      detail: detailLines.join('\n'),
      stage: 'todo',
      source: 'cody',
    }).catch(() => null)

    if (!task) {
      failed++
      record({
        slug,
        disposition: 'file_failed',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
      })
      continue
    }

    tasksFiled++
    record({
      slug,
      disposition: 'filed_task',
      missingImports: missing,
      undeclaredJsx: undeclared,
      truncatedFiles: truncated,
    })
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
