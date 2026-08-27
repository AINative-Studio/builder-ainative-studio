/**
 * "I'm stuck" jump-to-answer search (#321, GR-12).
 *
 * Pure, dependency-free retrieval over the FULL docs catalog — every section of
 * every guide in lib/data/seo-guides.ts plus every Help Center FAQ entry in
 * lib/build/help-faq.ts — so a user stuck anywhere can jump straight to the
 * exact section that answers them, via deep links:
 *
 *   /guides/{slug}#{anchor}   (guide sections + guide FAQs)
 *   /help#{faq-id}            (Help Center FAQ entries)
 *
 * Anchors are generated here (slugified headings, de-duplicated per page) and
 * the guide page imports the SAME generator to stamp ids on its headings, so
 * the deep links and the rendered anchors can never drift apart.
 *
 * ── RANKER SEAM (ZeroDB embeddings) ────────────────────────────────────────
 * Retrieval is expressed as a StuckRanker function: (question, catalog, limit)
 * → ranked results. The default is `keywordRanker` (tokenize + weighted keyword
 * overlap — pure, deterministic, zero-latency). To upgrade to semantic search,
 * implement a StuckRanker backed by ZeroDB embeddings (embed each catalog
 * entry's searchable text once, embed the question at query time, rank by
 * cosine similarity) and pass it to `searchStuck` — nothing else changes:
 * the catalog, anchors, and API contract stay identical.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Video timestamps: OnboardingVideo (components/build/OnboardingVideo.tsx) has
 * no chapter/timestamp data in the repo today (it is a placeholder driven by a
 * single src env var). When chapters exist, add them to the catalog as
 * source: 'video' entries with href `?t=SECONDS` — the ranker needs no changes.
 */

import { GUIDES, type SeoGuide } from '@/lib/data/seo-guides'
import { FAQ_ENTRIES } from '@/lib/build/help-faq'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One searchable entry in the catalog (a guide section, guide FAQ, or help FAQ). */
export interface StuckSection {
  /** Stable unique id, e.g. "guides/how-to-build-a-saas-with-ai#add-a-database". */
  id: string
  /** Where this entry lives. 'video' is reserved for chapter data (none today). */
  source: 'guide' | 'guide-faq' | 'help-faq' | 'video'
  /** Section heading / FAQ question. */
  title: string
  /** Parent document title (guide title, or "Help Center FAQ"). */
  parentTitle: string
  /** Deep link, e.g. "/guides/{slug}#{anchor}" or "/help#{id}". */
  href: string
  /** Short preview shown in results (first paragraph, truncated). */
  snippet: string
  /** Full body text used for ranking (paragraphs + bullets / answer). */
  body: string
  /** Extra ranking keywords (guide tags/keywords, FAQ keywords). */
  keywords: string[]
}

/** A ranked search hit returned to the UI. */
export interface StuckResult {
  href: string
  title: string
  parentTitle: string
  source: StuckSection['source']
  snippet: string
  score: number
}

/**
 * The ranker seam. Implementations MUST be side-effect free from the caller's
 * point of view and MUST return at most `limit` results, best first.
 */
export type StuckRanker = (
  question: string,
  catalog: StuckSection[],
  limit: number,
) => StuckResult[]

// ---------------------------------------------------------------------------
// Anchor generation (slugified headings, stable + unique per page)
// ---------------------------------------------------------------------------

/** Slugify a heading into a URL-safe anchor: lowercase, a-z0-9 and hyphens. */
export function slugifyAnchor(heading: string): string {
  const slug = String(heading || '')
    .toLowerCase()
    .replace(/['’]/g, '') // "user's" → "users", not "user-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

/**
 * Generate one anchor per heading, de-duplicated within a page ("-2", "-3" …
 * suffixes on repeats) so every section id is unique. An optional prefix
 * namespaces a group (e.g. 'faq') against the main section anchors.
 */
export function sectionAnchors(headings: string[], prefix = ''): string[] {
  const seen = new Map<string, number>()
  return headings.map((h) => {
    const base = (prefix ? `${prefix}-` : '') + slugifyAnchor(h)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  })
}

// ---------------------------------------------------------------------------
// Catalog — the full guides + FAQ corpus, built once per process
// ---------------------------------------------------------------------------

const SNIPPET_MAX = 180

/** Truncate body copy to a clean snippet for the results list. */
export function toSnippet(text: string, max = SNIPPET_MAX): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`
}

/** Build catalog entries for a single guide (sections + its FAQs). */
function guideEntries(guide: SeoGuide): StuckSection[] {
  const entries: StuckSection[] = []
  const anchors = sectionAnchors(guide.sections.map((s) => s.heading))

  guide.sections.forEach((section, i) => {
    const body = [...section.paragraphs, ...(section.bullets || [])].join(' ')
    entries.push({
      id: `guides/${guide.slug}#${anchors[i]}`,
      source: 'guide',
      title: section.heading,
      parentTitle: guide.title,
      href: `/guides/${guide.slug}#${anchors[i]}`,
      snippet: toSnippet(section.paragraphs[0] || body),
      body,
      keywords: [...guide.keywords, ...guide.tags],
    })
  })

  const faqAnchors = sectionAnchors(guide.faqs.map((f) => f.question), 'faq')
  guide.faqs.forEach((faq, i) => {
    entries.push({
      id: `guides/${guide.slug}#${faqAnchors[i]}`,
      source: 'guide-faq',
      title: faq.question,
      parentTitle: guide.title,
      href: `/guides/${guide.slug}#${faqAnchors[i]}`,
      snippet: toSnippet(faq.answer),
      body: faq.answer,
      keywords: [...guide.keywords, ...guide.tags],
    })
  })

  return entries
}

