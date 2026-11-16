/**
 * One-shot nightly-loop enrollment ownerKey backfill, as a CLI (#2114).
 *
 * The retroactive half of #2111/#2113: corrects a `builder_loop_enrollments`
 * row's stale/empty `ownerKey` for a company that is ALREADY stuck today and
 * has no reason to hit `register-app`, `subscription/verify`, or `provision`
 * again (the three places #2113 wired the forward-only fix into). `wrench`
 * and `tidemark` are the confirmed candidate companies as of #2114.
 *
 * All the logic lives in lib/build/loop-enrollment-backfill.ts (read its doc
 * comment, and lib/build/loop-enrollment.ts's `syncEnrollmentOwnerKey` doc
 * comment, for the full incident history). This is a thin, reviewable
 * wrapper — the sweep is a reviewed repair script, not a scheduled job, so
 * running it from a terminal with the output in front of you is the
 * intended way to use it.
 *
 * SAFETY: dry run by default. `--apply` is required to write anything.
 * `syncEnrollmentOwnerKey()` itself is a no-op for a company that isn't
 * enrolled yet or already carries the correct `ownerKey`, so a real run only
 * ever touches a company that is genuinely stale.
 *
 *   Dry run (whole registry):  npx tsx scripts/backfill-enrollment-ownerkey.ts
 *   Dry run (one company):     npx tsx scripts/backfill-enrollment-ownerkey.ts --only wrench
 *   Real run (one company):    npx tsx scripts/backfill-enrollment-ownerkey.ts --only wrench --apply
 *   Real run (whole backlog):  npx tsx scripts/backfill-enrollment-ownerkey.ts --apply
 *
 * Requires the same ZeroDB/AINative credentials as any other script in this
 * repo that reads the company registry and writes builder_loop_enrollments.
 *
 * STRONGLY RECOMMENDED: do the first real run with `--only <slug>` against
 * ONE already-confirmed-stuck company (e.g. `wrench`), then re-check
 * `GET /api/build/tasks?companyId=wrench`'s `counts.recurring` flips from
 * `0` to `1` and the company resumes getting real daily task-store touches,
 * before running the whole backlog.
 *
 * A `--only` with no slug after it exits 1 before reading or syncing
 * anything — same parser and reasoning as every other backfill script in
 * this repo.
 */

export {}

import { runOwnerKeyBackfillSweep } from '../lib/build/loop-enrollment-backfill'
import { parseBackfillArgs, BackfillArgsError } from './backfill-zerodb-keys-args'

async function main() {
  let args
  try {
    args = parseBackfillArgs(process.argv.slice(2))
  } catch (e) {
    if (e instanceof BackfillArgsError) {
      console.error(`[backfill-enrollment-ownerkey] ${e.message}`)
      process.exit(1)
    }
    throw e
  }

  const dryRun = !args.apply
  console.log(
    `[backfill-enrollment-ownerkey] ${dryRun ? 'DRY RUN' : 'REAL RUN'}` +
      (args.onlySlugs.length ? ` — scoped to: ${args.onlySlugs.join(', ')}` : ' — whole registry'),
  )

  const result = await runOwnerKeyBackfillSweep({ dryRun, onlySlugs: args.onlySlugs })

  if (!result.registryOk) {
    console.error('[backfill-enrollment-ownerkey] company registry read failed — nothing was checked.')
    process.exit(1)
  }

  console.log(
    `[backfill-enrollment-ownerkey] checked=${result.checked} synced=${result.synced} failed=${result.failed}`,
  )
  console.log('[backfill-enrollment-ownerkey] by disposition:', JSON.stringify(result.byDisposition, null, 2))

  for (const r of result.results) {
    if (r.disposition === 'no_owner_email') continue
    console.log(`  ${r.slug}: ${r.disposition}${r.ownerEmail ? ` (${r.ownerEmail})` : ''}`)
  }

  if (dryRun && result.checked > 0) {
    console.log(
      `\n[backfill-enrollment-ownerkey] ${result.checked} compan${result.checked === 1 ? 'y' : 'ies'} ` +
        'with a resolvable owner would be checked. Re-run with --apply to actually sync.',
    )
  }

  if (result.failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('[backfill-enrollment-ownerkey] fatal error:', e)
  process.exit(1)
})
