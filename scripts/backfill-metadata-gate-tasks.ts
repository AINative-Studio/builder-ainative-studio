/**
 * One-shot metadata-freshness backlog backfill, as a CLI.
 *
 * Re-checks every live registered company's CURRENT persisted
 * `/app/layout.tsx` for the two confirmed, already-fixed generator bugs
 * (#1952's literal "this" company name, #2024's "Ecommerce Application"
 * mislabel) and files a backlog task for any company whose live metadata
 * still shows the bug and isn't already tracked. Repairs companies whose
 * last generation predates either fix, or that simply haven't had a new
 * chat turn/regeneration since. Confirmed live for `wrench`, `lumeo`, and
 * `shingle` on 2026-11-15 (days after both fixes merged).
 *
 * All the logic lives in lib/build/metadata-backfill.ts (read its doc
 * comment, and lib/build/metadata-gate.ts's, for the full incident history
 * and safety posture). This is a thin, reviewable wrapper — the sweep is a
 * reviewed repair script, not a scheduled job, so running it from a
 * terminal with the output in front of you is the intended way to use it.
 *
 * SAFETY: dry run by default. `--apply` is required to write anything, and
 * a real run files real backlog tasks that the existing resolver pipeline
 * turns into real Gitea issues on real founders' repos. Review the dry-run
 * output first. This script never rewrites a company's code directly —
 * only ever files a task for the existing, reviewed resolveTask() pipeline
 * to act on.
 *
 *   Dry run (whole registry):  npx tsx scripts/backfill-metadata-gate-tasks.ts
 *   Dry run (one company):     npx tsx scripts/backfill-metadata-gate-tasks.ts --only wrench
 *   Real run (one company):    npx tsx scripts/backfill-metadata-gate-tasks.ts --only wrench --apply
 *   Real run (whole backlog):  npx tsx scripts/backfill-metadata-gate-tasks.ts --apply
 *
 * Requires the same ZeroDB/AINative credentials as any other script in this
 * repo that reads the company registry and writes build_tasks.
 *
 * STRONGLY RECOMMENDED: do the first real run with `--only <slug>` against
 * ONE already-confirmed-broken company (e.g. `wrench`), then verify a real
 * Gitea issue actually appears on that company's repo, before running the
 * whole backlog.
 *
 * A `--only` with no slug after it exits 1 before reading or filing anything
 * — same parser and reasoning as scripts/backfill-obedience-gate-tasks.ts /
 * scripts/backfill-zerodb-keys.ts.
 */

export {}

import { runMetadataBackfillSweep, MAX_TASKS_FILED_PER_RUN } from '../lib/build/metadata-backfill'
import { parseBackfillArgs, BackfillArgsError } from './backfill-zerodb-keys-args'

async function main() {
  let args
  try {
    args = parseBackfillArgs(process.argv.slice(2))
  } catch (e) {
    if (e instanceof BackfillArgsError) {
      console.error(`[backfill-metadata-gate-tasks] ${e.message}`)
      process.exit(1)
    }
    throw e
  }

  const dryRun = !args.apply
  console.log(
    `[backfill-metadata-gate-tasks] ${dryRun ? 'DRY RUN' : 'REAL RUN'}` +
      (args.onlySlugs.length ? ` — scoped to: ${args.onlySlugs.join(', ')}` : ' — whole registry') +
      ` (cap: ${MAX_TASKS_FILED_PER_RUN} tasks/run)`,
  )

  const result = await runMetadataBackfillSweep({ dryRun, onlySlugs: args.onlySlugs })

  if (!result.registryOk) {
    console.error('[backfill-metadata-gate-tasks] company registry read failed — nothing was checked.')
    process.exit(1)
  }

  console.log(
    `[backfill-metadata-gate-tasks] checked=${result.checked} gapsFound=${result.gapsFound} ` +
      `tasksFiled=${result.tasksFiled} failed=${result.failed}`,
  )
  console.log('[backfill-metadata-gate-tasks] by disposition:', JSON.stringify(result.byDisposition, null, 2))

  for (const r of result.results) {
    if (r.disposition === 'clean' || r.disposition === 'no_chat_id') continue
    console.log(`  ${r.slug}: ${r.disposition}${r.reason ? ` (${r.reason})` : ''}`)
    if (r.reasons) for (const reason of r.reasons) console.log(`      - ${reason}`)
  }

  if (dryRun && result.gapsFound > 0) {
    console.log(
      `\n[backfill-metadata-gate-tasks] ${result.gapsFound} compan${result.gapsFound === 1 ? 'y' : 'ies'} ` +
        'with stale metadata. Re-run with --apply to file backlog tasks for them.',
    )
  }

  if (result.failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[backfill-metadata-gate-tasks] fatal error:', e)
  process.exit(1)
})
