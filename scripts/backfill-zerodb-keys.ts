/**
 * #1013 — one-shot ZeroDB data-plane key backfill, as a CLI.
 *
 * Repairs companies provisioned BEFORE #806 (2026-09-22) whose per-company key
 * was never written to `builder_company_zerodb_keys`, which makes every
 * `/api/db` call for that company fail closed (502 KEY_UNAVAILABLE) — silently
 * losing real waitlist signups behind the generated app's own
 * `.catch(() => {})` success UI. Confirmed live for `agentive`; ~17 of 31
 * historically-provisioned projects are affected, all of them pre-#806.
 *
 * All the logic lives in lib/build/zerodb-key-backfill.ts (read its doc comment
 * for the repair strategy and why a fresh key is minted against the EXISTING
 * project rather than re-provisioning). This is a thin, reviewable wrapper —
 * the sweep is a one-shot repair, not a scheduled job, so running it from a
 * terminal with the output in front of you is the intended way to use it.
 *
 * SAFETY: dry run by default. `--apply` is required to write anything, and a
 * real run mints REAL credentials in core against REAL customer projects.
 * Review the dry-run output first.
 *
 *   Dry run (whole registry):  npx tsx scripts/backfill-zerodb-keys.ts
 *   Dry run (one company):     npx tsx scripts/backfill-zerodb-keys.ts --only agentive
 *   Real run (one company):    npx tsx scripts/backfill-zerodb-keys.ts --only agentive --apply
 *   Real run (whole backlog):  npx tsx scripts/backfill-zerodb-keys.ts --apply
 *
 * Requires ZERODB_API_KEY (or AINATIVE_API_KEY) + ZERODB_PROJECT_ID +
 * DEPLOYMENT_ENCRYPTION_KEY in the env — e.g. via
 * `railway run --service builder-ainative-studio npx tsx scripts/backfill-zerodb-keys.ts`.
 *
 * STRONGLY RECOMMENDED: do the first real run with `--only <slug>` against ONE
 * company, then verify a real `/api/db` read/write for that company's live app
 * actually succeeds, before running the whole backlog.
 *
 * A `--only` with no slug after it (e.g. the typo `--only --apply`) EXITS 1
 * before reading or minting anything — it is never read as "no scope
 * restriction". "Whole registry" has to be asked for by omitting `--only`.
 */

export {}

import { runZerodbKeyBackfillSweep, MAX_BACKFILLS_PER_RUN } from '../lib/build/zerodb-key-backfill'
import { parseBackfillArgs, BackfillArgsError, type BackfillArgs } from './backfill-zerodb-keys-args'

/**
 * `--only slug-a,slug-b` / repeated `--only`, plus `--apply`.
 *
 * Parsed by a pure, tested function (backfill-zerodb-keys-args.ts) that treats a
 * `--only` with no slug as a HARD ERROR rather than an unscoped run: `--only
 * --apply`, a one-token typo of the recommended canary `--only agentive
 * --apply`, used to silently widen the scope from one company to the entire
 * registry while still applying. Exit before anything is read or minted.
 */
let ARGS: BackfillArgs
try {
  ARGS = parseBackfillArgs(process.argv.slice(2))
} catch (e) {
  if (e instanceof BackfillArgsError) {
    console.error(`\n✗ ${e.message}\n`)
    process.exit(1)
  }
  throw e
}

const APPLY = ARGS.apply

const MARKS: Record<string, string> = {
  backfilled: '✓',
  would_backfill: '→',
  already_stored: '=',
  not_provisioned: '·',
  capped: '…',
  mint_failed: '✗',
  store_failed: '✗',
  unverifiable: '?',
}

async function main() {
  const onlySlugs = ARGS.onlySlugs
  console.log(
    `\n#1013 ZeroDB key backfill — ${APPLY ? 'APPLY (mints real credentials!)' : 'DRY RUN (no writes)'}` +
      `${onlySlugs.length ? `  scope: ${onlySlugs.join(', ')}` : '  scope: whole registry'}\n`,
  )

  const r = await runZerodbKeyBackfillSweep({ dryRun: !APPLY, onlySlugs })

  if (!r.registryOk) {
    console.error('✗ Company registry read FAILED — the sweep did not run.')
    console.error('  An empty result here is NOT "every company has a key" (see core#7395).')
    process.exit(1)
  }

  for (const row of r.results) {
    // Don't bury the real signal under dozens of never-provisioned companies.
    if (row.disposition === 'not_provisioned' && !onlySlugs.length) continue
    const bits = [
      row.projectId ? row.projectId : '',
      row.provisionedAt ? `provisioned=${row.provisionedAt}` : '',
      row.reason ? `(${row.reason})` : '',
    ]
      .filter(Boolean)
      .join('  ')
    console.log(`  ${MARKS[row.disposition] || ' '} ${row.slug.padEnd(28)} ${row.disposition.padEnd(16)} ${bits}`)
  }

  const skippedQuiet = r.results.filter((x) => x.disposition === 'not_provisioned').length
  console.log('\n--- Summary ---')
  console.log(`  provisioned companies checked : ${r.checked}`)
  console.log(`  missing a stored key          : ${r.missing}`)
  console.log(`  backfilled                    : ${r.backfilled}`)
  console.log(`  failed                        : ${r.failed}`)
  if (skippedQuiet && !onlySlugs.length) {
    console.log(`  never provisioned (not shown) : ${skippedQuiet}`)
  }
  console.log('  by disposition                :', JSON.stringify(r.byDisposition))

  if (!APPLY && r.missing > 0) {
    console.log(`\n  ${r.missing} company(ies) WOULD be repaired. Re-run with --apply to act.`)
    console.log('  Start with a single company: --only <slug> --apply, then verify its real /api/db calls.')
  }
  if (r.byDisposition.capped) {
    console.log(`\n  Per-run cap (${MAX_BACKFILLS_PER_RUN}) reached — re-run to continue; the sweep is idempotent.`)
  }
  if (r.failed > 0) {
    console.log(`\n  ${r.failed} company(ies) could NOT be repaired — see the reasons above.`)
    console.log('  A mint_failed with a 404 means that ZeroDB project is genuinely gone or')
    console.log('  unreachable by Builder\'s identity: a real terminal case, not a script bug.')
  }
  console.log()

  // A per-company failure is real information, not a crashed script — but it
  // must not exit 0, or an operator (or CI) will read the run as fully clean.
  if (r.failed > 0) process.exit(2)
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
