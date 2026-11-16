/**
 * One-shot metadata-freshness backlog backfill sweep.
 *
 * THE GAP THIS REPAIRS
 * `extractAppMetadata()` (lib/ainative-file-generator.ts) had two confirmed,
 * now-fixed bugs — #1952 (literal "this" company name) and #2024 (every
 * non-ecommerce company mislabeled "Ecommerce Application") — that together
 * produced a broken `<title>`/OG/Twitter/metadataBase block in
 * `/app/layout.tsx` for a large share of generated companies. Both fixes
 * landed in the generator, but a generator fix only ever applies to a NEW
 * generation or regeneration — nothing ever re-checks a company's CURRENT
 * persisted `/app/layout.tsx` outside that moment, so a company generated
 * before either fix (and not regenerated since) ships with a permanently
 * broken browser-tab title, SEO description, and social-share card. Sampling
 * wrench/lumeo/shingle's live production files on 2026-11-15 (days after
 * both fixes merged) confirms all three still serve the broken metadata —
 * see lib/build/metadata-gate.ts's doc comment for the full incident
 * history.
 *
 * WHAT THIS SWEEP DOES
 * For every live (non-deleted) registered company, load its CURRENT durable
 * `/app/layout.tsx` and run checkMetadataFreshness() (lib/build/metadata-gate.ts)
 * against it using the company's own real prompt/code — the same
 * `checkObedience()`-style real-function, no-reimplementation approach
 * obedience-backfill.ts uses — and `createTask()` a plain `todo` row per
 * distinct, unresolved reason, same scope-key shape and same title/detail
 * format #1140/obedience-backfill.ts use, so the existing Gitea resolver
 * pipeline (task-resolver.ts, #905) picks it up exactly the same way.
 *
 * SAFETY — same posture as obedience-backfill.ts / zerodb-key-backfill.ts:
 *  - DRY RUN BY DEFAULT. `apply: false` is required to skip writing anything.
 *  - IDEMPOTENT PER REASON. Never re-files a reason that already has a
 *    non-terminal task tracking it for that company.
 *  - NEVER RE-CHECKS A DELETED COMPANY.
 *  - A FAILED REGISTRY READ IS NOT "NO COMPANIES NEED FIXING" (core#7395) —
 *    reported as `registryOk: false`, sweep does nothing.
 *  - CAPPED per run, globally across reasons, not per company — a filed task
 *    is a real write plus the resolver pipeline's own real Gitea issue
 *    creation downstream.
 *  - Never regenerates or overwrites a company's code directly — this only
 *    ever files a backlog task and lets the EXISTING, reviewed
 *    resolveTask() pipeline (LLM-implement → Gitea commit+PR → coverage
 *    verify) make the actual change, same as every other gap this loop's
 *    backfills track.
 */

import { listAllAppsWithStatus, type AppEntry } from '@/lib/build/app-registry'
import { loadGeneration } from '@/lib/zerodb-store'
import { checkMetadataFreshness } from '@/lib/build/metadata-gate'
import { createTask, listTasksForCompany } from '@/lib/build/task-store'
import { openIssueForNewTask } from '@/lib/build/task-resolver'
import { chatScopeKey } from '@/lib/build/chat-store'

/** Same posture as MAX_TASKS_FILED_PER_RUN in obedience-backfill.ts. */
export const MAX_TASKS_FILED_PER_RUN = 50

export type MetadataBackfillDisposition =
  | 'no_chat_id'
  | 'no_code'
  | 'clean'
  | 'would_file_task'
  | 'already_tracked'
  | 'filed_task'
  | 'file_failed'
  | 'capped'

export interface MetadataBackfillCompanyResult {
  slug: string
  disposition: MetadataBackfillDisposition
  reasons?: string[]
  reason?: string
}

export interface MetadataBackfillSweepResult {
  ok: boolean
  dryRun: boolean
  registryOk: boolean
  checked: number
  gapsFound: number
  tasksFiled: number
  failed: number
  byDisposition: Record<string, number>
  results: MetadataBackfillCompanyResult[]
}

function isDeleted(app: { lifecycleStatus?: string }): boolean {
  return (app.lifecycleStatus || 'active') === 'deleted'
}

