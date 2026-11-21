/**
 * #2156 — read-only CLI over findEnrolledCompaniesMissingChatId()
 * (lib/build/stale-enrollment-detector.ts).
 *
 * Prints every company that is nightly-loop-enrolled but whose registry row
 * has no chatId at all (e.g. "flo" — confirmed live, enrolled 24+ days with
 * nothing for any pipeline to act on). Purely a visibility tool: no mutation
 * path exists here or in the function it calls, so there is nothing to
 * `--apply` and nothing to review before running it.
 *
 * This does NOT decide the product response (unenroll vs. prompt the founder
 * to regenerate) — that's a human decision per #2156. It only answers "which
 * companies are in this cohort right now."
 *
 *   npx tsx scripts/find-enrolled-missing-chatid.ts
 *
 * Requires the same ZeroDB/AINative read credentials as any other script in
 * this repo that reads the company registry or the loop enrollment store.
 */

export {}

import { findEnrolledCompaniesMissingChatId } from '../lib/build/stale-enrollment-detector'

async function main() {
  const result = await findEnrolledCompaniesMissingChatId()

  if (!result.ok) {
    console.error('[find-enrolled-missing-chatid] registry read failed — cannot report a result')
    process.exit(1)
  }

  if (result.companies.length === 0) {
    console.log('[find-enrolled-missing-chatid] none found — every enrolled company has a chatId')
    return
  }

  console.log(`[find-enrolled-missing-chatid] ${result.companies.length} enrolled compan${result.companies.length === 1 ? 'y' : 'ies'} with no chatId:`)
  for (const c of result.companies) {
    console.log(`  - ${c.slug} (${c.companyName}) — enrolled ${c.enrolledAt}, last run ${c.lastRunAt || 'never'}`)
  }
}

main().catch((err) => {
  console.error('[find-enrolled-missing-chatid] failed:', err)
  process.exit(1)
})
