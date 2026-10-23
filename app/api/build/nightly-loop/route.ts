/**
 * Option B — nightly autonomous loop cron (#207). Fires nightly (schedule via
 * the same cron mechanism as app/api/cron/alerts). Iterates enrolled companies
 * and runs one autonomous iteration each (brief → dispatch to agent swarm).
 * CRON_SECRET-secured, same pattern as the existing cron routes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * #1055 — WALL-CLOCK BUDGET (the reason this route is no longer a serial loop)
 * ─────────────────────────────────────────────────────────────────────────────
 * This route used to run the full per-company pipeline — swarm dispatch, comms
 * outreach, daily report, media routine, backlog seed, task resolution, every
 * one of them a real network or LLM call — for all ~77 enrolled companies in a
 * plain `for (const e of enrolled)`, inside this route's single 300s
 * `maxDuration`. The nightly GitHub Action POSTs here with `--max-time 300`:
 * the SAME number, so the two raced, and the client lost. Nine of the last
 * fifteen scheduled runs died with
 * `curl: (28) Operation timed out after 300001 milliseconds with 0 bytes
 * received` — and because the platform kills the function at maxDuration, the
 * companies the sweep had not reached yet simply never ran, with no response
 * and no record of how far it got.
 *
 * Three changes, all needed together (raising the Action's timeout alone would
 * only have hidden the slowness):
 *
 *   1. BOUNDED CONCURRENCY. Per-company work now runs through
 *      mapWithConcurrency() at NIGHTLY_COMPANY_CONCURRENCY. The pipeline is
 *      almost entirely I/O-wait, so this cuts wall clock by roughly the
 *      concurrency factor. The cap is finite and small on purpose — an
 *      unbounded Promise.all over 77 companies would fire 77 concurrent LLM
 *      implementations and coverage runs at core and at this one Node process,
 *      trading a timeout for an OOM or a rate-limit outage.
 *
 *   2. AN INTERNAL DEADLINE well below maxDuration (NIGHTLY_LOOP_BUDGET_MS).
 *      The sweep stops ADMITTING new companies when the budget is spent and
 *      returns a real 200 reporting exactly how many were deferred to the next
 *      tick — instead of being killed mid-company with the response lost.
 *
 *   3. SHARDING (`?shard=N&shards=M`). The Action can split one sweep into
 *      several independently-timed calls, so the per-call budget stays
 *      comfortable as the enrolled-company count keeps growing. Every company
 *      lands in exactly one shard (see selectShard).
 *
 * The Action's own `--max-time` is also raised past this route's budget so the
 * client can no longer time out before the server has finished and answered.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listEnrolled, recordRun, listRecentRuns, recordRunHealth } from '@/lib/build/loop-enrollment'
import { runNightlyLoop, buildNightlySeedDescription, type NightlyRunResult } from '@/lib/build/autonomous-loop'
import { appendAutoRunEvent } from '@/lib/build/auto-mode'
import { dispatchEventTitle } from '@/lib/build/auto-run-activity'
import { chatScopeKey } from '@/lib/build/chat-store'
import { createDocument, hasReportForDate, pruneDuplicateReports } from '@/lib/build/document-store'
import { buildDailyReport, dailyReportTitle } from '@/lib/build/document-prompts'
import { runMediaRoutines } from '@/lib/build/media-routine'
import { createTask, listTasks } from '@/lib/build/task-store'
import { runTaskResolutions } from '@/lib/build/task-resolution-loop'
import { resolveApp } from '@/lib/build/app-registry'
import { runNightlyCommsOutreach } from '@/lib/build/comms-policy'
import { fetchPlanByEmail, type AdminPlanLookup } from '@/lib/ainative/admin-plan-lookup'
import { normalizeTier } from '@/lib/ainative/plan'
import { mapWithConcurrency, selectShard } from '@/lib/build/concurrent-map'
import { assessSwarmHealth, MAX_TASKS_CHECKED, type SwarmHealthVerdict } from '@/lib/build/swarm-task-health'
import { logger } from '@/lib/logger'
import type { LoopEnrollment } from '@/lib/build/loop-enrollment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * How many companies' pipelines run at once. Exported so the cap the nightly
 * sweep actually depends on is directly assertable in tests rather than being
 * a magic number buried in a call.
 *
 * Eight, not more: each slot can hold a real LLM implementation call plus a
 * coverage run (coverage-runner's own timeout is 120s — see
 * task-resolution-loop.ts), so this is also a concurrent-load ceiling on
 * core, not just a local scheduling knob. Eight takes the ~77-company sweep
 * from serial to roughly an eighth of the wall clock, which is a large enough
 * margin under the budget below that a few slow companies no longer put the
 * whole run at risk.
 */