/** Same code-concatenation shape codeForObedienceCheck() in obedience-backfill.ts uses. */
function codeForMetadataCheck(gen: {
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

function layoutTsFor(gen: { files?: Record<string, string> | null }): string {
  return gen.files?.['/app/layout.tsx'] || ''
}

/** Same title format #1140/obedience-backfill.ts use, so idempotency matching works identically. */
function taskTitleFor(reason: string): string {
  return `Fix generation compliance gap: ${reason}`
}

function hasOpenTaskForReason(existing: { stage: string; title: string }[], reason: string): boolean {
  const title = taskTitleFor(reason)
  return existing.some(
    (t) => t.title === title && t.stage !== 'completed' && t.stage !== 'rejected' && t.stage !== 'failed',
  )
}

/**
 * Run the metadata-freshness backlog backfill sweep.
 *
 * `dryRun` defaults to TRUE. `onlySlugs` scopes the run to named companies,
 * matching obedience-backfill.ts's / scripts/backfill-zerodb-keys-args.ts's
 * `--only` contract.
 */
export async function runMetadataBackfillSweep(
  opts: { dryRun?: boolean; onlySlugs?: string[] } = {},
): Promise<MetadataBackfillSweepResult> {
  const dryRun = opts.dryRun !== false
  const only = (opts.onlySlugs || []).map((s) => (s || '').trim()).filter(Boolean)
  const onlySet = only.length ? new Set(only) : null

  const empty = (registryOk: boolean): MetadataBackfillSweepResult => ({
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
      '[metadata-backfill] ABORTED — company registry read failed. ' +
        'An empty result here is NOT "every company is clean"; re-run once the read recovers.',
    )
    return empty(false)
  }

  const results: MetadataBackfillCompanyResult[] = []
  const byDisposition: Record<string, number> = {}
  let checked = 0
  let gapsFound = 0
  let tasksFiled = 0
  let failed = 0

  const record = (r: MetadataBackfillCompanyResult) => {
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
    const layoutTs = gen ? layoutTsFor(gen) : ''
    if (!layoutTs.trim()) {
      // No persisted /app/layout.tsx on record — single-file-only generations
      // never had one; nothing to check.
      record({ slug, disposition: 'no_code' })
      continue
    }

    checked++

    const idea = gen?.prompt || app.idea || slug
    const code = gen ? codeForMetadataCheck(gen) : ''
    const freshness = checkMetadataFreshness(idea, code, layoutTs)
    if (!freshness.stale) {
      record({ slug, disposition: 'clean' })
      continue
    }

    gapsFound++
    const reasons = freshness.reasons

    if (dryRun) {
      record({ slug, disposition: 'would_file_task', reasons })
      continue
    }

    const existing = await listTasksForCompany(slug)
    const filedThisPass = new Set<string>()
    let anyFiled = false
    let anyCapped = false
    let anyFailed = false

    for (const reason of reasons) {
      const title = taskTitleFor(reason)
      if (filedThisPass.has(title) || hasOpenTaskForReason(existing, reason)) {
        continue
      }

      if (tasksFiled >= MAX_TASKS_FILED_PER_RUN) {
        anyCapped = true
        continue
      }

      const scopeKey = chatScopeKey(app.ownerEmail || 'guest:anon', slug)
      const task = await createTask(scopeKey, {
        title,
        detail: reason,
        stage: 'todo',
        source: 'cody',
      }).catch(() => null)

      if (!task) {
        anyFailed = true
        failed++
        continue
      }

      void openIssueForNewTask(scopeKey, app.gitOrg, slug, task)

      tasksFiled++
      anyFiled = true
      filedThisPass.add(title)
    }

    const disposition: MetadataBackfillDisposition = anyFailed
      ? 'file_failed'
      : anyFiled
        ? 'filed_task'
        : anyCapped
          ? 'capped'
          : 'already_tracked'
    record({
      slug,
      disposition,
      reasons,
      ...(anyCapped && !anyFiled && !anyFailed
        ? { reason: `per-run cap of ${MAX_TASKS_FILED_PER_RUN} reached — re-run to continue` }
        : {}),
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
