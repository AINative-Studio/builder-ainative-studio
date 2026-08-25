/**
 * Media routine runner (#54) — the nightly-loop hook that executes DUE on-brand
 * media routines for a company and persists the generated assets to the company's
 * own storage. Sits alongside the swarm dispatch in the nightly loop.
 *
 * A routine is DUE when it is enabled and its computed next-run time is at/before
 * now (see {@link isRoutineDue}). For each due routine we run one on-brand
 * generation via the OWNED core Multimodal primitive; on success the routine's
 * lastRunAt advances (so the next run is scheduled forward and 'once' routines stop).
 *
 * FULLY GATED (#54 req 6): when media generation isn't configured this is inert —
 * runMediaGeneration returns 'disabled', nothing is persisted, and { generated: 0 }
 * is returned. Best-effort throughout: a per-routine failure is swallowed so the
 * nightly loop is never broken.
 */

import {
  listMedia,
  isRoutineDue,
  runMediaGeneration,
  saveRoutine,
  mediaGenerationConfigured,
  type BrandContext,
} from '@/lib/build/media-schedule'

/**
 * Run all DUE media routines for a scope. Returns how many assets were generated
 * (0 when unconfigured or nothing due). Never throws.
 */
export async function runMediaRoutines(
  scopeKey: string,
  brand: BrandContext,
): Promise<{ generated: number }> {
  if (!scopeKey || !mediaGenerationConfigured()) return { generated: 0 }

  let generated = 0
  try {
    const { routines } = await listMedia(scopeKey)
    for (const routine of routines) {
      if (!isRoutineDue(routine)) continue
      try {
        const result = await runMediaGeneration(scopeKey, routine.mediaKind, brand)
        if (result.status !== 'generated') continue
        generated += 1
        // Advance the routine forward. A 'once' routine disables after it fires;
        // recurring routines keep enabled with a fresh lastRunAt so nextRunAt moves.
        await saveRoutine(scopeKey, {
          mediaKind: routine.mediaKind,
          frequency: routine.frequency,
          enabled: routine.frequency !== 'once',
          lastRunAt: new Date().toISOString(),
        })
      } catch {
        /* per-routine failure is non-fatal — keep going */
      }
    }
  } catch {
    /* listing failure is non-fatal */
  }
  return { generated }
}
