/**
 * #1102/#1113 — idea backfill sweep, as a CLI.
 *
 * Repairs registry rows created before `idea` persistence shipped (#660),
 * so Live.tsx's landing-page/product generation triggers (gated on
 * `state.idea`) can finally fire for them — see lib/build/idea-backfill.ts
 * for the full root-cause writeup.
 *
 * SAFETY: dry run by default. `--apply` is required to write anything.
 * A real run only ever sets a currently-empty `idea` field (setAppIdea()
 * itself refuses to overwrite a row that already has one) — it never
 * triggers a generation by itself; that still happens the normal way, the
 * next time the founder's Live dashboard mounts with the idea now present.
 *
 *   Dry run:  npx tsx scripts/backfill-idea.ts
 *   Real run: npx tsx scripts/backfill-idea.ts --apply
 *
 * Requires ZERODB_API_KEY (or AINATIVE_API_KEY) + ZERODB_PROJECT_ID in the
 * env, e.g. via `railway run --service builder-ainative-studio`.
 */

export {}

import { runIdeaBackfillSweep } from '../lib/build/idea-backfill'

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`\n#1102/#1113 idea backfill — ${APPLY ? 'APPLY (writes!)' : 'DRY RUN (no writes)'}\n`)

  const r = await runIdeaBackfillSweep({ dryRun: !APPLY })

  if (!r.registryOk) {
    console.error('✗ Company registry read FAILED — sweep did not run.')
    process.exit(1)
  }

  for (const row of r.results) {
    const mark = row.disposition === 'backfilled' ? (APPLY ? '✓' : '→') : '='
    const ideaPreview = row.idea ? ` "${row.idea.slice(0, 70)}${row.idea.length > 70 ? '…' : ''}"` : ''
    console.log(`  ${mark} ${row.slug.padEnd(32)} ${row.disposition}${ideaPreview}`)
  }

  console.log('\n--- Summary ---')
  console.log(`  registry rows checked : ${r.total}`)
  console.log(`  missing idea          : ${r.candidates}`)
  console.log(`  backfilled            : ${r.backfilled}`)
  if (!APPLY && r.candidates > 0) {
    console.log('\nDry run only — rerun with --apply to write these.')
  }
}

main().catch((e) => {
  console.error('Sweep crashed:', e)
  process.exit(1)
})
