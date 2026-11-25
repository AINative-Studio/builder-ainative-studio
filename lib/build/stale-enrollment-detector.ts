/**
 * #2156 — read-only visibility for "nightly-loop-enrolled, but the registry
 * has no chatId at all" companies.
 *
 * Confirmed live: company "flo" has `chatId: null` in the registry (no
 * generation was ever stored for it) and has still been nightly-loop-enrolled
 * for 24+ consecutive days, with a fresh "Nightly backlog" task created every
 * night for a company with nothing to maintain.
 *
 * No existing health signal can see this cohort:
 *  - registration-reconcile.ts's sweep enumerates companies via
 *    listAllAppsWithStatus(), which filters to rows that already HAVE a
 *    chatId (by design — every other caller of that function needs one). So
 *    reconcileRegistration()'s own `no_chat_id` early return can never fire
 *    during the sweep; the row never reaches it.
 *  - nightly-loop's own enrollment list has no chatId check at all before
 *    seeding a backlog task.
 *
 * This function is deliberately read-only and makes no product decision
 * (unenroll vs. prompt the founder to regenerate from scratch) — that choice
 * needs a human, per #2156. It only answers "which companies are in this
 * cohort right now," the "cheap, read-only win" #2156 asked for.
 */

import { listRegistryEntriesMissingChatId } from '@/lib/build/app-registry'
import { listEnrolled } from '@/lib/build/loop-enrollment'

export interface EnrolledMissingChatId {
  slug: string
  companyName: string
  enrolledAt: string
  lastRunAt?: string
}

export interface FindEnrolledMissingChatIdResult {
  /** False only when the registry read itself failed — never report this as "none found". */
  ok: boolean
  companies: EnrolledMissingChatId[]
}

export async function findEnrolledCompaniesMissingChatId(): Promise<FindEnrolledMissingChatIdResult> {
  const [missing, enrolled] = await Promise.all([
    listRegistryEntriesMissingChatId(),
    listEnrolled(),
  ])
  if (!missing.ok) return { ok: false, companies: [] }

  const enrolledBySlug = new Map(enrolled.map((e) => [e.companyId, e]))
  const companies: EnrolledMissingChatId[] = []
  for (const entry of missing.apps) {
    const enrollment = enrolledBySlug.get(entry.slug)
    if (!enrollment) continue
    companies.push({
      slug: entry.slug,
      companyName: enrollment.companyName || entry.name || entry.slug,
      enrolledAt: enrollment.enrolledAt,
      lastRunAt: enrollment.lastRunAt,
    })
  }
  return { ok: true, companies }
}