export const NIGHTLY_COMPANY_CONCURRENCY = Number(process.env.NIGHTLY_COMPANY_CONCURRENCY || 8)

/**
 * The route's self-imposed wall-clock budget for ADMITTING new companies —
 * deliberately well under `maxDuration` (300s) so in-flight companies have
 * room to finish, the response can be serialized, and the function is never
 * killed with its result lost. 210s leaves ~90s of headroom.
 *
 * Read at CALL time, not frozen at module scope: a top-level const captures
 * whatever the env was at first import, which both misses a real env change
 * without a full process restart and is untestable per-test (module import
 * happens once, before any beforeEach). Same lazy-read convention
 * lib/build/autonomous-loop.ts and media-schedule.ts already follow for
 * exactly this reason.
 */
function nightlyLoopBudgetMs(): number {
  return Number(process.env.NIGHTLY_LOOP_BUDGET_MS || 210_000)
}

/** Per-company outcome the sweep collects. */
interface CompanyOutcome {
  result: NightlyRunResult
  reportWritten: boolean
  mediaGenerated: number
  tasksAttempted: number
  tasksCompleted: number
  /** #1232 — real ship rate alongside coverage-pass rate; see runTaskResolutions(). */
  tasksMerged: number
  tasksRedeployed: number
  /** How many orphaned `in_progress` tasks were recovered this run — see task-resolution-loop.ts's isStaleInProgress. */
  tasksReaped: number
  commsSent: boolean
  stalled: boolean
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const budgetMs = nightlyLoopBudgetMs()
  const deadline = startedAt + budgetMs

  // Read before the try block (pure URL parsing, cannot throw on its own)
  // so a crash during listEnrolled() or anything else below still lets the
  // catch block record WHICH shard went down, not just that one did.
  const params = new URL(request.url ?? 'https://localhost/').searchParams
  const rawShard = params.get('shard')
  const rawShards = params.get('shards')

