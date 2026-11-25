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
 *  - #1971 (fixed, date predates this gate): `generateNextLayoutTs()` now
 *    runs the idea/prompt text through `escapeJsStringLiteral()`
 *    (lib/ainative-file-generator.ts) before splicing it into the
 *    `description`/`openGraph.description`/`twitter.description` single-
 *    quoted string literals, escaping backslashes, quotes, and — critically
 *    — turning a raw `\r\n`/`\n` into the two-character escape `\n`. A
 *    company generated before that fix landed can still have a RAW,
 *    unescaped newline byte sitting inside one of those single-quoted
 *    literals — an immediate `Unterminated string literal` parse error for
 *    any real TS/Next.js build of the file. Confirmed live (#2143, company
 *    "Value Economy", 2026-11-17): `ts.transpileModule()` on the stored
 *    `/app/layout.tsx` threw 10 diagnostics starting with exactly that
 *    message. Like #1952/#2024 above, the generation-time fix was never
 *    paired with a backfill sweep against already-stored companies.
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

// #2143/#1971 backfill: only the exact three `description: '...'` literals
// generateNextLayoutTs() itself emits (top-level metadata, openGraph,
// twitter) — never a blanket single-quote scan over the whole file, which
// would risk flagging a legitimate multi-line construct a founder added
// elsewhere after generation. `(?:[^'\\]|\\.)*` walks the literal the same
// way a real tokenizer would — an escaped char (`\\.`) is consumed as a
// pair so an escaped quote (`\\'`) can never be mistaken for the literal's
// closing quote.
const DESCRIPTION_LITERAL_RE = /description:\s*'((?:[^'\\]|\\.)*)'/g

/**
 * True when a stored layout.tsx has a RAW, unescaped newline byte inside one
 * of its `description: '...'` string literals — the exact #1971 generator
 * bug (fixed in `escapeJsStringLiteral()`, never backfilled). A real escape
 * sequence shows up as the two characters `\` and `n`, which this regex
 * class (`[^'\\]`) never matches raw inside the literal's body — only an
 * ACTUAL newline byte (`\n`/`\r`) trips this, so an already-escaped,
 * generated-after-#1971 company never false-positives here.
 */
export function hasUnescapedDescriptionNewline(persistedLayoutTs: string): boolean {
  const layout = persistedLayoutTs || ''
  for (const m of layout.matchAll(DESCRIPTION_LITERAL_RE)) {
    if (/[\r\n]/.test(m[1])) return true
  }
  return false
}

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

  if (hasUnescapedDescriptionNewline(layout)) {
    reasons.push(
      'layout.tsx has a raw, unescaped newline inside a description string literal — the #1971 generator bug (fixed in escapeJsStringLiteral, never backfilled); a real Next.js build of this file fails immediately with "Unterminated string literal".',
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
