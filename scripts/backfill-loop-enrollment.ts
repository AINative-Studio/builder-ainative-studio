/**
 * #841 — paid-but-never-enrolled backfill sweep, as a CLI.
 *
 * Same logic and same safety contract as the cron route
 * (app/api/cron/loop-backfill) — both call the one implementation in
 * lib/build/loop-backfill.ts, so a CLI run and a cron run can never disagree.
 * This exists because the sweep is a reviewed, one-shot repair rather than a
 * scheduled job: running it from a terminal with the output in front of you is
 * the intended way to use it.
 *
 * SAFETY: dry run by default. `--apply` is required to write anything, and a
 * real run enrolls live customer companies and fires billable swarm dispatches.
 * Review the dry-run output first.
 *
 *   Dry run:  npx tsx scripts/backfill-loop-enrollment.ts
 *   Real run: npx tsx scripts/backfill-loop-enrollment.ts --apply
 *
 * Requires ZERODB_API_KEY (or AINATIVE_API_KEY) + ZERODB_PROJECT_ID in the env,
 * e.g. via `railway run --service builder-ainative-studio`.
 */

export {}

import { runLoopBackfillSweep } from '../lib/build/loop-backfill'

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`\n#841 loop-enrollment backfill — ${APPLY ? 'APPLY (writes!)' : 'DRY RUN (no writes)'}\n`)

  const r = await runLoopBackfillSweep({ dryRun: !APPLY })

  if (!r.registryOk) {
    console.error('✗ Company registry read FAILED — sweep did not run.')
    console.error('  An empty result here is NOT "no companies" (see core#7395).')
    process.exit(1)
  }

  for (const row of r.results) {
    const mark =
      row.disposition === 'enroll' ? (row.enrolled ? '✓' : '→')
        : row.disposition === 'unverifiable' ? '?'
          : '='
    const bits = [
      `plan=${row.plan ?? '-'}`,
      row.dispatched === true ? 'dispatched' : '',
      row.reason ? `(${row.reason})` : '',
    ].filter(Boolean).join(' ')
    console.log(`  ${mark} ${row.companyId.padEnd(32)} ${row.disposition.padEnd(20)} ${bits}`)
  }

  console.log('\n--- Summary ---')
  console.log(`  companies checked : ${r.total}`)
  console.log(`  qualifying        : ${r.candidates}`)
  console.log(`  enrolled          : ${r.enrolled}`)
  console.log(`  dispatched        : ${r.dispatched}`)
  console.log(`  skipped           : ${r.skipped}`)
  console.log(`  failed            : ${r.failed}`)
  console.log('  by disposition    :', JSON.stringify(r.byDisposition))
  if (!APPLY && r.candidates > 0) {
    console.log(`\n  ${r.candidates} company(ies) WOULD be enrolled. Re-run with --apply to act.`)
  }
  console.log()
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
