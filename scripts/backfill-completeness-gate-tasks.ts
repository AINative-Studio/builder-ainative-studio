/**
 * #1990 — one-shot completeness-gate backlog backfill, as a CLI.
 *
 * Re-checks every live registered company's CURRENT durable generation code
 * against this repo's real `findMissingLocalImports()`/
 * `findUndeclaredJsxComponents()` (lib/build/completeness-gate.ts — the same
 * pure detectors `checkAppReady()` uses at generation time) and files a
 * backlog task for any company with an unresolved gap that isn't already
 * tracked. Repairs companies whose last generation predates the completeness
 * gate (or a given call path gaining it). Confirmed live for "Agentive" — see
 * #1990 for the exact repro (3 of 5 dashboard panels import components that
 * were never emitted anywhere in the payload).
 *
 * All the logic lives in lib/build/completeness-backfill.ts (read its doc
 * comment for the full repair strategy and safety posture). This is a thin,
 * reviewable wrapper — the sweep is a reviewed repair script, not a scheduled
 * job, so running it from a terminal with the output in front of you is the
 * intended way to use it. Same shape as scripts/backfill-obedience-gate-tasks.ts
 * (#1954/PR #1955).
 *
 * SAFETY: dry run by default. `--apply` is required to write anything, and a
 * real run files real backlog tasks that the existing resolver pipeline turns
 * into real Gitea issues on real founders' repos. Review the dry-run output
 * first.
 *
 *   Dry run (whole registry):  npx tsx scripts/backfill-completeness-gate-tasks.ts
 *   Dry run (one company):     npx tsx scripts/backfill-completeness-gate-tasks.ts --only agentive
 *   Real run (one company):    npx tsx scripts/backfill-completeness-gate-tasks.ts --only agentive --apply
 *   Real run (whole backlog):  npx tsx scripts/backfill-completeness-gate-tasks.ts --apply
 *
 * Requires the same ZeroDB/AINative credentials as any other script in this
 * repo that reads the company registry and writes build_tasks.
 *
 * STRONGLY RECOMMENDED: do the first real run with `--only <slug>` against
 * ONE already-confirmed-broken company (e.g. the slug from #1990), then
 * verify a real Gitea issue actually appears on that company's repo, before
 * running the whole backlog.
 *
 * A `--only` with no slug after it exits 1 before reading or filing anything
 * — it is never read as "no scope restriction" (same parser and the same
 * reasoning as scripts/backfill-zerodb-keys.ts; see
 * scripts/backfill-zerodb-keys-args.ts's doc comment).
 */

export {}

import { runCompletenessBackfillSweep, MAX_TASKS_FILED_PER_RUN } from '../lib/build/completeness-backfill'
import { parseBackfillArgs, BackfillArgsError } from './backfill-zerodb-keys-args'

async function main() {
  let args
  try {
    args = parseBackfillArgs(process.argv.slice(2))
  } catch (e) {
    if (e instanceof BackfillArgsError) {
      console.error(`[backfill-completeness-gate-tasks] ${e.message}`)
      process.exit(1)
    }
    throw e
  }

  const dryRun = !args.apply
  console.log(
    `[backfill-completeness-gate-tasks] ${dryRun ? 'DRY RUN' : 'REAL RUN'}` +
      (args.onlySlugs.length ? ` — scoped to: ${args.onlySlugs.join(', ')}` : ' — whole registry') +
      ` (cap: ${MAX_TASKS_FILED_PER_RUN} tasks/run)`,
  )

  const result = await runCompletenessBackfillSweep({ dryRun, onlySlugs: args.onlySlugs })

  if (!result.registryOk) {
    console.error('[backfill-completeness-gate-tasks] company registry read failed — nothing was checked.')
    process.exit(1)
  }

  console.log(
    `[backfill-completeness-gate-tasks] checked=${result.checked} gapsFound=${result.gapsFound} ` +
      `tasksFiled=${result.tasksFiled} failed=${result.failed}`,
  )
  console.log('[backfill-completeness-gate-tasks] by disposition:', JSON.stringify(result.byDisposition, null, 2))

  for (const r of result.results) {
    if (r.disposition === 'clean' || r.disposition === 'no_chat_id') continue
    console.log(`  ${r.slug}: ${r.disposition}${r.reason ? ` (${r.reason})` : ''}`)
    if (r.missingImports) for (const m of r.missingImports) console.log(`      - missing import: ${m}`)
    if (r.undeclaredJsx) for (const u of r.undeclaredJsx) console.log(`      - undeclared JSX: ${u}`)
  }

  if (dryRun && result.gapsFound > 0) {
    console.log(
      `\n[backfill-completeness-gate-tasks] ${result.gapsFound} compan${result.gapsFound === 1 ? 'y' : 'ies'} ` +
        'with an unresolved gap. Re-run with --apply to file backlog tasks for them.',
    )
  }

  if (result.failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[backfill-completeness-gate-tasks] fatal error:', e)
  process.exit(1)
})