/**
 * Build the full searchable catalog: every guide section, every guide FAQ, and
 * every Help Center FAQ entry. Pure — same input data, same output.
 */
export function buildStuckCatalog(): StuckSection[] {
  const catalog: StuckSection[] = GUIDES.flatMap(guideEntries)

  for (const faq of FAQ_ENTRIES) {
    catalog.push({
      id: `help#${faq.id}`,
      source: 'help-faq',
      title: faq.question,
      parentTitle: 'Help Center FAQ',
      // /help renders each FAQ entry with id={entry.id} already — stable anchors.
      href: `/help#${faq.id}`,
      snippet: toSnippet(faq.answer),
      body: faq.answer,
      keywords: faq.keywords || [],
    })
  }

  return catalog
}

let cachedCatalog: StuckSection[] | null = null

/** Cached accessor — the corpus is static build-time data. */
export function getStuckCatalog(): StuckSection[] {
  if (!cachedCatalog) cachedCatalog = buildStuckCatalog()
  return cachedCatalog
}

// ---------------------------------------------------------------------------
// Default ranker — tokenize + weighted keyword overlap
// ---------------------------------------------------------------------------

/** English stopwords dropped before overlap scoring (mirrors help-faq's set). */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'is', 'are', 'do', 'does', 'i', 'im', 'my', 'me',
  'to', 'of', 'for', 'on', 'in', 'it', 'this', 'that', 'can', 'how', 'what',
  'with', 'you', 'your', 'we', 'our', 'be', 'or', 'as', 'at', 'by', 'so', 'if',
  'get', 'use', 'stuck', 'when', 'why', 'where', 'am', 'cant', 'not', 'but',
])

/** Tokenize into lowercase alphanumeric words, dropping stopwords + 1-char tokens. */
export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Field weights: a title hit is worth more than a keyword hit than a body hit. */
const WEIGHT_TITLE = 3
const WEIGHT_KEYWORD = 2
const WEIGHT_BODY = 1

/**
 * Score one catalog entry against tokenized query terms via weighted overlap.
 * Each distinct query token counts once at its highest-weight match.
 */
export function scoreSection(queryTokens: string[], section: StuckSection): number {
  if (queryTokens.length === 0) return 0
  const title = new Set(tokenize(section.title))
  const keywords = new Set(tokenize(section.keywords.join(' ')))
  const body = new Set(tokenize(section.body))
  let score = 0
  for (const t of new Set(queryTokens)) {
    if (title.has(t)) score += WEIGHT_TITLE
    else if (keywords.has(t)) score += WEIGHT_KEYWORD
    else if (body.has(t)) score += WEIGHT_BODY
  }
  return score
}

/**
 * Default StuckRanker: pure keyword-overlap ranking. Deterministic — ties keep
 * catalog order (guides before help FAQ). Returns [] for empty/stopword-only
 * questions and when nothing in the corpus overlaps (no fake matches).
 */
export const keywordRanker: StuckRanker = (question, catalog, limit) => {
  const queryTokens = tokenize(question)
  if (queryTokens.length === 0) return []
  return catalog
    .map((section, order) => ({ section, order, score: scoreSection(queryTokens, section) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ section, score }) => ({
      href: section.href,
      title: section.title,
      parentTitle: section.parentTitle,
      source: section.source,
      snippet: section.snippet,
      score,
    }))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const DEFAULT_RESULT_LIMIT = 5

/**
 * Search the full docs catalog for the sections most likely to unstick the
 * user. Swap `ranker` for a ZeroDB-embeddings implementation to go semantic
 * (see RANKER SEAM note at the top of this file).
 */
export function searchStuck(
  question: string,
  limit = DEFAULT_RESULT_LIMIT,
  ranker: StuckRanker = keywordRanker,
): StuckResult[] {
  return ranker(question, getStuckCatalog(), limit)
}
