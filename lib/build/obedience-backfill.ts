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
 * #1951-class gap (found live, this run, the SAME sweep): a company almost
 * always has MULTIPLE simultaneous `checkObedience()` reasons (confirmed
 * live: `wrench` had 11 at once — missing visitor-tracking beacon, no
 * persisted waitlist capture, a dead CTA handler, and 8 AX/landmark gaps).
 * The sweep used to file a task for ONLY `obedience.reasons[0]` — the first
 * reason in the list — then mark the company `already_tracked`/`filed_task`
 * as if that one task represented its WHOLE compliance state. Every other
 * real, unresolved reason (including, for `wrench` and `beacon`, the exact
 * visitor-tracking gap #1951 is about) was then permanently invisible to
 * this sweep: re-running it forever just re-picks the same first reason,
 * sees it's already tracked, and reports nothing left to do — even though
 * 10 other real gaps sit live and untracked. Fixed by tracking each
 * COMPANY's reasons independently: one idempotency check and one
 * createTask() per distinct reason, not one per company.
 *
 * WHAT THIS SWEEP DOES
 * For every live (non-deleted) registered company, load its CURRENT
 * generated code (the same durable source `/api/generation/{id}/files`
 * serves), run `checkObedience()` against it, and `createTask()` a plain
 * `todo` row per unresolved reason — same scope-key shape and same
 * title/detail format #1140 uses in chat-ws, so the existing Gitea resolver
 * pipeline (task-resolver.ts, #905) picks it up exactly the same way — for
 * any reason that doesn't already have a non-terminal task tracking it.
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
 *  - IDEMPOTENT PER REASON. Before filing a task for a given reason, checks
 *    the company's existing tasks (`listTasksForCompany`) for a non-terminal
 *    one already carrying that exact reason's title, so a re-run never piles
 *    up duplicate tasks for a gap that's already tracked — and, as of this
 *    fix, never skips a DIFFERENT unresolved reason just because the
 *    company's first reason happens to already be tracked.
 *  - NEVER RE-CHECKS A DELETED COMPANY. Same `isDeleted` gate as the
 *    zerodb-key-backfill sweep.
 *  - A FAILED REGISTRY READ IS NOT "NO COMPANIES NEED FIXING" (core#7395) —
 *    reported as `registryOk: false`, sweep does nothing.
 *  - CAPPED per run, GLOBALLY ACROSS REASONS (not per company) — each filed
 *    task is a real write plus the resolver pipeline's own real Gitea issue
 *    creation downstream, so an unbounded run is not an acceptable failure
 *    mode for a filter bug. A company with many reasons can still exhaust
 *    the cap mid-company; the remaining reasons (for it and every company
 *    after it) are reported `capped`, same as before, just now at reason
 *    granularity instead of company granularity.
 */

import { listAllAppsWithStatus, resolveAppVerified, type AppEntry } from '@/lib/build/app-registry'
import { loadGeneration, listGenerations } from '@/lib/zerodb-store'
import { checkObedience } from '@/lib/build/obedience-gate'
import { createTask, listTasksForCompany } from '@/lib/build/task-store'
import { openIssueForNewTask } from '@/lib/build/task-resolver'
import { chatScopeKey } from '@/lib/build/chat-store'
import { generateSlug, looksLikeUnsubstitutedPlaceholder, extractShowcaseTitle } from '@/lib/showcase-data'
import { isQualityApp } from '@/lib/showcase-quality'

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
    const reasons = obedience.reasons.length > 0 ? obedience.reasons : ['obedience-gate check failed']

    if (dryRun) {
      record({ slug, disposition: 'would_file_task', reasons })
      continue
    }

    // #1951-class fix: each reason is its own independent unit of work — a
    // company's reasons are no longer collapsed into "check reasons[0], then
    // treat the whole company as tracked/filed/capped." One reason reaching
    // `already_tracked` must never stop a SIBLING reason for the same
    // company from being filed in this same pass.
    const existing = await listTasksForCompany(slug)
    // Titles filed EARLIER IN THIS SAME LOOP, tracked separately from
    // `existing` (a real BuildTask[] this function must not fabricate a
    // partial entry into) — otherwise two reasons that happen to render to
    // the exact same title (a real possibility: checkObedience() can repeat
    // a reason string) would file a duplicate task for themselves within one
    // pass, before the next sweep's own listTasksForCompany() re-read would
    // ever catch it.
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

      // #1973-class gap: open this task's real Gitea issue now rather than
      // leaving it to a future tier-capped nightly resolveTask() pass — the
      // same fix #1928 already applied to every other createTask() call site
      // that wasn't resolveTask() itself. Best-effort; a filed task is still
      // a real win even if this fails or the company has no gitOrg yet.
      void openIssueForNewTask(scopeKey, app.gitOrg, slug, task)

      tasksFiled++
      anyFiled = true
      filedThisPass.add(title)
    }

    // Company-level disposition is a roll-up across its reasons, in the same
    // priority order a caller would want to notice: a real write this run
    // outranks "nothing new to do", which outranks "hit the cap", which
    // outranks "every reason already tracked". `reasons` is still the FULL
    // list (not just the ones acted on) so existing callers that print it —
    // and the CLI wrapper's own per-reason bullet list — keep seeing the
    // company's complete current gap set, same as before this fix.
    const disposition: ObedienceBackfillDisposition = anyFailed
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

/**
 * #2126 — the sweep above iterates `listAllAppsWithStatus()`, i.e. only
 * companies that went through `registerApp()`. But `/showcase`
 * (app/api/showcase/route.ts) independently lists generations straight from
 * `listGenerations()` and SYNTHESIZES a display slug for any generation that
 * passes `isQualityApp()`/`is_showcase` — including a fully anonymous,
 * never-registered, never-claimed chat session. That synthesized slug gets
 * its own real, public, linkable `/build/{slug}` page (a different
 * resolution path than the registry — `resolveAppVerified()` only matches
 * registry rows), but is structurally invisible to `runObedienceBackfillSweep`
 * above AND to the nightly loop (also registry-derived) — so a real
 * `fakeLeadCaptureGap`-class bug on one of these pages has NO remediation
 * path, ever, no matter how many times either sweep runs.
 *
 * Confirmed live (#2126): 82% of showcase entries match this unregistered
 * pattern; two sampled ones have the exact same silent-no-op email-capture
 * bug #1954/#2089 already fixed on registered companies.
 *
 * This sweep closes that gap by walking the SAME `listGenerations()` rows
 * and the SAME eligibility/slug-synthesis `/showcase` uses, skipping any row
 * whose synthesized slug already resolves to a real registry entry (that
 * one is the OTHER sweep's job — never double-file for it here), and running
 * the same `checkObedience()` + per-reason `createTask()` pipeline as above.
 *
 * SCOPE KEY: there is no `app` row and no `ownerEmail` for an unregistered
 * generation, so this always scopes as `chatScopeKey('guest:anon', slug)` —
 * the same anonymous-session convention `deriveOwnerKey()`
 * (lib/build/chat-store.ts) falls back to for a guest with no stable id.
 *
 * GITEA ISSUE: there is no `app.gitOrg` either — `openIssueForNewTask()`
 * already treats an absent `gitOrg` as "not git-provisioned yet" and
 * no-ops (same as the registry sweep's own un-provisioned-company case), so
 * no new fallback logic is needed; the task is still filed and visible on
 * the founder's Tasks panel once/if the generation is ever claimed and
 * provisioned.
 *
 * SAFETY — same posture as the sweep above: dry-run by default, idempotent
 * per reason (never double-files a gap that's already tracked), capped
 * per run, and a `listGenerations()` read that comes back empty is reported
 * as `registryOk: false` rather than "nothing to check" — `listGenerations()`
 * itself never throws (it falls back to a stale cache or `[]` on a real
 * failure), so an empty result here is genuinely ambiguous between "no
 * showcase-eligible generations exist" and "the read failed" — treating it
 * as a possible failure is the safer default for a sweep that can never tell
 * the difference from its own inputs alone.
 */
export async function runShowcaseObedienceBackfillSweep(
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

  let rows: any[]
  try {
    rows = await listGenerations(1000)
  } catch {
    rows = []
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(
      '[obedience-backfill:showcase] ABORTED — generation list read returned nothing. ' +
        'listGenerations() never throws and falls back to a stale cache on failure, so an ' +
        'empty result here cannot be told apart from a real read failure; re-run rather than ' +
        'treating this as "no showcase-eligible generations exist".',
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

  for (const r of rows) {
    const chatId = String(r?.chat_id || '').trim()
    const code = r?.generated_code || ''
    // Same eligibility gate /showcase applies before an entry is ever
    // surfaced/synthesized a slug at all — a generation that would not even
    // appear on the public gallery is out of scope for this sweep too.
    if (r?.is_showcase === false) continue
    if (!isQualityApp(code, chatId)) continue
    const title = r?.title || extractShowcaseTitle(r?.prompt || '')
    if (looksLikeUnsubstitutedPlaceholder(title)) continue

    const slug = `${generateSlug(title)}-${chatId.slice(0, 6)}`
    if (onlySet && !onlySet.has(slug)) continue

    // Skip anything that already resolves to a real registry entry — that
    // company is the OTHER sweep's job (runObedienceBackfillSweep above);
    // double-checking it here would risk filing a duplicate task under a
    // DIFFERENT scope key (guest:anon vs. the company's real ownerEmail).
    const { entry, verified } = await resolveAppVerified(slug).catch(() => ({ entry: null, verified: false }))
    if (!verified) {
      // Could not confirm either way — fail closed (never silently treat an
      // unconfirmed registry read as "definitely unregistered").
      record({ slug, disposition: 'no_code', reason: 'could not verify registry status' })
      continue
    }
    if (entry) continue

    let gen: Awaited<ReturnType<typeof loadGeneration>>
    try {
      gen = await loadGeneration(chatId)
    } catch (e: any) {
      record({ slug, disposition: 'no_code', reason: String(e?.message || e).slice(0, 160) })
      continue
    }
    const fullCode = gen ? codeForObedienceCheck(gen) : code
    if (!fullCode.trim()) {
      record({ slug, disposition: 'no_code' })
      continue
    }

    checked++

    const idea = gen?.prompt || r?.prompt || slug
    const obedience = checkObedience(fullCode, idea, undefined, { landingPageOnly: true })
    if (obedience.ok) {
      record({ slug, disposition: 'clean' })
      continue
    }

    gapsFound++
    const reasons = obedience.reasons.length > 0 ? obedience.reasons : ['obedience-gate check failed']

    if (dryRun) {
      record({ slug, disposition: 'would_file_task', reasons })
      continue
    }

    const scopeKey = chatScopeKey('guest:anon', slug)
    const existing = await listTasksForCompany(slug)
    const filedThisPass = new Set<string>()
    let anyFiled = false
    let anyCapped = false
    let anyFailed = false

    for (const reason of reasons) {
      const reasonTitle = taskTitleFor(reason)
      if (filedThisPass.has(reasonTitle) || hasOpenTaskForReason(existing, reason)) {
        continue
      }

      if (tasksFiled >= MAX_TASKS_FILED_PER_RUN) {
        anyCapped = true
        continue
      }

      const task = await createTask(scopeKey, {
        title: reasonTitle,
        detail: reason,
        stage: 'todo',
        source: 'cody',
      }).catch(() => null)

      if (!task) {
        anyFailed = true
        failed++
        continue
      }

      // No app-registry row ⇒ no gitOrg ⇒ this no-ops exactly like a
      // not-yet-git-provisioned registered company (openIssueForNewTask's
      // own documented behavior) — the task is still filed and will get a
      // real Gitea issue later if/when this generation is ever claimed.
      void openIssueForNewTask(scopeKey, undefined, slug, task)

      tasksFiled++
      anyFiled = true
      filedThisPass.add(reasonTitle)
    }

    const disposition: ObedienceBackfillDisposition = anyFailed
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
