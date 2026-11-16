/**
 * Metadata freshness gate — detects a company's PERSISTED `/app/layout.tsx`
 * still carrying one of two already-fixed, already-confirmed generator bugs,
 * so a one-shot backfill sweep (metadata-backfill.ts) can file a real backlog
 * task for it, the same way obedience-backfill.ts does for obedience-gate
 * gaps.
 *
 * THE BUGS THIS DETECTS (both fixed in `lib/ainative-file-generator.ts`,
 * neither backfilled to already-generated companies):
 *
 *  - #1952 (fixed 2026-11-11): `extractAppMetadata()`'s old unanchored
 *    `for\s+(\w+)` name scan locked onto the literal word "this" from the
 *    landing-page wrapper's OWN later "...a real company for this idea: ..."
 *    boilerplate, for every company whose prompt went through that wrapper.
 *    Confirmed live (same incident report): wrench, lumeo, shingle, tidemark
 *    all served `title: 'this — Ecommerce Application'` and
 *    `metadataBase: new URL('https://this.app')`.
 *
 *  - #2024 (fixed 2026-11-14): `extractAppMetadata()`'s old `type` detection
 *    matched the substring "product" inside the wrapper's own
 *    "production-quality" boilerplate phrase, so ~57.5% of sampled companies
 *    — regardless of real business — got mislabeled `type: 'ecommerce'`,
 *    i.e. `title: '{Name} — Ecommerce Application'` for a CRM, a field-service
 *    platform, a knowledge marketplace, etc.
 *
 * Neither fix was ever applied to a company's already-persisted
 * `/app/layout.tsx` — generation-time fixes never retroactively repair
 * existing durable files, the same caveat every other gate/backfill pair in
 * this codebase documents (obedience-gate.ts/obedience-backfill.ts,
 * completeness-gate.ts/completeness-backfill.ts). Re-sampling wrench, lumeo,
 * and shingle's CURRENT production files (2026-11-15) confirms both bugs are
 * still live for every one of them — this gate exists to turn that into a
 * real, trackable backlog item per affected company instead of a one-off
 * issue re-discovered by hand each time.
 *
 * DELIBERATELY NARROW: only flags the two confirmed bug signatures above,
 * never general "the title doesn't match what I'd generate today" drift —
 * a founder may have legitimately customized their own metadata since
 * generation, and this gate must never suggest clobbering that.
 */

import { extractAppMetadata } from '@/lib/ainative-file-generator'

export interface MetadataFreshnessResult {
  stale: boolean
  reasons: string[]
}

const TITLE_RE = /title:\s*'([^']*) — ([^']*) Application'/

/**
 * PURE — no I/O. `persistedLayoutTs` is the company's current durable
 * `/app/layout.tsx` file content; `prompt`/`code` are the same inputs
 * `extractAppMetadata()` takes everywhere else it's called, so this re-runs
 * the REAL, current (fixed) classifier rather than a reimplementation.
 */
export function checkMetadataFreshness(
  prompt: string,
  code: string,
  persistedLayoutTs: string,
): MetadataFreshnessResult {
  const reasons: string[] = []
  const layout = persistedLayoutTs || ''

  if (!layout.trim()) {
    return { stale: false, reasons: [] }
  }

  if (/metadataBase:\s*new URL\('https:\/\/this\.app'\)/.test(layout)) {
    reasons.push(
      'layout.tsx metadataBase is the literal placeholder domain "https://this.app" — the #1952 unanchored-name-scan bug signature (fixed in extractAppMetadata, never backfilled).',
    )
  }

  const titleMatch = layout.match(TITLE_RE)
  if (titleMatch) {
    const [, persistedName, persistedType] = titleMatch
    if (persistedName === 'this' && !reasons.some((r) => r.includes('metadataBase'))) {
      reasons.push(
        'layout.tsx <title>/OG/Twitter metadata reads the literal company name "this" instead of the real company name — the #1952 unanchored-name-scan bug signature (fixed in extractAppMetadata, never backfilled).',
      )
    }

    if (persistedType === 'Ecommerce') {
      const meta = extractAppMetadata(prompt || '', code || '')
      const expectedType = meta.type.charAt(0).toUpperCase() + meta.type.slice(1)
      if (expectedType !== 'Ecommerce') {
        reasons.push(
          `layout.tsx title/JSON-LD category reads "Ecommerce Application" but the current (fixed) classifier says "${expectedType} Application" for this company's real idea — the #2024 "product"-inside-"production-quality" bug signature (fixed in extractAppMetadata, never backfilled).`,
        )
      }
    }
  }

  return { stale: reasons.length > 0, reasons }
}
