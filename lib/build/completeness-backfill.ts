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
 * ALSO RUNS `validateJavaScriptCode()` (lib/code-validator.ts) against the
 * current durable code (#2151). That function is the one that actually
 * produces the public-facing "This build needs another pass" error page
 * (app/api/preview/[id]/route.ts calls it at READ time) — but until now it
 * was never called from any backfill/backlog path, so a company whose
 * CURRENT generation hard-fails it (a real parse/reference error — e.g.
 * `Reference to undefined variable 'id'`, confirmed live on company
 * "driftly") could sit with a 100%-broken public landing page indefinitely,
 * with no backlog task and no nightly-loop path ever noticing. The three
 * detectors above catch structural shape problems (missing/undeclared/
 * truncated); this catches the broader class of render-breaking defects
 * `checkAppReady()` (lib/build/ready-gate.ts) never checked for either.
 * `lenient: true` matches exactly what the preview route itself tolerates —
 * a company this check flags is one real visitors see broken right now, not
 * one that merely fails a stricter bar nothing in production enforces.
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
 *
 * #2032: a filed task's real Gitea issue is opened HERE, immediately, via
 * openIssueForNewTask() — not left to a future nightly resolveTask() pass.
 * That pass is tier-capped (maxTasksForTier()), so for most hobbyist/pro-tier
 * companies "later" means "never," the same gap #1928 fixed for 3 other
 * createTask() call sites and #1973 then fixed for 2 more
 * (chat-ws/route.ts's obFinal block, obedience-backfill.ts's own sweep) —
 * this sweep was the one remaining createTask() site still relying on the
 * stale "the resolver pipeline picks it up the same way" assumption #1973
 * disproved.
 */

import { listAllAppsWithStatus, resolveAppVerified, type AppEntry } from '@/lib/build/app-registry'
import { loadGeneration, listGenerations } from '@/lib/zerodb-store'
import {
  findMissingLocalImports,
  findUndeclaredJsxComponents,
  findTruncatedFiles,
  findMissingDefaultExports,
  findShadcnComponentsImportedFromLucide,
} from '@/lib/build/completeness-gate'
import { validateJavaScriptCode } from '@/lib/code-validator'
import { createTask, listTasksForCompany } from '@/lib/build/task-store'
import { openIssueForNewTask } from '@/lib/build/task-resolver'
import { chatScopeKey } from '@/lib/build/chat-store'
import { generateSlug, looksLikeUnsubstitutedPlaceholder, extractShowcaseTitle } from '@/lib/showcase-data'
import { isQualityApp } from '@/lib/showcase-quality'

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
  /** #2151: validateJavaScriptCode()'s error when the CURRENT durable code fails it — the same check that produces the public "This build needs another pass" page. */
  renderError?: string
  missingDefaultExports?: string[]
  shadcnFromLucide?: string[]
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
function firstReasonFor(
  missing: string[],
  undeclared: string[],
  truncated: string[],
  missingDefaults: string[],
  shadcnFromLucide: string[],
  renderError?: string,
): string {
  if (missing.length > 0) {
    return `imported local module(s) never defined in the payload: ${missing.join(', ')}`
  }
  if (undeclared.length > 0) {
    return `undeclared JSX component(s) — used but never imported: ${undeclared.join(', ')}`
  }
  if (truncated.length > 0) {
    return `file(s) fail a strict parse — truncated/incomplete generation: ${truncated.join(', ')}`
  }
  if (missingDefaults.length > 0) {
    return `local module(s) imported as a default export but never export one: ${missingDefaults.join(', ')}`
  }
  if (shadcnFromLucide.length > 0) {
    return `shadcn UI component(s) imported from 'lucide-react' (icon-only package, no such export): ${shadcnFromLucide.join(', ')}`
  }
  return `generation fails validateJavaScriptCode() at render time — this is the exact check behind the public "This build needs another pass" page: ${renderError}`
}

/**
 * Same title format as #1140/obedience-backfill.ts's createTask() calls, so
 * idempotency matching works identically either way. A render-breaking
 * defect (#2151) gets its own prefix — distinct from the structural
 * "completeness gap" shape detectors above — so a founder/resolver can tell
 * "this payload is incomplete" apart from "this payload parses but crashes
 * the preview right now" at a glance.
 */
function taskTitleFor(firstReason: string, isRenderDefect: boolean): string {
  return isRenderDefect
    ? `Fix generation render-breaking defect: ${firstReason}`
    : `Fix generation completeness gap: ${firstReason}`
}

function hasOpenTaskForReason(
  existing: { stage: string; title: string }[],
  firstReason: string,
  isRenderDefect: boolean,
): boolean {
  const title = taskTitleFor(firstReason, isRenderDefect)
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
    const missingDefaults = findMissingDefaultExports(files)
    const shadcnFromLucide = findShadcnComponentsImportedFromLucide(files)
    // #2151: the same check that produces the live "This build needs another
    // pass" page (app/api/preview/[id]/route.ts) — never previously run from
    // any backfill/backlog path, so a company whose current generation
    // hard-fails it had no automated path to a tracked repair.
    const renderCheck = validateJavaScriptCode(code, { importsStripped: false, lenient: true })
    const renderError = renderCheck.valid ? undefined : (renderCheck.error || 'code fails validation').slice(0, 300)

    if (
      missing.length === 0 &&
      undeclared.length === 0 &&
      truncated.length === 0 &&
      missingDefaults.length === 0 &&
      shadcnFromLucide.length === 0 &&
      !renderError
    ) {
      record({ slug, disposition: 'clean' })
      continue
    }

    gapsFound++
    const isRenderDefect =
      missing.length === 0 &&
      undeclared.length === 0 &&
      truncated.length === 0 &&
      missingDefaults.length === 0 &&
      shadcnFromLucide.length === 0
    const firstReason = firstReasonFor(missing, undeclared, truncated, missingDefaults, shadcnFromLucide, renderError)

    if (dryRun) {
      record({
        slug,
        disposition: 'would_file_task',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
        renderError,
      })
      continue
    }

    const existing = await listTasksForCompany(slug)
    if (hasOpenTaskForReason(existing, firstReason, isRenderDefect)) {
      record({
        slug,
        disposition: 'already_tracked',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
        renderError,
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
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
        renderError,
      })
      continue
    }

    const detailLines = [
      ...missing.map((m) => `Missing local import definition: ${m}`),
      ...undeclared.map((u) => `Undeclared JSX component used but never imported: ${u}`),
      ...truncated.map((t) => `File fails a strict parse (truncated/incomplete generation): ${t}`),
      ...missingDefaults.map((d) => `Local module imported as a default export but never exports one: ${d}`),
      ...shadcnFromLucide.map((d) => `shadcn UI component imported from 'lucide-react' instead of './components/ui/*': ${d}`),
      ...(renderError ? [`Fails validateJavaScriptCode() at render time (visitors see "This build needs another pass"): ${renderError}`] : []),
    ]

    const scopeKey = chatScopeKey(app.ownerEmail || 'guest:anon', slug)
    const task = await createTask(scopeKey, {
      title: taskTitleFor(firstReason, isRenderDefect),
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
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
        renderError,
      })
      continue
    }

    // #2032: open this task's real Gitea issue now rather than leaving it to
    // a future tier-capped nightly resolveTask() pass — same fix #1973
    // already applied to obedience-backfill.ts's sibling sweep. Best-effort;
    // a filed task is still a real win even if this fails or the company has
    // no gitOrg yet.
    void openIssueForNewTask(scopeKey, app.gitOrg, slug, task)

    tasksFiled++
    record({
      slug,
      disposition: 'filed_task',
      missingImports: missing,
      undeclaredJsx: undeclared,
      truncatedFiles: truncated,
      missingDefaultExports: missingDefaults,
      shadcnFromLucide,
      renderError,
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
 * Showcase-scoped completeness sweep (overnight render/dashboard-integrity
 * loop finding, mirroring #2126's `runShowcaseObedienceBackfillSweep` in
 * obedience-backfill.ts exactly).
 *
 * THE GAP: `runCompletenessBackfillSweep()` above only iterates
 * `listAllAppsWithStatus()` — i.e. companies that went through
 * `registerApp()`. But `/showcase` (app/api/showcase/route.ts) independently
 * lists generations straight from `listGenerations()` and synthesizes a
 * display slug for ANY generation passing `isQualityApp()` — including a
 * fully anonymous, never-registered, never-claimed chat session (confirmed
 * live, #2126: 82% of showcase entries match this unregistered pattern).
 * That synthesized slug gets its own real, public, linkable `/build/{slug}`
 * page, but is structurally invisible to the registry sweep above — so a
 * real `findTruncatedFiles()`-class truncation bug (#2013/#2119: a component
 * file that got cut off mid-generation, parses as valid-but-returnless, or
 * fails a strict parse outright) on one of these unregistered pages has NO
 * remediation path, ever, no matter how many times the registry sweep runs.
 *
 * Confirmed live (overnight loop, this finding): two unregistered-looking
 * showcase entries — `wallkind-z4nabG` (`/src/components/LeadsPanel.tsx`,
 * an exported component function with zero `return`/JSX — the exact
 * #2119 "export-patched but still-returnless" shape) and
 * `a-game-that-helps-students-get-cyber-security-PRBKNy`
 * (`/src/components/PhishingSimulator.tsx`, same shape) — both trip the
 * real `findTruncatedFiles()` detector today. Today's live Sandpack preview
 * for both is NOT currently broken: `lib/sandpack/build-files.ts`'s
 * `stubTruncatedFiles()` already wholesale-replaces any truncated file with
 * a trivial stub before Sandpack ever sees it (#2022) — so this is the same
 * "real bug, no live-preview crash, but no remediation path either" shape
 * #2143 found for the unrelated metadata-gate class.
 *
 * Exactly mirrors `runShowcaseObedienceBackfillSweep()`'s eligibility gate,
 * slug synthesis, already-registered skip, and scope-key convention — see
 * that function's own doc comment in obedience-backfill.ts for the full
 * reasoning (anonymous `guest:anon` scope key, no-op Gitea issue creation
 * until/unless the generation is later claimed and provisioned, etc.).
 *
 * SAFETY: identical posture to every sweep in this file/obedience-backfill.ts
 * — dry-run by default, idempotent per reason, capped per run, and a
 * `listGenerations()` read that comes back empty is reported as
 * `registryOk: false` rather than "nothing to check."
 */
export async function runShowcaseCompletenessBackfillSweep(
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

  let rows: any[]
  try {
    rows = await listGenerations(1000)
  } catch {
    rows = []
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(
      '[completeness-backfill:showcase] ABORTED — generation list read returned nothing. ' +
        'listGenerations() never throws and falls back to a stale cache on failure, so an ' +
        'empty result here cannot be told apart from a real read failure; re-run rather than ' +
        'treating this as "no showcase-eligible generations exist".',
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

  for (const r of rows) {
    const chatId = String(r?.chat_id || '').trim()
    const code = r?.generated_code || ''
    // Same eligibility gate /showcase applies before an entry is ever
    // surfaced/synthesized a slug at all.
    if (r?.is_showcase === false) continue
    if (!isQualityApp(code, chatId)) continue
    const title = r?.title || extractShowcaseTitle(r?.prompt || '')
    if (looksLikeUnsubstitutedPlaceholder(title)) continue

    const slug = `${generateSlug(title)}-${chatId.slice(0, 6)}`
    if (onlySet && !onlySet.has(slug)) continue

    // Skip anything that already resolves to a real registry entry — that
    // company is the OTHER sweep's job (runCompletenessBackfillSweep above);
    // double-checking it here would risk filing a duplicate task under a
    // DIFFERENT scope key (guest:anon vs. the company's real ownerEmail).
    const { entry, verified } = await resolveAppVerified(slug).catch(() => ({ entry: null, verified: false }))
    if (!verified) {
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
    const fullCode = gen?.generatedCode || code
    if (!fullCode.trim()) {
      record({ slug, disposition: 'no_code' })
      continue
    }

    checked++

    const files = gen?.files ?? undefined
    const missing = findMissingLocalImports(fullCode, files)
    const undeclared = findUndeclaredJsxComponents(fullCode, files)
    const truncated = findTruncatedFiles(files)
    const missingDefaults = findMissingDefaultExports(files)
    const shadcnFromLucide = findShadcnComponentsImportedFromLucide(files)

    if (
      missing.length === 0 &&
      undeclared.length === 0 &&
      truncated.length === 0 &&
      missingDefaults.length === 0 &&
      shadcnFromLucide.length === 0
    ) {
      record({ slug, disposition: 'clean' })
      continue
    }

    gapsFound++
    // #2151 rebase note: this showcase sweep only checks structural gaps
    // above, never the render-defect check that PR adds — renderError is
    // honestly undefined here, not a stub.
    const firstReason = firstReasonFor(missing, undeclared, truncated, missingDefaults, shadcnFromLucide, undefined)

    if (dryRun) {
      record({
        slug,
        disposition: 'would_file_task',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
      })
      continue
    }

    const scopeKey = chatScopeKey('guest:anon', slug)
    const existing = await listTasksForCompany(slug)
    // #2151 rebase note: this showcase sweep only checks structural gaps
    // (missing/undeclared/truncated/missingDefaults/shadcnFromLucide) above,
    // never the render-defect check that PR adds — isRenderDefect is
    // honestly false here, not a stub.
    if (hasOpenTaskForReason(existing, firstReason, false)) {
      record({
        slug,
        disposition: 'already_tracked',
        missingImports: missing,
        undeclaredJsx: undeclared,
        truncatedFiles: truncated,
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
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
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
      })
      continue
    }

    const detailLines = [
      ...missing.map((m) => `Missing local import definition: ${m}`),
      ...undeclared.map((u) => `Undeclared JSX component used but never imported: ${u}`),
      ...truncated.map((t) => `File fails a strict parse (truncated/incomplete generation): ${t}`),
      ...missingDefaults.map((d) => `Local module imported as a default export but never exports one: ${d}`),
      ...shadcnFromLucide.map((d) => `shadcn UI component imported from 'lucide-react' instead of './components/ui/*': ${d}`),
    ]

    const task = await createTask(scopeKey, {
      title: taskTitleFor(firstReason, false),
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
        missingDefaultExports: missingDefaults,
        shadcnFromLucide,
      })
      continue
    }

    // There is no app.gitOrg for an unregistered generation —
    // openIssueForNewTask() already treats an absent gitOrg as "not
    // git-provisioned yet" and no-ops, same as the registry sweep's own
    // un-provisioned-company case.
    void openIssueForNewTask(scopeKey, undefined, slug, task)

    tasksFiled++
    record({
      slug,
      disposition: 'filed_task',
      missingImports: missing,
      undeclaredJsx: undeclared,
      truncatedFiles: truncated,
      missingDefaultExports: missingDefaults,
      shadcnFromLucide,
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
