/**
 * Idea backfill (#1102/#1113 follow-up) — repair registry rows created
 * before `idea` persistence shipped (#660/#696, 2026-09-11).
 *
 * THE GAP THIS CLOSES
 * Live.tsx's real landing-page (company-app) and real-product
 * (company-product) generation triggers both gate on
 * `state.idea && state.appSub` — state.idea hydrates from
 * `resolveApp(slug).idea` (see Live.tsx's #660 hydration effect). A registry
 * row with no `idea` field at all (every row created before #660 shipped)
 * never satisfies that gate, so NEITHER generation ever fires for it —
 * regardless of track. habanero-hub (created 2026-09-12, one day after the
 * #660 fix shipped but evidently still missing the field — the fix's own
 * backfill-the-rest-of-registration-callers rollout was itself gradual) is
 * the confirmed real instance: its registry row genuinely has no `idea`,
 * and its ONE real generation (the dashboard-only `Orders()` component) was
 * produced through the OLDER, pre-#660 flow that bypassed the registry
 * entirely.
 *
 * THE REAL SIGNAL
 * `generations` (lib/zerodb-store.ts's `loadGeneration()`) already has the
 * real idea text, wrapped in one of three known template phrasings
 * (company-app/route.ts, company-product/route.ts, useRealPreview.ts) —
 * `extractIdeaFromPrompt()` below strips the known wrapper and trailing
 * boilerplate the same way lib/showcase-data.ts's `extractShowcaseTitle()`
 * already does for the title case, but keeps the FULL idea text rather than
 * truncating to a title.
 *
 * SAFETY — mirrors loop-backfill.ts's contract:
 *  - Dry-run by default (via the CLI wrapper, scripts/backfill-idea.ts).
 *  - Never overwrites a real idea — setAppIdea() itself no-ops (returns
 *    true, not an error) if the row already has one.
 *  - Fails closed per-company: a lookup/extraction failure skips that one
 *    company and is reported, never silently drops the whole sweep.
 *  - Writes nothing by itself beyond the one new field — never touches
 *    track, plan, or any other registry column.
 */

import { listAllAppsWithStatus, setAppIdea, type AppEntry } from '@/lib/build/app-registry'
import { loadGeneration } from '@/lib/zerodb-store'
import { logger } from '@/lib/logger'

/**
 * Strip each known generation-prompt wrapper (prefix) and trailing
 * boilerplate (suffix) so what remains is the founder's real idea text.
 * Returns null if the prompt doesn't match any known wrapper shape at all —
 * callers should skip rather than backfill garbage.
 */
export function extractIdeaFromPrompt(prompt: string): string | null {
  const text = (prompt || '').trim()
  if (!text) return null

  const wrappers: Array<{ prefix: RegExp; suffixMarkers: string[] }> = [
    {
      // company-product/route.ts
      prefix: /^Build\s+a\s+real,\s+working,\s+functional\s+application\s+for\s+"[^"]*"\s+that\s+actually\s+implements\s+this\s+idea:\s*/i,
      suffixMarkers: [". This is the founder's REAL, WORKING TOOL"],
    },
    {
      // company-app/route.ts — tagline is optional, so the prefix must tolerate its absence.
      prefix: /^Build\s+a\s+polished,\s+production-quality\s+single-page\s+marketing\s+LANDING\s+PAGE\s+for\s+"[^"]*"(?:\s*\(tagline:\s*"[^"]*"\))?\s*—\s*a\s+real\s+company\s+for\s+this\s+idea:\s*/i,
      suffixMarkers: ['. Include: a hero with the value prop'],
    },
    {
      // useRealPreview.ts (single-file quick-preview path)
      prefix: /^Build\s+a\s+polished,\s+working\s+web\s+app\s+for\s+this\s+idea:\s*/i,
      suffixMarkers: ['. Make it interactive'],
    },
  ]

  for (const { prefix, suffixMarkers } of wrappers) {
    const stripped = text.replace(prefix, '')
    if (stripped === text) continue // this wrapper didn't match
    let idea = stripped
    for (const marker of suffixMarkers) {
      const idx = idea.indexOf(marker)
      if (idx !== -1) {
        idea = idea.slice(0, idx)
        break
      }
    }
    idea = idea.trim()
    return idea || null
  }

  return null
}

export interface IdeaBackfillResult {
  slug: string
  disposition: 'backfilled' | 'already_has_idea' | 'no_generation_found' | 'unrecognized_prompt_shape' | 'write_failed'
  idea?: string
}

export interface IdeaBackfillSummary {
  registryOk: boolean
  total: number
  candidates: number
  backfilled: number
  results: IdeaBackfillResult[]
}

/**
 * Sweep every registry entry missing `idea`, look up its real generation
 * prompt by chatId, extract the real idea text, and (unless dryRun) write
 * it back via setAppIdea(). Never touches a row that already has an idea.
 */
export async function runIdeaBackfillSweep(opts: { dryRun: boolean }): Promise<IdeaBackfillSummary> {
  const { apps, ok } = await listAllAppsWithStatus()
  if (!ok) {
    return { registryOk: false, total: 0, candidates: 0, backfilled: 0, results: [] }
  }

  const candidates = apps.filter((a: AppEntry) => !a.idea && a.chatId && a.slug)
  const results: IdeaBackfillResult[] = []
  let backfilled = 0

  for (const app of candidates) {
    try {
      const generation = await loadGeneration(app.chatId)
      if (!generation?.prompt) {
        results.push({ slug: app.slug, disposition: 'no_generation_found' })
        continue
      }
      const idea = extractIdeaFromPrompt(generation.prompt)
      if (!idea) {
        results.push({ slug: app.slug, disposition: 'unrecognized_prompt_shape' })
        continue
      }
      if (opts.dryRun) {
        results.push({ slug: app.slug, disposition: 'backfilled', idea })
        backfilled++
        continue
      }
      const wrote = await setAppIdea(app.slug, idea)
      if (!wrote) {
        results.push({ slug: app.slug, disposition: 'write_failed' })
        continue
      }
      results.push({ slug: app.slug, disposition: 'backfilled', idea })
      backfilled++
    } catch (e) {
      logger.warn('[idea-backfill] sweep failed for company', { slug: app.slug, err: (e as Error)?.message })
      results.push({ slug: app.slug, disposition: 'write_failed' })
    }
  }

  return { registryOk: true, total: apps.length, candidates: candidates.length, backfilled, results }
}