  try {
    const enrolled = await listEnrolled()

    // Sharding (#1055): the Action may split the sweep across several smaller
    // calls. A malformed/out-of-range spec degrades to the whole list — see
    // selectShard; processing everyone is the safe failure mode for a nightly
    // cron, processing nobody would silently skip a night.
    const batch = selectShard(enrolled, rawShard, rawShards)
    const sharded = batch.length !== enrolled.length

    logger.info('Nightly autonomous loop starting', {
      count: enrolled.length, batch: batch.length, sharded,
      concurrency: NIGHTLY_COMPANY_CONCURRENCY, budgetMs,
    })

    // #908 (epic #900): plan-tier-aware nightly backlog throughput. This cron
    // has no founder session to resolve a plan from (resolveActivePlan()
    // needs one — see task-resolution-loop.ts's doc comment), so plan tier is
    // looked up by owner email via the same admin-scoped, offline-safe path
    // lib/build/loop-backfill.ts already established for this exact gap
    // (fetchPlanByEmail → normalizeTier). Cached per owner email: one founder
    // commonly owns several enrolled companies, so this keeps the sweep to
    // ~N core calls for N distinct owners rather than one per company.
    //
    // #1055: the cache now stores the in-flight PROMISE, not the resolved
    // value. With the sweep parallelized, several companies owned by the same
    // founder start at the same instant, so a resolved-value cache would miss
    // every time (nothing is in it yet) and fire N duplicate core lookups for
    // one owner — quietly undoing the very saving the cache was added for.
    const planCache = new Map<string, Promise<AdminPlanLookup>>()
    async function resolvePlanTier(ownerKey: string | undefined): Promise<string | null> {
      const email = (ownerKey || '').trim().toLowerCase()
      // A guest scope key (see deriveOwnerKey) is never a real account email —
      // skip the lookup entirely and let maxTasksForTier degrade to free-tier.
      if (!email || !email.includes('@')) return null
      let pending = planCache.get(email)
      if (!pending) {
        pending = fetchPlanByEmail(email).catch(
          (err: unknown): AdminPlanLookup => ({
            plan: null, email: null, verified: false,
            reason: `threw:${err instanceof Error ? err.name : 'unknown'}`,
          }),
        )
        planCache.set(email, pending)
      }
      const lookup = await pending
      // verified:false must never be treated as a real tier — degrade to the
      // free-tier limit (maxTasksForTier's own null/undefined handling), same
      // invariant loop-backfill.ts's toActivePlan() enforces for enrollment.
      if (!lookup.verified) return null
      return normalizeTier(lookup.plan)
    }

    const outcomes = await mapWithConcurrency(
      batch,
      NIGHTLY_COMPANY_CONCURRENCY,
      (e) => runForCompany(e, resolvePlanTier),
      { deadline },
    )

    const completed = outcomes.filter((o) => o.done)
    const deferred = outcomes.length - completed.length
    const results = completed.map((o) => o.value?.result).filter((r): r is NightlyRunResult => Boolean(r))

    const dispatched = results.filter((r) => r.status === 'dispatched').length
    const failedCompanies = completed.filter((o) => o.error).length
    const reportsWritten = completed.filter((o) => o.value?.reportWritten).length
    const mediaGenerated = completed.reduce((n, o) => n + (o.value?.mediaGenerated || 0), 0)
    const tasksAttempted = completed.reduce((n, o) => n + (o.value?.tasksAttempted || 0), 0)
    const tasksCompleted = completed.reduce((n, o) => n + (o.value?.tasksCompleted || 0), 0)
    const tasksMerged = completed.reduce((n, o) => n + (o.value?.tasksMerged || 0), 0)
    const tasksRedeployed = completed.reduce((n, o) => n + (o.value?.tasksRedeployed || 0), 0)
    const tasksReaped = completed.reduce((n, o) => n + (o.value?.tasksReaped || 0), 0)
    const commsSent = completed.filter((o) => o.value?.commsSent).length
    const stalledCompanies = completed.filter((o) => o.value?.stalled).length

    const elapsedMs = Date.now() - startedAt
    const budgetExhausted = deferred > 0

    // #1055 — operator-visible aggregate. `stalledCompanies` is the number
    // that was previously invisible everywhere: companies whose dispatched
    // tasks are accepted by core's swarm and then never finish. A non-zero
    // value here means the swarm's own executor needs attention; this route is
    // doing its job correctly either way.
    logger.info('Nightly autonomous loop complete', {
      dispatched, total: results.length, processed: completed.length, deferred,
      failedCompanies, reportsWritten, mediaGenerated, tasksAttempted, tasksCompleted,
      tasksMerged, tasksRedeployed, tasksReaped,
      commsSent, stalledCompanies, elapsedMs, budgetExhausted,
    })
    if (stalledCompanies > 0) {
      logger.warn('Nightly loop: companies with a stalled agent swarm', {
        stalledCompanies, of: completed.length,
      })
    }
    if (tasksReaped > 0) {
      // A non-zero reap count means a PRIOR run was killed mid-resolution
      // (task-resolution-loop.ts's isStaleInProgress) — worth its own log
      // line so this doesn't just blend into the aggregate above.
      logger.warn('Nightly loop: recovered orphaned in_progress tasks from a prior crashed/killed run', {
        tasksReaped,
      })
    }

    // #1130: give this aggregate a persisted home, not just the log line
    // above and the HTTP response below — neither reachable once Railway cron
    // (not a GitHub Actions matrix) is what's calling this route.
    await recordRunHealth({
      shardIndex: sharded ? Number(rawShard) : null,
      shardCount: sharded ? Number(rawShards) : null,
      enrolled: enrolled.length,
      processed: completed.length,
      deferred,
      budgetExhausted,
      dispatched,
      failed: failedCompanies,
      tasksAttempted,
      tasksCompleted,
      tasksMerged,
      tasksRedeployed,
      tasksReaped,
      stalledCompanies,
      elapsedMs,
    })

    return NextResponse.json({
      ok: true,
      enrolled: enrolled.length,
      processed: completed.length,
      deferred,
      budgetExhausted,
      elapsedMs,
      concurrency: NIGHTLY_COMPANY_CONCURRENCY,
      shard: sharded ? { index: Number(rawShard), count: Number(rawShards) } : null,
      dispatched,
      failed: failedCompanies,
      reportsWritten,
      mediaGenerated,
      tasksAttempted,
      tasksCompleted,
      tasksMerged,
      tasksRedeployed,
      tasksReaped,
      commsSent,
      stalledCompanies,
      results,
    })
  } catch (error) {
    logger.error('Nightly autonomous loop failed', error as Error)

    // Real gap (#1141 follow-up): this catch previously returned 500 with
    // no call to recordRunHealth() at all -- a shard that crashes outright
    // (not merely degraded: budget-exhausted, stalled companies, etc, all
    // captured by the success path above) left ZERO trace in the run-health
    // history. A human reading listRecentRunHealth()/the #1142 health API
    // would see only ever-healthy-looking runs and have no way to tell a
    // totally silent, never-even-started shard apart from one that simply
    // never fired. Record what's known (shard identity, elapsed time) with
    // crashed: true so a true crash is visible instead of invisible.
    await recordRunHealth({
      shardIndex: rawShard !== null ? Number(rawShard) : null,
      shardCount: rawShards !== null ? Number(rawShards) : null,
      enrolled: 0,
      processed: 0,
      deferred: 0,
      budgetExhausted: false,
      dispatched: 0,
      failed: 0,
      tasksAttempted: 0,
      tasksCompleted: 0,
      tasksMerged: 0,
      tasksRedeployed: 0,
      tasksReaped: 0,
      stalledCompanies: 0,
      elapsedMs: Date.now() - startedAt,
      crashed: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Nightly loop failed' }, { status: 500 })
  }
}

/**
 * The full per-company pipeline — unchanged in behaviour and order from the
 * serial version, just extracted so the worker pool can run several companies
 * at once. Every inner step keeps its original best-effort posture: a hiccup
 * in comms, the report, media, the backlog seed, or task resolution must never
 * break the rest of THIS company's pipeline, and (now via the pool's own
 * error capture) never the other companies' either.
 */
async function runForCompany(
  e: LoopEnrollment,
  resolvePlanTier: (ownerKey: string | undefined) => Promise<string | null>,
): Promise<CompanyOutcome> {
  const outcome: CompanyOutcome = {
    result: { companyId: e.companyId, briefing: null, taskId: null, status: 'error', detail: 'not run' },
    reportWritten: false, mediaGenerated: 0, tasksAttempted: 0, tasksCompleted: 0,
    tasksMerged: 0, tasksRedeployed: 0, tasksReaped: 0,
    commsSent: false, stalled: false,
  }

  // Best-effort: a registry lookup hiccup must never block dispatch — the
  // task still runs, it just surfaces no Gitea link in its result (core#8656).
  const registryEntry = await resolveApp(e.companyId).catch(() => null)

  const r = await runNightlyLoop({
    companyId: e.companyId, companyName: e.companyName, track: e.track, goal: e.goal,
    giteaRepoUrl: registryEntry?.gitRepoUrl,
  })
  outcome.result = r
  await recordRun(e.companyId, r.taskId, r.status)

  // Founder comms outreach (#742) — the policy layer that decides
  // whether tonight's run is worth proactively emailing the founder
  // about at all. Runs the SAME decision (real signal, frequency cap,
  // opt-out) regardless of the swarm-dispatch outcome above; see
  // lib/build/comms-policy.ts for the full policy writeup. Best-effort:
  // a comms hiccup must never break the rest of this company's pipeline
  // or the loop over other companies.
  try {
    const comms = await runNightlyCommsOutreach(e.companyId, e.companyName, r)
    if (comms.status === 'sent') outcome.commsSent = true
  } catch (err) {
    logger.warn('Nightly comms outreach failed', { companyId: e.companyId, err: (err as Error)?.message })
  }

  // Event trail (#340): when an Auto Mode run is ACTIVE for this company,
  // append this dispatch to its recentEvents ring so the founder's Live
  // dashboard shows the run's real activity. No-op for plain nightly
  // enrollments (appendAutoRunEvent only writes to an active run).
  if (r.status !== 'skipped') {
    await appendAutoRunEvent(e.companyId, {
      ts: new Date().toISOString(),
      title: dispatchEventTitle({ track: e.track, taskId: r.taskId }),
      status: r.status === 'dispatched' ? 'dispatched' : 'failed',
    }).catch(() => {})
  }

  // #1055 — read back what the swarm ACTUALLY did with this company's recent
  // dispatched task ids, so the report below can tell the aggregate truth
  // instead of only this run's dispatch status. The swarm's executor is
  // core's (see lib/build/swarm-task-health.ts); this is a read of its real
  // task-status endpoint, and every failure mode degrades to "not assessed"
  // rather than to a fabricated verdict in either direction.
  let swarmHealth: SwarmHealthVerdict | null = null
  try {
    const recent = await listRecentRuns(e.companyId, MAX_TASKS_CHECKED)
    const refs = recent
      .filter((run) => run.lastTaskId)
      .map((run) => ({ taskId: String(run.lastTaskId), dispatchedAt: run.lastRunAt || new Date().toISOString() }))
    if (refs.length) {
      swarmHealth = await assessSwarmHealth(refs)
      outcome.stalled = Boolean(swarmHealth?.stalled)
    }
  } catch (err) {
    logger.warn('Swarm health check failed', { companyId: e.companyId, err: (err as Error)?.message })
    swarmHealth = null
  }

  // Append a dated daily operational report to the company's Documents library
  // (#64 req 4). Grounded ENTIRELY in this run's REAL result (task id, status,
  // briefing, detail) — never fabricated. Best-effort: a persistence hiccup
  // must not break the loop. Keyed to the same {owner, company} scope the
  // Documents panel reads (falls back to companyId-only for pre-#64 enrollments).
  //
  // IDEMPOTENCY (real bug: "Daily Operational Report — Sep 5, 2026" appeared
  // 10x): the primary fix is deduping the enrollment list itself so a company
  // is iterated once per run (loop-enrollment.ts `dedupeByCompany`), but this
  // is a second, independent layer — skip the write entirely if a 'daily'
  // report already exists for THIS scope on today's calendar date, so a
  // duplicate dispatch (a manual workflow_dispatch re-run, a future caller
  // that re-triggers this route same-day) still can't double-write.
  if (e.ownerKey) {
    try {
      const runAt = new Date().toISOString()
      const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
      const alreadyReported = await hasReportForDate(scopeKey, 'daily', runAt)
      if (!alreadyReported) {
        const input = {
          companyName: e.companyName,
          runAt,
          taskId: r.taskId,
          status: r.status,
          briefing: r.briefing,
          detail: r.detail,
          // #1055 — the aggregate swarm verdict. See document-prompts.ts.
          swarmHealth,
        }
        const doc = await createDocument(scopeKey, {
          title: dailyReportTitle(input),
          content: buildDailyReport(input),
          type: 'daily',
        })
        if (doc) outcome.reportWritten = true
      }
      // Self-healing cleanup (real bug: 20 duplicate reports landed in one
      // scope for a single company BEFORE hasReportForDate existed, and
      // nothing ever retroactively collapsed them — the write-time guard
      // only stops NEW duplicates). Runs every pass, alongside the guard
      // above, so any stray duplicate (this backlog, or a future one from
      // a cause not yet found) self-heals on the very next nightly tick
      // instead of silently accumulating forever. Best-effort: never
      // blocks the loop.
      await pruneDuplicateReports(scopeKey).catch(() => {})
    } catch (err) {
      logger.warn('Daily report append failed', { companyId: e.companyId, err: (err as Error)?.message })
    }
  }

  // Media routine (#54): alongside the swarm dispatch, run any DUE on-brand
  // media routines for this company and persist the assets to its own storage.
  // Best-effort + fully gated: inert (no-op) when media generation isn't
  // configured, and a hiccup here must never break the nightly loop.
  //
  // BRAND GROUNDING (real bug — off-brand auto-generated images): this used to
  // pass ONLY companyName, so buildBrandPrompt() had no tagline, no brand
  // color, and — most importantly — no idea/business-description at all for
  // every auto-fired (Once/Daily/Weekly/Monthly) media routine, which is
  // exactly what produced a generic, ungrounded stock-photo image for a real
  // company ("Beacon"). What IS durably persisted and was being silently
  // dropped is the registry entry's tagline + brand color (set at
  // registration / brand step) — resolving it here grounds the recurring
  // prompt in the founder's real brand tagline and color instead of a bare
  // company name every time.
  //
  // REMAINING GAP (flagged honestly, not worked around): the company's real
  // `idea` text is only ever held in front-end React state (Live.tsx
  // `state.idea`) and is never persisted server-side against the company's
  // slug/registry entry — so a nightly, server-only cron genuinely has no
  // durable source to read it from. `LoopEnrollment.goal` looked like a
  // plausible substitute but is NOT: Live.tsx wires it as
  // `goal: state.answers?.privacy` (a leftover from an unrelated onboarding
  // question, not the idea) — using it here would inject wrong/misleading
  // content into the prompt, worse than leaving it empty. Passing real idea
  // grounding through to the nightly loop needs a real fix (persist `idea` on
  // the app registry at registration time) — out of scope for this prompt-
  // leak fix; tracked as a follow-up rather than silently faked here.
  if (e.ownerKey) {
    try {
      const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
      const app = await resolveApp(e.companyId).catch(() => null)
      const m = await runMediaRoutines(scopeKey, {
        companyName: e.companyName,
        tagline: app?.tagline,
        color: app?.color,
      })
      outcome.mediaGenerated += m.generated
    } catch (err) {
      logger.warn('Media routine run failed', { companyId: e.companyId, err: (err as Error)?.message })
    }

    // Backlog seeding (#898): runTaskResolutions() below only resolves
    // tasks that ALREADY exist with stage:'todo' — nothing in the nightly
    // loop ever created one, so the swarm dispatch above and the real
    // implement→Gitea-commit→coverage-verify pipeline (task-resolver.ts)
    // were two working but completely disconnected systems. Seed a real
    // todo task from the SAME description already sent to the swarm, so
    // there is something concrete for the resolver to actually implement.
    //
    // 'app' track only: the resolver's pipeline commits a code diff to the
    // company's Gitea repo and coverage-gates it — meaningful for an app's
    // "bug fix / UX polish / small feature" description, not for the
    // 'company' track's business-ops description (positioning, pipeline,
    // outreach), which has no repo to commit into.
    //
    // IDEMPOTENT: skip if this company already has an unresolved nightly
    // task (todo or in_progress, source:'recurring') so a slow/failing
    // resolver doesn't accumulate a new duplicate every night — same
    // pattern as hasReportForDate above, applied to the task queue
    // instead of the documents list.
    if (e.track === 'app') {
      try {
        const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
        const existing = await listTasks(scopeKey)
        const hasUnresolved = existing.some(
          (t) => t.source === 'recurring' && (t.stage === 'todo' || t.stage === 'in_progress'),
        )
        if (!hasUnresolved) {
          // PRD feature priority (#901, epic #900): prefer naming the
          // company's real highest-priority (P0 else P1 else P2) PRD
          // feature over the generic "ship the highest-leverage thing"
          // prose, when that company has a `prd` document in its scope.
          // Falls back to buildTaskDescription() (today's behavior, and
          // still the universal case until #532's write-side lands) with
          // no regression — see autonomous-loop.ts's buildNightlySeedDescription().
          const detail = await buildNightlySeedDescription(
            scopeKey,
            { companyId: e.companyId, companyName: e.companyName, track: e.track, goal: e.goal },
            r.briefing,
          )
          await createTask(scopeKey, {
            title: `Nightly backlog: ${e.companyName}`,
            detail,
            stage: 'todo',
            source: 'recurring',
          })
        }
      } catch (err) {
        logger.warn('Nightly backlog task seed failed', { companyId: e.companyId, err: (err as Error)?.message })
      }
    }

    // Task resolution (#433, epic #371): resolveTask() had zero real
    // callers anywhere in the app until this — alongside the media
    // routine and swarm dispatch, resolve any DUE (`todo`) backlog tasks
    // for this company via the real coverage-gated pipeline. Best-effort
    // + fully bounded per the company's real plan tier (#908 — see
    // resolvePlanTier above and task-resolution-loop.ts's
    // maxTasksForTier): a hiccup here must never break the nightly loop,
    // and one company's backlog must never starve the shared route's
    // maxDuration budget.
    try {
      const scopeKey = chatScopeKey(e.ownerKey, e.companyId)
      const planTier = await resolvePlanTier(e.ownerKey).catch(() => null)
      const t = await runTaskResolutions(scopeKey, e.companyId, planTier)
      outcome.tasksAttempted += t.attempted
      outcome.tasksCompleted += t.completed
      outcome.tasksMerged += t.merged || 0
      outcome.tasksRedeployed += t.redeployed || 0
      outcome.tasksReaped += t.reaped || 0
    } catch (err) {
      logger.warn('Task resolution run failed', { companyId: e.companyId, err: (err as Error)?.message })
    }
  }

  return outcome
}

export async function POST(request: NextRequest) {
  return GET(request)
}
