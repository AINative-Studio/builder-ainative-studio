/**
 * #1032 — stuck-paid-founder plan backfill sweep, as a CLI.
 *
 * Amador (amador@selfpreneur.com, company `agentive`) was a genuine, confirmed
 * `pro` subscriber in core whose Builder registry row had `plan: null` — fixed
 * by hand via `setAppPlan('agentive', 'pro')`. This is the sweep version of
 * that same manual check: for every registered company whose registry plan is
 * null/undefined/a non-paid value, cross-reference its ownerEmail against
 * core's real admin user-lookup endpoint. Where core shows a genuinely paid
 * plan but the registry disagrees, that's a real mismatch.
 *
 * All logic lives in lib/build/paid-founder-plan-backfill.ts — this file is
 * just argument parsing + console reporting, so a CLI run and any future
 * cron/route wrapper can never disagree.
 *
 * SAFETY: dry run by default (report-only, same posture as
 * scripts/backfill-loop-enrollment.ts). `--execute` is required to actually
 * call setAppPlan() and write anything.
 *
 *   Dry run:  npx tsx scripts/backfill-stuck-paid-founders.ts
 *   Real run: npx tsx scripts/backfill-stuck-paid-founders.ts --execute
 *
 * Does NOT touch the ZeroDB key-claim half (tmp_ → permanent) — per the
 * issue and CODY.md Rule 5, that requires the founder's own real session and
 * is correctly left for their next login.
 *
 * Requires ZERODB_API_KEY (or AINATIVE_API_KEY) + ZERODB_PROJECT_ID in the
 * env, e.g. via `railway run --service builder-ainative-studio`.
 */

export {}

import { runPaidFounderPlanBackfillSweep } from '../lib/build/paid-founder-plan-backfill'

const EXECUTE = process.argv.includes('--execute')

async function main() {
  console.log(`\n#1032 stuck-paid-founder plan backfill — ${EXECUTE ? 'EXECUTE (writes!)' : 'DRY RUN (no writes, default)'}\n`)

  const r = await runPaidFounderPlanBackfillSweep({ dryRun: !EXECUTE })

  if (!r.registryOk) {
    console.error('✗ Company registry read FAILED — sweep did not run.')
    console.error('  An empty result here is NOT "no mismatches" (see core#7395).')
    process.exit(1)
  }

  const mismatchRows = r.results.filter((row) => row.disposition === 'mismatch')

  if (mismatchRows.length > 0) {
    console.log('--- Mismatches (core says paid, registry disagreed) ---')
    for (const row of mismatchRows) {
      const mark = row.fixed ? '✓' : '→'
      const bits = [
        `owner=${row.ownerEmail}`,
        `registryPlan=${row.registryPlan ?? 'null'}`,
        `corePlan=${row.corePlan}`,
        row.reason ? `(${row.reason})` : '',
      ].filter(Boolean).join(' ')
      console.log(`  ${mark} ${row.companyId.padEnd(32)} ${bits}`)
    }
    console.log()
  }

  console.log('--- Every other company (collapsed by disposition) ---')
  console.log('  ', JSON.stringify(r.byDisposition))

  console.log('\n--- Summary ---')
  console.log(`  companies checked : ${r.total}`)
  console.log(`  mismatches found  : ${r.mismatches}`)
  console.log(`  fixed (setAppPlan): ${r.fixed}`)
  console.log(`  failed            : ${r.failed}`)
  console.log('  by disposition    :', JSON.stringify(r.byDisposition))

  if (!EXECUTE && r.mismatches > 0) {
    console.log(`\n  ${r.mismatches} company(ies) WOULD be fixed. Re-run with --execute to act.`)
    console.log('  Mismatched slugs:', JSON.stringify(mismatchRows.map((row) => row.companyId)))
  } else if (r.mismatches === 0) {
    console.log('\n  No mismatches found — no OTHER company is in Amador\'s situation right now.')
  }

  // Note: this sweep never touches the ZeroDB key-claim half (tmp_ →
  // permanent) — that requires each founder's own real session (CODY.md
  // Rule 5) and is correctly left for their next login.
  console.log()
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
